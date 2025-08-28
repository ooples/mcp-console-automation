import * as pty from 'node-pty';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import stripAnsi from 'strip-ansi';
import { ConsoleSession, ConsoleOutput, ErrorPattern, ConsoleEvent, SessionOptions } from '../types/index.js';
import { ErrorDetector } from './ErrorDetector.js';
import { Logger } from '../utils/logger.js';

export class ConsoleManager extends EventEmitter {
  private sessions: Map<string, ConsoleSession>;
  private terminals: Map<string, pty.IPty>;
  private outputBuffers: Map<string, ConsoleOutput[]>;
  private errorDetector: ErrorDetector;
  private logger: Logger;
  private maxBufferSize: number = 10000;

  constructor() {
    super();
    this.sessions = new Map();
    this.terminals = new Map();
    this.outputBuffers = new Map();
    this.errorDetector = new ErrorDetector();
    this.logger = new Logger('ConsoleManager');
  }

  async createSession(options: SessionOptions): Promise<string> {
    const sessionId = uuidv4();
    
    const session: ConsoleSession = {
      id: sessionId,
      command: options.command,
      args: options.args || [],
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...options.env },
      createdAt: new Date(),
      status: 'running'
    };

    try {
      const terminal = pty.spawn(options.command, options.args || [], {
        name: 'xterm-256color',
        cols: options.cols || 80,
        rows: options.rows || 24,
        cwd: options.cwd || process.cwd(),
        env: { ...process.env, ...options.env } as any,
        handleFlowControl: true
      });

      session.pid = terminal.pid;
      
      this.sessions.set(sessionId, session);
      this.terminals.set(sessionId, terminal);
      this.outputBuffers.set(sessionId, []);

      this.setupTerminalHandlers(sessionId, terminal, options);

      this.emitEvent({
        sessionId,
        type: 'started',
        timestamp: new Date(),
        data: { pid: terminal.pid, command: options.command }
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

  private setupTerminalHandlers(sessionId: string, terminal: pty.IPty, options: SessionOptions) {
    terminal.onData((data: string) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stdout',
        data: stripAnsi(data),
        raw: data,
        timestamp: new Date()
      };

      this.addToBuffer(sessionId, output);
      
      this.emitEvent({
        sessionId,
        type: 'output',
        timestamp: new Date(),
        data: output
      });

      if (options.detectErrors !== false) {
        const errors = this.errorDetector.detect(output.data, options.patterns);
        if (errors.length > 0) {
          this.emitEvent({
            sessionId,
            type: 'error',
            timestamp: new Date(),
            data: { errors, output: output.data }
          });
        }
      }
    });

    terminal.onExit((exitCode: { exitCode: number; signal?: number }) => {
      const session = this.sessions.get(sessionId);
      if (session) {
        session.status = 'stopped';
        session.exitCode = exitCode.exitCode;
        this.sessions.set(sessionId, session);
      }

      this.emitEvent({
        sessionId,
        type: 'stopped',
        timestamp: new Date(),
        data: { exitCode: exitCode.exitCode, signal: exitCode.signal }
      });

      this.logger.info(`Session ${sessionId} exited with code: ${exitCode.exitCode}`);
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
    const terminal = this.terminals.get(sessionId);
    if (!terminal) {
      throw new Error(`Session ${sessionId} not found`);
    }

    terminal.write(input);
    
    this.emitEvent({
      sessionId,
      type: 'input',
      timestamp: new Date(),
      data: { input }
    });
  }

  async sendKey(sessionId: string, key: string): Promise<void> {
    const keyMap: Record<string, string> = {
      'enter': '\r',
      'tab': '\t',
      'up': '\x1b[A',
      'down': '\x1b[B',
      'right': '\x1b[C',
      'left': '\x1b[D',
      'escape': '\x1b',
      'backspace': '\x7f',
      'delete': '\x1b[3~',
      'home': '\x1b[H',
      'end': '\x1b[F',
      'pageup': '\x1b[5~',
      'pagedown': '\x1b[6~',
      'ctrl+c': '\x03',
      'ctrl+d': '\x04',
      'ctrl+z': '\x1a',
      'ctrl+l': '\x0c'
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

  clearOutput(sessionId: string): void {
    this.outputBuffers.set(sessionId, []);
  }

  async resizeSession(sessionId: string, cols: number, rows: number): Promise<void> {
    const terminal = this.terminals.get(sessionId);
    if (!terminal) {
      throw new Error(`Session ${sessionId} not found`);
    }
    terminal.resize(cols, rows);
  }

  isSessionRunning(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    return session?.status === 'running';
  }

  async stopSession(sessionId: string): Promise<void> {
    const terminal = this.terminals.get(sessionId);
    if (terminal) {
      terminal.kill();
      this.terminals.delete(sessionId);
    }

    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = 'stopped';
      this.sessions.set(sessionId, session);
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
    this.stopAllSessions();
    this.removeAllListeners();
    this.sessions.clear();
    this.terminals.clear();
    this.outputBuffers.clear();
  }
}