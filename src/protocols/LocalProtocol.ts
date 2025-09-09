import { spawn, ChildProcess, SpawnOptions } from 'child_process';
import { EventEmitter } from 'events';
import { platform } from 'os';
import { IProtocol, ProtocolCapabilities, ProtocolHealthStatus } from '../core/ProtocolFactory.js';
import {
  ConsoleType,
  ConsoleSession,
  ConsoleOutput,
  SessionOptions,
  CommandExecution
} from '../types/index.js';
import { Logger } from '../utils/logger.js';

/**
 * Local Protocol implementation for native shell access
 * Supports cmd, powershell, bash, zsh, and other local shells
 */
export class LocalProtocol extends EventEmitter implements IProtocol {
  public readonly type: ConsoleType;
  public readonly capabilities: ProtocolCapabilities;
  public readonly healthStatus: ProtocolHealthStatus;

  private logger: Logger;
  private sessions: Map<string, LocalSession> = new Map();
  private isInitialized: boolean = false;

  constructor(type: ConsoleType) {
    super();
    this.type = type;
    this.logger = new Logger('LocalProtocol');
    
    this.capabilities = {
      supportsStreaming: true,
      supportsFileTransfer: false,
      supportsX11Forwarding: false,
      supportsPortForwarding: false,
      supportsAuthentication: false,
      supportsEncryption: false,
      supportsCompression: false,
      supportsMultiplexing: false,
      supportsKeepAlive: false,
      supportsReconnection: false,
      supportsBinaryData: false,
      supportsCustomEnvironment: true,
      supportsWorkingDirectory: true,
      supportsSignals: true,
      supportsResizing: true,
      supportsPTY: true,
      maxConcurrentSessions: 50,
      defaultTimeout: 30000,
      supportedEncodings: ['utf-8', 'ascii'],
      supportedAuthMethods: [],
      platformSupport: {
        windows: true,
        linux: true,
        macos: true,
        freebsd: true,
      },
    };

    this.healthStatus = {
      isHealthy: true,
      lastChecked: new Date(),
      errors: [],
      warnings: [],
      metrics: {
        activeSessions: 0,
        totalSessions: 0,
        averageLatency: 0,
        successRate: 1.0,
        uptime: 0,
      },
      dependencies: {
        shell: {
          available: false,
        },
      },
    };
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Validate shell availability
      await this.validateShellAvailability();
      
      this.healthStatus.dependencies.shell.available = true;
      this.healthStatus.isHealthy = true;
      this.isInitialized = true;
      
      this.logger.info(`Local protocol initialized for shell: ${this.type}`);
    } catch (error) {
      this.healthStatus.isHealthy = false;
      this.healthStatus.errors.push(`Failed to initialize: ${error}`);
      throw error;
    }
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    if (!this.isInitialized) {
      throw new Error('Protocol not initialized');
    }

    const sessionId = `local-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      const shellInfo = this.getShellInfo();
      const spawnOptions: SpawnOptions = {
        cwd: options.cwd || process.cwd(),
        env: { ...process.env, ...options.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      };

      const childProcess = spawn(shellInfo.command, shellInfo.args, spawnOptions);

      const session: LocalSession = {
        id: sessionId,
        type: this.type,
        process: childProcess,
        created: new Date(),
        lastActivity: new Date(),
        outputBuffer: '',
        errorBuffer: '',
        isActive: true,
      };

      // Setup process event handlers
      this.setupProcessHandlers(session);

      this.sessions.set(sessionId, session);
      this.healthStatus.metrics.activeSessions++;
      this.healthStatus.metrics.totalSessions++;

      const consoleSession: ConsoleSession = {
        id: sessionId,
        command: shellInfo.command,
        args: shellInfo.args,
        cwd: options.cwd || process.cwd(),
        env: { ...process.env, ...options.env },
        createdAt: new Date(),
        pid: childProcess.pid,
        status: 'running',
        type: this.type,
        streaming: options.streaming ?? false,
        executionState: 'idle',
        activeCommands: new Map(),
      };

      this.emit('sessionCreated', consoleSession);
      return consoleSession;

    } catch (error) {
      this.logger.error(`Failed to create local session: ${error}`);
      throw error;
    }
  }

  async executeCommand(sessionId: string, command: string, args?: string[]): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) {
      throw new Error(`Session ${sessionId} not found or inactive`);
    }

    try {
      const fullCommand = args ? `${command} ${args.join(' ')}` : command;
      const commandWithNewline = fullCommand + '\n';
      
      session.process.stdin?.write(commandWithNewline);
      session.lastActivity = new Date();

      this.emit('commandExecuted', {
        sessionId,
        command: fullCommand,
        timestamp: new Date(),
      });
      
    } catch (error) {
      this.logger.error(`Failed to execute command in session ${sessionId}: ${error}`);
      throw error;
    }
  }

  async sendInput(sessionId: string, input: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) {
      throw new Error(`Session ${sessionId} not found or inactive`);
    }

    try {
      session.process.stdin?.write(input);
      session.lastActivity = new Date();

      this.emit('inputSent', {
        sessionId,
        input,
        timestamp: new Date(),
      });
      
    } catch (error) {
      this.logger.error(`Failed to send input to session ${sessionId}: ${error}`);
      throw error;
    }
  }

  async getOutput(sessionId: string, since?: Date): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // For local protocols, we return the accumulated output buffer
    // In a production implementation, you'd want to track timestamps
    // and filter based on the 'since' parameter
    return session.outputBuffer + session.errorBuffer;
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return; // Session doesn't exist, nothing to close
    }

    try {
      session.isActive = false;
      
      if (session.process && !session.process.killed) {
        // Try graceful shutdown first
        session.process.kill('SIGTERM');
        
        // Force kill after timeout
        setTimeout(() => {
          if (session.process && !session.process.killed) {
            session.process.kill('SIGKILL');
          }
        }, 5000);
      }

      this.sessions.delete(sessionId);
      this.healthStatus.metrics.activeSessions = Math.max(0, this.healthStatus.metrics.activeSessions - 1);

      this.emit('sessionClosed', sessionId);
      
    } catch (error) {
      this.logger.error(`Failed to close session ${sessionId}: ${error}`);
      throw error;
    }
  }

  async getHealthStatus(): Promise<ProtocolHealthStatus> {
    // Update current metrics
    this.healthStatus.lastChecked = new Date();
    this.healthStatus.metrics.activeSessions = this.sessions.size;
    
    // Check shell availability
    try {
      await this.validateShellAvailability();
      this.healthStatus.dependencies.shell.available = true;
      this.healthStatus.isHealthy = true;
      this.healthStatus.errors = [];
    } catch (error) {
      this.healthStatus.dependencies.shell.available = false;
      this.healthStatus.isHealthy = false;
      this.healthStatus.errors = [`Shell not available: ${error}`];
    }

    return { ...this.healthStatus };
  }

  async dispose(): Promise<void> {
    this.logger.info(`Disposing local protocol: ${this.type}`);
    
    // Close all active sessions
    const sessionIds = Array.from(this.sessions.keys());
    await Promise.all(sessionIds.map(id => this.closeSession(id)));

    this.sessions.clear();
    this.removeAllListeners();
    this.isInitialized = false;
  }

  private getShellInfo(): { command: string; args: string[] } {
    switch (this.type) {
      case 'cmd':
        return { command: 'cmd.exe', args: ['/k'] };
      case 'powershell':
        return { command: 'powershell.exe', args: ['-NoLogo', '-NoExit'] };
      case 'pwsh':
        return { command: 'pwsh', args: ['-NoLogo', '-NoExit'] };
      case 'bash':
        return { command: 'bash', args: ['--login'] };
      case 'zsh':
        return { command: 'zsh', args: ['-l'] };
      case 'sh':
        return { command: 'sh', args: [] };
      case 'auto':
        return this.getDefaultShell();
      default:
        throw new Error(`Unsupported shell type: ${this.type}`);
    }
  }

  private getDefaultShell(): { command: string; args: string[] } {
    switch (platform()) {
      case 'win32':
        return { command: 'powershell.exe', args: ['-NoLogo', '-NoExit'] };
      case 'darwin':
        return { command: 'zsh', args: ['-l'] };
      default:
        return { command: 'bash', args: ['--login'] };
    }
  }

  private async validateShellAvailability(): Promise<void> {
    return new Promise((resolve, reject) => {
      const shellInfo = this.getShellInfo();
      const testProcess = spawn(shellInfo.command, ['--version'], { stdio: 'ignore' });
      
      testProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Shell ${shellInfo.command} not available (exit code: ${code})`));
        }
      });

      testProcess.on('error', (error) => {
        reject(new Error(`Shell ${shellInfo.command} not available: ${error.message}`));
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        testProcess.kill();
        reject(new Error(`Shell validation timeout for ${shellInfo.command}`));
      }, 5000);
    });
  }

  private setupProcessHandlers(session: LocalSession): void {
    if (!session.process) return;

    // Handle stdout
    session.process.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      session.outputBuffer += text;
      session.lastActivity = new Date();

      const output: ConsoleOutput = {
        sessionId: session.id,
        type: 'stdout',
        data: text,
        timestamp: new Date(),
        raw: text,
      };

      this.emit('output', output);
    });

    // Handle stderr
    session.process.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      session.errorBuffer += text;
      session.lastActivity = new Date();

      const output: ConsoleOutput = {
        sessionId: session.id,
        type: 'stderr',
        data: text,
        timestamp: new Date(),
        raw: text,
      };

      this.emit('output', output);
    });

    // Handle process exit
    session.process.on('close', (code, signal) => {
      session.isActive = false;
      this.logger.info(`Local session ${session.id} closed with code: ${code}, signal: ${signal}`);
      
      this.emit('sessionClosed', session.id);
      this.sessions.delete(session.id);
      this.healthStatus.metrics.activeSessions = Math.max(0, this.healthStatus.metrics.activeSessions - 1);
    });

    // Handle process errors
    session.process.on('error', (error) => {
      session.isActive = false;
      this.logger.error(`Local session ${session.id} error: ${error}`);
      
      this.emit('error', {
        sessionId: session.id,
        error: error.message,
        timestamp: new Date(),
      });
    });
  }
}

interface LocalSession {
  id: string;
  type: ConsoleType;
  process: ChildProcess;
  created: Date;
  lastActivity: Date;
  outputBuffer: string;
  errorBuffer: string;
  isActive: boolean;
}