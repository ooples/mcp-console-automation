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

// Containerd session interface extending base console session
interface ContainerdSession extends ConsoleSession {
  containerId?: string;
  containerName?: string;
  namespace?: string;
  image?: string;
  isRunning: boolean;
  process?: ChildProcess;
  containerdCommand?: string[];
}

// Containerd container management options
interface ContainerdOptions {
  namespace?: string;
  image: string;
  containerName?: string;
  command?: string[];
  workingDir?: string;
  env?: Record<string, string>;
  runtime?: string;
  network?: string;
  volumes?: string[];
  removeOnExit?: boolean;
}

export class ContainerdProtocol extends EventEmitter implements IProtocol {
  public readonly type = 'containerd';
  public readonly capabilities: ProtocolCapabilities;
  public readonly healthStatus: ProtocolHealthStatus;
  
  private logger: Logger;
  private isInitialized: boolean = false;
  private sessions: Map<string, ContainerdSession> = new Map();
  private processes: Map<string, ChildProcess> = new Map();
  private containerdAvailable: boolean = false;

  constructor() {
    super();
    this.logger = new Logger('ContainerdProtocol');
    
    this.capabilities = {
      supportsStreaming: true, supportsFileTransfer: true, supportsX11Forwarding: false,
      supportsPortForwarding: false, supportsAuthentication: false, supportsEncryption: false,
      supportsCompression: false, supportsMultiplexing: true, supportsKeepAlive: false,
      supportsReconnection: false, supportsBinaryData: true, supportsCustomEnvironment: true,
      supportsWorkingDirectory: true, supportsSignals: true, supportsResizing: true,
      supportsPTY: true, maxConcurrentSessions: 50, defaultTimeout: 30000,
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
      // Check if containerd CLI (ctr) is available
      await this.checkContainerdAvailability();
      this.isInitialized = true;
      this.logger.info('Containerd protocol initialized successfully', { available: this.containerdAvailable });
    } catch (error) {
      this.logger.error('Failed to initialize Containerd protocol', { error: (error as Error).message });
      throw error;
    }
  }

  private async checkContainerdAvailability(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ctrProcess = spawn('ctr', ['version'], { stdio: 'pipe' });
      
      ctrProcess.on('exit', (code) => {
        this.containerdAvailable = code === 0;
        if (this.containerdAvailable) {
          resolve();
        } else {
          reject(new Error('Containerd (ctr) is not available or not installed'));
        }
      });

      ctrProcess.on('error', (error) => {
        this.containerdAvailable = false;
        reject(new Error(`Containerd check failed: ${error.message}`));
      });
    });
  }

  async createSession(options: SessionOptions): Promise<ContainerdSession> {
    if (!this.containerdAvailable) {
      throw new Error('Containerd is not available. Ensure containerd and ctr CLI are installed');
    }

    const sessionId = uuidv4();
    const containerdOptions = this.parseContainerdOptions(options);
    
    try {
      // Create and start container
      const containerId = await this.createContainer(containerdOptions);
      
      const session: ContainerdSession = {
        id: sessionId,
        command: options.command,
        args: options.args || [],
        cwd: options.cwd || '/app',
        env: options.env || {},
        createdAt: new Date(),
        status: 'running',
        type: 'containerd' as ConsoleType,
        streaming: options.streaming || false,
        executionState: 'idle',
        activeCommands: new Map(),
        containerId,
        containerName: containerdOptions.containerName,
        namespace: containerdOptions.namespace || 'default',
        image: containerdOptions.image,
        isRunning: true
      };

      this.sessions.set(sessionId, session);
      
      // Start container execution
      await this.startContainer(session, containerdOptions);

      this.logger.info('Containerd session created', {
        sessionId,
        containerId,
        image: containerdOptions.image,
        namespace: containerdOptions.namespace
      });

      return session;

    } catch (error) {
      this.logger.error('Failed to create Containerd session', {
        sessionId,
        error: (error as Error).message
      });
      throw error;
    }
  }

  private parseContainerdOptions(options: SessionOptions): ContainerdOptions {
    // Parse containerd-specific options from session options
    const containerdOpts = (options as any).containerdOptions || {};
    
    return {
      namespace: containerdOpts.namespace || 'default',
      image: containerdOpts.image || 'alpine:latest',
      containerName: containerdOpts.containerName || `console-session-${uuidv4().substring(0, 8)}`,
      command: containerdOpts.command || [options.command, ...(options.args || [])],
      workingDir: containerdOpts.workingDir || options.cwd || '/app',
      env: { ...options.env, ...containerdOpts.env },
      runtime: containerdOpts.runtime || 'io.containerd.runc.v2',
      network: containerdOpts.network,
      volumes: containerdOpts.volumes || [],
      removeOnExit: containerdOpts.removeOnExit !== false
    };
  }

  private async createContainer(options: ContainerdOptions): Promise<string> {
    const containerId = `${options.containerName}-${Date.now()}`;
    
    const ctrArgs = [
      '--namespace', options.namespace!,
      'container', 'create',
      '--runtime', options.runtime!,
      options.image,
      containerId
    ];

    // Add command if specified
    if (options.command && options.command.length > 0) {
      ctrArgs.push('--');
      ctrArgs.push(...options.command);
    }

    return new Promise((resolve, reject) => {
      const createProcess = spawn('ctr', ctrArgs, { stdio: 'pipe' });

      let stderr = '';
      createProcess.stderr?.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      createProcess.on('exit', (code) => {
        if (code === 0) {
          resolve(containerId);
        } else {
          reject(new Error(`Failed to create container: ${stderr}`));
        }
      });

      createProcess.on('error', (error) => {
        reject(new Error(`Container creation failed: ${error.message}`));
      });
    });
  }

  private async startContainer(session: ContainerdSession, options: ContainerdOptions): Promise<void> {
    const ctrArgs = [
      '--namespace', options.namespace!,
      'tasks', 'start',
      '--detach',
      session.containerId!
    ];

    const startProcess = spawn('ctr', ctrArgs, { stdio: 'pipe' });
    this.processes.set(session.id, startProcess);

    startProcess.stdout?.on('data', (chunk) => {
      const output: ConsoleOutput = {
        sessionId: session.id,
        type: 'stdout',
        data: stripAnsi(chunk.toString()),
        timestamp: new Date(),
        raw: chunk.toString()
      };
      this.emit('output', output);
    });

    startProcess.stderr?.on('data', (chunk) => {
      const output: ConsoleOutput = {
        sessionId: session.id,
        type: 'stderr',
        data: stripAnsi(chunk.toString()),
        timestamp: new Date(),
        raw: chunk.toString()
      };
      this.emit('output', output);
    });

    startProcess.on('exit', (code) => {
      session.status = code === 0 ? 'stopped' : 'crashed';
      session.exitCode = code || undefined;
      session.isRunning = false;
      this.emit('session-ended', session);
    });

    startProcess.on('error', (error) => {
      this.logger.error('Container process error', {
        sessionId: session.id,
        containerId: session.containerId,
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
    
    const ctrArgs = [
      '--namespace', session.namespace!,
      'tasks', 'exec',
      '--exec-id', `exec-${Date.now()}`,
      '-t',
      session.containerId!,
      ...fullCommand
    ];

    const execProcess = spawn('ctr', ctrArgs, { stdio: 'pipe' });

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
    // For containerd, output is handled via events
    // This could be enhanced to store and retrieve historical output
    return '';
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    try {
      // Stop the container task
      if (session.containerId && session.isRunning) {
        const stopArgs = [
          '--namespace', session.namespace!,
          'tasks', 'kill',
          session.containerId,
          'SIGTERM'
        ];

        const stopProcess = spawn('ctr', stopArgs, { stdio: 'pipe' });
        
        await new Promise((resolve) => {
          stopProcess.on('exit', resolve);
          setTimeout(resolve, 5000); // Force resolve after 5 seconds
        });

        // Remove container if specified
        const containerdOptions = session as any;
        if (containerdOptions.removeOnExit !== false) {
          const rmArgs = [
            '--namespace', session.namespace!,
            'container', 'rm',
            session.containerId
          ];
          spawn('ctr', rmArgs, { stdio: 'ignore' });
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

      this.logger.info('Containerd session closed', {
        sessionId,
        containerId: session.containerId
      });

    } catch (error) {
      this.logger.error('Failed to close Containerd session', {
        sessionId,
        error: (error as Error).message
      });
    }
  }

  async getHealthStatus(): Promise<ProtocolHealthStatus> {
    const activeSessions = Array.from(this.sessions.values()).filter(s => s.isRunning).length;
    
    return {
      ...this.healthStatus,
      isHealthy: this.containerdAvailable && this.isInitialized,
      lastChecked: new Date(),
      metrics: {
        ...this.healthStatus.metrics,
        activeSessions,
        totalSessions: this.sessions.size
      },
      dependencies: {
        containerd: {
          available: this.containerdAvailable,
          version: this.containerdAvailable ? 'detected' : undefined,
          error: this.containerdAvailable ? undefined : 'containerd not available'
        }
      }
    };
  }

  async dispose(): Promise<void> {
    this.logger.info('Disposing Containerd protocol');

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