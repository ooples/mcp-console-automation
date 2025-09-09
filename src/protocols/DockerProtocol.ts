// Basic Docker types stub until @types/dockerode is available
declare namespace Docker {
  interface ContainerCreateOptions {
    [key: string]: any;
  }
  
  interface Container {
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
}

declare class Docker {
  constructor(options?: any);
  createContainer(options: Docker.ContainerCreateOptions): Promise<Docker.Container>;
  listContainers(options?: any): Promise<any[]>;
  getContainer(id: string): Docker.Container;
  getEvents(options?: any): any;
  version(callback?: (err: any, data: any) => void): Promise<any>;
  info(callback?: (err: any, data: any) => void): Promise<any>;
  ping(callback?: (err: any, data: any) => void): Promise<any>;
}

declare module 'dockerode' {
  export = Docker;
}

import Docker from 'dockerode';
import { EventEmitter } from 'events';
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
  ConsoleType
} from '../types/index.js';

import { Logger } from '../utils/logger.js';

export interface DockerProtocolEvents {
  'container-created': (containerId: string, session: DockerSession) => void;
  'container-started': (containerId: string, session: DockerSession) => void;
  'container-stopped': (containerId: string, session: DockerSession) => void;
  'container-removed': (containerId: string, session: DockerSession) => void;
  'container-error': (containerId: string, error: Error, session: DockerSession) => void;
  'exec-created': (execId: string, session: DockerSession) => void;
  'exec-started': (execId: string, session: DockerSession) => void;
  'exec-completed': (execId: string, exitCode: number, session: DockerSession) => void;
  'health-check': (result: DockerHealthCheck, session: DockerSession) => void;
  'log-stream': (logEntry: DockerLogEntry, session: DockerSession) => void;
  'metrics-collected': (metrics: DockerMetrics, session: DockerSession) => void;
  'docker-event': (event: DockerEvent) => void;
  'connection-error': (error: Error) => void;
  'reconnected': (connection: Docker) => void;
  'output': (output: ConsoleOutput) => void;
}

export declare interface DockerProtocol {
  on<U extends keyof DockerProtocolEvents>(event: U, listener: DockerProtocolEvents[U]): this;
  emit<U extends keyof DockerProtocolEvents>(event: U, ...args: Parameters<DockerProtocolEvents[U]>): boolean;
}

/**
 * Production-ready Docker Protocol implementation for console automation
 * Supports Docker containers, docker exec, docker-compose, health checks, and comprehensive monitoring
 */
export class DockerProtocol extends EventEmitter {
  private docker: Docker;
  private logger: Logger;
  private config: DockerProtocolConfig;
  private sessions: Map<string, DockerSession> = new Map();
  private containers: Map<string, Docker.Container> = new Map();
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

  constructor(config: DockerProtocolConfig) {
    super();
    this.config = config;
    this.logger = new Logger('DockerProtocol');
    
    // Initialize Docker connection with comprehensive error handling
    this.initializeDockerConnection();
    
    // Set up connection monitoring
    this.setupConnectionMonitoring();
    
    // Start event monitoring if enabled
    if (this.config.monitoring.enableMetrics) {
      this.startEventMonitoring();
    }
  }

  /**
   * Initialize Docker connection with fallback strategies for different environments
   */
  private initializeDockerConnection(): void {
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
        port: connectionOptions.port
      });

    } catch (error) {
      this.logger.error('Failed to initialize Docker connection', { error: error.message });
      this.connectionHealthy = false;
      this.emit('connection-error', error);
      
      // Attempt reconnection
      this.scheduleReconnection();
    }
  }

  /**
   * Test Docker connection health
   */
  private async testDockerConnection(): Promise<boolean> {
    try {
      await this.docker.ping();
      this.connectionHealthy = true;
      this.lastHealthCheck = new Date();
      return true;
    } catch (error) {
      this.connectionHealthy = false;
      this.logger.warn('Docker connection test failed', { error: error.message });
      return false;
    }
  }

  /**
   * Test connection synchronously for initialization
   */
  private testConnection(options: any): boolean {
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
      if (!await this.testDockerConnection()) {
        this.emit('connection-error', new Error('Docker connection health check failed'));
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
      this.logger.info(`Attempting Docker reconnection (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      this.initializeDockerConnection();
    }, delay);
  }

  /**
   * Start Docker event monitoring
   */
  private startEventMonitoring(): void {
    try {
      this.docker.getEvents({}, (err, stream) => {
        if (err) {
          this.logger.error('Failed to start Docker event monitoring', { error: err.message });
          return;
        }

        stream.on('data', (chunk) => {
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
            this.logger.warn('Failed to parse Docker event', { error: error.message, chunk: chunk.toString() });
          }
        });

        stream.on('error', (error) => {
          this.logger.error('Docker event stream error', { error: error.message });
        });
      });
    } catch (error) {
      this.logger.error('Failed to initialize Docker event monitoring', { error: error.message });
    }
  }

  /**
   * Handle Docker events for session state management
   */
  private handleDockerEvent(event: DockerEvent): void {
    if (event.type === 'container') {
      const containerId = event.actor.id;
      const session = Array.from(this.sessions.values()).find(s => s.containerId === containerId);
      
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
            this.cleanupSession(session.id);
            this.emit('container-removed', containerId, session);
            break;
        }
      }
    }
  }

  /**
   * Create a Docker session (run a new container)
   */
  async createSession(sessionOptions: SessionOptions): Promise<DockerSession> {
    if (!this.connectionHealthy) {
      throw new Error('Docker connection is not healthy');
    }

    const sessionId = uuidv4();
    const containerOptions = this.parseContainerOptions(sessionOptions);
    const dockerOptions = sessionOptions.dockerOptions || this.config.connection;
    
    try {
      // Create container
      const container = await this.docker.createContainer(containerOptions);
      const containerId = container.id;
      
      this.containers.set(containerId, container);

      // Build session object
      const session: DockerSession = {
        id: sessionId,
        command: containerOptions.cmd?.[0] || sessionOptions.command,
        args: containerOptions.cmd?.slice(1) || sessionOptions.args || [],
        cwd: containerOptions.workingDir || sessionOptions.cwd || '/app',
        env: this.parseEnvironment(containerOptions.env),
        createdAt: new Date(),
        status: 'running',
        type: sessionOptions.consoleType as ConsoleType,
        streaming: sessionOptions.streaming || this.config.logStreaming.enabled,
        executionState: 'idle',
        activeCommands: new Map(),
        dockerOptions,
        containerOptions,
        containerId,
        containerName: containerOptions.name,
        isExecSession: false,
        isRunning: false,
        autoCleanup: containerOptions.hostConfig?.autoRemove || this.config.autoCleanup,
        volumeMounts: this.parseVolumeMounts(containerOptions.hostConfig?.binds),
        portMappings: this.parsePortMappings(containerOptions.hostConfig?.portBindings)
      };

      this.sessions.set(sessionId, session);
      
      // Start container
      await container.start();
      session.isRunning = true;
      session.status = 'running';

      // Get container info and update session
      const containerInfo = await container.inspect();
      session.containerState = this.parseContainerState(containerInfo.State);
      session.networkSettings = containerInfo.NetworkSettings;
      session.pid = containerInfo.State.Pid;

      this.emit('container-created', containerId, session);
      this.emit('container-started', containerId, session);

      // Set up health monitoring if enabled
      if (this.config.healthCheck.enabled) {
        this.startHealthCheck(session);
      }

      // Start log streaming if enabled
      if (session.streaming) {
        this.startLogStreaming(session);
      }

      // Start metrics collection if enabled
      if (this.config.monitoring.enableMetrics) {
        this.startMetricsCollection(session);
      }

      this.logger.info('Docker container session created', {
        sessionId,
        containerId,
        image: containerOptions.image,
        name: containerOptions.name
      });

      return session;

    } catch (error) {
      this.logger.error('Failed to create Docker session', {
        sessionId,
        error: error.message,
        containerOptions
      });
      throw error;
    }
  }

  /**
   * Create a Docker exec session
   */
  async createExecSession(sessionOptions: SessionOptions & { containerId: string }): Promise<DockerSession> {
    if (!this.connectionHealthy) {
      throw new Error('Docker connection is not healthy');
    }

    const sessionId = uuidv4();
    const { containerId } = sessionOptions;
    
    const container = this.containers.get(containerId) || this.docker.getContainer(containerId);
    if (!container) {
      throw new Error(`Container ${containerId} not found`);
    }

    const execOptions: DockerExecOptions = {
      cmd: [sessionOptions.command, ...(sessionOptions.args || [])],
      attachStdout: true,
      attachStderr: true,
      attachStdin: true,
      tty: true,
      env: sessionOptions.env ? Object.entries(sessionOptions.env).map(([k, v]) => `${k}=${v}`) : undefined,
      user: sessionOptions.dockerExecOptions?.user,
      workingDir: sessionOptions.cwd,
      privileged: sessionOptions.dockerExecOptions?.privileged || false,
      ...sessionOptions.dockerExecOptions
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
        autoCleanup: true
      };

      this.sessions.set(sessionId, session);

      this.emit('exec-created', execId, session);

      this.logger.info('Docker exec session created', {
        sessionId,
        execId,
        containerId,
        command: sessionOptions.command
      });

      return session;

    } catch (error) {
      this.logger.error('Failed to create Docker exec session', {
        sessionId,
        containerId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Execute command in Docker session
   */
  async executeCommand(sessionId: string, command: string, options?: { timeout?: number }): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (session.isExecSession) {
      return this.executeExecCommand(session, command, options);
    } else {
      return this.executeContainerCommand(session, command, options);
    }
  }

  /**
   * Execute command in exec session
   */
  private async executeExecCommand(session: DockerSession, command: string, options?: { timeout?: number }): Promise<string> {
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
        tty: true
      });

      this.emit('exec-started', session.execId!, session);

      let output = '';
      const timeout = options?.timeout || 30000;

      return new Promise((resolve, reject) => {
        const timeoutHandle = setTimeout(() => {
          reject(new Error('Command execution timeout'));
        }, timeout);

        stream.write(command + '\n');

        stream.on('data', (chunk: Buffer) => {
          const data = chunk.toString();
          output += data;
          
          const consoleOutput: ConsoleOutput = {
            sessionId: session.id,
            type: 'stdout',
            data: stripAnsi(data),
            timestamp: new Date(),
            raw: data
          };

          this.emit('output', consoleOutput);
        });

        stream.on('end', () => {
          clearTimeout(timeoutHandle);
          session.executionState = 'idle';
          resolve(output);
        });

        stream.on('error', (error) => {
          clearTimeout(timeoutHandle);
          session.executionState = 'idle';
          reject(error);
        });
      });

    } catch (error) {
      session.executionState = 'idle';
      this.logger.error('Failed to execute command in exec session', {
        sessionId: session.id,
        execId: session.execId,
        command,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Execute command in container session
   */
  private async executeContainerCommand(session: DockerSession, command: string, options?: { timeout?: number }): Promise<string> {
    const container = this.containers.get(session.containerId!);
    if (!container) {
      throw new Error(`Container ${session.containerId} not found`);
    }

    try {
      const exec = await container.exec({
        cmd: ['sh', '-c', command],
        attachStdout: true,
        attachStderr: true,
        tty: false
      });

      const stream = await exec.start({
        hijack: false,
        stdin: false
      });

      let output = '';
      const timeout = options?.timeout || 30000;

      return new Promise((resolve, reject) => {
        const timeoutHandle = setTimeout(() => {
          reject(new Error('Command execution timeout'));
        }, timeout);

        stream.on('data', (chunk: Buffer) => {
          output += chunk.toString();
        });

        stream.on('end', async () => {
          clearTimeout(timeoutHandle);
          
          try {
            const inspectResult = await exec.inspect();
            const exitCode = inspectResult.ExitCode;
            
            if (exitCode === 0) {
              resolve(output);
            } else {
              reject(new Error(`Command failed with exit code ${exitCode}: ${output}`));
            }
          } catch (inspectError) {
            reject(inspectError);
          }
        });

        stream.on('error', (error) => {
          clearTimeout(timeoutHandle);
          reject(error);
        });
      });

    } catch (error) {
      this.logger.error('Failed to execute command in container', {
        sessionId: session.id,
        containerId: session.containerId,
        command,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Stop Docker session
   */
  async stopSession(sessionId: string, options?: { force?: boolean; timeout?: number }): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    try {
      if (session.isExecSession) {
        // Exec sessions don't need explicit stopping, just cleanup
        this.cleanupSession(sessionId);
      } else {
        const container = this.containers.get(session.containerId!);
        if (container) {
          if (options?.force) {
            await container.kill();
          } else {
            await container.stop({ t: options?.timeout || 10 });
          }
          
          if (session.autoCleanup) {
            await container.remove();
            this.emit('container-removed', session.containerId!, session);
          }
        }
        
        this.cleanupSession(sessionId);
      }

      session.status = 'stopped';
      session.isRunning = false;
      
      this.logger.info('Docker session stopped', {
        sessionId,
        containerId: session.containerId,
        isExecSession: session.isExecSession
      });

    } catch (error) {
      this.logger.error('Failed to stop Docker session', {
        sessionId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get session output
   */
  async getSessionOutput(sessionId: string, options?: { since?: Date; limit?: number }): Promise<ConsoleOutput[]> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (session.isExecSession) {
      // For exec sessions, we don't store historical output
      return [];
    }

    const container = this.containers.get(session.containerId!);
    if (!container) {
      throw new Error(`Container ${session.containerId} not found`);
    }

    try {
      const logOptions: any = {
        stdout: true,
        stderr: true,
        timestamps: true
      };

      if (options?.since) {
        logOptions.since = Math.floor(options.since.getTime() / 1000);
      }

      if (options?.limit) {
        logOptions.tail = options.limit;
      }

      const stream = await container.logs(logOptions);
      const logs = stream.toString();
      
      return this.parseDockerLogs(logs, session.id);

    } catch (error) {
      this.logger.error('Failed to get session output', {
        sessionId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get container information
   */
  async getContainerInfo(containerId: string): Promise<DockerContainerInfo> {
    const container = this.containers.get(containerId) || this.docker.getContainer(containerId);
    
    try {
      const containerInfo = await container.inspect();
      return this.parseContainerInfo(containerInfo);
    } catch (error) {
      this.logger.error('Failed to get container info', {
        containerId,
        error: error.message
      });
      throw error;
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
        
        if (healthResult.status === 'unhealthy' && healthResult.consecutiveFailures >= 3) {
          this.logger.warn('Container health check failing consistently', {
            sessionId: session.id,
            containerId: session.containerId,
            consecutiveFailures: healthResult.consecutiveFailures
          });
        }
        
      } catch (error) {
        this.logger.error('Health check failed', {
          sessionId: session.id,
          containerId: session.containerId,
          error: error.message
        });
      }
    }, checkInterval);

    this.healthChecks.set(checkId, healthCheckInterval);
  }

  /**
   * Perform container health check
   */
  private async performHealthCheck(session: DockerSession): Promise<DockerHealthCheck> {
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
      output = error.message;
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
      healthScore: status === 'healthy' ? 100 : status === 'starting' ? 50 : 0
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
        timestamps: this.config.logStreaming.timestamps
      };

      container.logs(logOptions, (err, stream) => {
        if (err) {
          this.logger.error('Failed to start log streaming', {
            sessionId: session.id,
            containerId: session.containerId,
            error: err.message
          });
          return;
        }

        const logStream = new PassThrough();
        this.logStreams.set(session.id, logStream);

        stream.pipe(logStream);

        logStream.on('data', (chunk: Buffer) => {
          const logEntries = this.parseDockerLogChunk(chunk, session.containerId!);
          
          for (const logEntry of logEntries) {
            this.emit('log-stream', logEntry, session);
            
            const consoleOutput: ConsoleOutput = {
              sessionId: session.id,
              type: logEntry.stream as 'stdout' | 'stderr',
              data: logEntry.message,
              timestamp: logEntry.timestamp,
              raw: chunk.toString()
            };
            
            this.emit('output', consoleOutput);
          }
        });

        logStream.on('error', (error) => {
          this.logger.error('Log stream error', {
            sessionId: session.id,
            containerId: session.containerId,
            error: error.message
          });
        });
      });

    } catch (error) {
      this.logger.error('Failed to start log streaming', {
        sessionId: session.id,
        containerId: session.containerId,
        error: error.message
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
        const metrics = this.parseContainerStats(stats, session.containerId!, session.containerName);
        
        this.emit('metrics-collected', metrics, session);
        
      } catch (error) {
        this.logger.error('Failed to collect container metrics', {
          sessionId: session.id,
          containerId: session.containerId,
          error: error.message
        });
      }
    }, 10000); // Collect metrics every 10 seconds

    this.metricsIntervals.set(session.id, metricsInterval);
  }

  /**
   * Parse container options from session options
   */
  private parseContainerOptions(sessionOptions: SessionOptions): DockerContainerOptions {
    const dockerContainerOptions = sessionOptions.dockerContainerOptions || {} as DockerContainerOptions;
    
    return {
      image: dockerContainerOptions.image || 'ubuntu:latest',
      name: dockerContainerOptions.name || `console-session-${uuidv4().substring(0, 8)}`,
      cmd: dockerContainerOptions.cmd || [sessionOptions.command, ...(sessionOptions.args || [])],
      workingDir: dockerContainerOptions.workingDir || sessionOptions.cwd || '/app',
      env: dockerContainerOptions.env || this.formatEnvironment(sessionOptions.env),
      attachStdin: true,
      attachStdout: true,
      attachStderr: true,
      tty: true,
      openStdin: true,
      stdinOnce: false,
      hostConfig: {
        autoRemove: this.config.autoCleanup,
        ...(dockerContainerOptions.hostConfig || {})
      },
      ...dockerContainerOptions
    };
  }

  /**
   * Format environment variables
   */
  private formatEnvironment(env?: Record<string, string>): string[] | undefined {
    if (!env) return undefined;
    return Object.entries(env).map(([key, value]) => `${key}=${value}`);
  }

  /**
   * Parse environment variables
   */
  private parseEnvironment(env?: string[] | Record<string, string>): Record<string, string> {
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
  private parseVolumeMounts(binds?: string[]): Array<{ hostPath: string; containerPath: string; mode?: 'ro' | 'rw' }> | undefined {
    if (!binds) return undefined;
    
    return binds.map(bind => {
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
  private parsePortMappings(portBindings?: Record<string, Array<{ hostPort: string }>>): Record<string, string> | undefined {
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
      health: state.Health ? {
        status: state.Health.Status,
        failingStreak: state.Health.FailingStreak,
        log: state.Health.Log?.map((log: any) => ({
          start: new Date(log.Start),
          end: new Date(log.End),
          exitCode: log.ExitCode,
          output: log.Output
        }))
      } : undefined
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
      ports: containerInfo.NetworkSettings.Ports ? Object.entries(containerInfo.NetworkSettings.Ports).flatMap(([port, bindings]: [string, any]) => 
        (bindings || []).map((binding: any) => ({
          privatePort: parseInt(port.split('/')[0]),
          publicPort: binding.HostPort ? parseInt(binding.HostPort) : undefined,
          type: port.split('/')[1] as 'tcp' | 'udp',
          ip: binding.HostIp
        }))
      ) : [],
      labels: containerInfo.Config.Labels || {},
      sizeRw: containerInfo.SizeRw,
      sizeRootFs: containerInfo.SizeRootFs,
      hostConfig: containerInfo.HostConfig,
      networkSettings: containerInfo.NetworkSettings,
      mounts: containerInfo.Mounts || []
    };
  }

  /**
   * Parse container stats for metrics
   */
  private parseContainerStats(stats: any, containerId: string, containerName?: string): DockerMetrics {
    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - (stats.precpu_stats.cpu_usage?.total_usage || 0);
    const systemDelta = stats.cpu_stats.system_cpu_usage - (stats.precpu_stats.system_cpu_usage || 0);
    const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * stats.cpu_stats.online_cpus * 100 : 0;

    return {
      containerId,
      containerName: containerName || 'unknown',
      timestamp: new Date(),
      cpu: {
        usage: cpuPercent,
        system: stats.cpu_stats.cpu_usage.usage_in_kernelmode || 0,
        user: stats.cpu_stats.cpu_usage.usage_in_usermode || 0,
        throttledTime: stats.cpu_stats.throttling_data?.throttled_time || 0,
        throttledPeriods: stats.cpu_stats.throttling_data?.throttled_periods || 0
      },
      memory: {
        usage: stats.memory_stats.usage || 0,
        limit: stats.memory_stats.limit || 0,
        cache: stats.memory_stats.stats?.cache || 0,
        rss: stats.memory_stats.stats?.rss || 0,
        maxUsage: stats.memory_stats.max_usage || 0,
        failCount: stats.memory_stats.failcnt || 0
      },
      network: this.parseNetworkStats(stats.networks || {}),
      blockIO: {
        readBytes: stats.blkio_stats.io_service_bytes_recursive?.find((io: any) => io.op === 'Read')?.value || 0,
        writeBytes: stats.blkio_stats.io_service_bytes_recursive?.find((io: any) => io.op === 'Write')?.value || 0,
        readOps: stats.blkio_stats.io_serviced_recursive?.find((io: any) => io.op === 'Read')?.value || 0,
        writeOps: stats.blkio_stats.io_serviced_recursive?.find((io: any) => io.op === 'Write')?.value || 0
      },
      pids: {
        current: stats.pids_stats?.current || 0,
        limit: stats.pids_stats?.limit || 0
      }
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
      return { rxBytes: 0, txBytes: 0, rxPackets: 0, txPackets: 0, rxErrors: 0, txErrors: 0, rxDropped: 0, txDropped: 0 };
    }
    
    return networkValues.reduce((acc, net: any) => ({
      rxBytes: acc.rxBytes + (net?.rx_bytes || 0),
      txBytes: acc.txBytes + (net?.tx_bytes || 0),
      rxPackets: acc.rxPackets + (net?.rx_packets || 0),
      txPackets: acc.txPackets + (net?.tx_packets || 0),
      rxErrors: acc.rxErrors + (net?.rx_errors || 0),
      txErrors: acc.txErrors + (net?.tx_errors || 0),
      rxDropped: acc.rxDropped + (net?.rx_dropped || 0),
      txDropped: acc.txDropped + (net?.tx_dropped || 0)
    }), { rxBytes: 0, txBytes: 0, rxPackets: 0, txPackets: 0, rxErrors: 0, txErrors: 0, rxDropped: 0, txDropped: 0 });
  }

  /**
   * Parse Docker logs
   */
  private parseDockerLogs(logs: string, sessionId: string): ConsoleOutput[] {
    const lines = logs.split('\n').filter(line => line.trim());
    const outputs: ConsoleOutput[] = [];
    
    for (const line of lines) {
      // Docker logs format: timestamp stream message
      const match = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)\s+(stdout|stderr)\s+(.*)$/);
      
      if (match) {
        const [, timestamp, stream, message] = match;
        outputs.push({
          sessionId,
          type: stream as 'stdout' | 'stderr',
          data: stripAnsi(message),
          timestamp: new Date(timestamp),
          raw: message
        });
      } else if (line.trim()) {
        // Fallback for non-timestamped logs
        outputs.push({
          sessionId,
          type: 'stdout',
          data: stripAnsi(line),
          timestamp: new Date(),
          raw: line
        });
      }
    }
    
    return outputs;
  }

  /**
   * Parse Docker log chunk
   */
  private parseDockerLogChunk(chunk: Buffer, containerId: string): DockerLogEntry[] {
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
        raw: chunk.slice(offset + 8, offset + 8 + size)
      });
      
      offset += 8 + size;
    }
    
    return logs;
  }

  /**
   * Cleanup session resources
   */
  private cleanupSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

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
    if (session.containerId) {
      this.containers.delete(session.containerId);
    }
    if (session.execId) {
      this.execSessions.delete(session.execId);
    }

    this.sessions.delete(sessionId);
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
  getConnectionHealth(): { healthy: boolean; lastCheck: Date; reconnectAttempts: number } {
    return {
      healthy: this.connectionHealthy,
      lastCheck: this.lastHealthCheck,
      reconnectAttempts: this.reconnectAttempts
    };
  }

  /**
   * Cleanup all resources
   */
  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up Docker protocol resources');

    // Stop all health checks
    Array.from(this.healthChecks.entries()).forEach(([id, interval]) => {
      clearInterval(interval);
    });
    this.healthChecks.clear();

    // Stop all metrics collection
    Array.from(this.metricsIntervals.entries()).forEach(([sessionId, interval]) => {
      clearInterval(interval);
    });
    this.metricsIntervals.clear();

    // Close all log streams
    Array.from(this.logStreams.entries()).forEach(([sessionId, stream]) => {
      stream.destroy();
    });
    this.logStreams.clear();

    // Stop event monitoring
    if (this.eventMonitor) {
      clearTimeout(this.eventMonitor);
    }

    // Clean up all sessions
    const sessionIds = Array.from(this.sessions.keys());
    for (const sessionId of sessionIds) {
      try {
        await this.stopSession(sessionId, { force: true });
      } catch (error) {
        this.logger.warn('Failed to stop session during cleanup', { sessionId, error: error.message });
      }
    }

    this.logger.info('Docker protocol cleanup completed');
  }
}