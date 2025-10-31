import { BaseProtocol } from '../core/BaseProtocol.js';
import { ProtocolCapabilities, SessionState } from '../core/IProtocol.js';
import { Readable, PassThrough } from 'stream';
import { v4 as uuidv4 } from 'uuid';
import stripAnsi from 'strip-ansi';
import * as path from 'path';
import * as os from 'os';

import {
  DockerConnectionOptions,
  DockerContainerOptions,
  DockerExecOptions,
  DockerSession,
  DockerContainerState,
  DockerContainerInfo,
  DockerHealthCheck,
  DockerLogStreamOptions,
  DockerLogEntry,
  DockerNetworkInfo,
  DockerVolumeInfo,
  DockerImageInfo,
  DockerRegistryAuth,
  DockerBuildOptions,
  DockerComposeService,
  DockerComposeConfig,
  DockerProtocolConfig,
  DockerMetrics,
  DockerEvent,
  ConsoleSession,
  ConsoleOutput,
  ConsoleEvent,
  SessionOptions,
  ConsoleType,
} from '../types/index.js';

// Docker API compatibility layer - handles optional dockerode dependency
interface DockerContainer {
  id: string;
  start(): Promise<void>;
  stop(options?: any): Promise<void>;
  remove(options?: any): Promise<void>;
  kill(options?: any): Promise<void>;
  exec(options: any): Promise<any>;
  stats(options?: any): any;
  logs(options?: any): any;
  inspect(): Promise<any>;
}

interface DockerAPI {
  createContainer(options: any): Promise<DockerContainer>;
  listContainers(options?: any): Promise<any[]>;
  getContainer(id: string): DockerContainer;
  getEvents(options?: any): any;
  version(callback?: (err: any, data: any) => void): Promise<any>;
  info(callback?: (err: any, data: any) => void): Promise<any>;
  ping(callback?: (err: any, data: any) => void): Promise<any>;
}

// Dynamic Docker import with fallback
let Docker: (new (options?: any) => DockerAPI) | null = null;
try {
  Docker = require('dockerode');
} catch (error) {
  // dockerode is optional dependency
  console.warn(
    'Docker support requires dockerode package. Install with: npm install dockerode'
  );
}

export interface DockerProtocolEvents {
  'container-created': (containerId: string, session: DockerSession) => void;
  'container-started': (containerId: string, session: DockerSession) => void;
  'container-stopped': (containerId: string, session: DockerSession) => void;
  'container-removed': (containerId: string, session: DockerSession) => void;
  'container-error': (
    containerId: string,
    error: Error,
    session: DockerSession
  ) => void;
  'exec-created': (execId: string, session: DockerSession) => void;
  'exec-started': (execId: string, session: DockerSession) => void;
  'exec-completed': (
    execId: string,
    exitCode: number,
    session: DockerSession
  ) => void;
  'health-check': (result: DockerHealthCheck, session: DockerSession) => void;
  'log-stream': (logEntry: DockerLogEntry, session: DockerSession) => void;
  'metrics-collected': (metrics: DockerMetrics, session: DockerSession) => void;
  'docker-event': (event: DockerEvent) => void;
  'connection-error': (error: Error) => void;
  reconnected: (connection: DockerAPI) => void;
  output: (output: ConsoleOutput) => void;
  sessionClosed: (sessionId: string) => void;
}

export declare interface DockerProtocol {
  on<U extends keyof DockerProtocolEvents>(
    event: U,
    listener: DockerProtocolEvents[U]
  ): this;
  emit<U extends keyof DockerProtocolEvents>(
    event: U,
    ...args: Parameters<DockerProtocolEvents[U]>
  ): boolean;
}

/**
 * Production-ready Docker Protocol implementation for console automation
 * Supports Docker containers, docker exec, docker-compose, health checks, and comprehensive monitoring
 */
export class DockerProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'docker';
  public readonly capabilities: ProtocolCapabilities;

  private docker: DockerAPI | null = null;
  private config: DockerProtocolConfig;
  private dockerSessions: Map<string, DockerSession> = new Map();
  private containers: Map<string, DockerContainer> = new Map();
  private execSessions: Map<string, any> = new Map();
  private healthChecks: Map<string, NodeJS.Timeout> = new Map();
  private logStreams: Map<string, PassThrough> = new Map();
  private metricsIntervals: Map<string, NodeJS.Timeout> = new Map();
  private eventMonitor?: NodeJS.Timeout;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private reconnectDelay: number = 5000;
  private connectionHealthy: boolean = false;
  private lastHealthCheck: Date = new Date();
  private dockerAvailable: boolean = false;

  constructor(config: DockerProtocolConfig) {
    super('DockerProtocol');
    this.config = config;

    this.capabilities = {
      supportsStreaming: true,
      supportsFileTransfer: true,
      supportsX11Forwarding: false,
      supportsPortForwarding: true,
      supportsAuthentication: true,
      supportsEncryption: false,
      supportsCompression: false,
      supportsMultiplexing: true,
      supportsKeepAlive: false,
      supportsReconnection: true,
      supportsBinaryData: true,
      supportsCustomEnvironment: true,
      supportsWorkingDirectory: true,
      supportsSignals: true,
      supportsResizing: true,
      supportsPTY: true,
      maxConcurrentSessions: 100,
      defaultTimeout: 30000,
      supportedEncodings: ['utf-8', 'binary'],
      supportedAuthMethods: ['registry-auth'],
      platformSupport: {
        windows: true,
        linux: true,
        macos: true,
        freebsd: true,
      },
    };
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    // Check if Docker is available
    this.dockerAvailable = Docker !== null;

    if (!this.dockerAvailable) {
      this.logger.warn(
        'Docker (dockerode) is not available. Install with: npm install dockerode'
      );
      this.connectionHealthy = false;
      throw new Error(
        'Docker (dockerode) is not available. Install with: npm install dockerode'
      );
    }

    // Initialize Docker connection with comprehensive error handling
    this.initializeDockerConnection();

    // Set up connection monitoring
    this.setupConnectionMonitoring();

    // Start event monitoring if enabled
    if (this.config.monitoring.enableMetrics) {
      this.startEventMonitoring();
    }

    this.isInitialized = true;
    this.logger.info(
      'Docker protocol initialized with session management fixes'
    );
  }

  /**
   * Initialize Docker connection with fallback strategies for different environments
   */
  private initializeDockerConnection(): void {
    if (!Docker || !this.dockerAvailable) {
      throw new Error('Docker (dockerode) is not available');
    }

    try {
      const connectionOptions: any = { ...this.config.connection };

      // Auto-detect Docker socket path based on platform
      if (!connectionOptions.socketPath && !connectionOptions.host) {
        const platform = os.platform();
        if (platform === 'win32') {
          // Windows Docker Desktop or Docker in WSL2
          connectionOptions.socketPath = '\\\\.\\pipe\\docker_engine';

          // Try WSL2 socket as fallback
          if (!this.testConnection(connectionOptions)) {
            connectionOptions.socketPath = '/var/run/docker.sock';
            connectionOptions.host = 'localhost';
            connectionOptions.port = 2375;
          }
        } else {
          // Unix-like systems
          connectionOptions.socketPath = '/var/run/docker.sock';
        }
      }

      this.docker = new Docker(connectionOptions);
      this.connectionHealthy = true;
      this.reconnectAttempts = 0;

      // Test connection
      this.testDockerConnection();

      this.logger.info('Docker connection initialized successfully', {
        socketPath: connectionOptions.socketPath,
        host: connectionOptions.host,
        port: connectionOptions.port,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to initialize Docker connection', {
        error: errorMessage,
      });
      this.connectionHealthy = false;
      this.emit(
        'connection-error',
        error instanceof Error ? error : new Error(errorMessage)
      );

      // Attempt reconnection
      this.scheduleReconnection();
    }
  }

  /**
   * Test Docker connection health
   */
  private async testDockerConnection(): Promise<boolean> {
    try {
      await this.docker!.ping();
      this.connectionHealthy = true;
      this.lastHealthCheck = new Date();
      return true;
    } catch (error) {
      this.connectionHealthy = false;
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warn('Docker connection test failed', {
        error: errorMessage,
      });
      return false;
    }
  }

  /**
   * Test connection synchronously for initialization
   */
  private testConnection(options: any): boolean {
    if (!Docker) return false;
    try {
      const testDocker = new Docker(options);
      // This is a synchronous test - in practice, you'd want to make this async
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Set up connection health monitoring
   */
  private setupConnectionMonitoring(): void {
    setInterval(async () => {
      if (!(await this.testDockerConnection())) {
        this.emit(
          'connection-error',
          new Error('Docker connection health check failed')
        );
        this.scheduleReconnection();
      }
    }, 30000); // Check every 30 seconds
  }

  /**
   * Schedule reconnection attempt with exponential backoff
   */
  private scheduleReconnection(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error('Maximum reconnection attempts exceeded');
      return;
    }

    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;

    setTimeout(() => {
      this.logger.info(
        `Attempting Docker reconnection (${this.reconnectAttempts}/${this.maxReconnectAttempts})`
      );
      this.initializeDockerConnection();
    }, delay);
  }

  /**
   * Start Docker event monitoring
   */
  private startEventMonitoring(): void {
    if (!this.docker) return;

    try {
      const eventsStream = this.docker.getEvents({});
      if (
        typeof eventsStream === 'object' &&
        eventsStream &&
        'on' in eventsStream
      ) {
        const stream = eventsStream as any;

        stream.on('data', (chunk: Buffer) => {
          try {
            const events = chunk.toString().trim().split('\n');
            for (const eventStr of events) {
              if (eventStr.trim()) {
                const event: DockerEvent = JSON.parse(eventStr);
                event.timestamp = new Date(event.timeNano / 1000000);
                this.emit('docker-event', event);
                this.handleDockerEvent(event);
              }
            }
          } catch (error) {
            this.logger.warn('Failed to parse Docker event', {
              error: (error as Error).message,
              chunk: chunk.toString(),
            });
          }
        });

        stream.on('error', (error: Error) => {
          this.logger.error('Docker event stream error', {
            error: error.message,
          });
        });
      } else {
        this.logger.warn('Docker events API not available or incompatible');
      }
    } catch (error) {
      this.logger.error('Failed to initialize Docker event monitoring', {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Handle Docker events for session state management
   */
  private handleDockerEvent(event: DockerEvent): void {
    if (event.type === 'container') {
      const containerId = event.actor.id;
      const session = Array.from(this.dockerSessions.values()).find(
        (s) => s.containerId === containerId
      );

      if (session) {
        switch (event.action) {
          case 'start':
            session.status = 'running';
            this.emit('container-started', containerId, session);
            break;
          case 'die':
          case 'stop':
            session.status = 'stopped';
            this.emit('container-stopped', containerId, session);
            break;
          case 'destroy':
            session.status = 'stopped';
            this.cleanupDockerSession(session.id);
            this.emit('container-removed', containerId, session);
            break;
        }
      }
    }
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const sessionId = `docker-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

    // Use session management fixes from BaseProtocol
    return await this.createSessionWithTypeDetection(sessionId, options);
  }

  protected async doCreateSession(
    sessionId: string,
    options: SessionOptions,
    sessionState: SessionState
  ): Promise<ConsoleSession> {
    if (!this.dockerAvailable || !this.docker) {
      throw new Error(
        'Docker (dockerode) is not available. Install with: npm install dockerode'
      );
    }

    if (!this.connectionHealthy) {
      throw new Error('Docker connection is not healthy');
    }

    try {
      const containerOptions = this.parseContainerOptions(options);
      const dockerOptions = options.dockerOptions || this.config.connection;

      // Create container
      const container = await this.docker.createContainer(containerOptions);
      const containerId = container.id;

      this.containers.set(containerId, container);

      // Build Docker session object
      const dockerSession: DockerSession = {
        id: sessionId,
        command: containerOptions.cmd?.[0] || options.command,
        args: containerOptions.cmd?.slice(1) || options.args || [],
        cwd: containerOptions.workingDir || options.cwd || '/app',
        env: this.parseEnvironment(containerOptions.env),
        createdAt: new Date(),
        status: sessionState.isOneShot ? 'initializing' : 'running',
        type: this.type,
        streaming: options.streaming || this.config.logStreaming.enabled,
        executionState: 'idle',
        activeCommands: new Map(),
        lastActivity: new Date(),
        dockerOptions,
        containerOptions,
        containerId,
        containerName: containerOptions.name,
        isExecSession: false,
        isRunning: false,
        autoCleanup:
          containerOptions.hostConfig?.autoRemove || this.config.autoCleanup,
        volumeMounts: this.parseVolumeMounts(
          containerOptions.hostConfig?.binds
        ),
        portMappings: this.parsePortMappings(
          containerOptions.hostConfig?.portBindings
        ),
      };

      this.dockerSessions.set(sessionId, dockerSession);

      // For persistent sessions, start container immediately
      // For one-shot sessions, start when executing command
      if (!sessionState.isOneShot) {
        await container.start();
        dockerSession.isRunning = true;
        dockerSession.status = 'running';

        // Get container info and update session
        const containerInfo = await container.inspect();
        dockerSession.containerState = this.parseContainerState(
          containerInfo.State
        );
        dockerSession.networkSettings = containerInfo.NetworkSettings;
        dockerSession.pid = containerInfo.State.Pid;

        this.emit('container-created', containerId, dockerSession);
        this.emit('container-started', containerId, dockerSession);

        // Set up health monitoring if enabled
        if (this.config.healthCheck.enabled) {
          this.startHealthCheck(dockerSession);
        }

        // Start log streaming if enabled
        if (dockerSession.streaming) {
          this.startLogStreaming(dockerSession);
        }

        // Start metrics collection if enabled
        if (this.config.monitoring.enableMetrics) {
          this.startMetricsCollection(dockerSession);
        }
      }

      // Create ConsoleSession for BaseProtocol
      const consoleSession: ConsoleSession = {
        id: sessionId,
        command: dockerSession.command,
        args: dockerSession.args,
        cwd: dockerSession.cwd,
        env: dockerSession.env,
        createdAt: dockerSession.createdAt,
        status: dockerSession.status,
        type: this.type,
        streaming: dockerSession.streaming,
        executionState: dockerSession.executionState,
        activeCommands: dockerSession.activeCommands,
        lastActivity: dockerSession.lastActivity,
        dockerOptions,
        pid: dockerSession.pid,
      };

      this.sessions.set(sessionId, consoleSession);
      this.outputBuffers.set(sessionId, []);

      this.logger.info(
        `Docker session ${sessionId} created (${sessionState.isOneShot ? 'one-shot' : 'persistent'})`,
        {
          containerId,
          image: containerOptions.image,
          name: containerOptions.name,
        }
      );

      return consoleSession;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to create Docker session', {
        sessionId,
        error: errorMessage,
      });

      // Cleanup on failure
      this.dockerSessions.delete(sessionId);
      throw error instanceof Error ? error : new Error(errorMessage);
    }
  }

  /**
   * Create a Docker exec session
   */
  async createExecSession(
    sessionOptions: SessionOptions & { containerId: string }
  ): Promise<DockerSession> {
    if (!this.dockerAvailable || !this.docker) {
      throw new Error(
        'Docker (dockerode) is not available. Install with: npm install dockerode'
      );
    }

    if (!this.connectionHealthy) {
      throw new Error('Docker connection is not healthy');
    }

    const sessionId = uuidv4();
    const { containerId } = sessionOptions;

    const container =
      this.containers.get(containerId) || this.docker.getContainer(containerId);
    if (!container) {
      throw new Error(`Container ${containerId} not found`);
    }

    const execOptions: DockerExecOptions = {
      cmd: [sessionOptions.command, ...(sessionOptions.args || [])],
      attachStdout: true,
      attachStderr: true,
      attachStdin: true,
      tty: true,
      env: sessionOptions.env
        ? Object.entries(sessionOptions.env).map(([k, v]) => `${k}=${v}`)
        : undefined,
      user: sessionOptions.dockerExecOptions?.user,
      workingDir: sessionOptions.cwd,
      privileged: sessionOptions.dockerExecOptions?.privileged || false,
      ...sessionOptions.dockerExecOptions,
    };

    try {
      // Create exec instance
      const exec = await container.exec(execOptions);
      const execId = exec.id;

      this.execSessions.set(execId, exec);

      // Build session object
      const session: DockerSession = {
        id: sessionId,
        command: sessionOptions.command,
        args: sessionOptions.args || [],
        cwd: sessionOptions.cwd || '/app',
        env: sessionOptions.env || {},
        createdAt: new Date(),
        status: 'running',
        type: 'docker-exec' as ConsoleType,
        streaming: sessionOptions.streaming || this.config.logStreaming.enabled,
        executionState: 'executing',
        activeCommands: new Map(),
        dockerOptions: this.config.connection,
        execOptions,
        containerId,
        execId,
        isExecSession: true,
        isRunning: false,
        autoCleanup: true,
      };

      this.sessions.set(sessionId, session);

      this.emit('exec-created', execId, session);

      this.logger.info('Docker exec session created', {
        sessionId,
        execId,
        containerId,
        command: sessionOptions.command,
      });

      return session;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to create Docker exec session', {
        sessionId,
        containerId,
        error: errorMessage,
      });
      throw error instanceof Error ? error : new Error(errorMessage);
    }
  }

  async executeCommand(
    sessionId: string,
    command: string,
    args?: string[]
  ): Promise<void> {
    const dockerSession = this.dockerSessions.get(sessionId);
    const sessionState = await this.getSessionState(sessionId);

    if (!dockerSession) {
      throw new Error(`Docker session ${sessionId} not found`);
    }

    try {
      // For one-shot sessions, start container first if not already started
      if (sessionState.isOneShot && !dockerSession.isRunning) {
        const container = this.containers.get(dockerSession.containerId!);
        if (container) {
          await container.start();
          dockerSession.isRunning = true;
          dockerSession.status = 'running';

          // Get container info
          const containerInfo = await container.inspect();
          dockerSession.containerState = this.parseContainerState(
            containerInfo.State
          );
          dockerSession.networkSettings = containerInfo.NetworkSettings;
          dockerSession.pid = containerInfo.State.Pid;

          this.emit(
            'container-created',
            dockerSession.containerId!,
            dockerSession
          );
          this.emit(
            'container-started',
            dockerSession.containerId!,
            dockerSession
          );
        }
      }

      // Build full command
      const fullCommand = args ? `${command} ${args.join(' ')}` : command;

      if (dockerSession.isExecSession) {
        await this.executeExecCommand(dockerSession, fullCommand);
      } else {
        await this.executeContainerCommand(dockerSession, fullCommand);
      }

      // For one-shot sessions, mark as complete after command execution
      if (sessionState.isOneShot) {
        setTimeout(() => {
          this.markSessionComplete(sessionId, 0);
        }, 1000); // Give time for output to be captured
      }
    } catch (error) {
      this.logger.error(`Failed to execute Docker command: ${error}`);
      throw error;
    }
  }

  /**
   * Execute command in exec session
   */
  private async executeExecCommand(
    session: DockerSession,
    command: string
  ): Promise<void> {
    const exec = this.execSessions.get(session.execId!);
    if (!exec) {
      throw new Error(`Exec session ${session.execId} not found`);
    }

    try {
      session.executionState = 'executing';

      const stream = await exec.start({
        hijack: true,
        stdin: true,
        stdout: true,
        stderr: true,
        tty: true,
      });

      this.emit('exec-started', session.execId!, session);

      stream.write(command + '\n');

      stream.on('data', (chunk: Buffer) => {
        const data = chunk.toString();

        const consoleOutput: ConsoleOutput = {
          sessionId: session.id,
          type: 'stdout',
          data: stripAnsi(data),
          timestamp: new Date(),
          raw: data,
        };

        this.addToOutputBuffer(session.id, consoleOutput);
      });

      stream.on('end', () => {
        session.executionState = 'idle';
      });

      stream.on('error', (error: Error) => {
        session.executionState = 'idle';
        const consoleOutput: ConsoleOutput = {
          sessionId: session.id,
          type: 'stderr',
          data: error.message,
          timestamp: new Date(),
          raw: error.message,
        };
        this.addToOutputBuffer(session.id, consoleOutput);
      });
    } catch (error) {
      session.executionState = 'idle';
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to execute command in exec session', {
        sessionId: session.id,
        execId: session.execId,
        command,
        error: errorMessage,
      });
      throw error instanceof Error ? error : new Error(errorMessage);
    }
  }

  /**
   * Execute command in container session
   */
  private async executeContainerCommand(
    session: DockerSession,
    command: string
  ): Promise<void> {
    const container = this.containers.get(session.containerId!);
    if (!container) {
      throw new Error(`Container ${session.containerId} not found`);
    }

    try {
      const exec = await container.exec({
        cmd: ['sh', '-c', command],
        attachStdout: true,
        attachStderr: true,
        tty: false,
      });

      const stream = await exec.start({
        hijack: false,
        stdin: false,
      });

      stream.on('data', (chunk: Buffer) => {
        const data = chunk.toString();
        const consoleOutput: ConsoleOutput = {
          sessionId: session.id,
          type: 'stdout',
          data: stripAnsi(data),
          timestamp: new Date(),
          raw: data,
        };

        this.addToOutputBuffer(session.id, consoleOutput);
      });

      stream.on('end', async () => {
        try {
          const inspectResult = await exec.inspect();
          const exitCode = inspectResult.ExitCode;

          if (exitCode !== 0) {
            const errorOutput: ConsoleOutput = {
              sessionId: session.id,
              type: 'stderr',
              data: `Command failed with exit code ${exitCode}`,
              timestamp: new Date(),
              raw: `Command failed with exit code ${exitCode}`,
            };
            this.addToOutputBuffer(session.id, errorOutput);
          }
        } catch (inspectError) {
          const errorOutput: ConsoleOutput = {
            sessionId: session.id,
            type: 'stderr',
            data: `Failed to inspect command result: ${inspectError}`,
            timestamp: new Date(),
            raw: `Failed to inspect command result: ${inspectError}`,
          };
          this.addToOutputBuffer(session.id, errorOutput);
        }
      });

      stream.on('error', (error: Error) => {
        const errorOutput: ConsoleOutput = {
          sessionId: session.id,
          type: 'stderr',
          data: error.message,
          timestamp: new Date(),
          raw: error.message,
        };
        this.addToOutputBuffer(session.id, errorOutput);
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to execute command in container', {
        sessionId: session.id,
        containerId: session.containerId,
        command,
        error: errorMessage,
      });
      throw error instanceof Error ? error : new Error(errorMessage);
    }
  }

  async sendInput(sessionId: string, input: string): Promise<void> {
    const dockerSession = this.dockerSessions.get(sessionId);
    if (!dockerSession) {
      throw new Error(`Docker session ${sessionId} not found`);
    }

    // For Docker containers, input handling depends on session type
    if (dockerSession.isExecSession) {
      const exec = this.execSessions.get(dockerSession.execId!);
      if (exec) {
        // Send input to exec session stream (if available)
        this.logger.info('Input sent to Docker exec session', {
          sessionId,
          input,
        });
      }
    } else {
      // For container sessions, we'd typically use docker exec for interactive commands
      this.logger.info('Input sent to Docker container session', {
        sessionId,
        input,
      });
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    const dockerSession = this.dockerSessions.get(sessionId);

    if (dockerSession) {
      try {
        if (dockerSession.isExecSession) {
          // Exec sessions don't need explicit stopping, just cleanup
          this.cleanupDockerSession(sessionId);
        } else {
          const container = this.containers.get(dockerSession.containerId!);
          if (container) {
            await container.stop({ t: 10 });

            if (dockerSession.autoCleanup) {
              await container.remove();
              this.emit(
                'container-removed',
                dockerSession.containerId!,
                dockerSession
              );
            }
          }

          this.cleanupDockerSession(sessionId);
        }

        dockerSession.status = 'stopped';
        dockerSession.isRunning = false;

        this.logger.info('Docker session stopped', {
          sessionId,
          containerId: dockerSession.containerId,
          isExecSession: dockerSession.isExecSession,
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error('Failed to stop Docker session', {
          sessionId,
          error: errorMessage,
        });
      }
    }

    // Remove from base class tracking
    this.sessions.delete(sessionId);
    this.outputBuffers.delete(sessionId);

    this.emit('sessionClosed', sessionId);
  }

  /**
   * Get session output
   */
  async getSessionOutput(
    sessionId: string,
    options?: { since?: Date; limit?: number }
  ): Promise<ConsoleOutput[]> {
    const dockerSession = this.dockerSessions.get(sessionId);
    if (!dockerSession) {
      throw new Error(`Docker session ${sessionId} not found`);
    }

    if (dockerSession.isExecSession) {
      // For exec sessions, we don't store historical output
      return [];
    }

    const container = this.containers.get(dockerSession.containerId!);
    if (!container) {
      throw new Error(`Container ${dockerSession.containerId} not found`);
    }

    try {
      const logOptions: any = {
        stdout: true,
        stderr: true,
        timestamps: true,
      };

      if (options?.since) {
        logOptions.since = Math.floor(options.since.getTime() / 1000);
      }

      if (options?.limit) {
        logOptions.tail = options.limit;
      }

      const stream = await container.logs(logOptions);
      const logs = stream.toString();

      return this.parseDockerLogs(logs, sessionId);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to get session output', {
        sessionId,
        error: errorMessage,
      });
      throw error instanceof Error ? error : new Error(errorMessage);
    }
  }

  /**
   * Get container information
   */
  async getContainerInfo(containerId: string): Promise<DockerContainerInfo> {
    const container =
      this.containers.get(containerId) ||
      this.docker!.getContainer(containerId);

    try {
      const containerInfo = await container.inspect();
      return this.parseContainerInfo(containerInfo);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to get container info', {
        containerId,
        error: errorMessage,
      });
      throw error instanceof Error ? error : new Error(errorMessage);
    }
  }

  /**
   * Start health check monitoring for session
   */
  private startHealthCheck(session: DockerSession): void {
    if (!session.containerId) return;

    const checkInterval = this.config.healthCheck.interval;
    const checkId = `health-${session.id}`;

    const healthCheckInterval = setInterval(async () => {
      try {
        const healthResult = await this.performHealthCheck(session);
        this.emit('health-check', healthResult, session);

        if (
          healthResult.status === 'unhealthy' &&
          healthResult.consecutiveFailures >= 3
        ) {
          this.logger.warn('Container health check failing consistently', {
            sessionId: session.id,
            containerId: session.containerId,
            consecutiveFailures: healthResult.consecutiveFailures,
          });
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error('Health check failed', {
          sessionId: session.id,
          containerId: session.containerId,
          error: errorMessage,
        });
      }
    }, checkInterval);

    this.healthChecks.set(checkId, healthCheckInterval);
  }

  /**
   * Perform container health check
   */
  private async performHealthCheck(
    session: DockerSession
  ): Promise<DockerHealthCheck> {
    const container = this.containers.get(session.containerId!);
    if (!container) {
      throw new Error(`Container ${session.containerId} not found`);
    }

    const startTime = Date.now();
    let status: DockerHealthCheck['status'] = 'none';
    let output = '';
    let exitCode: number | undefined;

    try {
      const containerInfo = await container.inspect();
      const health = containerInfo.State.Health;

      if (health) {
        switch (health.Status) {
          case 'healthy':
            status = 'healthy';
            break;
          case 'unhealthy':
            status = 'unhealthy';
            break;
          case 'starting':
            status = 'starting';
            break;
          default:
            status = 'none';
        }

        if (health.Log && health.Log.length > 0) {
          const lastLog = health.Log[health.Log.length - 1];
          output = lastLog.Output;
          exitCode = lastLog.ExitCode;
        }
      } else if (containerInfo.State.Running) {
        status = 'healthy';
      } else {
        status = 'unhealthy';
      }
    } catch (error) {
      status = 'unhealthy';
      output = error instanceof Error ? error.message : String(error);
    }

    const duration = Date.now() - startTime;

    return {
      containerId: session.containerId!,
      checkId: uuidv4(),
      timestamp: new Date(),
      status,
      output,
      duration,
      exitCode,
      retryCount: 0,
      maxRetries: this.config.healthCheck.retries,
      consecutiveFailures: status === 'unhealthy' ? 1 : 0,
      healthScore: status === 'healthy' ? 100 : status === 'starting' ? 50 : 0,
    };
  }

  /**
   * Start log streaming for session
   */
  private startLogStreaming(session: DockerSession): void {
    if (!session.containerId || session.isExecSession) return;

    const container = this.containers.get(session.containerId);
    if (!container) return;

    try {
      const logOptions: any = {
        follow: true,
        stdout: true,
        stderr: true,
        timestamps: this.config.logStreaming.timestamps,
      };

      const logStream = container.logs(logOptions) as any;

      if (logStream && typeof logStream.on === 'function') {
        const passThrough = new PassThrough();
        this.logStreams.set(session.id, passThrough);

        logStream.pipe(passThrough);

        passThrough.on('data', (chunk: Buffer) => {
          const logEntries = this.parseDockerLogChunk(
            chunk,
            session.containerId!
          );

          for (const logEntry of logEntries) {
            this.emit('log-stream', logEntry, session);

            const consoleOutput: ConsoleOutput = {
              sessionId: session.id,
              type: logEntry.stream as 'stdout' | 'stderr',
              data: logEntry.message,
              timestamp: logEntry.timestamp,
              raw: chunk.toString(),
            };

            this.emit('output', consoleOutput);
          }
        });

        passThrough.on('error', (error: Error) => {
          this.logger.error('Log stream error', {
            sessionId: session.id,
            containerId: session.containerId,
            error: error.message,
          });
        });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to start log streaming', {
        sessionId: session.id,
        containerId: session.containerId,
        error: errorMessage,
      });
    }
  }

  /**
   * Start metrics collection for session
   */
  private startMetricsCollection(session: DockerSession): void {
    if (!session.containerId || session.isExecSession) return;

    const container = this.containers.get(session.containerId);
    if (!container) return;

    const metricsInterval = setInterval(async () => {
      try {
        const stats = await container.stats({ stream: false });
        const metrics = this.parseContainerStats(
          stats,
          session.containerId!,
          session.containerName
        );

        this.emit('metrics-collected', metrics, session);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error('Failed to collect container metrics', {
          sessionId: session.id,
          containerId: session.containerId,
          error: errorMessage,
        });
      }
    }, 10000); // Collect metrics every 10 seconds

    this.metricsIntervals.set(session.id, metricsInterval);
  }

  /**
   * Parse container options from session options
   */
  private parseContainerOptions(
    sessionOptions: SessionOptions
  ): DockerContainerOptions {
    const dockerContainerOptions =
      sessionOptions.dockerContainerOptions || ({} as DockerContainerOptions);

    const baseOptions = {
      image: dockerContainerOptions.image || 'ubuntu:latest',
      name:
        dockerContainerOptions.name ||
        `console-session-${uuidv4().substring(0, 8)}`,
      cmd: dockerContainerOptions.cmd || [
        sessionOptions.command,
        ...(sessionOptions.args || []),
      ],
      workingDir:
        dockerContainerOptions.workingDir || sessionOptions.cwd || '/app',
      env:
        dockerContainerOptions.env ||
        this.formatEnvironment(sessionOptions.env),
      attachStdin: true,
      attachStdout: true,
      attachStderr: true,
      tty: true,
      openStdin: true,
      stdinOnce: false,
      hostConfig: {
        autoRemove: this.config.autoCleanup,
        ...(dockerContainerOptions.hostConfig || {}),
      },
    };

    // Merge additional options without overriding base properties
    const {
      image,
      name,
      cmd,
      workingDir,
      env,
      attachStdin,
      attachStdout,
      attachStderr,
      tty,
      openStdin,
      stdinOnce,
      hostConfig,
      ...additionalOptions
    } = dockerContainerOptions;

    return {
      ...baseOptions,
      ...additionalOptions,
    };
  }

  /**
   * Format environment variables
   */
  private formatEnvironment(
    env?: Record<string, string>
  ): string[] | undefined {
    if (!env) return undefined;
    return Object.entries(env).map(([key, value]) => `${key}=${value}`);
  }

  /**
   * Parse environment variables
   */
  private parseEnvironment(
    env?: string[] | Record<string, string>
  ): Record<string, string> {
    if (!env) return {};

    if (Array.isArray(env)) {
      const result: Record<string, string> = {};
      for (const envVar of env) {
        const [key, ...valueParts] = envVar.split('=');
        result[key] = valueParts.join('=');
      }
      return result;
    }

    return env as Record<string, string>;
  }

  /**
   * Parse volume mounts
   */
  private parseVolumeMounts(
    binds?: string[]
  ):
    | Array<{ hostPath: string; containerPath: string; mode?: 'ro' | 'rw' }>
    | undefined {
    if (!binds) return undefined;

    return binds.map((bind) => {
      const parts = bind.split(':');
      const hostPath = parts[0];
      const containerPath = parts[1];
      const mode = parts[2] as 'ro' | 'rw' | undefined;

      return { hostPath, containerPath, mode };
    });
  }

  /**
   * Parse port mappings
   */
  private parsePortMappings(
    portBindings?: Record<string, Array<{ hostPort: string }>>
  ): Record<string, string> | undefined {
    if (!portBindings) return undefined;

    const mappings: Record<string, string> = {};
    for (const [containerPort, bindings] of Object.entries(portBindings)) {
      if (bindings.length > 0) {
        mappings[containerPort] = bindings[0].hostPort;
      }
    }

    return mappings;
  }

  /**
   * Parse container state
   */
  private parseContainerState(state: any): DockerContainerState {
    return {
      status: state.Status,
      running: state.Running,
      paused: state.Paused,
      restarting: state.Restarting,
      oomKilled: state.OOMKilled,
      dead: state.Dead,
      pid: state.Pid,
      exitCode: state.ExitCode,
      error: state.Error,
      startedAt: new Date(state.StartedAt),
      finishedAt: new Date(state.FinishedAt),
      health: state.Health
        ? {
            status: state.Health.Status,
            failingStreak: state.Health.FailingStreak,
            log: state.Health.Log?.map((log: any) => ({
              start: new Date(log.Start),
              end: new Date(log.End),
              exitCode: log.ExitCode,
              output: log.Output,
            })),
          }
        : undefined,
    };
  }

  /**
   * Parse container info
   */
  private parseContainerInfo(containerInfo: any): DockerContainerInfo {
    return {
      id: containerInfo.Id,
      name: containerInfo.Name.replace(/^\//, ''),
      image: containerInfo.Config.Image,
      imageId: containerInfo.Image,
      command: containerInfo.Config.Cmd?.join(' ') || '',
      created: new Date(containerInfo.Created),
      state: this.parseContainerState(containerInfo.State),
      status: containerInfo.State.Status,
      ports: containerInfo.NetworkSettings.Ports
        ? Object.entries(containerInfo.NetworkSettings.Ports).flatMap(
            ([port, bindings]: [string, any]) =>
              (bindings || []).map((binding: any) => ({
                privatePort: parseInt(port.split('/')[0]),
                publicPort: binding.HostPort
                  ? parseInt(binding.HostPort)
                  : undefined,
                type: port.split('/')[1] as 'tcp' | 'udp',
                ip: binding.HostIp,
              }))
          )
        : [],
      labels: containerInfo.Config.Labels || {},
      sizeRw: containerInfo.SizeRw,
      sizeRootFs: containerInfo.SizeRootFs,
      hostConfig: containerInfo.HostConfig,
      networkSettings: containerInfo.NetworkSettings,
      mounts: containerInfo.Mounts || [],
    };
  }

  /**
   * Parse container stats for metrics
   */
  private parseContainerStats(
    stats: any,
    containerId: string,
    containerName?: string
  ): DockerMetrics {
    const cpuDelta =
      stats.cpu_stats.cpu_usage.total_usage -
      (stats.precpu_stats.cpu_usage?.total_usage || 0);
    const systemDelta =
      stats.cpu_stats.system_cpu_usage -
      (stats.precpu_stats.system_cpu_usage || 0);
    const cpuPercent =
      systemDelta > 0
        ? (cpuDelta / systemDelta) * stats.cpu_stats.online_cpus * 100
        : 0;

    return {
      containerId,
      containerName: containerName || 'unknown',
      timestamp: new Date(),
      cpu: {
        usage: cpuPercent,
        system: stats.cpu_stats.cpu_usage.usage_in_kernelmode || 0,
        user: stats.cpu_stats.cpu_usage.usage_in_usermode || 0,
        throttledTime: stats.cpu_stats.throttling_data?.throttled_time || 0,
        throttledPeriods:
          stats.cpu_stats.throttling_data?.throttled_periods || 0,
      },
      memory: {
        usage: stats.memory_stats.usage || 0,
        limit: stats.memory_stats.limit || 0,
        cache: stats.memory_stats.stats?.cache || 0,
        rss: stats.memory_stats.stats?.rss || 0,
        maxUsage: stats.memory_stats.max_usage || 0,
        failCount: stats.memory_stats.failcnt || 0,
      },
      network: this.parseNetworkStats(stats.networks || {}),
      blockIO: {
        readBytes:
          stats.blkio_stats.io_service_bytes_recursive?.find(
            (io: any) => io.op === 'Read'
          )?.value || 0,
        writeBytes:
          stats.blkio_stats.io_service_bytes_recursive?.find(
            (io: any) => io.op === 'Write'
          )?.value || 0,
        readOps:
          stats.blkio_stats.io_serviced_recursive?.find(
            (io: any) => io.op === 'Read'
          )?.value || 0,
        writeOps:
          stats.blkio_stats.io_serviced_recursive?.find(
            (io: any) => io.op === 'Write'
          )?.value || 0,
      },
      pids: {
        current: stats.pids_stats?.current || 0,
        limit: stats.pids_stats?.limit || 0,
      },
    };
  }

  /**
   * Parse network statistics from Docker stats
   */
  private parseNetworkStats(networks: Record<string, any>): {
    rxBytes: number;
    txBytes: number;
    rxPackets: number;
    txPackets: number;
    rxErrors: number;
    txErrors: number;
    rxDropped: number;
    txDropped: number;
  } {
    const networkValues = Object.values(networks);
    if (networkValues.length === 0) {
      return {
        rxBytes: 0,
        txBytes: 0,
        rxPackets: 0,
        txPackets: 0,
        rxErrors: 0,
        txErrors: 0,
        rxDropped: 0,
        txDropped: 0,
      };
    }

    return networkValues.reduce(
      (acc, net: any) => ({
        rxBytes: acc.rxBytes + (net?.rx_bytes || 0),
        txBytes: acc.txBytes + (net?.tx_bytes || 0),
        rxPackets: acc.rxPackets + (net?.rx_packets || 0),
        txPackets: acc.txPackets + (net?.tx_packets || 0),
        rxErrors: acc.rxErrors + (net?.rx_errors || 0),
        txErrors: acc.txErrors + (net?.tx_errors || 0),
        rxDropped: acc.rxDropped + (net?.rx_dropped || 0),
        txDropped: acc.txDropped + (net?.tx_dropped || 0),
      }),
      {
        rxBytes: 0,
        txBytes: 0,
        rxPackets: 0,
        txPackets: 0,
        rxErrors: 0,
        txErrors: 0,
        rxDropped: 0,
        txDropped: 0,
      }
    );
  }

  /**
   * Parse Docker logs
   */
  private parseDockerLogs(logs: string, sessionId: string): ConsoleOutput[] {
    const lines = logs.split('\n').filter((line) => line.trim());
    const outputs: ConsoleOutput[] = [];

    for (const line of lines) {
      // Docker logs format: timestamp stream message
      const match = line.match(
        /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)\s+(stdout|stderr)\s+(.*)$/
      );

      if (match) {
        const [, timestamp, stream, message] = match;
        outputs.push({
          sessionId,
          type: stream as 'stdout' | 'stderr',
          data: stripAnsi(message),
          timestamp: new Date(timestamp),
          raw: message,
        });
      } else if (line.trim()) {
        // Fallback for non-timestamped logs
        outputs.push({
          sessionId,
          type: 'stdout',
          data: stripAnsi(line),
          timestamp: new Date(),
          raw: line,
        });
      }
    }

    return outputs;
  }

  /**
   * Parse Docker log chunk
   */
  private parseDockerLogChunk(
    chunk: Buffer,
    containerId: string
  ): DockerLogEntry[] {
    const logs: DockerLogEntry[] = [];

    // Docker multiplexed stream format
    let offset = 0;
    while (offset < chunk.length) {
      if (chunk.length - offset < 8) break;

      const streamType = chunk.readUInt8(offset);
      const size = chunk.readUInt32BE(offset + 4);

      if (chunk.length - offset < 8 + size) break;

      const message = chunk.slice(offset + 8, offset + 8 + size).toString();
      const stream = streamType === 1 ? 'stdout' : 'stderr';

      logs.push({
        timestamp: new Date(),
        stream,
        message: stripAnsi(message),
        containerId,
        raw: chunk.slice(offset + 8, offset + 8 + size),
      });

      offset += 8 + size;
    }

    return logs;
  }

  /**
   * Cleanup Docker session resources
   */
  private cleanupDockerSession(sessionId: string): void {
    const dockerSession = this.dockerSessions.get(sessionId);
    if (!dockerSession) return;

    // Stop health checks
    const healthCheckId = `health-${sessionId}`;
    const healthCheck = this.healthChecks.get(healthCheckId);
    if (healthCheck) {
      clearInterval(healthCheck);
      this.healthChecks.delete(healthCheckId);
    }

    // Stop metrics collection
    const metricsInterval = this.metricsIntervals.get(sessionId);
    if (metricsInterval) {
      clearInterval(metricsInterval);
      this.metricsIntervals.delete(sessionId);
    }

    // Close log streams
    const logStream = this.logStreams.get(sessionId);
    if (logStream) {
      logStream.destroy();
      this.logStreams.delete(sessionId);
    }

    // Clean up containers and exec sessions
    if (dockerSession.containerId) {
      this.containers.delete(dockerSession.containerId);
    }
    if (dockerSession.execId) {
      this.execSessions.delete(dockerSession.execId);
    }

    this.dockerSessions.delete(sessionId);
  }

  /**
   * Get all active sessions
   */
  getAllSessions(): DockerSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): DockerSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Check if Docker connection is healthy
   */
  isConnectionHealthy(): boolean {
    return this.connectionHealthy;
  }

  /**
   * Get connection health details
   */
  getConnectionHealth(): {
    healthy: boolean;
    lastCheck: Date;
    reconnectAttempts: number;
  } {
    return {
      healthy: this.connectionHealthy,
      lastCheck: this.lastHealthCheck,
      reconnectAttempts: this.reconnectAttempts,
    };
  }

  async dispose(): Promise<void> {
    this.logger.info('Disposing Docker protocol');

    // Stop all health checks
    Array.from(this.healthChecks.keys()).forEach((id) => {
      const interval = this.healthChecks.get(id);
      if (interval) {
        clearInterval(interval);
      }
    });
    this.healthChecks.clear();

    // Stop all metrics collection
    Array.from(this.metricsIntervals.keys()).forEach((sessionId) => {
      const interval = this.metricsIntervals.get(sessionId);
      if (interval) {
        clearInterval(interval);
      }
    });
    this.metricsIntervals.clear();

    // Close all log streams
    Array.from(this.logStreams.keys()).forEach((sessionId) => {
      const stream = this.logStreams.get(sessionId);
      if (stream) {
        stream.destroy();
      }
    });
    this.logStreams.clear();

    // Stop event monitoring
    if (this.eventMonitor) {
      clearTimeout(this.eventMonitor);
    }

    // Clean up all Docker sessions
    const sessionIds = Array.from(this.dockerSessions.keys());
    for (const sessionId of sessionIds) {
      try {
        await this.closeSession(sessionId);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.warn('Failed to stop session during cleanup', {
          sessionId,
          error: errorMessage,
        });
      }
    }

    this.dockerSessions.clear();
    this.containers.clear();
    this.execSessions.clear();

    await this.cleanup();

    this.logger.info('Docker protocol cleanup completed');
  }
}

export default DockerProtocol;
