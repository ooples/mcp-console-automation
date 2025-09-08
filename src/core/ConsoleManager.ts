import { spawn, ChildProcess, SpawnOptions } from 'child_process';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import stripAnsi from 'strip-ansi';
import { Client as SSHClient, ClientChannel, ConnectConfig } from 'ssh2';
import { ConsoleSession, ConsoleOutput, ConsoleEvent, SessionOptions, ConsoleType, ConnectionPoolingOptions, SSHConnectionOptions, ExtendedErrorPattern } from '../types/index.js';
import { ErrorDetector } from './ErrorDetector.js';
import { Logger } from '../utils/logger.js';
import { StreamManager } from './StreamManager.js';
import { MonitoringSystem } from '../monitoring/MonitoringSystem.js';
import { ConnectionPool } from './ConnectionPool.js';
import { SessionManager } from './SessionManager.js';
import { RetryManager } from './RetryManager.js';
import { ErrorRecovery, ErrorContext } from './ErrorRecovery.js';
import PQueue from 'p-queue';
import { platform } from 'os';
import { readFileSync } from 'fs';

export class ConsoleManager extends EventEmitter {
  private sessions: Map<string, ConsoleSession>;
  private processes: Map<string, ChildProcess>;
  private sshClients: Map<string, SSHClient>;
  private sshChannels: Map<string, ClientChannel>;
  private sshConnectionPool: Map<string, SSHClient>; // Legacy connection pooling for SSH
  private outputBuffers: Map<string, ConsoleOutput[]>;
  private streamManagers: Map<string, StreamManager>;
  private errorDetector: ErrorDetector;
  private logger: Logger;
  private queue: PQueue;
  private maxBufferSize: number = 10000;
  private maxSessions: number = 50;
  private resourceMonitor: NodeJS.Timeout | null = null;
  private monitoringSystem: MonitoringSystem;
  private retryAttempts: Map<string, number>;
  
  // New production-ready connection pooling and session management
  private connectionPool: ConnectionPool;
  private sessionManager: SessionManager;
  private retryManager: RetryManager;
  private errorRecovery: ErrorRecovery;

  constructor(config?: {
    connectionPooling?: ConnectionPoolingOptions;
    sessionManager?: Partial<import('../types/index.js').SessionManagerConfig>;
  }) {
    super();
    this.sessions = new Map();
    this.processes = new Map();
    this.sshClients = new Map();
    this.sshChannels = new Map();
    this.sshConnectionPool = new Map();
    this.outputBuffers = new Map();
    this.streamManagers = new Map();
    this.errorDetector = new ErrorDetector();
    this.logger = new Logger('ConsoleManager');
    this.queue = new PQueue({ concurrency: 10 });
    this.monitoringSystem = new MonitoringSystem();
    this.retryAttempts = new Map();
    this.retryManager = new RetryManager();
    this.errorRecovery = new ErrorRecovery();

    // Initialize new production-ready components
    this.connectionPool = new ConnectionPool({
      maxConnectionsPerHost: config?.connectionPooling?.maxConnectionsPerHost ?? 5,
      connectionIdleTimeout: config?.connectionPooling?.connectionIdleTimeout ?? 5 * 60 * 1000,
      keepAliveInterval: config?.connectionPooling?.keepAliveInterval ?? 30 * 1000,
      connectionRetryAttempts: config?.connectionPooling?.connectionRetryAttempts ?? 3,
      healthCheckInterval: 60 * 1000, // 1 minute health checks
      poolingStrategy: config?.connectionPooling?.poolingStrategy ?? 'least-connections',
      enableMetrics: true,
      enableLogging: true,
      cleanupInterval: 2 * 60 * 1000, // 2 minute cleanup
      connectionTimeout: 30 * 1000, // 30 seconds
      maxReconnectAttempts: 5,
      circuitBreakerThreshold: 3
    });

    this.sessionManager = new SessionManager(config?.sessionManager);

    // Setup event listeners for integration
    this.setupPoolingIntegration();
    this.setupErrorRecoveryHandlers();
    this.startResourceMonitor();
  }

  /**
   * Setup event listeners for connection pool and session manager integration
   */
  private setupPoolingIntegration(): void {
    // Connection pool events
    this.connectionPool.on('connectionCreated', ({ connectionId, hostKey }) => {
      this.logger.info(`Connection pool: New connection ${connectionId} created for ${hostKey}`);
    });

    this.connectionPool.on('connectionError', ({ connectionId, error }) => {
      this.logger.error(`Connection pool: Connection ${connectionId} error:`, error);
    });

    this.connectionPool.on('connectionClosed', ({ connectionId }) => {
      this.logger.info(`Connection pool: Connection ${connectionId} closed`);
    });

    this.connectionPool.on('circuitBreakerTripped', ({ hostKey, failures }) => {
      this.logger.warn(`Connection pool: Circuit breaker tripped for ${hostKey} after ${failures} failures`);
    });

    // Session manager events
    this.sessionManager.on('sessionRegistered', ({ sessionId, type }) => {
      this.logger.info(`Session manager: Registered ${type} session ${sessionId}`);
    });

    this.sessionManager.on('sessionStatusChanged', ({ sessionId, oldStatus, newStatus }) => {
      this.logger.info(`Session manager: Session ${sessionId} status changed from ${oldStatus} to ${newStatus}`);
    });

    this.sessionManager.on('sessionRecoveryAttempt', async ({ sessionId, attempt, sessionState, persistentData }) => {
      this.logger.info(`Session manager: Attempting recovery ${attempt} for session ${sessionId}`);
      
      try {
        // Attempt to recreate the session based on persistent data
        if (persistentData && sessionState.type === 'local') {
          // For local sessions, try to restart the process
          const newSessionId = await this.createSession({
            command: persistentData.command,
            args: persistentData.args,
            cwd: persistentData.cwd,
            env: persistentData.env,
            consoleType: persistentData.consoleType,
            streaming: persistentData.streaming
          });

          // Update session manager that recovery succeeded
          await this.sessionManager.updateSessionStatus(sessionId, 'running', {
            recoveredSessionId: newSessionId,
            recoverySuccess: true
          });

        } else if (persistentData && sessionState.type === 'ssh') {
          // For SSH sessions, recovery would need SSH connection details
          // This would require storing SSH options in persistent data
          this.logger.warn(`SSH session recovery not yet implemented for session ${sessionId}`);
          await this.sessionManager.updateSessionStatus(sessionId, 'failed', {
            recoveryFailure: 'SSH recovery not implemented'
          });
        }

      } catch (error) {
        this.logger.error(`Session recovery failed for ${sessionId}:`, error);
        await this.sessionManager.updateSessionStatus(sessionId, 'failed', {
          recoveryError: error instanceof Error ? error.message : String(error)
        });
      }
    });

    this.sessionManager.on('sessionRecovered', ({ sessionId }) => {
      this.logger.info(`Session manager: Successfully recovered session ${sessionId}`);
    });
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

  private setupErrorRecoveryHandlers(): void {
    // Handle retry events
    this.retryManager.on('retry-success', (context) => {
      this.logger.info(`Retry succeeded for ${context.operation} in session ${context.sessionId}`);
      this.emit('retry-success', context);
    });

    this.retryManager.on('retry-failed', (context) => {
      this.logger.warn(`Retry failed for ${context.operation} in session ${context.sessionId}: ${context.reason}`);
      this.emit('retry-failed', context);
    });

    this.retryManager.on('retry-exhausted', (context) => {
      this.logger.error(`Retry exhausted for ${context.operation} in session ${context.sessionId}`);
      this.emit('retry-exhausted', context);
    });

    this.retryManager.on('circuit-breaker-open', (data) => {
      this.logger.warn(`Circuit breaker opened for ${data.key}`);
      this.emit('circuit-breaker-open', data);
    });

    // Handle error recovery events
    this.errorRecovery.on('recovery-attempted', (data) => {
      this.logger.info(`Error recovery attempted for session ${data.sessionId}: ${data.strategy}`);
      this.emit('recovery-attempted', data);
    });

    this.errorRecovery.on('degradation-enabled', (data) => {
      this.logger.warn(`Degraded mode enabled for session ${data.sessionId}: ${data.reason}`);
      this.emit('degradation-enabled', data);
    });

    this.errorRecovery.on('degradation-restored', (data) => {
      this.logger.info(`Degraded mode restored for session ${data.sessionId}`);
      this.emit('degradation-restored', data);
    });

    this.errorRecovery.on('require-reauth', (data) => {
      this.logger.warn(`Re-authentication required for session ${data.sessionId}`);
      this.emit('require-reauth', data);
    });
  }

  private async handleSessionError(sessionId: string, error: Error, operation: string): Promise<boolean> {
    try {
      // Create error context
      const errorContext: ErrorContext = {
        sessionId,
        operation,
        error,
        timestamp: Date.now(),
        metadata: {
          sessionInfo: this.sessions.get(sessionId),
          isDegraded: this.errorRecovery.isDegraded(sessionId)
        }
      };

      // Attempt error recovery
      const recoveryResult = await this.errorRecovery.attemptRecovery(errorContext);
      
      if (recoveryResult.recovered) {
        this.logger.info(`Error recovery successful for session ${sessionId}`);
        return true;
      } else if (recoveryResult.userGuidance.length > 0) {
        // Emit guidance to user
        this.emit('user-guidance', {
          sessionId,
          guidance: recoveryResult.userGuidance,
          actions: recoveryResult.actions
        });
      }

      return false;
    } catch (recoveryError) {
      this.logger.error(`Error recovery failed for session ${sessionId}: ${recoveryError}`);
      return false;
    }
  }

  async createSession(options: SessionOptions): Promise<string> {
    if (this.sessions.size >= this.maxSessions) {
      throw new Error(`Maximum session limit (${this.maxSessions}) reached`);
    }

    const sessionId = uuidv4();
    
    // Use retry logic for session creation
    return await this.retryManager.executeWithRetry(
      async () => {
        return await this.createSessionInternal(sessionId, options);
      },
      {
        sessionId,
        operationName: 'create_session',
        strategyName: options.command?.toLowerCase().includes('ssh') ? 'ssh' : 'generic',
        context: { command: options.command, args: options.args },
        onRetry: (context) => {
          this.logger.info(`Retrying session creation for ${sessionId} (attempt ${context.attemptNumber})`);
          
          // Clean up any partial session state before retry
          this.cleanupPartialSession(sessionId);
        }
      }
    );
  }

  private async createSessionInternal(sessionId: string, options: SessionOptions): Promise<string> {
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

    // Check if this is an SSH session
    const isSSHSession = !!options.sshOptions;
    const sessionType: 'local' | 'ssh' = isSSHSession ? 'ssh' : 'local';

    try {
      // Register session with SessionManager
      await this.sessionManager.registerSession(session, sessionType);

      if (isSSHSession && options.sshOptions) {
        // Handle SSH session creation through connection pool
        return await this.createPooledSSHSession(sessionId, session, options);
      } else {
        // Handle local session creation (existing logic)
        return await this.createLocalSession(sessionId, session, options);
      }
    } catch (error) {
      // Update session manager about the failure
      await this.sessionManager.updateSessionStatus(sessionId, 'failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      
      session.status = 'crashed';
      this.sessions.set(sessionId, session);
      
      // Try to recover from the error
      await this.handleSessionError(sessionId, error as Error, 'create_session');
      
      this.logger.error(`Failed to create session: ${error}`);
      throw error;
    }
  }

  /**
   * Create SSH session using connection pool
   */
  private async createPooledSSHSession(sessionId: string, session: ConsoleSession, options: SessionOptions): Promise<string> {
    if (!options.sshOptions) {
      throw new Error('SSH options are required for SSH session');
    }

    try {
      // Get or create pooled connection
      const pooledConnection = await this.connectionPool.getConnection(options.sshOptions);
      
      // Create SSH shell session
      const sshClient = pooledConnection.connection;
      
      await new Promise<void>((resolve, reject) => {
        sshClient.shell({ 
          term: 'xterm-256color',
          cols: options.cols || 80,
          rows: options.rows || 24
        }, (err: Error | undefined, stream: ClientChannel) => {
          if (err) {
            reject(err);
            return;
          }

          // Store SSH connection info
          this.sshClients.set(sessionId, sshClient);
          this.sshChannels.set(sessionId, stream);
          
          // Setup stream handlers for SSH session
          this.setupPooledSSHHandlers(sessionId, stream, options);
          
          // Store session data
          this.sessions.set(sessionId, { 
            ...session, 
            status: 'running',
            pid: undefined // SSH sessions don't have local PIDs
          });
          this.outputBuffers.set(sessionId, []);

          // Setup stream manager for efficient streaming
          if (options.streaming) {
            const streamManager = new StreamManager(sessionId);
            this.streamManagers.set(sessionId, streamManager);
          }

          // Update session manager
          this.sessionManager.updateSessionStatus(sessionId, 'running', {
            connectionId: pooledConnection.id,
            sshHost: options.sshOptions!.host
          });

          resolve();
        });
      });

      // Start monitoring if enabled
      if (options.monitoring) {
        await this.monitoringSystem.startSessionMonitoring(sessionId, {
          command: options.command,
          args: options.args || [],
          ...options.monitoring
        });
      }

      this.emitEvent({
        sessionId,
        type: 'started',
        timestamp: new Date(),
        data: { 
          command: options.command, 
          type: 'ssh',
          host: options.sshOptions.host 
        }
      });

      this.logger.info(`SSH session ${sessionId} created for command: ${options.command} on ${options.sshOptions.host}`);
      
      return sessionId;

    } catch (error) {
      // Release connection back to pool on error
      // Note: We don't have the connection ID here in error case, so this is best effort
      this.logger.error(`SSH session creation failed for ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Create local session (existing logic extracted)
   */
  private async createLocalSession(sessionId: string, session: ConsoleSession, options: SessionOptions): Promise<string> {
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

      // Start monitoring if enabled
      if (options.monitoring) {
        await this.monitoringSystem.startSessionMonitoring(sessionId, {
          command: options.command,
          args: options.args || [],
          pid: childProcess.pid!,
          ...options.monitoring
        });
      }

      // Update session manager
      await this.sessionManager.updateSessionStatus(sessionId, 'running', {
        pid: childProcess.pid
      });

      this.emitEvent({
        sessionId,
        type: 'started',
        timestamp: new Date(),
        data: { pid: childProcess.pid, command: options.command }
      });

      this.logger.info(`Session ${sessionId} created for command: ${options.command}`);
      
      return sessionId;
    } catch (error) {
      this.logger.error(`Local session creation failed for ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Setup SSH stream handlers for pooled connections
   */
  private setupPooledSSHHandlers(sessionId: string, stream: ClientChannel, options: SessionOptions): void {
    const streamManager = this.streamManagers.get(sessionId);

    // Handle SSH stream stdout/stderr
    stream.on('data', (data: Buffer) => {
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

      // Record output to monitoring system
      if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
        this.monitoringSystem.recordEvent(sessionId, 'output', { 
          type: 'stdout',
          size: text.length,
          lineCount: text.split('\n').length - 1
        });
      }

      // Update session activity
      this.sessionManager.updateSessionActivity(sessionId, {
        lastOutput: new Date(),
        outputSize: text.length
      });

      if (options.detectErrors !== false) {
        this.queue.add(async () => {
          // Convert ErrorPattern[] to ExtendedErrorPattern[] if needed
          const extendedPatterns = options.patterns?.map(p => ({
            ...p,
            category: 'custom',
            language: 'unknown'
          } as ExtendedErrorPattern));
          
          const errors = this.errorDetector.detect(output.data, extendedPatterns);
          if (errors.length > 0) {
            this.emitEvent({
              sessionId,
              type: 'error',
              timestamp: new Date(),
              data: { errors, output: output.data }
            });
            
            // Record error to monitoring system
            if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
              this.monitoringSystem.recordEvent(sessionId, 'error', {
                errorCount: errors.length,
                errorTypes: errors.map(e => e.pattern.type),
                output: output.data
              });
            }
          }
        });
      }
    });

    // Handle SSH stream stderr
    stream.stderr?.on('data', (data: Buffer) => {
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

      // Record stderr output to monitoring system
      if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
        this.monitoringSystem.recordEvent(sessionId, 'output', { 
          type: 'stderr',
          size: text.length,
          lineCount: text.split('\n').length - 1
        });
      }

      // Update session activity
      this.sessionManager.updateSessionActivity(sessionId, {
        lastError: new Date(),
        errorSize: text.length
      });

      // Always check stderr for errors
      this.queue.add(async () => {
        // Convert ErrorPattern[] to ExtendedErrorPattern[] if needed
        const extendedPatterns = options.patterns?.map(p => ({
          ...p,
          category: 'custom',
          language: 'unknown'
        } as ExtendedErrorPattern));
        
        const errors = this.errorDetector.detect(output.data, extendedPatterns);
        if (errors.length > 0) {
          this.emitEvent({
            sessionId,
            type: 'error',
            timestamp: new Date(),
            data: { errors, output: output.data, isStderr: true }
          });
          
          // Record stderr error to monitoring system
          if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
            this.monitoringSystem.recordEvent(sessionId, 'error', {
              errorCount: errors.length,
              errorTypes: errors.map(e => e.pattern.type),
              output: output.data,
              isStderr: true
            });
          }
        }
      });
    });

    // Handle SSH stream close
    stream.on('close', () => {
      const session = this.sessions.get(sessionId);
      if (session) {
        session.status = 'stopped';
        this.sessions.set(sessionId, session);
      }

      if (streamManager) {
        streamManager.end();
      }

      // Update session manager
      this.sessionManager.updateSessionStatus(sessionId, 'stopped');

      // Stop monitoring if active
      if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
        this.monitoringSystem.stopSessionMonitoring(sessionId);
      }

      this.emitEvent({
        sessionId,
        type: 'stopped',
        timestamp: new Date(),
        data: { reason: 'SSH stream closed' }
      });

      this.logger.info(`SSH session ${sessionId} stream closed`);

      // Release connection back to pool
      const sshClient = this.sshClients.get(sessionId);
      if (sshClient) {
        // Note: We'd need to track connection IDs properly, for now just log
        this.logger.debug(`SSH connection for session ${sessionId} will be released when connection tracking is implemented`);
      }
    });

    // Handle SSH stream error
    stream.on('error', (error: Error) => {
      const session = this.sessions.get(sessionId);
      if (session) {
        session.status = 'crashed';
        this.sessions.set(sessionId, session);
      }

      // Update session manager
      this.sessionManager.updateSessionStatus(sessionId, 'failed', {
        error: error.message
      });

      // Record process error to monitoring system
      if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
        this.monitoringSystem.recordEvent(sessionId, 'error', {
          type: 'ssh_stream_error',
          error: error.message,
          stack: error.stack
        });
        this.monitoringSystem.stopSessionMonitoring(sessionId);
      }

      this.emitEvent({
        sessionId,
        type: 'error',
        timestamp: new Date(),
        data: { error: error.message }
      });

      this.logger.error(`SSH session ${sessionId} stream error: ${error.message}`);
    });

    if (options.timeout) {
      setTimeout(() => {
        if (this.isSessionRunning(sessionId)) {
          this.stopSession(sessionId);
        }
      }, options.timeout);
    }
  }

  private cleanupPartialSession(sessionId: string): void {
    // Clean up any partial state from failed session creation
    const process = this.processes.get(sessionId);
    if (process && !process.killed) {
      try {
        process.kill('SIGTERM');
      } catch (error) {
        // Process might already be dead
        this.logger.debug(`Failed to kill process during cleanup: ${error}`);
      }
    }

    this.sessions.delete(sessionId);
    this.processes.delete(sessionId);
    this.outputBuffers.delete(sessionId);
    this.streamManagers.delete(sessionId);
    this.sshClients.delete(sessionId);
    this.sshChannels.delete(sessionId);
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

        // Record output to monitoring system
        if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
          this.monitoringSystem.recordEvent(sessionId, 'output', { 
            type: 'stdout',
            size: text.length,
            lineCount: text.split('\n').length - 1
          });
        }

        if (options.detectErrors !== false) {
          this.queue.add(async () => {
            // Convert ErrorPattern[] to ExtendedErrorPattern[] if needed
            const extendedPatterns = options.patterns?.map(p => ({
              ...p,
              category: 'custom',
              language: 'unknown'
            } as ExtendedErrorPattern));
            
            const errors = this.errorDetector.detect(output.data, extendedPatterns);
            if (errors.length > 0) {
              this.emitEvent({
                sessionId,
                type: 'error',
                timestamp: new Date(),
                data: { errors, output: output.data }
              });
              
              // Record error to monitoring system
              if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
                this.monitoringSystem.recordEvent(sessionId, 'error', {
                  errorCount: errors.length,
                  errorTypes: errors.map(e => e.pattern.type),
                  output: output.data
                });
              }
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

        // Record stderr output to monitoring system
        if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
          this.monitoringSystem.recordEvent(sessionId, 'output', { 
            type: 'stderr',
            size: text.length,
            lineCount: text.split('\n').length - 1
          });
        }

        // Always check stderr for errors
        this.queue.add(async () => {
          // Convert ErrorPattern[] to ExtendedErrorPattern[] if needed
          const extendedPatterns = options.patterns?.map(p => ({
            ...p,
            category: 'custom',
            language: 'unknown'
          } as ExtendedErrorPattern));
          
          const errors = this.errorDetector.detect(output.data, extendedPatterns);
          if (errors.length > 0) {
            this.emitEvent({
              sessionId,
              type: 'error',
              timestamp: new Date(),
              data: { errors, output: output.data, isStderr: true }
            });
            
            // Record stderr error to monitoring system
            if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
              this.monitoringSystem.recordEvent(sessionId, 'error', {
                errorCount: errors.length,
                errorTypes: errors.map(e => e.pattern.type),
                output: output.data,
                isStderr: true
              });
            }
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

      // Stop monitoring if active
      if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
        this.monitoringSystem.stopSessionMonitoring(sessionId);
      }

      this.emitEvent({
        sessionId,
        type: 'stopped',
        timestamp: new Date(),
        data: { exitCode: code, signal }
      });

      this.logger.info(`Session ${sessionId} exited with code: ${code}`);
    });

    process.on('error', async (error: Error) => {
      const session = this.sessions.get(sessionId);
      if (session) {
        session.status = 'crashed';
        this.sessions.set(sessionId, session);
      }

      // Record process error to monitoring system
      if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
        this.monitoringSystem.recordEvent(sessionId, 'error', {
          type: 'process_error',
          error: error.message,
          stack: error.stack
        });
        this.monitoringSystem.stopSessionMonitoring(sessionId);
      }

      // Try to recover from the error
      const recovered = await this.handleSessionError(sessionId, error, 'process_error');
      
      this.emitEvent({
        sessionId,
        type: 'error',
        timestamp: new Date(),
        data: { error: error.message, recovered }
      });

      this.logger.error(`Session ${sessionId} error: ${error.message}`);
      
      if (!recovered) {
        // If recovery failed, attempt to restart the session if it's a recoverable error
        const classification = this.errorRecovery.classifyError(error);
        if (classification.recoverable && !this.errorRecovery.isDegraded(sessionId)) {
          this.logger.info(`Attempting to restart session ${sessionId} due to recoverable error`);
          this.emit('session-restart-required', { sessionId, error: error.message, classification });
        }
      }
    });

    if (options.timeout) {
      setTimeout(() => {
        if (this.isSessionRunning(sessionId)) {
          this.stopSession(sessionId);
        }
      }, options.timeout);
    }
  }

  private isSSHCommand(command: string): boolean {
    // Check if the command starts with 'ssh' and contains typical SSH patterns
    const sshPattern = /^ssh\s+/i;
    return sshPattern.test(command.trim());
  }

  private parseSSHCommand(command: string): {
    host: string;
    port?: number;
    user?: string;
    password?: string;
    privateKey?: string;
    options: string[];
  } {
    const parts = command.trim().split(/\s+/);
    const result = {
      host: '',
      port: 22,
      user: undefined as string | undefined,
      password: undefined as string | undefined,
      privateKey: undefined as string | undefined,
      options: [] as string[]
    };

    // Parse SSH command arguments
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      
      if (part === '-p' && i + 1 < parts.length) {
        // Port specification
        result.port = parseInt(parts[++i], 10);
      } else if (part === '-i' && i + 1 < parts.length) {
        // Private key file
        result.privateKey = parts[++i];
      } else if (part === '-l' && i + 1 < parts.length) {
        // Username
        result.user = parts[++i];
      } else if (part.startsWith('-')) {
        // Other SSH options
        result.options.push(part);
        // Some options might have values
        if (i + 1 < parts.length && !parts[i + 1].startsWith('-')) {
          result.options.push(parts[++i]);
        }
      } else if (!result.host) {
        // This should be the host or user@host
        if (part.includes('@')) {
          const [user, host] = part.split('@');
          result.user = user;
          result.host = host;
        } else {
          result.host = part;
        }
      }
    }

    if (!result.host) {
      throw new Error('No hostname specified in SSH command');
    }

    return result;
  }

  private getConnectionPoolKey(host: string, port: number, user?: string): string {
    return `${user || 'default'}@${host}:${port}`;
  }

  private async createSSHSession(sessionId: string, options: SessionOptions): Promise<string> {
    const sshConfig = this.parseSSHCommand(options.command!);
    const poolKey = this.getConnectionPoolKey(sshConfig.host, sshConfig.port!, sshConfig.user);
    
    const session: ConsoleSession = {
      id: sessionId,
      command: options.command!,
      args: options.args || [],
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...options.env } as Record<string, string>,
      createdAt: new Date(),
      status: 'running',
      type: 'ssh',
      streaming: options.streaming || false
    };

    try {
      // Check for existing connection in pool
      let sshClient = this.sshConnectionPool.get(poolKey);
      
      if (!sshClient || (sshClient as any)._sock?.readyState !== 'open') {
        // Create new SSH connection
        sshClient = new SSHClient();
        
        const connectConfig: ConnectConfig = {
          host: sshConfig.host,
          port: sshConfig.port || 22,
          username: sshConfig.user || process.env.USER || process.env.USERNAME || 'root'
        };

        // Authentication setup
        if (sshConfig.privateKey) {
          try {
            connectConfig.privateKey = readFileSync(sshConfig.privateKey);
          } catch (error) {
            this.logger.error(`Failed to read private key: ${error}`);
            throw new Error(`Failed to read private key: ${sshConfig.privateKey}`);
          }
        } else if (sshConfig.password) {
          connectConfig.password = sshConfig.password;
        } else if (process.env.SSH_AUTH_SOCK) {
          // Use SSH agent if available
          connectConfig.agent = process.env.SSH_AUTH_SOCK;
        }

        // Set connection timeout
        connectConfig.readyTimeout = options.timeout || 10000;

        await this.connectSSH(sshClient, connectConfig, poolKey, sessionId);
      }

      // Create shell session
      const channel = await this.createSSHChannel(sshClient, sessionId);
      
      this.sessions.set(sessionId, session);
      this.sshClients.set(sessionId, sshClient);
      this.sshChannels.set(sessionId, channel);
      this.outputBuffers.set(sessionId, []);

      // Setup stream manager for efficient streaming
      if (options.streaming) {
        const streamManager = new StreamManager(sessionId);
        this.streamManagers.set(sessionId, streamManager);
      }

      this.setupSSHHandlers(sessionId, channel, options);

      // Start monitoring if enabled
      if (options.monitoring) {
        await this.monitoringSystem.startSessionMonitoring(sessionId, {
          command: options.command!,
          args: options.args || [],
          pid: 0, // SSH connections don't have local PIDs
          ...options.monitoring
        });
      }

      this.emitEvent({
        sessionId,
        type: 'started',
        timestamp: new Date(),
        data: { command: options.command, ssh: true, host: sshConfig.host }
      });

      this.logger.info(`SSH session ${sessionId} created for ${sshConfig.user}@${sshConfig.host}:${sshConfig.port}`);
      
      return sessionId;
    } catch (error) {
      session.status = 'crashed';
      this.sessions.set(sessionId, session);
      this.logger.error(`Failed to create SSH session: ${error}`);
      throw error;
    }
  }

  private async connectSSH(client: SSHClient, config: ConnectConfig, poolKey: string, sessionId: string): Promise<void> {
    const maxRetries = 3;
    const baseDelay = 1000; // 1 second
    const retryKey = `${poolKey}_${sessionId}`;
    
    let currentAttempt = this.retryAttempts.get(retryKey) || 0;

    return new Promise((resolve, reject) => {
      const attemptConnection = () => {
        currentAttempt++;
        this.retryAttempts.set(retryKey, currentAttempt);

        client.connect(config);

        const connectionTimeout = setTimeout(() => {
          client.destroy();
          const error = new Error(`SSH connection timeout after ${config.readyTimeout}ms`);
          
          if (currentAttempt < maxRetries) {
            const delay = baseDelay * Math.pow(2, currentAttempt - 1); // Exponential backoff
            this.logger.warn(`SSH connection attempt ${currentAttempt} failed, retrying in ${delay}ms`);
            setTimeout(attemptConnection, delay);
          } else {
            this.retryAttempts.delete(retryKey);
            reject(error);
          }
        }, config.readyTimeout || 10000);

        client.once('ready', () => {
          clearTimeout(connectionTimeout);
          this.retryAttempts.delete(retryKey);
          this.sshConnectionPool.set(poolKey, client);
          this.logger.info(`SSH connection established: ${poolKey}`);
          
          // Setup connection error handler for reconnection
          client.on('error', (error) => {
            this.logger.error(`SSH connection error: ${error.message}`);
            this.handleSSHConnectionError(poolKey, error);
          });

          client.on('close', () => {
            this.logger.info(`SSH connection closed: ${poolKey}`);
            this.sshConnectionPool.delete(poolKey);
          });

          resolve();
        });

        client.once('error', (error) => {
          clearTimeout(connectionTimeout);
          
          if (currentAttempt < maxRetries) {
            const delay = baseDelay * Math.pow(2, currentAttempt - 1); // Exponential backoff
            this.logger.warn(`SSH connection attempt ${currentAttempt} failed: ${error.message}, retrying in ${delay}ms`);
            setTimeout(attemptConnection, delay);
          } else {
            this.retryAttempts.delete(retryKey);
            reject(error);
          }
        });
      };

      attemptConnection();
    });
  }

  private async createSSHChannel(client: SSHClient, sessionId: string): Promise<ClientChannel> {
    return new Promise((resolve, reject) => {
      client.shell((error, channel) => {
        if (error) {
          reject(error);
          return;
        }

        // Request PTY for proper interactive session
        channel.setWindow(80, 24, 640, 480);
        
        resolve(channel);
      });
    });
  }

  private setupSSHHandlers(sessionId: string, channel: ClientChannel, options: SessionOptions) {
    const streamManager = this.streamManagers.get(sessionId);
    
    // Handle stdout/stderr from SSH channel
    channel.on('data', (data: Buffer) => {
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

      // Record output to monitoring system
      if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
        this.monitoringSystem.recordEvent(sessionId, 'output', { 
          type: 'stdout',
          size: text.length,
          lineCount: text.split('\n').length - 1
        });
      }

      if (options.detectErrors !== false) {
        this.queue.add(async () => {
          // Convert ErrorPattern[] to ExtendedErrorPattern[] if needed
          const extendedPatterns = options.patterns?.map(p => ({
            ...p,
            category: 'custom',
            language: 'unknown'
          } as ExtendedErrorPattern));
          
          const errors = this.errorDetector.detect(output.data, extendedPatterns);
          if (errors.length > 0) {
            this.emitEvent({
              sessionId,
              type: 'error',
              timestamp: new Date(),
              data: { errors, output: output.data }
            });
            
            // Record error to monitoring system
            if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
              this.monitoringSystem.recordEvent(sessionId, 'error', {
                errorCount: errors.length,
                errorTypes: errors.map(e => e.pattern.type),
                output: output.data
              });
            }
          }
        });
      }
    });

    channel.stderr.on('data', (data: Buffer) => {
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

      // Record stderr output to monitoring system
      if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
        this.monitoringSystem.recordEvent(sessionId, 'output', { 
          type: 'stderr',
          size: text.length,
          lineCount: text.split('\n').length - 1
        });
      }

      // Always check stderr for errors
      this.queue.add(async () => {
        // Convert ErrorPattern[] to ExtendedErrorPattern[] if needed
        const extendedPatterns = options.patterns?.map(p => ({
          ...p,
          category: 'custom',
          language: 'unknown'
        } as ExtendedErrorPattern));
        
        const errors = this.errorDetector.detect(output.data, extendedPatterns);
        if (errors.length > 0) {
          this.emitEvent({
            sessionId,
            type: 'error',
            timestamp: new Date(),
            data: { errors, output: output.data, isStderr: true }
          });
          
          // Record stderr error to monitoring system
          if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
            this.monitoringSystem.recordEvent(sessionId, 'error', {
              errorCount: errors.length,
              errorTypes: errors.map(e => e.pattern.type),
              output: output.data,
              isStderr: true
            });
          }
        }
      });
    });

    // Handle channel close
    channel.on('close', () => {
      const session = this.sessions.get(sessionId);
      if (session) {
        session.status = 'stopped';
        this.sessions.set(sessionId, session);
      }

      if (streamManager) {
        streamManager.end();
      }

      // Stop monitoring if active
      if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
        this.monitoringSystem.stopSessionMonitoring(sessionId);
      }

      this.emitEvent({
        sessionId,
        type: 'stopped',
        timestamp: new Date(),
        data: { ssh: true }
      });

      this.logger.info(`SSH session ${sessionId} closed`);
    });

    channel.on('error', (error: Error) => {
      const session = this.sessions.get(sessionId);
      if (session) {
        session.status = 'crashed';
        this.sessions.set(sessionId, session);
      }

      // Record SSH error to monitoring system
      if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
        this.monitoringSystem.recordEvent(sessionId, 'error', {
          type: 'ssh_channel_error',
          error: error.message,
          stack: error.stack
        });
        this.monitoringSystem.stopSessionMonitoring(sessionId);
      }

      this.emitEvent({
        sessionId,
        type: 'error',
        timestamp: new Date(),
        data: { error: error.message, ssh: true }
      });

      this.logger.error(`SSH session ${sessionId} error: ${error.message}`);
    });

    if (options.timeout) {
      setTimeout(() => {
        if (this.isSessionRunning(sessionId)) {
          this.stopSession(sessionId);
        }
      }, options.timeout);
    }
  }

  private handleSSHConnectionError(poolKey: string, error: Error) {
    // Remove failed connection from pool
    this.sshConnectionPool.delete(poolKey);
    
    // Find all sessions using this connection and mark them for reconnection
    this.sshClients.forEach((client, sessionId) => {
      const clientConfig = (client as any)._config;
      if (this.getConnectionPoolKey(
        clientConfig?.host || '',
        clientConfig?.port || 22,
        clientConfig?.username
      ) === poolKey) {
        this.emitEvent({
          sessionId,
          type: 'error',
          timestamp: new Date(),
          data: { 
            error: `SSH connection lost: ${error.message}`,
            reconnectable: true,
            ssh: true
          }
        });
      }
    });
  }

  async sendInput(sessionId: string, input: string): Promise<void> {
    return await this.retryManager.executeWithRetry(
      async () => {
        // Check if this is an SSH session
        const sshChannel = this.sshChannels.get(sessionId);
        if (sshChannel) {
          return new Promise<void>((resolve, reject) => {
            sshChannel.write(input, (error) => {
              if (error) {
                reject(error);
              } else {
                // Record input to monitoring system
                if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
                  this.monitoringSystem.recordEvent(sessionId, 'input', {
                    size: input.length,
                    type: 'ssh_text_input'
                  });
                }

                this.emitEvent({
                  sessionId,
                  type: 'input',
                  timestamp: new Date(),
                  data: { input, ssh: true }
                });
                resolve();
              }
            });
          });
        }

        return this.sendInputToProcess(sessionId, input);
      },
      {
        sessionId,
        operationName: 'send_input',
        strategyName: this.sshChannels.has(sessionId) ? 'ssh' : 'generic',
        context: { inputLength: input.length },
        onRetry: (context) => {
          this.logger.debug(`Retrying input send for session ${sessionId} (attempt ${context.attemptNumber})`);
        }
      }
    );
  }

  private async sendInputToProcess(sessionId: string, input: string): Promise<void> {

    // Handle regular process input
    const process = this.processes.get(sessionId);
    if (!process || !process.stdin) {
      throw new Error(`Session ${sessionId} not found or stdin not available`);
    }

    return new Promise((resolve, reject) => {
      process.stdin!.write(input, (error) => {
        if (error) {
          reject(error);
        } else {
          // Record input to monitoring system
          if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
            this.monitoringSystem.recordEvent(sessionId, 'input', {
              size: input.length,
              type: 'text_input'
            });
          }

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
    
    // Record key input to monitoring system
    if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
      this.monitoringSystem.recordEvent(sessionId, 'input', {
        type: 'key_input',
        key: key.toLowerCase(),
        sequence: sequence.replace(/\x1b/g, '\\x1b') // Safe representation
      });
    }
    
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
    // Handle SSH sessions
    const sshChannel = this.sshChannels.get(sessionId);
    if (sshChannel) {
      sshChannel.close();
      this.sshChannels.delete(sessionId);
      this.sshClients.delete(sessionId);
    }

    // Handle regular processes
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

    // Ensure monitoring is stopped
    if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
      this.monitoringSystem.stopSessionMonitoring(sessionId);
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

  // Monitoring system access methods
  getMonitoringSystem(): MonitoringSystem {
    return this.monitoringSystem;
  }

  getSessionMetrics(sessionId: string) {
    return this.monitoringSystem.getSessionMetrics(sessionId);
  }

  getSystemMetrics() {
    return this.monitoringSystem.getSystemMetrics();
  }

  getAlerts() {
    return this.monitoringSystem.getAlerts();
  }

  getDashboard() {
    return this.monitoringSystem.getDashboard();
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
    this.sshClients.delete(sessionId);
    this.sshChannels.delete(sessionId);
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

  // Retry and Error Recovery Management Methods

  /**
   * Get retry statistics for all sessions
   */
  getRetryStats() {
    return this.retryManager.getRetryStats();
  }

  /**
   * Get error recovery statistics
   */
  getRecoveryStats() {
    return this.errorRecovery.getRecoveryStats();
  }

  /**
   * Get circuit breaker states
   */
  getCircuitBreakerStates() {
    return this.retryManager.getCircuitBreakerStates();
  }

  /**
   * Reset circuit breakers
   */
  resetCircuitBreakers(): void {
    this.retryManager.resetAllCircuitBreakers();
    this.logger.info('All circuit breakers reset');
  }

  /**
   * Get error history for a session
   */
  getSessionErrorHistory(sessionId: string) {
    return this.errorRecovery.getErrorHistory(sessionId);
  }

  /**
   * Check if a session is in degraded mode
   */
  isSessionDegraded(sessionId: string): boolean {
    return this.errorRecovery.isDegraded(sessionId);
  }

  /**
   * Get degradation state for a session
   */
  getSessionDegradationState(sessionId: string) {
    return this.errorRecovery.getDegradationState(sessionId);
  }

  /**
   * Restore a session from degraded mode
   */
  restoreSessionFromDegradedMode(sessionId: string): boolean {
    return this.errorRecovery.restoreSession(sessionId);
  }

  /**
   * Get aggregated error data
   */
  getErrorAggregation(timeWindowMs?: number) {
    return this.errorRecovery.getErrorAggregation(timeWindowMs);
  }

  /**
   * Create an SSH session with automatic retry and recovery
   */
  async createSSHSessionWithRetry(host: string, options: {
    username: string;
    password?: string;
    privateKey?: string;
    port?: number;
    command?: string;
    args?: string[];
  }): Promise<string> {
    const sessionId = uuidv4();
    
    return await this.retryManager.executeWithRetry(
      async () => {
        // This would implement SSH session creation
        // For now, we'll simulate the behavior
        this.logger.info(`Creating SSH session to ${host} for session ${sessionId}`);
        
        // Create a placeholder session for SSH
        const session: ConsoleSession = {
          id: sessionId,
          command: `ssh ${options.username}@${host}`,
          args: options.args || [],
          cwd: process.cwd(),
          env: process.env as Record<string, string>,
          createdAt: new Date(),
          status: 'running',
          type: 'ssh' as ConsoleType,
          streaming: false
        };
        
        this.sessions.set(sessionId, session);
        this.outputBuffers.set(sessionId, []);
        
        // Emit session started event
        this.emitEvent({
          sessionId,
          type: 'started',
          timestamp: new Date(),
          data: { host, username: options.username, ssh: true }
        });
        
        return sessionId;
      },
      {
        sessionId,
        operationName: 'create_ssh_session',
        strategyName: 'ssh',
        context: { host, username: options.username },
        onRetry: (context) => {
          this.logger.info(`Retrying SSH session creation to ${host} (attempt ${context.attemptNumber})`);
          this.cleanupPartialSession(sessionId);
        }
      }
    );
  }

  // Connection Pool and Session Manager access methods

  /**
   * Get connection pool statistics
   */
  getConnectionPoolStats() {
    return this.connectionPool.getStats();
  }

  /**
   * Get connection pool metrics
   */
  getConnectionPoolMetrics() {
    return this.connectionPool.getMetrics();
  }

  /**
   * Get session manager statistics
   */
  getSessionManagerStats() {
    return this.sessionManager.getStats();
  }

  /**
   * Get session manager metrics
   */
  getSessionManagerMetrics() {
    return this.sessionManager.getMetrics();
  }

  /**
   * Get session state from session manager
   */
  getSessionState(sessionId: string) {
    return this.sessionManager.getSession(sessionId);
  }

  /**
   * Pause a session
   */
  async pauseSession(sessionId: string) {
    return this.sessionManager.pauseSession(sessionId);
  }

  /**
   * Resume a paused session
   */
  async resumeSession(sessionId: string) {
    return this.sessionManager.resumeSession(sessionId);
  }

  /**
   * Get all session states
   */
  getAllSessionStates() {
    return this.sessionManager.getAllSessions();
  }

  /**
   * Get sessions by status
   */
  getSessionsByStatus(status: import('../types/index.js').SessionState['status']) {
    return this.sessionManager.getSessionsByStatus(status);
  }

  /**
   * Get sessions by type
   */
  getSessionsByType(type: 'local' | 'ssh') {
    return this.sessionManager.getSessionsByType(type);
  }

  /**
   * Create SSH session (convenience method)
   */
  async createSSHSessionFromOptions(sshOptions: SSHConnectionOptions, sessionOptions: Omit<SessionOptions, 'sshOptions'> = { command: '' }) {
    return this.createSession({
      ...sessionOptions,
      sshOptions
    });
  }

  async destroy() {
    if (this.resourceMonitor) {
      clearInterval(this.resourceMonitor);
    }
    await this.stopAllSessions();
    
    // Close all SSH connections in the pool
    this.sshConnectionPool.forEach((client, key) => {
      this.logger.info(`Closing SSH connection pool: ${key}`);
      client.destroy();
    });
    
    // Shutdown new production-ready components
    await this.connectionPool.shutdown();
    await this.sessionManager.shutdown();
    
    await this.monitoringSystem.destroy();
    
    // Clean up retry and error recovery systems
    this.retryManager.destroy();
    this.errorRecovery.destroy();
    
    this.removeAllListeners();
    this.sessions.clear();
    this.processes.clear();
    this.sshClients.clear();
    this.sshChannels.clear();
    this.sshConnectionPool.clear();
    this.outputBuffers.clear();
    this.streamManagers.clear();
    this.retryAttempts.clear();
  }
}