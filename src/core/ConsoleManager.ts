import { spawn, ChildProcess, SpawnOptions } from 'child_process';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import stripAnsi from 'strip-ansi';
import { ConsoleSession, ConsoleOutput, ConsoleEvent, SessionOptions, ConsoleType } from '../types/index.js';
import { ErrorDetector } from './ErrorDetector.js';
import { Logger } from '../utils/logger.js';
import { StreamManager } from './StreamManager.js';
import PQueue from 'p-queue';
import { platform } from 'os';

export class ConsoleManager extends EventEmitter {
  private sessions: Map<string, ConsoleSession>;
  private processes: Map<string, ChildProcess>;
  private outputBuffers: Map<string, ConsoleOutput[]>;
  private streamManagers: Map<string, StreamManager>;
  private errorDetector: ErrorDetector;
  private logger: Logger;
  private queue: PQueue;
  private maxBufferSize: number = 10000;
  private maxSessions: number = 50;
  private resourceMonitor: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.sessions = new Map();
    this.processes = new Map();
    this.outputBuffers = new Map();
    this.streamManagers = new Map();
    this.errorDetector = new ErrorDetector();
    this.logger = new Logger('ConsoleManager');
    this.queue = new PQueue({ concurrency: 10 });
    this.startResourceMonitor();
  }

  private getShellCommand(type: ConsoleType): { command: string; args: string[] } {
    const osType = platform();
    
    switch (type) {
      case 'cmd':
        return { command: 'cmd.exe', args: ['/c'] };
      case 'powershell':
        return { command: 'powershell.exe', args: ['-NoProfile', '-Command'] };
      case 'pwsh':
        return { command: 'pwsh.exe', args: ['-NoProfile', '-Command'] };
      case 'bash':
        if (osType === 'win32') {
          // Try Git Bash or WSL
          return { command: 'bash.exe', args: ['-c'] };
        }
        return { command: '/bin/bash', args: ['-c'] };
      case 'zsh':
        return { command: '/bin/zsh', args: ['-c'] };
      case 'sh':
        return { command: '/bin/sh', args: ['-c'] };
      default:
        // Auto-detect based on OS
        if (osType === 'win32') {
          return { command: 'cmd.exe', args: ['/c'] };
        } else {
          return { command: '/bin/bash', args: ['-c'] };
        }
    }
  }

  async createSession(options: SessionOptions): Promise<string> {
    if (this.sessions.size >= this.maxSessions) {
      throw new Error(`Maximum session limit (${this.maxSessions}) reached`);
    }

    const sessionId = uuidv4();
    
    const session: ConsoleSession = {
      id: sessionId,
      command: options.command,
      args: options.args || [],
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...options.env } as Record<string, string>,
      createdAt: new Date(),
      status: 'running',
      type: options.consoleType || 'auto',
      streaming: options.streaming || false
    };

    try {
      let finalCommand: string;
      let finalArgs: string[] = [];
      let spawnOptions: SpawnOptions = {
        cwd: options.cwd || process.cwd(),
        env: { ...process.env, ...options.env } as any,
        shell: false,
        windowsHide: true
      };

      if (options.shell || options.consoleType) {
        const shellConfig = this.getShellCommand(options.consoleType || 'auto');
        finalCommand = shellConfig.command;
        
        if (options.command) {
          const fullCommand = options.args?.length 
            ? `${options.command} ${options.args.join(' ')}`
            : options.command;
          finalArgs = [...shellConfig.args, fullCommand];
        } else {
          // Interactive shell
          finalArgs = [];
          spawnOptions.shell = false;
        }
      } else {
        finalCommand = options.command;
        finalArgs = options.args || [];
      }

      const childProcess = spawn(finalCommand, finalArgs, spawnOptions);

      if (!childProcess.pid) {
        throw new Error('Failed to spawn process');
      }

      session.pid = childProcess.pid;
      
      this.sessions.set(sessionId, session);
      this.processes.set(sessionId, childProcess);
      this.outputBuffers.set(sessionId, []);

      // Setup stream manager for efficient streaming
      if (options.streaming) {
        const streamManager = new StreamManager(sessionId);
        this.streamManagers.set(sessionId, streamManager);
      }

      this.setupProcessHandlers(sessionId, childProcess, options);

      this.emitEvent({
        sessionId,
        type: 'started',
        timestamp: new Date(),
        data: { pid: childProcess.pid, command: options.command }
      });

      this.logger.info(`Session ${sessionId} created for command: ${options.command}`);
      
      return sessionId;
    } catch (error) {
      session.status = 'crashed';
      this.sessions.set(sessionId, session);
      this.logger.error(`Failed to create session: ${error}`);
      throw error;
    }
  }

  private setupProcessHandlers(sessionId: string, process: ChildProcess, options: SessionOptions) {
    const streamManager = this.streamManagers.get(sessionId);
    
    // Handle stdout
    if (process.stdout) {
      process.stdout.on('data', (data: Buffer) => {
        const text = data.toString();
        const output: ConsoleOutput = {
          sessionId,
          type: 'stdout',
          data: stripAnsi(text),
          raw: text,
          timestamp: new Date()
        };

        this.addToBuffer(sessionId, output);
        
        if (streamManager) {
          streamManager.addChunk(text);
        }
        
        this.emitEvent({
          sessionId,
          type: 'output',
          timestamp: new Date(),
          data: output
        });

        if (options.detectErrors !== false) {
          this.queue.add(async () => {
            const errors = this.errorDetector.detect(output.data, options.patterns);
            if (errors.length > 0) {
              this.emitEvent({
                sessionId,
                type: 'error',
                timestamp: new Date(),
                data: { errors, output: output.data }
              });
            }
          });
        }
      });
    }

    // Handle stderr
    if (process.stderr) {
      process.stderr.on('data', (data: Buffer) => {
        const text = data.toString();
        const output: ConsoleOutput = {
          sessionId,
          type: 'stderr',
          data: stripAnsi(text),
          raw: text,
          timestamp: new Date()
        };

        this.addToBuffer(sessionId, output);
        
        if (streamManager) {
          streamManager.addChunk(text, true);
        }
        
        this.emitEvent({
          sessionId,
          type: 'output',
          timestamp: new Date(),
          data: output
        });

        // Always check stderr for errors
        this.queue.add(async () => {
          const errors = this.errorDetector.detect(output.data, options.patterns);
          if (errors.length > 0) {
            this.emitEvent({
              sessionId,
              type: 'error',
              timestamp: new Date(),
              data: { errors, output: output.data, isStderr: true }
            });
          }
        });
      });
    }

    // Handle process exit
    process.on('exit', (code: number | null, signal: string | null) => {
      const session = this.sessions.get(sessionId);
      if (session) {
        session.status = 'stopped';
        session.exitCode = code ?? undefined;
        this.sessions.set(sessionId, session);
      }

      if (streamManager) {
        streamManager.end();
      }

      this.emitEvent({
        sessionId,
        type: 'stopped',
        timestamp: new Date(),
        data: { exitCode: code, signal }
      });

      this.logger.info(`Session ${sessionId} exited with code: ${code}`);
    });

    process.on('error', (error: Error) => {
      const session = this.sessions.get(sessionId);
      if (session) {
        session.status = 'crashed';
        this.sessions.set(sessionId, session);
      }

      this.emitEvent({
        sessionId,
        type: 'error',
        timestamp: new Date(),
        data: { error: error.message }
      });

      this.logger.error(`Session ${sessionId} error: ${error.message}`);
    });

    if (options.timeout) {
      setTimeout(() => {
        if (this.isSessionRunning(sessionId)) {
          this.stopSession(sessionId);
        }
      }, options.timeout);
    }
  }

  async sendInput(sessionId: string, input: string): Promise<void> {
    const process = this.processes.get(sessionId);
    if (!process || !process.stdin) {
      throw new Error(`Session ${sessionId} not found or stdin not available`);
    }

    return new Promise((resolve, reject) => {
      process.stdin!.write(input, (error) => {
        if (error) {
          reject(error);
        } else {
          this.emitEvent({
            sessionId,
            type: 'input',
            timestamp: new Date(),
            data: { input }
          });
          resolve();
        }
      });
    });
  }

  async sendKey(sessionId: string, key: string): Promise<void> {
    const keyMap: Record<string, string> = {
      'enter': '\r\n',
      'tab': '\t',
      'escape': '\x1b',
      'backspace': '\x08',
      'delete': '\x7f',
      'ctrl+c': '\x03',
      'ctrl+d': '\x04',
      'ctrl+z': '\x1a',
      'ctrl+l': '\x0c',
      'ctrl+break': '\x03',
      'up': '\x1b[A',
      'down': '\x1b[B',
      'right': '\x1b[C',
      'left': '\x1b[D'
    };

    const sequence = keyMap[key.toLowerCase()] || key;
    await this.sendInput(sessionId, sequence);
  }

  getOutput(sessionId: string, limit?: number): ConsoleOutput[] {
    const buffer = this.outputBuffers.get(sessionId) || [];
    return limit ? buffer.slice(-limit) : buffer;
  }

  getLastOutput(sessionId: string, lines: number = 10): string {
    const outputs = this.getOutput(sessionId, lines);
    return outputs.map(o => o.data).join('');
  }

  getStream(sessionId: string): StreamManager | undefined {
    return this.streamManagers.get(sessionId);
  }

  clearOutput(sessionId: string): void {
    this.outputBuffers.set(sessionId, []);
    const streamManager = this.streamManagers.get(sessionId);
    if (streamManager) {
      streamManager.clear();
    }
  }

  isSessionRunning(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    return session?.status === 'running';
  }

  async stopSession(sessionId: string): Promise<void> {
    const process = this.processes.get(sessionId);
    if (process) {
      // Try graceful shutdown first
      if (platform() === 'win32') {
        process.kill('SIGTERM');
      } else {
        process.kill('SIGTERM');
      }
      
      // Force kill after timeout
      setTimeout(() => {
        if (process.killed === false) {
          process.kill('SIGKILL');
        }
      }, 2000);
      
      this.processes.delete(sessionId);
    }

    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = 'stopped';
      this.sessions.set(sessionId, session);
    }

    const streamManager = this.streamManagers.get(sessionId);
    if (streamManager) {
      streamManager.end();
      this.streamManagers.delete(sessionId);
    }
  }

  async stopAllSessions(): Promise<void> {
    const sessionIds = Array.from(this.sessions.keys());
    await Promise.all(sessionIds.map(id => this.stopSession(id)));
  }

  getSession(sessionId: string): ConsoleSession | undefined {
    return this.sessions.get(sessionId);
  }

  getAllSessions(): ConsoleSession[] {
    return Array.from(this.sessions.values());
  }

  getResourceUsage(): { sessions: number; memoryMB: number; bufferSizes: Record<string, number> } {
    const memoryUsage = process.memoryUsage();
    const bufferSizes: Record<string, number> = {};
    
    this.outputBuffers.forEach((buffer, sessionId) => {
      bufferSizes[sessionId] = buffer.length;
    });

    return {
      sessions: this.sessions.size,
      memoryMB: Math.round(memoryUsage.heapUsed / 1024 / 1024),
      bufferSizes
    };
  }

  private startResourceMonitor() {
    this.resourceMonitor = setInterval(() => {
      const usage = this.getResourceUsage();
      
      // Clean up stopped sessions older than 5 minutes
      const now = Date.now();
      this.sessions.forEach((session, id) => {
        if (session.status !== 'running') {
          const age = now - session.createdAt.getTime();
          if (age > 5 * 60 * 1000) {
            this.cleanupSession(id);
          }
        }
      });

      // Warn if memory usage is high
      if (usage.memoryMB > 500) {
        this.logger.warn(`High memory usage: ${usage.memoryMB}MB`);
      }
    }, 30000); // Check every 30 seconds
  }

  private cleanupSession(sessionId: string) {
    this.sessions.delete(sessionId);
    this.processes.delete(sessionId);
    this.outputBuffers.delete(sessionId);
    this.streamManagers.delete(sessionId);
    this.logger.debug(`Cleaned up session ${sessionId}`);
  }

  private addToBuffer(sessionId: string, output: ConsoleOutput) {
    const buffer = this.outputBuffers.get(sessionId) || [];
    buffer.push(output);
    
    if (buffer.length > this.maxBufferSize) {
      buffer.shift();
    }
    
    this.outputBuffers.set(sessionId, buffer);
  }

  private emitEvent(event: ConsoleEvent) {
    this.emit('console-event', event);
  }

  async waitForOutput(sessionId: string, pattern: string | RegExp, timeout: number = 5000): Promise<string> {
    return new Promise((resolve, reject) => {
      const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
      const startTime = Date.now();

      const checkOutput = () => {
        const output = this.getLastOutput(sessionId, 100);
        if (regex.test(output)) {
          resolve(output);
          return;
        }

        if (!this.isSessionRunning(sessionId)) {
          reject(new Error(`Session ${sessionId} has stopped`));
          return;
        }

        if (Date.now() - startTime > timeout) {
          reject(new Error(`Timeout waiting for pattern: ${pattern}`));
          return;
        }

        setTimeout(checkOutput, 100);
      };

      checkOutput();
    });
  }

  async executeCommand(command: string, args?: string[], options?: Partial<SessionOptions>): Promise<{ output: string; exitCode?: number }> {
    const sessionId = await this.createSession({
      command,
      args,
      ...options
    });

    return new Promise((resolve) => {
      const outputs: string[] = [];
      
      const handleEvent = (event: ConsoleEvent) => {
        if (event.sessionId !== sessionId) return;
        
        if (event.type === 'output') {
          outputs.push(event.data.data);
        } else if (event.type === 'stopped') {
          this.removeListener('console-event', handleEvent);
          this.cleanupSession(sessionId);
          resolve({
            output: outputs.join(''),
            exitCode: event.data.exitCode
          });
        }
      };

      this.on('console-event', handleEvent);
    });
  }

  destroy() {
    if (this.resourceMonitor) {
      clearInterval(this.resourceMonitor);
    }
    this.stopAllSessions();
    this.removeAllListeners();
    this.sessions.clear();
    this.processes.clear();
    this.outputBuffers.clear();
    this.streamManagers.clear();
  }
}