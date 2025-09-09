import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import { IProtocol, ProtocolCapabilities, ProtocolHealthStatus } from '../core/ProtocolFactory.js';
import { 
  ConsoleSession, 
  SessionOptions, 
  ConsoleOutput, 
  ConsoleType,
  ContainerConsoleType,
  CommandExecution
} from '../types/index.js';
import { Logger } from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';
import stripAnsi from 'strip-ansi';

// LXC session interface extending base console session
interface LXCSession extends ConsoleSession {
  containerId?: string;
  containerName?: string;
  template?: string;
  isRunning: boolean;
  process?: ChildProcess;
  lxcCommand?: string[];
  config?: Record<string, string>;
}

// LXC container management options
interface LXCOptions {
  containerName: string;
  template?: string;
  command?: string[];
  workingDir?: string;
  env?: Record<string, string>;
  config?: Record<string, string>;
  network?: string;
  autoStart?: boolean;
  privileged?: boolean;
  removeOnExit?: boolean;
  rootfs?: string;
  storage?: string;
}

/**
 * Production-ready LXC Protocol implementation for console automation
 * Supports LXC containers, lxc-attach, and comprehensive container lifecycle management
 */
export class LXCProtocol extends EventEmitter implements IProtocol {
  public readonly type = 'lxc';
  public readonly capabilities: ProtocolCapabilities;
  public readonly healthStatus: ProtocolHealthStatus;
  
  private logger: Logger;
  private isInitialized: boolean = false;
  private sessions: Map<string, LXCSession> = new Map();
  private processes: Map<string, ChildProcess> = new Map();
  private lxcAvailable: boolean = false;

  constructor() {
    super();
    this.logger = new Logger('LXCProtocol');
    
    this.capabilities = {
      supportsStreaming: true, supportsFileTransfer: true, supportsX11Forwarding: false,
      supportsPortForwarding: false, supportsAuthentication: false, supportsEncryption: false,
      supportsCompression: false, supportsMultiplexing: true, supportsKeepAlive: false,
      supportsReconnection: false, supportsBinaryData: true, supportsCustomEnvironment: true,
      supportsWorkingDirectory: true, supportsSignals: true, supportsResizing: true,
      supportsPTY: true, maxConcurrentSessions: 30, defaultTimeout: 30000,
      supportedEncodings: ['utf-8'], supportedAuthMethods: [],
      platformSupport: { windows: false, linux: true, macos: false, freebsd: false },
    };

    this.healthStatus = {
      isHealthy: true, lastChecked: new Date(), errors: [], warnings: [],
      metrics: { activeSessions: 0, totalSessions: 0, averageLatency: 0, successRate: 1.0, uptime: 0 },
      dependencies: {},
    };
  }

  async initialize(): Promise<void> {
    try {
      // Check if LXC is available
      await this.checkLXCAvailability();
      this.isInitialized = true;
      this.logger.info('LXC protocol initialized successfully', { available: this.lxcAvailable });
    } catch (error) {
      this.logger.error('Failed to initialize LXC protocol', { error: (error as Error).message });
      throw error;
    }
  }

  private async checkLXCAvailability(): Promise<void> {
    return new Promise((resolve, reject) => {
      const lxcProcess = spawn('lxc-ls', ['--version'], { stdio: 'pipe' });
      
      lxcProcess.on('exit', (code) => {
        this.lxcAvailable = code === 0;
        if (this.lxcAvailable) {
          resolve();
        } else {
          reject(new Error('LXC is not available or not installed'));
        }
      });

      lxcProcess.on('error', (error) => {
        this.lxcAvailable = false;
        reject(new Error(`LXC check failed: ${error.message}`));
      });
    });
  }

  async createSession(options: SessionOptions): Promise<LXCSession> {
    if (!this.lxcAvailable) {
      throw new Error('LXC is not available. Ensure LXC is installed and properly configured');
    }

    const sessionId = uuidv4();
    const lxcOptions = this.parseLXCOptions(options);
    
    try {
      // Create container if it doesn't exist
      await this.ensureContainer(lxcOptions);
      
      // Start container if not running
      await this.startContainer(lxcOptions.containerName);
      
      const session: LXCSession = {
        id: sessionId,
        command: options.command,
        args: options.args || [],
        cwd: options.cwd || '/root',
        env: options.env || {},
        createdAt: new Date(),
        status: 'running',
        type: 'lxc' as ConsoleType,
        streaming: options.streaming || false,
        executionState: 'idle',
        activeCommands: new Map(),
        containerId: lxcOptions.containerName,
        containerName: lxcOptions.containerName,
        template: lxcOptions.template,
        isRunning: true,
        config: lxcOptions.config
      };

      this.sessions.set(sessionId, session);
      
      // Attach to container and start session
      await this.attachToContainer(session, lxcOptions);

      this.logger.info('LXC session created', {
        sessionId,
        containerName: lxcOptions.containerName,
        template: lxcOptions.template
      });

      return session;

    } catch (error) {
      this.logger.error('Failed to create LXC session', {
        sessionId,
        error: (error as Error).message
      });
      throw error;
    }
  }

  private parseLXCOptions(options: SessionOptions): LXCOptions {
    // Parse LXC-specific options from session options
    const lxcOpts = (options as any).lxcOptions || {};
    
    return {
      containerName: lxcOpts.containerName || `console-session-${uuidv4().substring(0, 8)}`,
      template: lxcOpts.template || 'ubuntu',
      command: lxcOpts.command || [options.command, ...(options.args || [])],
      workingDir: lxcOpts.workingDir || options.cwd || '/root',
      env: { ...options.env, ...lxcOpts.env },
      config: lxcOpts.config || {},
      network: lxcOpts.network,
      autoStart: lxcOpts.autoStart !== false,
      privileged: lxcOpts.privileged || false,
      removeOnExit: lxcOpts.removeOnExit !== false,
      rootfs: lxcOpts.rootfs,
      storage: lxcOpts.storage
    };
  }

  private async ensureContainer(options: LXCOptions): Promise<void> {
    // Check if container exists
    const exists = await this.containerExists(options.containerName);
    
    if (!exists) {
      await this.createContainer(options);
    }
  }

  private async containerExists(containerName: string): Promise<boolean> {
    return new Promise((resolve) => {
      const lxcProcess = spawn('lxc-info', ['-n', containerName], { stdio: 'pipe' });
      
      lxcProcess.on('exit', (code) => {
        resolve(code === 0);
      });

      lxcProcess.on('error', () => {
        resolve(false);
      });
    });
  }

  private async createContainer(options: LXCOptions): Promise<void> {
    const lxcArgs = ['lxc-create', '-n', options.containerName];
    
    if (options.template) {
      lxcArgs.push('-t', options.template);
    }
    
    // Add configuration options
    if (options.config) {
      for (const [key, value] of Object.entries(options.config)) {
        lxcArgs.push('--', `--${key}=${value}`);
      }
    }

    return new Promise((resolve, reject) => {
      const createProcess = spawn('sudo', lxcArgs, { stdio: 'pipe' });

      let stderr = '';
      createProcess.stderr?.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      createProcess.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Failed to create LXC container: ${stderr}`));
        }
      });

      createProcess.on('error', (error) => {
        reject(new Error(`Container creation failed: ${error.message}`));
      });
    });
  }

  private async startContainer(containerName: string): Promise<void> {
    // Check if container is already running
    const isRunning = await this.isContainerRunning(containerName);
    if (isRunning) {
      return;
    }

    return new Promise((resolve, reject) => {
      const startProcess = spawn('sudo', ['lxc-start', '-n', containerName, '-d'], { stdio: 'pipe' });

      let stderr = '';
      startProcess.stderr?.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      startProcess.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Failed to start LXC container: ${stderr}`));
        }
      });

      startProcess.on('error', (error) => {
        reject(new Error(`Container start failed: ${error.message}`));
      });
    });
  }

  private async isContainerRunning(containerName: string): Promise<boolean> {
    return new Promise((resolve) => {
      const infoProcess = spawn('lxc-info', ['-n', containerName, '-s'], { stdio: 'pipe' });
      
      let stdout = '';
      infoProcess.stdout?.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      infoProcess.on('exit', () => {
        resolve(stdout.includes('RUNNING'));
      });

      infoProcess.on('error', () => {
        resolve(false);
      });
    });
  }

  private async attachToContainer(session: LXCSession, options: LXCOptions): Promise<void> {
    const lxcArgs = ['lxc-attach', '-n', options.containerName];
    
    // Add environment variables
    if (options.env) {
      for (const [key, value] of Object.entries(options.env)) {
        lxcArgs.push('--set-var', `${key}=${value}`);
      }
    }
    
    // Add command if specified
    if (options.command && options.command.length > 0) {
      lxcArgs.push('--', ...options.command);
    }

    const attachProcess = spawn('sudo', lxcArgs, { stdio: 'pipe' });
    this.processes.set(session.id, attachProcess);

    attachProcess.stdout?.on('data', (chunk) => {
      const output: ConsoleOutput = {
        sessionId: session.id,
        type: 'stdout',
        data: stripAnsi(chunk.toString()),
        timestamp: new Date(),
        raw: chunk.toString()
      };
      this.emit('output', output);
    });

    attachProcess.stderr?.on('data', (chunk) => {
      const output: ConsoleOutput = {
        sessionId: session.id,
        type: 'stderr',
        data: stripAnsi(chunk.toString()),
        timestamp: new Date(),
        raw: chunk.toString()
      };
      this.emit('output', output);
    });

    attachProcess.on('exit', (code) => {
      session.status = code === 0 ? 'stopped' : 'crashed';
      session.exitCode = code || undefined;
      session.isRunning = false;
      this.emit('session-ended', session);
    });

    attachProcess.on('error', (error) => {
      this.logger.error('Container attach process error', {
        sessionId: session.id,
        containerName: session.containerName,
        error: error.message
      });
      session.status = 'crashed';
      session.isRunning = false;
    });
  }

  async executeCommand(sessionId: string, command: string, args?: string[]): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (!session.isRunning) {
      throw new Error(`Session ${sessionId} is not running`);
    }

    const fullCommand = args ? [command, ...args] : [command];
    
    const lxcArgs = [
      'lxc-attach',
      '-n', session.containerName!,
      '--',
      ...fullCommand
    ];

    const execProcess = spawn('sudo', lxcArgs, { stdio: 'pipe' });

    execProcess.stdout?.on('data', (chunk) => {
      const output: ConsoleOutput = {
        sessionId: session.id,
        type: 'stdout',
        data: stripAnsi(chunk.toString()),
        timestamp: new Date(),
        raw: chunk.toString()
      };
      this.emit('output', output);
    });

    execProcess.stderr?.on('data', (chunk) => {
      const output: ConsoleOutput = {
        sessionId: session.id,
        type: 'stderr',
        data: stripAnsi(chunk.toString()),
        timestamp: new Date(),
        raw: chunk.toString()
      };
      this.emit('output', output);
    });
  }

  async sendInput(sessionId: string, input: string): Promise<void> {
    const process = this.processes.get(sessionId);
    if (!process || !process.stdin) {
      throw new Error(`No active process for session ${sessionId}`);
    }

    process.stdin.write(input);
  }

  async getOutput(sessionId: string, since?: Date): Promise<string> {
    // For LXC, output is handled via events
    // This could be enhanced to store and retrieve historical output
    return '';
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    try {
      // Stop the container if specified
      if (session.containerName && session.isRunning) {
        const lxcOptions = session as any;
        if (lxcOptions.removeOnExit !== false) {
          // Stop the container
          const stopProcess = spawn('sudo', ['lxc-stop', '-n', session.containerName], { stdio: 'pipe' });
          
          await new Promise((resolve) => {
            stopProcess.on('exit', resolve);
            setTimeout(resolve, 5000); // Force resolve after 5 seconds
          });

          // Destroy the container
          spawn('sudo', ['lxc-destroy', '-n', session.containerName], { stdio: 'ignore' });
        }
      }

      // Clean up process
      const process = this.processes.get(sessionId);
      if (process && !process.killed) {
        process.kill('SIGTERM');
      }
      this.processes.delete(sessionId);

      session.status = 'stopped';
      session.isRunning = false;
      this.sessions.delete(sessionId);

      this.logger.info('LXC session closed', {
        sessionId,
        containerName: session.containerName
      });

    } catch (error) {
      this.logger.error('Failed to close LXC session', {
        sessionId,
        error: (error as Error).message
      });
    }
  }

  async getHealthStatus(): Promise<ProtocolHealthStatus> {
    const activeSessions = Array.from(this.sessions.values()).filter(s => s.isRunning).length;
    
    return {
      ...this.healthStatus,
      isHealthy: this.lxcAvailable && this.isInitialized,
      lastChecked: new Date(),
      metrics: {
        ...this.healthStatus.metrics,
        activeSessions,
        totalSessions: this.sessions.size
      },
      dependencies: {
        lxc: {
          available: this.lxcAvailable,
          version: this.lxcAvailable ? 'detected' : undefined,
          error: this.lxcAvailable ? undefined : 'lxc not available'
        }
      }
    };
  }

  async dispose(): Promise<void> {
    this.logger.info('Disposing LXC protocol');

    // Close all active sessions
    const sessionIds = Array.from(this.sessions.keys());
    for (const sessionId of sessionIds) {
      try {
        await this.closeSession(sessionId);
      } catch (error) {
        this.logger.warn('Failed to close session during disposal', {
          sessionId,
          error: (error as Error).message
        });
      }
    }

    this.removeAllListeners();
    this.isInitialized = false;
  }
}