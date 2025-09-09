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

// Podman session interface extending base console session
interface PodmanSession extends ConsoleSession {
  containerId?: string;
  containerName?: string;
  image?: string;
  isRunning: boolean;
  process?: ChildProcess;
  podmanCommand?: string[];
  pod?: string;
}

// Podman container management options
interface PodmanOptions {
  image: string;
  containerName?: string;
  command?: string[];
  workingDir?: string;
  env?: Record<string, string>;
  volumes?: string[];
  ports?: string[];
  network?: string;
  pod?: string;
  user?: string;
  privileged?: boolean;
  removeOnExit?: boolean;
  detach?: boolean;
  interactive?: boolean;
  tty?: boolean;
}

/**
 * Production-ready Podman Protocol implementation for console automation
 * Supports Podman containers, podman exec, pods, and comprehensive monitoring
 */
export class PodmanProtocol extends EventEmitter implements IProtocol {
  public readonly type = 'podman';
  public readonly capabilities: ProtocolCapabilities;
  public readonly healthStatus: ProtocolHealthStatus;
  
  private logger: Logger;
  private isInitialized: boolean = false;
  private sessions: Map<string, PodmanSession> = new Map();
  private processes: Map<string, ChildProcess> = new Map();
  private podmanAvailable: boolean = false;

  constructor() {
    super();
    this.logger = new Logger('PodmanProtocol');
    
    this.capabilities = {
      supportsStreaming: true,
      supportsFileTransfer: true,
      supportsX11Forwarding: false,
      supportsPortForwarding: true,
      supportsAuthentication: false,
      supportsEncryption: false,
      supportsCompression: false,
      supportsMultiplexing: true,
      supportsKeepAlive: false,
      supportsReconnection: false,
      supportsBinaryData: true,
      supportsCustomEnvironment: true,
      supportsWorkingDirectory: true,
      supportsSignals: true,
      supportsResizing: true,
      supportsPTY: true,
      maxConcurrentSessions: 50,
      defaultTimeout: 30000,
      supportedEncodings: ['utf-8'],
      supportedAuthMethods: [],
      platformSupport: {
        windows: false,
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
      dependencies: {},
    };
  }

  async initialize(): Promise<void> {
    try {
      // Check if Podman is available
      await this.checkPodmanAvailability();
      this.isInitialized = true;
      this.logger.info('Podman protocol initialized successfully', { available: this.podmanAvailable });
    } catch (error) {
      this.logger.error('Failed to initialize Podman protocol', { error: (error as Error).message });
      throw error;
    }
  }

  private async checkPodmanAvailability(): Promise<void> {
    return new Promise((resolve, reject) => {
      const podmanProcess = spawn('podman', ['--version'], { stdio: 'pipe' });
      
      podmanProcess.on('exit', (code) => {
        this.podmanAvailable = code === 0;
        if (this.podmanAvailable) {
          resolve();
        } else {
          reject(new Error('Podman is not available or not installed'));
        }
      });

      podmanProcess.on('error', (error) => {
        this.podmanAvailable = false;
        reject(new Error(`Podman check failed: ${error.message}`));
      });
    });
  }

  async createSession(options: SessionOptions): Promise<PodmanSession> {
    if (!this.podmanAvailable) {
      throw new Error('Podman is not available. Ensure Podman is installed and in PATH');
    }

    const sessionId = uuidv4();
    const podmanOptions = this.parsePodmanOptions(options);
    
    try {
      // Create and start container
      const containerId = await this.createContainer(podmanOptions);
      
      const session: PodmanSession = {
        id: sessionId,
        command: options.command,
        args: options.args || [],
        cwd: options.cwd || '/app',
        env: options.env || {},
        createdAt: new Date(),
        status: 'running',
        type: 'podman' as ConsoleType,
        streaming: options.streaming || false,
        executionState: 'idle',
        activeCommands: new Map(),
        containerId,
        containerName: podmanOptions.containerName,
        image: podmanOptions.image,
        isRunning: true,
        pod: podmanOptions.pod
      };

      this.sessions.set(sessionId, session);
      
      // Start container execution if not detached
      if (!podmanOptions.detach) {
        await this.startContainer(session, podmanOptions);
      }

      this.logger.info('Podman session created', {
        sessionId,
        containerId,
        image: podmanOptions.image,
        pod: podmanOptions.pod
      });

      return session;

    } catch (error) {
      this.logger.error('Failed to create Podman session', {
        sessionId,
        error: (error as Error).message
      });
      throw error;
    }
  }

  private parsePodmanOptions(options: SessionOptions): PodmanOptions {
    // Parse podman-specific options from session options
    const podmanOpts = (options as any).podmanOptions || {};
    
    return {
      image: podmanOpts.image || 'alpine:latest',
      containerName: podmanOpts.containerName || `console-session-${uuidv4().substring(0, 8)}`,
      command: podmanOpts.command || [options.command, ...(options.args || [])],
      workingDir: podmanOpts.workingDir || options.cwd || '/app',
      env: { ...options.env, ...podmanOpts.env },
      volumes: podmanOpts.volumes || [],
      ports: podmanOpts.ports || [],
      network: podmanOpts.network,
      pod: podmanOpts.pod,
      user: podmanOpts.user,
      privileged: podmanOpts.privileged || false,
      removeOnExit: podmanOpts.removeOnExit !== false,
      detach: podmanOpts.detach || false,
      interactive: podmanOpts.interactive !== false,
      tty: podmanOpts.tty !== false
    };
  }

  private async createContainer(options: PodmanOptions): Promise<string> {
    const podmanArgs = ['run'];
    
    // Add flags
    if (options.detach) podmanArgs.push('-d');
    if (options.interactive) podmanArgs.push('-i');
    if (options.tty) podmanArgs.push('-t');
    if (options.removeOnExit) podmanArgs.push('--rm');
    if (options.privileged) podmanArgs.push('--privileged');
    
    // Add name
    if (options.containerName) {
      podmanArgs.push('--name', options.containerName);
    }
    
    // Add working directory
    if (options.workingDir) {
      podmanArgs.push('-w', options.workingDir);
    }
    
    // Add user
    if (options.user) {
      podmanArgs.push('-u', options.user);
    }
    
    // Add environment variables
    if (options.env) {
      for (const [key, value] of Object.entries(options.env)) {
        podmanArgs.push('-e', `${key}=${value}`);
      }
    }
    
    // Add volumes
    if (options.volumes) {
      for (const volume of options.volumes) {
        podmanArgs.push('-v', volume);
      }
    }
    
    // Add port mappings
    if (options.ports) {
      for (const port of options.ports) {
        podmanArgs.push('-p', port);
      }
    }
    
    // Add network
    if (options.network) {
      podmanArgs.push('--network', options.network);
    }
    
    // Add pod
    if (options.pod) {
      podmanArgs.push('--pod', options.pod);
    }
    
    // Add image
    podmanArgs.push(options.image);
    
    // Add command
    if (options.command && options.command.length > 0) {
      podmanArgs.push(...options.command);
    }

    return new Promise((resolve, reject) => {
      const createProcess = spawn('podman', podmanArgs, { stdio: 'pipe' });

      let stdout = '';
      let stderr = '';
      
      createProcess.stdout?.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      
      createProcess.stderr?.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      createProcess.on('exit', (code) => {
        if (code === 0) {
          // Extract container ID from stdout (first line usually contains the ID)
          const containerId = stdout.trim().split('\n')[0] || options.containerName || 'unknown';
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

  private async startContainer(session: PodmanSession, options: PodmanOptions): Promise<void> {
    // If container was created with detach, we need to attach to it
    const podmanArgs = ['logs', '-f'];
    if (session.containerId) {
      podmanArgs.push(session.containerId);
    }

    const logsProcess = spawn('podman', podmanArgs, { stdio: 'pipe' });
    this.processes.set(session.id, logsProcess);

    logsProcess.stdout?.on('data', (chunk) => {
      const output: ConsoleOutput = {
        sessionId: session.id,
        type: 'stdout',
        data: stripAnsi(chunk.toString()),
        timestamp: new Date(),
        raw: chunk.toString()
      };
      this.emit('output', output);
    });

    logsProcess.stderr?.on('data', (chunk) => {
      const output: ConsoleOutput = {
        sessionId: session.id,
        type: 'stderr',
        data: stripAnsi(chunk.toString()),
        timestamp: new Date(),
        raw: chunk.toString()
      };
      this.emit('output', output);
    });

    logsProcess.on('exit', (code) => {
      session.status = code === 0 ? 'stopped' : 'crashed';
      session.exitCode = code || undefined;
      session.isRunning = false;
      this.emit('session-ended', session);
    });

    logsProcess.on('error', (error) => {
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
    
    const podmanArgs = [
      'exec',
      '-it',
      session.containerId!,
      ...fullCommand
    ];

    const execProcess = spawn('podman', podmanArgs, { stdio: 'pipe' });

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
    // For podman, output is handled via events
    // This could be enhanced to store and retrieve historical output
    return '';
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    try {
      // Stop the container
      if (session.containerId && session.isRunning) {
        const stopArgs = ['stop', session.containerId];
        const stopProcess = spawn('podman', stopArgs, { stdio: 'pipe' });
        
        await new Promise((resolve) => {
          stopProcess.on('exit', resolve);
          setTimeout(resolve, 5000); // Force resolve after 5 seconds
        });

        // Remove container if specified
        const podmanOptions = session as any;
        if (podmanOptions.removeOnExit !== false) {
          const rmArgs = ['rm', '-f', session.containerId];
          spawn('podman', rmArgs, { stdio: 'ignore' });
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

      this.logger.info('Podman session closed', {
        sessionId,
        containerId: session.containerId
      });

    } catch (error) {
      this.logger.error('Failed to close Podman session', {
        sessionId,
        error: (error as Error).message
      });
    }
  }

  async getHealthStatus(): Promise<ProtocolHealthStatus> {
    const activeSessions = Array.from(this.sessions.values()).filter(s => s.isRunning).length;
    
    return {
      ...this.healthStatus,
      isHealthy: this.podmanAvailable && this.isInitialized,
      lastChecked: new Date(),
      metrics: {
        ...this.healthStatus.metrics,
        activeSessions,
        totalSessions: this.sessions.size
      },
      dependencies: {
        podman: {
          available: this.podmanAvailable,
          version: this.podmanAvailable ? 'detected' : undefined,
          error: this.podmanAvailable ? undefined : 'podman not available'
        }
      }
    };
  }

  async dispose(): Promise<void> {
    this.logger.info('Disposing Podman protocol');

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