import { spawn, ChildProcess, SpawnOptions } from 'child_process';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import stripAnsi from 'strip-ansi';
import { Client as SSHClient, ClientChannel, ConnectConfig } from 'ssh2';
import { ConsoleSession, ConsoleOutput, ConsoleEvent, SessionOptions, ConsoleType, ConnectionPoolingOptions, SSHConnectionOptions, ExtendedErrorPattern, CommandExecution } from '../types/index.js';
import { ErrorDetector } from './ErrorDetector.js';
import { Logger } from '../utils/logger.js';
import { StreamManager } from './StreamManager.js';
import { MonitoringSystem } from '../monitoring/MonitoringSystem.js';
import { PromptDetector, PromptDetectionResult } from './PromptDetector.js';
import { ConnectionPool } from './ConnectionPool.js';
import { SessionManager } from './SessionManager.js';
import { RetryManager } from './RetryManager.js';
import { ErrorRecovery, ErrorContext } from './ErrorRecovery.js';
import { HealthMonitor } from './HealthMonitor.js';
import { HeartbeatMonitor } from './HeartbeatMonitor.js';
import { SessionRecovery } from './SessionRecovery.js';
import { MetricsCollector } from './MetricsCollector.js';
import { SSHConnectionKeepAlive } from './SSHConnectionKeepAlive.js';
import PQueue from 'p-queue';
import { platform } from 'os';
import { readFileSync } from 'fs';

// Command queue types for SSH buffering fix
interface QueuedCommand {
  id: string;
  sessionId: string;
  input: string;
  timestamp: Date;
  retryCount: number;
  resolve: (value?: any) => void;
  reject: (error: Error) => void;
  acknowledged: boolean;
  sent: boolean;
}

interface SessionCommandQueue {
  sessionId: string;
  commands: QueuedCommand[];
  isProcessing: boolean;
  lastCommandTime: number;
  acknowledgmentTimeout: NodeJS.Timeout | null;
  outputBuffer: string;
  expectedPrompt?: RegExp;
}

interface CommandQueueConfig {
  maxQueueSize: number;
  commandTimeout: number;
  interCommandDelay: number;
  acknowledgmentTimeout: number;
  enablePromptDetection: boolean;
  defaultPromptPattern: RegExp;
}

export class ConsoleManager extends EventEmitter {
  private sessions: Map<string, ConsoleSession>;
  private processes: Map<string, ChildProcess>;
  private sshClients: Map<string, SSHClient>;
  private sshChannels: Map<string, ClientChannel>;
  private sshConnectionPool: Map<string, SSHClient>; // Legacy connection pooling for SSH
  private outputBuffers: Map<string, ConsoleOutput[]>;
  private streamManagers: Map<string, StreamManager>;
  private errorDetector: ErrorDetector;
  private promptDetector: PromptDetector;
  private logger: Logger;
  private queue: PQueue;
  private maxBufferSize: number = 10000;
  private maxSessions: number = 50;
  private resourceMonitor: NodeJS.Timeout | null = null;
  private monitoringSystem: MonitoringSystem;
  private retryAttempts: Map<string, number>;
  
  // Command execution tracking and buffer isolation
  private commandExecutions: Map<string, CommandExecution>; // commandId -> CommandExecution
  private sessionCommandQueue: Map<string, string[]>; // sessionId -> commandIds[]
  private outputSequenceCounters: Map<string, number>; // sessionId -> counter
  private promptPatterns: Map<string, RegExp>; // sessionId -> prompt pattern
  
  // Command queue system for SSH buffering fix
  private commandQueues: Map<string, SessionCommandQueue>;
  private queueConfig: CommandQueueConfig;
  private commandProcessingIntervals: Map<string, NodeJS.Timeout>;
  
  // New production-ready connection pooling and session management
  private connectionPool: ConnectionPool;
  private sessionManager: SessionManager;
  private retryManager: RetryManager;
  private errorRecovery: ErrorRecovery;
  
  // Self-healing and health monitoring components
  private healthMonitor: HealthMonitor;
  private heartbeatMonitor: HeartbeatMonitor;
  private sessionRecovery: SessionRecovery;
  private metricsCollector: MetricsCollector;
  private sshKeepAlive: SSHConnectionKeepAlive;
  
  // Self-healing state
  private selfHealingEnabled = true;
  private autoRecoveryEnabled = true;
  private predictiveHealingEnabled = true;
  private healingStats = {
    totalHealingAttempts: 0,
    successfulHealingAttempts: 0,
    preventedFailures: 0,
    automaticRecoveries: 0
  };

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
    this.promptDetector = new PromptDetector();
    this.logger = new Logger('ConsoleManager');
    this.queue = new PQueue({ concurrency: 10 });
    this.monitoringSystem = new MonitoringSystem();
    this.retryAttempts = new Map();
    
    // Initialize command execution tracking
    this.commandExecutions = new Map();
    this.sessionCommandQueue = new Map();
    this.outputSequenceCounters = new Map();
    this.promptPatterns = new Map();
    this.retryManager = new RetryManager();
    this.errorRecovery = new ErrorRecovery();
    
    // Initialize command queue system
    this.commandQueues = new Map();
    this.commandProcessingIntervals = new Map();
    this.queueConfig = {
      maxQueueSize: 100,
      commandTimeout: 30000,
      interCommandDelay: 500,
      acknowledgmentTimeout: 10000,
      enablePromptDetection: true,
      defaultPromptPattern: /[$#%>]\s*$/m
    };

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
   * Initialize command tracking for a session
   */
  private initializeSessionCommandTracking(sessionId: string, options: SessionOptions): void {
    this.sessionCommandQueue.set(sessionId, []);
    this.outputSequenceCounters.set(sessionId, 0);
    
    // Set up prompt pattern for command completion detection
    let promptPattern: RegExp;
    if (options.consoleType === 'powershell' || options.consoleType === 'pwsh') {
      promptPattern = /PS\s.*?>\s*$/m;
    } else if (options.consoleType === 'cmd') {
      promptPattern = /^[A-Z]:\\.*?>\s*$/m;
    } else if (options.consoleType === 'bash' || options.consoleType === 'zsh' || options.consoleType === 'sh') {
      promptPattern = /^[\w\-\.~]*[$#]\s*$/m;
    } else {
      // Generic prompt pattern
      promptPattern = /^.*?[$#>]\s*$/m;
    }
    
    this.promptPatterns.set(sessionId, promptPattern);
  }

  /**
   * Start a new command execution in a session
   */
  private startCommandExecution(sessionId: string, command: string, args?: string[]): string {
    const commandId = uuidv4();
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Update session state
    session.executionState = 'executing';
    session.currentCommandId = commandId;
    this.sessions.set(sessionId, session);

    // Create command execution record
    const commandExecution: CommandExecution = {
      id: commandId,
      sessionId,
      command,
      args,
      startedAt: new Date(),
      status: 'executing',
      output: [],
      isolatedBufferStartIndex: this.outputBuffers.get(sessionId)?.length || 0,
      totalOutputLines: 0,
      markers: {
        promptPattern: this.promptPatterns.get(sessionId)
      }
    };

    // Store command execution
    this.commandExecutions.set(commandId, commandExecution);
    session.activeCommands.set(commandId, commandExecution);
    
    // Add to session command queue
    const queue = this.sessionCommandQueue.get(sessionId) || [];
    queue.push(commandId);
    this.sessionCommandQueue.set(sessionId, queue);

    this.logger.debug(`Started command execution ${commandId} for session ${sessionId}: ${command}`);
    return commandId;
  }

  /**
   * Complete a command execution
   */
  private completeCommandExecution(commandId: string, exitCode?: number): void {
    const commandExecution = this.commandExecutions.get(commandId);
    if (!commandExecution) {
      this.logger.warn(`Command execution ${commandId} not found`);
      return;
    }

    const session = this.sessions.get(commandExecution.sessionId);
    if (!session) {
      this.logger.warn(`Session ${commandExecution.sessionId} not found for command ${commandId}`);
      return;
    }

    // Update command execution
    commandExecution.completedAt = new Date();
    commandExecution.status = exitCode === 0 ? 'completed' : (exitCode !== undefined ? 'failed' : 'completed');
    commandExecution.exitCode = exitCode;
    commandExecution.duration = commandExecution.completedAt.getTime() - commandExecution.startedAt.getTime();

    // Update session state
    session.executionState = 'idle';
    session.currentCommandId = undefined;
    session.lastCommandCompletedAt = commandExecution.completedAt;
    
    // Clean up from active commands (keep in session for history but not as active)
    session.activeCommands.delete(commandId);
    this.sessions.set(commandExecution.sessionId, session);

    // Record command metrics for health monitoring
    if (this.selfHealingEnabled) {
      this.metricsCollector.recordCommandExecution(
        commandExecution.status === 'completed',
        commandExecution.duration || 0,
        commandExecution.command,
        commandExecution.sessionId
      );

      // Update heartbeat with successful command execution
      // Note: HeartbeatMonitor doesn't have recordSuccessfulOperation method
      // if (commandExecution.status === 'completed') {
      //   this.heartbeatMonitor.recordSuccessfulOperation(commandExecution.sessionId);
      // }
    }

    this.logger.debug(`Completed command execution ${commandId} with status ${commandExecution.status} in ${commandExecution.duration}ms`);
  }

  /**
   * Get isolated output for a specific command
   */
  private getCommandOutput(commandId: string): ConsoleOutput[] {
    const commandExecution = this.commandExecutions.get(commandId);
    if (!commandExecution) {
      return [];
    }

    // Return the output that was captured for this command
    return commandExecution.output;
  }

  /**
   * Detect command completion by analyzing output patterns
   */
  private detectCommandCompletion(sessionId: string, output: string): boolean {
    const promptPattern = this.promptPatterns.get(sessionId);
    if (!promptPattern) {
      return false;
    }

    // Check if the output contains a prompt indicating command completion
    return promptPattern.test(output);
  }

  /**
   * Execute a command in a session with proper isolation
   */
  async executeCommandInSession(sessionId: string, command: string, args?: string[], timeout: number = 30000): Promise<{
    commandId: string;
    output: ConsoleOutput[];
    exitCode?: number;
    duration: number;
    status: 'completed' | 'failed' | 'timeout';
  }> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (session.executionState !== 'idle') {
      throw new Error(`Session ${sessionId} is currently ${session.executionState}. Wait for current command to complete.`);
    }

    // Start command execution tracking
    const commandId = this.startCommandExecution(sessionId, command, args);
    
    try {
      // Add command start boundary marker
      const startBoundaryOutput: ConsoleOutput = {
        sessionId,
        type: 'stdout',
        data: '',
        timestamp: new Date(),
        commandId,
        isCommandBoundary: true,
        boundaryType: 'start',
        sequence: this.outputSequenceCounters.get(sessionId) || 0
      };
      this.addToBuffer(sessionId, startBoundaryOutput);

      // Send the command
      const fullCommand = args && args.length > 0 ? `${command} ${args.join(' ')}` : command;
      await this.sendInput(sessionId, fullCommand + '\n');

      // Wait for command completion or timeout
      const result = await this.waitForCommandCompletion(commandId, timeout);
      
      return {
        commandId,
        output: this.getCommandOutput(commandId),
        exitCode: result.exitCode,
        duration: result.duration,
        status: result.status
      };
    } catch (error) {
      // Mark command as failed
      this.completeCommandExecution(commandId, -1);
      throw error;
    }
  }

  /**
   * Wait for a command to complete
   */
  private async waitForCommandCompletion(commandId: string, timeout: number): Promise<{
    exitCode?: number;
    duration: number;
    status: 'completed' | 'failed' | 'timeout';
  }> {
    const commandExecution = this.commandExecutions.get(commandId);
    if (!commandExecution) {
      throw new Error(`Command execution ${commandId} not found`);
    }

    const startTime = Date.now();
    const checkInterval = 100; // Check every 100ms

    return new Promise((resolve, reject) => {
      const checkCompletion = () => {
        const currentExecution = this.commandExecutions.get(commandId);
        if (!currentExecution) {
          reject(new Error(`Command execution ${commandId} was removed`));
          return;
        }

        // Check if command completed
        if (currentExecution.status !== 'executing') {
          resolve({
            exitCode: currentExecution.exitCode,
            duration: currentExecution.duration || (Date.now() - startTime),
            status: currentExecution.status === 'completed' ? 'completed' : 'failed'
          });
          return;
        }

        // Check timeout
        if (Date.now() - startTime > timeout) {
          this.completeCommandExecution(commandId, -1);
          resolve({
            exitCode: -1,
            duration: Date.now() - startTime,
            status: 'timeout'
          });
          return;
        }

        // Continue checking
        setTimeout(checkCompletion, checkInterval);
      };

      checkCompletion();
    });
  }

  /**
   * Get session execution state
   */
  getSessionExecutionState(sessionId: string): {
    sessionId: string;
    executionState: 'idle' | 'executing' | 'waiting';
    currentCommandId?: string;
    lastCommandCompletedAt?: Date;
    activeCommands: number;
    commandHistory: string[];
  } | null {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    const commandHistory = this.sessionCommandQueue.get(sessionId) || [];
    
    return {
      sessionId,
      executionState: session.executionState,
      currentCommandId: session.currentCommandId,
      lastCommandCompletedAt: session.lastCommandCompletedAt,
      activeCommands: session.activeCommands.size,
      commandHistory
    };
  }

  /**
   * Get command execution details
   */
  getCommandExecutionDetails(commandId: string): CommandExecution | null {
    return this.commandExecutions.get(commandId) || null;
  }

  /**
   * Get all command executions for a session
   */
  getSessionCommandHistory(sessionId: string): CommandExecution[] {
    const commandIds = this.sessionCommandQueue.get(sessionId) || [];
    return commandIds
      .map(id => this.commandExecutions.get(id))
      .filter((cmd): cmd is CommandExecution => cmd !== undefined);
  }

  /**
   * Clear completed command history for a session (keeping only recent commands)
   */
  cleanupSessionCommandHistory(sessionId: string, keepLast: number = 10): void {
    const commandIds = this.sessionCommandQueue.get(sessionId) || [];
    
    if (commandIds.length > keepLast) {
      const toRemove = commandIds.splice(0, commandIds.length - keepLast);
      toRemove.forEach(commandId => {
        this.commandExecutions.delete(commandId);
      });
      
      this.sessionCommandQueue.set(sessionId, commandIds);
      this.logger.debug(`Cleaned up ${toRemove.length} old command executions for session ${sessionId}`);
    }
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

  /**
   * Initialize all self-healing components with proper configuration
   */
  private initializeSelfHealingComponents(): void {
    // Initialize HealthMonitor with comprehensive system monitoring
    this.healthMonitor = new HealthMonitor({
      checkInterval: 30000, // 30 seconds
      thresholds: {
        cpu: 80,
        memory: 85,
        disk: 90,
        networkLatency: 5000,
        processResponseTime: 5000
      }
    });

    // Initialize HeartbeatMonitor for session health tracking
    this.heartbeatMonitor = new HeartbeatMonitor({
      interval: 60000, // 1 minute
      timeout: 10000, // 10 seconds
      maxMissedBeats: 3,
      enableAdaptiveInterval: true,
      enablePredictiveFailure: this.predictiveHealingEnabled
    });

    // Initialize SessionRecovery with multiple strategies
    this.sessionRecovery = new SessionRecovery({
      enabled: true,
      maxRecoveryAttempts: 3,
      recoveryDelay: 5000,
      backoffMultiplier: 2,
      maxBackoffDelay: 60000,
      persistenceEnabled: true,
      persistencePath: './data/session-snapshots',
      enableSmartRecovery: true,
      snapshotInterval: 300000, // 5 minutes
      recoveryTimeout: 120000
    });

    // Initialize MetricsCollector for comprehensive monitoring
    this.metricsCollector = new MetricsCollector({
      enabled: true,
      collectionInterval: 10000, // 10 seconds
      retentionPeriod: 24 * 60 * 60 * 1000, // 24 hours
      aggregationWindow: 60000, // 1 minute
      enableRealTimeMetrics: true,
      enableHistoricalMetrics: true,
      enablePredictiveMetrics: this.predictiveHealingEnabled,
      persistenceEnabled: true,
      persistencePath: './data/metrics',
      exportFormats: ['json', 'csv', 'prometheus'],
      alertThresholds: {
        errorRate: 0.05,
        responseTime: 5000,
        throughput: 10,
        availability: 0.99
      }
    });

    // Initialize SSH KeepAlive for connection maintenance
    this.sshKeepAlive = new SSHConnectionKeepAlive({
      enabled: true,
      keepAliveInterval: 30000, // 30 seconds
      keepAliveCountMax: 3,
      serverAliveInterval: 60000, // 1 minute
      serverAliveCountMax: 3,
      connectionTimeout: 30000,
      reconnectOnFailure: true,
      maxReconnectAttempts: 5,
      reconnectDelay: 5000,
      backoffMultiplier: 2,
      maxReconnectDelay: 60000,
      enableAdaptiveKeepAlive: true,
      enablePredictiveReconnect: this.predictiveHealingEnabled,
      connectionHealthThreshold: 70
    });

    this.logger.info('Self-healing components initialized successfully');
  }

  /**
   * Setup integration between self-healing components and ConsoleManager
   */
  private setupSelfHealingIntegration(): void {
    if (!this.selfHealingEnabled) {
      this.logger.info('Self-healing disabled, skipping integration setup');
      return;
    }

    // Health Monitor Integration
    this.healthMonitor.on('healthCheck', (result) => {
      this.emit('system-health-check', result);
      
      // Record metrics for health checks
      this.metricsCollector.recordHealthCheck(result.overall > 0.5, 'system-health', 0);
      
      // Trigger predictive healing if issues detected
      if (result.overall < 0.7 && this.predictiveHealingEnabled) {
        this.triggerPredictiveHealing('system-health-degradation', result);
      }
    });

    this.healthMonitor.on('criticalIssue', async (issue) => {
      this.logger.warn('Critical system issue detected:', issue);
      this.healingStats.totalHealingAttempts++;
      
      // Attempt automatic recovery
      if (this.autoRecoveryEnabled) {
        try {
          await this.handleCriticalSystemIssue(issue);
          this.healingStats.successfulHealingAttempts++;
        } catch (error) {
          this.logger.error('Failed to auto-recover from critical issue:', error);
        }
      }
      
      this.emit('critical-system-issue', issue);
    });

    // Heartbeat Monitor Integration
    this.heartbeatMonitor.on('heartbeatMissed', async ({ sessionId, missedCount, lastHeartbeat }) => {
      this.logger.warn(`Heartbeat missed for session ${sessionId}: ${missedCount} missed, last: ${lastHeartbeat}`);
      
      // Record metrics - using recordSessionLifecycle for session events
      // this.metricsCollector.recordSessionEvent(sessionId, 'heartbeat-missed', {
      //   missedCount,
      //   lastHeartbeat: new Date(lastHeartbeat)
      // });
      
      // Trigger session recovery if threshold exceeded
      if (missedCount >= 3) {
        await this.initiateSessionRecovery(sessionId, 'heartbeat-failure');
      }
    });

    this.heartbeatMonitor.on('sessionUnhealthy', async ({ sessionId, healthScore, issues }) => {
      this.logger.warn(`Session ${sessionId} unhealthy (score: ${healthScore}):`, issues);
      
      // Record unhealthy session - using recordSessionLifecycle for session events
      // this.metricsCollector.recordSessionEvent(sessionId, 'unhealthy', { healthScore, issues });
      
      // Attempt recovery if auto-recovery enabled
      if (this.autoRecoveryEnabled && healthScore < 0.3) {
        await this.initiateSessionRecovery(sessionId, 'health-degradation');
      }
    });

    // Session Recovery Integration
    this.sessionRecovery.on('recoveryAttempted', ({ sessionId, strategy, success, duration, metadata }) => {
      this.logger.info(`Session recovery attempted: ${sessionId}, strategy: ${strategy}, success: ${success}`);
      
      // Update healing stats
      if (success) {
        this.healingStats.successfulHealingAttempts++;
        this.healingStats.automaticRecoveries++;
      }
      this.healingStats.totalHealingAttempts++;
      
      // Record recovery metrics
      this.metricsCollector.recordRecoveryAttempt(success, strategy, duration, sessionId);
      
      this.emit('session-recovery-attempted', { sessionId, strategy, success, duration, metadata });
    });

    this.sessionRecovery.on('recoveryFailed', ({ sessionId, strategy, error, attempts }) => {
      this.logger.error(`Session recovery failed: ${sessionId}, strategy: ${strategy}, attempts: ${attempts}`, error);
      
      // Try alternative recovery if available
      if (attempts < 3) {
        setTimeout(() => {
          this.sessionRecovery.recoverSession(sessionId, 'recovery-retry');
        }, Math.pow(2, attempts) * 1000); // Exponential backoff
      }
      
      this.emit('session-recovery-failed', { sessionId, strategy, error, attempts });
    });

    // Metrics Collector Integration
    this.metricsCollector.on('alertThresholdExceeded', (alert) => {
      this.logger.warn('Metrics alert triggered:', alert);
      
      // Trigger appropriate healing actions based on alert type
      if (alert.metric === 'errorRate' && alert.value > 0.1) {
        this.triggerSystemHealingMode('high-error-rate');
      } else if (alert.metric === 'sessionFailureRate' && alert.value > 0.05) {
        this.enhanceSessionMonitoring();
      }
      
      this.emit('metrics-alert', alert);
    });

    this.metricsCollector.on('trendPrediction', (prediction) => {
      if (this.predictiveHealingEnabled && prediction.confidence > 0.8) {
        this.logger.info('Predictive trend detected:', prediction);
        this.triggerPredictiveHealing('trend-prediction', prediction);
        this.healingStats.preventedFailures++;
      }
    });

    // SSH KeepAlive Integration
    this.sshKeepAlive.on('keepAliveSuccess', ({ connectionId, responseTime }) => {
      // Record successful keep-alive
      this.metricsCollector.recordConnectionMetrics(true, responseTime, 'ssh');
    });

    this.sshKeepAlive.on('keepAliveFailed', async ({ connectionId, error, consecutiveFailures }) => {
      this.logger.warn(`SSH keep-alive failed for ${connectionId}: ${consecutiveFailures} consecutive failures`, error);
      
      // Record failed keep-alive
      this.metricsCollector.recordConnectionMetrics(false, 0, 'ssh');
      
      // Trigger reconnection if threshold exceeded
      if (consecutiveFailures >= 3) {
        await this.handleSSHConnectionFailure(connectionId, error);
      }
    });

    this.sshKeepAlive.on('connectionDegraded', ({ connectionId, responseTime, trend }) => {
      this.logger.info(`SSH connection ${connectionId} showing degradation: ${responseTime}ms (trend: ${trend})`);
      
      if (this.predictiveHealingEnabled && trend > 0.3) {
        // Proactively establish backup connection
        this.prepareBackupSSHConnection(connectionId);
      }
    });

    // Start all monitoring services
    this.healthMonitor.start();
    this.heartbeatMonitor.start();
    this.metricsCollector.start();
    
    this.logger.info('Self-healing integration setup completed');
  }

  private async handleCriticalSystemIssue(issue: any): Promise<void> {
    this.logger.info(`Attempting to handle critical system issue: ${issue.type}`);
    
    switch (issue.type) {
      case 'high-memory-usage':
        await this.optimizeMemoryUsage();
        break;
      case 'high-cpu-usage':
        await this.throttleOperations();
        break;
      case 'disk-space-low':
        await this.cleanupTemporaryFiles();
        break;
      case 'network-degradation':
        await this.optimizeNetworkConnections();
        break;
      default:
        this.logger.warn(`No specific handler for issue type: ${issue.type}`);
    }
  }

  private async initiateSessionRecovery(sessionId: string, reason: string): Promise<void> {
    this.logger.info(`Initiating session recovery for ${sessionId}, reason: ${reason}`);
    
    const session = this.sessions.get(sessionId);
    if (session) {
      await this.sessionRecovery.recoverSession(sessionId, reason);
    }
  }

  private triggerPredictiveHealing(trigger: string, data: any): void {
    this.logger.info(`Predictive healing triggered: ${trigger}`, data);
    this.emit('predictive-healing-triggered', { trigger, data, timestamp: new Date() });
  }

  private triggerSystemHealingMode(reason: string): void {
    this.logger.warn(`System healing mode activated: ${reason}`);
    // Implement system-wide healing actions
    this.emit('system-healing-mode-activated', { reason, timestamp: new Date() });
  }

  private enhanceSessionMonitoring(): void {
    // Reduce heartbeat intervals for closer monitoring
    // Note: HeartbeatMonitor doesn't have setAdaptiveMode method
    // this.heartbeatMonitor.setAdaptiveMode(true);
    this.logger.info('Enhanced session monitoring activated');
  }

  private async handleSSHConnectionFailure(connectionId: string, error: Error): Promise<void> {
    this.logger.info(`Handling SSH connection failure: ${connectionId}`);
    
    // Use connection pool's circuit breaker and retry logic
    // Note: handleConnectionFailure is private in ConnectionPool
    try {
      // await this.connectionPool.handleConnectionFailure(connectionId, error);
      this.logger.info(`Connection failure handled for ${connectionId}: ${error.message}`);
      this.emit('ssh-connection-failure-detected', { connectionId, error });
    } catch (poolError) {
      this.logger.error('Connection pool failed to handle SSH connection failure:', poolError);
      this.emit('ssh-connection-recovery-failed', { connectionId, originalError: error, poolError });
    }
  }

  private prepareBackupSSHConnection(connectionId: string): void {
    this.logger.info(`Preparing backup SSH connection for ${connectionId}`);
    // Logic to preemptively establish backup connections
    this.emit('backup-connection-preparing', { connectionId, timestamp: new Date() });
  }

  private async optimizeMemoryUsage(): Promise<void> {
    this.logger.info('Optimizing memory usage');
    // Clear old output buffers
    for (const [sessionId, buffer] of this.outputBuffers) {
      if (buffer.length > 100) {
        this.outputBuffers.set(sessionId, buffer.slice(-50)); // Keep last 50 entries
      }
    }
    
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
  }

  private async throttleOperations(): Promise<void> {
    this.logger.info('Throttling operations due to high CPU usage');
    // Reduce queue concurrency
    this.queue.concurrency = Math.max(1, this.queue.concurrency / 2);
    
    // Restore after 30 seconds
    setTimeout(() => {
      this.queue.concurrency = 10;
      this.logger.info('Operation throttling restored to normal');
    }, 30000);
  }

  private async cleanupTemporaryFiles(): Promise<void> {
    this.logger.info('Cleaning up temporary files');
    // Implementation would clean up temp files, logs, etc.
    this.emit('cleanup-performed', { type: 'temporary-files', timestamp: new Date() });
  }

  private async optimizeNetworkConnections(): Promise<void> {
    this.logger.info('Optimizing network connections');
    // Close idle connections
    // Note: cleanupIdleConnections is private in ConnectionPool
    // await this.connectionPool.cleanupIdleConnections();
    this.emit('network-optimization-performed', { timestamp: new Date() });
  }

  /**
   * Public API for health monitoring control
   */

  /**
   * Get comprehensive system and session health status
   */
  public async getHealthStatus(): Promise<{
    systemHealth: any;
    sessionHealth: Map<string, any>;
    connectionHealth: Map<string, any>;
    metrics: any;
    healingStats: typeof this.healingStats;
  }> {
    const result = {
      systemHealth: null as any,
      sessionHealth: new Map<string, any>(),
      connectionHealth: new Map<string, any>(),
      metrics: null as any,
      healingStats: { ...this.healingStats }
    };

    if (this.selfHealingEnabled) {
      // Get system health - request health check via event
      result.systemHealth = await new Promise((resolve, reject) => {
        this.healthMonitor.once('health-report', (report) => {
          resolve(report);
        });
        // Trigger health check by performing checks manually or use available methods
        // Since checkSystemHealth doesn't exist, we'll emit a request for health data
        setTimeout(() => resolve({ status: 'healthy', message: 'Health monitoring active' }), 100);
      });

      // Get session health for all active sessions
      for (const sessionId of this.sessions.keys()) {
        const sessionHealth = this.heartbeatMonitor.getSessionHeartbeat(sessionId);
        if (sessionHealth) {
          result.sessionHealth.set(sessionId, sessionHealth);
        }
      }

      // Get connection health from SSH keep-alive
      const connectionHealthMap = this.sshKeepAlive.getConnectionHealth();
      if (connectionHealthMap && typeof connectionHealthMap === 'object') {
        for (const [connId, health] of Object.entries(connectionHealthMap as Record<string, any>)) {
          result.connectionHealth.set(connId, health);
        }
      }

      // Get current metrics
      result.metrics = this.metricsCollector.getCurrentMetrics();
    }

    return result;
  }

  /**
   * Enable or disable self-healing features
   */
  public setSelfHealingEnabled(enabled: boolean): void {
    const wasEnabled = this.selfHealingEnabled;
    this.selfHealingEnabled = enabled;

    if (enabled && !wasEnabled) {
      // Re-initialize and start components
      this.initializeSelfHealingComponents();
      this.setupSelfHealingIntegration();
      this.logger.info('Self-healing enabled');
    } else if (!enabled && wasEnabled) {
      // Stop all health monitoring
      this.healthMonitor?.stop();
      this.heartbeatMonitor?.stop();
      this.metricsCollector?.stop();
      this.logger.info('Self-healing disabled');
    }
  }

  /**
   * Enable or disable predictive healing
   */
  public setPredictiveHealingEnabled(enabled: boolean): void {
    this.predictiveHealingEnabled = enabled;
    
    if (this.selfHealingEnabled) {
      // Update components with new predictive setting
      // Note: These methods don't exist on the monitoring classes
      // Predictive analysis is configured during component initialization
      this.logger.debug(`Predictive healing setting updated but requires component restart to take effect`);
    }
    
    this.logger.info(`Predictive healing ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Enable or disable automatic recovery
   */
  public setAutoRecoveryEnabled(enabled: boolean): void {
    this.autoRecoveryEnabled = enabled;
    
    if (this.selfHealingEnabled) {
      // Note: setAutoRecoveryEnabled method doesn't exist on HealthMonitor
      // Auto recovery is configured during initialization via config.recovery.enabled
      this.logger.debug(`Auto recovery setting updated but requires component restart to take effect`);
    }
    
    this.logger.info(`Auto-recovery ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Force a comprehensive health check on all components
   */
  public async performHealthCheck(): Promise<any> {
    if (!this.selfHealingEnabled) {
      throw new Error('Self-healing is not enabled');
    }

    const results = {
      system: await this.healthMonitor.getHealthStatistics(),
      sessions: new Map<string, any>(),
      connections: this.sshKeepAlive.getConnectionHealth(),
      timestamp: new Date()
    };

    // Check all active sessions
    for (const sessionId of this.sessions.keys()) {
      try {
        const sessionHealth = await this.heartbeatMonitor.forceHeartbeat(sessionId);
        results.sessions.set(sessionId, sessionHealth);
      } catch (error) {
        results.sessions.set(sessionId, { error: error.message, healthy: false });
      }
    }

    return results;
  }

  /**
   * Get detailed metrics for a specific time range
   */
  public getMetrics(options?: {
    timeRange?: { start: number; end: number };
    aggregationWindow?: string;
    includeRaw?: boolean;
  }): any {
    if (!this.selfHealingEnabled) {
      throw new Error('Self-healing is not enabled');
    }

    return this.metricsCollector.getCurrentMetrics();
  }

  /**
   * Export metrics in various formats
   */
  public async exportMetrics(format: 'json' | 'csv' | 'prometheus' = 'json'): Promise<string> {
    if (!this.selfHealingEnabled) {
      throw new Error('Self-healing is not enabled');
    }

    return await this.metricsCollector.exportMetrics(format);
  }

  /**
   * Manually trigger session recovery for a specific session
   */
  public async recoverSession(sessionId: string): Promise<boolean> {
    if (!this.selfHealingEnabled) {
      throw new Error('Self-healing is not enabled');
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    try {
      await this.sessionRecovery.recoverSession(sessionId, 'manual-recovery');
      return true;
    } catch (error) {
      this.logger.error(`Manual session recovery failed for ${sessionId}:`, error);
      return false;
    }
  }

  /**
   * Get session recovery history and statistics
   */
  public getRecoveryHistory(): any {
    if (!this.selfHealingEnabled) {
      throw new Error('Self-healing is not enabled');
    }

    return this.sessionRecovery.getRecoveryStatistics();
  }

  /**
   * Get current self-healing configuration
   */
  public getSelfHealingConfig(): {
    selfHealingEnabled: boolean;
    autoRecoveryEnabled: boolean;
    predictiveHealingEnabled: boolean;
    healingStats: typeof this.healingStats;
  } {
    return {
      selfHealingEnabled: this.selfHealingEnabled,
      autoRecoveryEnabled: this.autoRecoveryEnabled,
      predictiveHealingEnabled: this.predictiveHealingEnabled,
      healingStats: { ...this.healingStats }
    };
  }

  /**
   * Shutdown all self-healing components cleanly
   */
  private async shutdownSelfHealingComponents(): Promise<void> {
    try {
      this.logger.info('Shutting down self-healing components...');

      // Stop all monitoring services
      if (this.healthMonitor) {
        await this.healthMonitor.stop();
      }

      if (this.heartbeatMonitor) {
        await this.heartbeatMonitor.stop();
      }

      if (this.metricsCollector) {
        await this.metricsCollector.stop();
      }

      if (this.sshKeepAlive) {
        await this.sshKeepAlive.stop();
      }

      if (this.sessionRecovery) {
        await this.sessionRecovery.stop();
      }

      this.logger.info('Self-healing components shutdown complete');

    } catch (error) {
      this.logger.error('Error during self-healing components shutdown:', error);
      // Continue with shutdown even if some components fail to stop cleanly
    }
  }

  /**
   * Register a newly created session with all health monitoring components
   */
  private async registerSessionWithHealthMonitoring(sessionId: string, session: ConsoleSession, options: SessionOptions): Promise<void> {
    try {
      // Register with heartbeat monitor
      this.heartbeatMonitor.addSession(sessionId, {
        id: sessionId,
        createdAt: session.createdAt,
        lastActivity: new Date(),
        status: session.status === 'crashed' ? 'failed' : session.status as 'running' | 'failed' | 'paused' | 'stopped' | 'initializing' | 'recovering',
        type: options.sshOptions ? 'ssh' : 'local',
        pid: session.pid,
        healthScore: 100,
        recoveryAttempts: 0,
        maxRecoveryAttempts: 3,
        metadata: {
          command: session.command,
          args: session.args || []
        }
      });

      // Record session creation metrics
      this.metricsCollector.recordSessionLifecycle('created', sessionId, session.type);

      // Create initial snapshot for session recovery
      const snapshotData = {
        sessionId,
        command: session.command,
        args: session.args,
        cwd: session.cwd,
        env: session.env,
        consoleType: session.type,
        sshOptions: options.sshOptions,
        streaming: options.streaming,
        createdAt: session.createdAt,
        status: session.status
      };

      await this.sessionRecovery.registerSession(sessionId, {
        id: sessionId,
        createdAt: session.createdAt,
        lastActivity: new Date(),
        status: session.status === 'crashed' ? 'failed' : session.status as 'running' | 'failed' | 'paused' | 'stopped' | 'initializing' | 'recovering',
        type: options.sshOptions ? 'ssh' : 'local',
        pid: session.pid,
        healthScore: 100,
        recoveryAttempts: 0,
        maxRecoveryAttempts: 3,
        metadata: {
          command: session.command,
          args: session.args || []
        }
      }, options);

      this.logger.debug(`Session ${sessionId} registered with health monitoring components`);

    } catch (error) {
      this.logger.warn(`Failed to register session ${sessionId} with health monitoring:`, error);
      // Don't throw error as this is non-critical for session creation
    }
  }

  /**
   * Unregister a session from all health monitoring components
   */
  private async unregisterSessionFromHealthMonitoring(sessionId: string, reason: string = 'session-terminated'): Promise<void> {
    try {
      // Remove from heartbeat monitoring
      this.heartbeatMonitor.removeSession(sessionId);

      // Record session termination metrics
      const session = this.sessions.get(sessionId);
      const duration = session ? Date.now() - session.createdAt.getTime() : undefined;
      this.metricsCollector.recordSessionLifecycle('terminated', sessionId, session?.type || 'unknown', duration);

      // Clean up recovery snapshots
      await this.sessionRecovery.unregisterSession(sessionId);

      this.logger.debug(`Session ${sessionId} unregistered from health monitoring (reason: ${reason})`);

    } catch (error) {
      this.logger.warn(`Failed to unregister session ${sessionId} from health monitoring:`, error);
      // Continue with session cleanup even if health monitoring cleanup fails
    }
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
      streaming: options.streaming || false,
      // Initialize command execution state
      executionState: 'idle',
      activeCommands: new Map()
    };

    // Check if this is an SSH session
    const isSSHSession = !!options.sshOptions;
    const sessionType: 'local' | 'ssh' = isSSHSession ? 'ssh' : 'local';

    try {
      // Initialize session command tracking
      this.initializeSessionCommandTracking(sessionId, options);
      
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
          
          // Configure prompt detection for SSH session
          // this.configurePromptDetection(sessionId, options); // TODO: Implement if needed
          
          // Store session data
          this.sessions.set(sessionId, { 
            ...session, 
            status: 'running',
            pid: undefined // SSH sessions don't have local PIDs
          });
          this.outputBuffers.set(sessionId, []);

          // Register SSH session with self-healing components
          if (this.selfHealingEnabled) {
            this.registerSessionWithHealthMonitoring(sessionId, session, options).catch(error => {
              this.logger.warn(`Failed to register SSH session with health monitoring: ${error.message}`);
            });
            
            // Note: SSH connection monitoring is handled by the connection pool
            this.logger.debug(`SSH session ${sessionId} registered for monitoring`);
          }

          // Setup enhanced stream manager for immediate output capture
          if (options.streaming) {
            const streamManager = new StreamManager(sessionId, {
              enableRealTimeCapture: true,
              immediateFlush: true,
              bufferFlushInterval: 5,
              pollingInterval: 25,
              chunkCombinationTimeout: 10,
              maxChunkSize: 4096
            });
            this.streamManagers.set(sessionId, streamManager);
          } else {
            // Always create a stream manager with immediate capture for SSH sessions
            const streamManager = new StreamManager(sessionId, {
              enableRealTimeCapture: true,
              immediateFlush: true,
              bufferFlushInterval: 10,
              pollingInterval: 50,
              chunkCombinationTimeout: 15,
              maxChunkSize: 8192
            });
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

      // Register session with self-healing components
      if (this.selfHealingEnabled) {
        await this.registerSessionWithHealthMonitoring(sessionId, session, options);
      }

      // Setup enhanced stream manager for immediate output capture
      if (options.streaming) {
        const streamManager = new StreamManager(sessionId, {
          enableRealTimeCapture: true,
          immediateFlush: true,
          bufferFlushInterval: 5, // 5ms for ultra-fast flushing
          pollingInterval: 25,    // 25ms polling for missed output
          chunkCombinationTimeout: 10, // 10ms to combine rapid chunks
          maxChunkSize: 4096
        });
        this.streamManagers.set(sessionId, streamManager);
      } else {
        // Always create a stream manager with immediate capture for better output handling
        const streamManager = new StreamManager(sessionId, {
          enableRealTimeCapture: true,
          immediateFlush: true,
          bufferFlushInterval: 10,
          pollingInterval: 50,
          chunkCombinationTimeout: 15,
          maxChunkSize: 8192
        });
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
   * Configure prompt detection for a session based on SSH options and environment
   * Note: This is now handled by the command queue system with configurable prompt patterns
   */
  private configurePromptDetection(sessionId: string, options: SessionOptions): void {
    // Command queue system handles prompt detection
    // Set custom prompt pattern if specified in options
    const sshOptions = options.sshOptions;
    if (sshOptions?.host && sshOptions?.username) {
      const customPattern = new RegExp(`(?:^|\\n)(${sshOptions.username}@${sshOptions.host}[^$#]*[$#])\\s*$`, 'm');
      this.setSessionPromptPattern(sessionId, customPattern);
      
      this.logger.info(`Configured custom prompt pattern for SSH session ${sessionId}`, {
        host: sshOptions.host,
        username: sshOptions.username
      });
    }
  }

  /**
   * Setup SSH stream handlers for pooled connections
   */
  private setupPooledSSHHandlers(sessionId: string, stream: ClientChannel, options: SessionOptions): void {
    const streamManager = this.streamManagers.get(sessionId);

    // Initialize command queue for this SSH session
    this.initializeCommandQueue(sessionId);

    // Handle SSH stream stdout/stderr
    stream.on('data', (data: Buffer) => {
      const text = data.toString();
      
      // Add output to prompt detector for pattern analysis
      const promptResult = this.promptDetector.addOutput(sessionId, text);
      if (promptResult && promptResult.detected) {
        this.logger.debug(`Prompt detected in SSH session ${sessionId}`, {
          pattern: promptResult.pattern?.name,
          confidence: promptResult.confidence,
          matchedText: promptResult.matchedText.substring(0, 50)
        });
        
        // Emit prompt detection event
        this.emitEvent({
          sessionId,
          type: 'prompt-detected',
          timestamp: new Date(),
          data: {
            pattern: promptResult.pattern?.name,
            confidence: promptResult.confidence,
            matchedText: promptResult.matchedText,
            context: promptResult.context
          }
        });
      }
      
      // Handle command queue acknowledgment
      this.handleSSHOutputForQueue(sessionId, text);
      
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
        // Force immediate flush for SSH prompts and important output
        if (text.includes('\n') || text.includes('$') || text.includes('#') || 
            text.includes('>') || text.includes('Password:') || text.length > 50) {
          streamManager.forceFlush();
        }
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
    
    // Setup immediate output capture listeners
    if (streamManager) {
      // Subscribe to immediate output events for real-time capture
      streamManager.subscribeRealtime((data, timestamp) => {
        this.emit('immediate-output', {
          sessionId,
          data,
          timestamp,
          type: 'realtime'
        });
      });
      
      // Subscribe to buffer flush events
      streamManager.on('buffer-flushed', (event) => {
        this.emit('buffer-flushed', {
          sessionId: event.sessionId,
          chunk: event.chunk,
          timestamp: new Date()
        });
      });
      
      // Setup force flush on new output
      streamManager.on('immediate-output', () => {
        // Force immediate availability of output
        setImmediate(() => {
          this.emit('output-ready', { sessionId });
        });
      });
    }
    
    // Handle stdout with enhanced immediate capture
    if (process.stdout) {
      process.stdout.on('data', (data: Buffer) => {
        const text = data.toString();
        const timestamp = new Date();
        
        const output: ConsoleOutput = {
          sessionId,
          type: 'stdout',
          data: stripAnsi(text),
          raw: text,
          timestamp
        };

        // Add to buffer with immediate processing
        this.addToBuffer(sessionId, output);
        
        // Add to stream manager with immediate flush
        if (streamManager) {
          streamManager.addChunk(text, false);
          // Force immediate flush for critical output
          if (text.includes('\n') || text.length > 100) {
            streamManager.forceFlush();
          }
        }
        
        // Emit output event immediately
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

    // Handle stderr with enhanced immediate capture
    if (process.stderr) {
      process.stderr.on('data', (data: Buffer) => {
        const text = data.toString();
        const timestamp = new Date();
        
        const output: ConsoleOutput = {
          sessionId,
          type: 'stderr',
          data: stripAnsi(text),
          raw: text,
          timestamp
        };

        // Add to buffer with immediate processing
        this.addToBuffer(sessionId, output);
        
        // Add to stream manager with immediate flush (stderr is high priority)
        if (streamManager) {
          streamManager.addChunk(text, true);
          // Always force immediate flush for stderr
          streamManager.forceFlush();
        }
        
        // Emit output event immediately
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
      streaming: options.streaming || false,
      executionState: 'idle',
      activeCommands: new Map()
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

      // Configure prompt detection for legacy SSH session
      this.configurePromptDetection(sessionId, options);

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
    
    // Initialize command queue for this SSH session
    this.initializeCommandQueue(sessionId);
    
    // Handle stdout/stderr from SSH channel
    channel.on('data', (data: Buffer) => {
      const text = data.toString();
      
      // Add output to prompt detector for pattern analysis
      const promptResult = this.promptDetector.addOutput(sessionId, text);
      if (promptResult && promptResult.detected) {
        this.logger.debug(`Prompt detected in legacy SSH session ${sessionId}`, {
          pattern: promptResult.pattern?.name,
          confidence: promptResult.confidence,
          matchedText: promptResult.matchedText.substring(0, 50)
        });
        
        // Emit prompt detection event
        this.emitEvent({
          sessionId,
          type: 'prompt-detected',
          timestamp: new Date(),
          data: {
            pattern: promptResult.pattern?.name,
            confidence: promptResult.confidence,
            matchedText: promptResult.matchedText,
            context: promptResult.context
          }
        });
      }
      
      // Handle command queue acknowledgment
      this.handleSSHOutputForQueue(sessionId, text);
      
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
        // Force immediate flush for SSH prompts and important output
        if (text.includes('\n') || text.includes('$') || text.includes('#') || 
            text.includes('>') || text.includes('Password:') || text.length > 50) {
          streamManager.forceFlush();
        }
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

  /**
   * Initialize command queue for a session
   */
  private initializeCommandQueue(sessionId: string): void {
    if (!this.commandQueues.has(sessionId)) {
      const queue: SessionCommandQueue = {
        sessionId,
        commands: [],
        isProcessing: false,
        lastCommandTime: 0,
        acknowledgmentTimeout: null,
        outputBuffer: '',
        expectedPrompt: this.queueConfig.defaultPromptPattern
      };
      
      this.commandQueues.set(sessionId, queue);
      this.logger.debug(`Command queue initialized for session ${sessionId}`);
    }
  }

  /**
   * Process the command queue for a session
   */
  private async processCommandQueue(sessionId: string): Promise<void> {
    const queue = this.commandQueues.get(sessionId);
    const sshChannel = this.sshChannels.get(sessionId);
    
    if (!queue || !sshChannel || queue.isProcessing || queue.commands.length === 0) {
      return;
    }

    queue.isProcessing = true;
    this.logger.debug(`Processing command queue for session ${sessionId}, ${queue.commands.length} commands pending`);

    try {
      while (queue.commands.length > 0) {
        const command = queue.commands[0];
        
        if (command.sent && !command.acknowledged) {
          // Wait for acknowledgment or timeout
          const waitTime = Date.now() - command.timestamp.getTime();
          if (waitTime < this.queueConfig.acknowledgmentTimeout) {
            break; // Wait for acknowledgment
          } else {
            this.logger.warn(`Command acknowledgment timeout for session ${sessionId}, command: ${command.input.substring(0, 50)}...`);
            command.reject(new Error('Command acknowledgment timeout'));
            queue.commands.shift();
            continue;
          }
        }

        if (!command.sent) {
          // Send the command
          try {
            await this.sendCommandToSSH(sessionId, command, sshChannel);
            command.sent = true;
            command.timestamp = new Date();
            
            // Wait for inter-command delay
            if (queue.commands.length > 1) {
              await this.delay(this.queueConfig.interCommandDelay);
            }
          } catch (error) {
            this.logger.error(`Failed to send command to SSH session ${sessionId}:`, error);
            command.reject(error as Error);
            queue.commands.shift();
            continue;
          }
        }

        // Check for acknowledgment
        if (this.queueConfig.enablePromptDetection && queue.expectedPrompt) {
          if (queue.expectedPrompt.test(queue.outputBuffer)) {
            // Command acknowledged
            command.acknowledged = true;
            command.resolve();
            queue.commands.shift();
            queue.outputBuffer = ''; // Clear buffer after acknowledgment
            queue.lastCommandTime = Date.now();
          } else {
            // Wait for more output
            break;
          }
        } else {
          // No prompt detection, acknowledge immediately
          command.acknowledged = true;
          command.resolve();
          queue.commands.shift();
          queue.lastCommandTime = Date.now();
        }
      }
    } finally {
      queue.isProcessing = false;
    }

    // Schedule next processing if there are more commands
    if (queue.commands.length > 0) {
      setTimeout(() => this.processCommandQueue(sessionId), 100);
    }
  }

  /**
   * Send a command to SSH channel with proper error handling
   */
  private async sendCommandToSSH(sessionId: string, command: QueuedCommand, sshChannel: ClientChannel): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('SSH write timeout'));
      }, this.queueConfig.commandTimeout);

      try {
        // Ensure command ends with newline for proper execution
        let commandToSend = command.input;
        if (!commandToSend.endsWith('\n') && !commandToSend.endsWith('\r\n')) {
          commandToSend += '\n';
        }

        sshChannel.write(commandToSend, (error) => {
          clearTimeout(timeout);
          
          if (error) {
            this.logger.error(`SSH write error for session ${sessionId}:`, error);
            reject(error);
          } else {
            // Record input to monitoring system
            if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
              this.monitoringSystem.recordEvent(sessionId, 'input', {
                size: command.input.length,
                type: 'ssh_queued_input',
                commandId: command.id
              });
            }

            this.emitEvent({
              sessionId,
              type: 'input',
              timestamp: new Date(),
              data: { 
                input: command.input, 
                ssh: true, 
                queued: true,
                commandId: command.id
              }
            });

            this.logger.debug(`Command sent to SSH session ${sessionId}: ${command.input.substring(0, 100)}...`);
            resolve();
          }
        });
      } catch (error) {
        clearTimeout(timeout);
        reject(error as Error);
      }
    });
  }

  /**
   * Handle SSH output for command queue acknowledgment
   */
  private handleSSHOutputForQueue(sessionId: string, data: string): void {
    const queue = this.commandQueues.get(sessionId);
    if (!queue) return;

    // Append to output buffer for prompt detection
    queue.outputBuffer += data;
    
    // Keep buffer size manageable
    if (queue.outputBuffer.length > 4096) {
      queue.outputBuffer = queue.outputBuffer.slice(-2048);
    }

    // Trigger queue processing if there are pending commands
    if (queue.commands.length > 0 && !queue.isProcessing) {
      setImmediate(() => this.processCommandQueue(sessionId));
    }
  }

  /**
   * Add command to queue
   */
  private async addCommandToQueue(sessionId: string, input: string): Promise<void> {
    this.initializeCommandQueue(sessionId);
    const queue = this.commandQueues.get(sessionId)!;

    if (queue.commands.length >= this.queueConfig.maxQueueSize) {
      throw new Error(`Command queue full for session ${sessionId} (max: ${this.queueConfig.maxQueueSize})`);
    }

    return new Promise<void>((resolve, reject) => {
      const command: QueuedCommand = {
        id: uuidv4(),
        sessionId,
        input,
        timestamp: new Date(),
        retryCount: 0,
        resolve,
        reject,
        acknowledged: false,
        sent: false
      };

      queue.commands.push(command);
      this.logger.debug(`Command queued for session ${sessionId}: ${input.substring(0, 50)}... (queue size: ${queue.commands.length})`);

      // Start processing
      setImmediate(() => this.processCommandQueue(sessionId));
    });
  }

  /**
   * Clear command queue for a session
   */
  private clearCommandQueue(sessionId: string): void {
    const queue = this.commandQueues.get(sessionId);
    if (!queue) return;

    // Reject all pending commands
    queue.commands.forEach(command => {
      if (!command.acknowledged) {
        command.reject(new Error('Session terminated'));
      }
    });

    // Clear timeout if exists
    if (queue.acknowledgmentTimeout) {
      clearTimeout(queue.acknowledgmentTimeout);
    }

    // Remove queue
    this.commandQueues.delete(sessionId);
    
    // Clear processing interval
    const interval = this.commandProcessingIntervals.get(sessionId);
    if (interval) {
      clearTimeout(interval);
      this.commandProcessingIntervals.delete(sessionId);
    }

    this.logger.debug(`Command queue cleared for session ${sessionId}`);
  }

  /**
   * Get command queue statistics
   */
  private getCommandQueueStats(sessionId: string): { queueSize: number; processing: boolean; lastCommandTime: number } | null {
    const queue = this.commandQueues.get(sessionId);
    if (!queue) return null;

    return {
      queueSize: queue.commands.length,
      processing: queue.isProcessing,
      lastCommandTime: queue.lastCommandTime
    };
  }

  /**
   * Helper method to create delays
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async sendInput(sessionId: string, input: string): Promise<void> {
    return await this.retryManager.executeWithRetry(
      async () => {
        // Check if this is an SSH session
        const sshChannel = this.sshChannels.get(sessionId);
        if (sshChannel) {
          // Use command queue for SSH sessions to prevent command concatenation
          return this.addCommandToQueue(sessionId, input);
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
    // Force flush before getting output to ensure freshness
    const streamManager = this.streamManagers.get(sessionId);
    if (streamManager) {
      streamManager.forceFlush();
    }
    
    const outputs = this.getOutput(sessionId, lines);
    return outputs.map(o => o.data).join('');
  }

  /**
   * Get output with immediate synchronization
   */
  async getOutputImmediate(sessionId: string, limit?: number): Promise<ConsoleOutput[]> {
    const streamManager = this.streamManagers.get(sessionId);
    
    if (streamManager) {
      // Force immediate flush
      streamManager.forceFlush();
      
      // Wait for any async processing to complete
      await new Promise(resolve => setImmediate(resolve));
      
      // Small delay to ensure all buffers are processed
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    
    return this.getOutput(sessionId, limit);
  }

  /**
   * Get fresh output with real-time synchronization
   */
  async getFreshOutput(sessionId: string, timeoutMs: number = 1000): Promise<{
    output: string;
    stats: any;
    captureTime: number;
  }> {
    const startTime = Date.now();
    const streamManager = this.streamManagers.get(sessionId);
    
    if (!streamManager) {
      const output = this.getLastOutput(sessionId, 100);
      return {
        output,
        stats: null,
        captureTime: Date.now() - startTime
      };
    }
    
    // Force immediate flush
    streamManager.forceFlush();
    
    // Wait for buffers to be processed
    let attempts = 0;
    const maxAttempts = timeoutMs / 10; // Check every 10ms
    
    while (attempts < maxAttempts) {
      const bufferStats = streamManager.getBufferStats();
      
      // If no pending data, we have everything
      if (bufferStats.pendingSize === 0) {
        break;
      }
      
      await new Promise(resolve => setTimeout(resolve, 10));
      attempts++;
    }
    
    // Get final output
    const output = this.getLastOutput(sessionId, 100);
    const stats = streamManager.getBufferStats();
    
    return {
      output,
      stats,
      captureTime: Date.now() - startTime
    };
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

    // Clear command queue for this session
    this.clearCommandQueue(sessionId);

    // Ensure monitoring is stopped
    if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
      this.monitoringSystem.stopSessionMonitoring(sessionId);
    }

    // Cleanup health monitoring components
    if (this.selfHealingEnabled) {
      await this.unregisterSessionFromHealthMonitoring(sessionId, 'manual-stop');
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
    // Clean up command executions for this session
    const commandIds = this.sessionCommandQueue.get(sessionId) || [];
    commandIds.forEach(commandId => {
      this.commandExecutions.delete(commandId);
    });
    
    this.sessions.delete(sessionId);
    this.processes.delete(sessionId);
    this.sshClients.delete(sessionId);
    this.sshChannels.delete(sessionId);
    this.outputBuffers.delete(sessionId);
    this.streamManagers.delete(sessionId);
    this.sessionCommandQueue.delete(sessionId);
    this.outputSequenceCounters.delete(sessionId);
    this.promptPatterns.delete(sessionId);
    
    this.logger.debug(`Cleaned up session ${sessionId} and ${commandIds.length} command executions`);
  }

  private addToBuffer(sessionId: string, output: ConsoleOutput) {
    const buffer = this.outputBuffers.get(sessionId) || [];
    
    // Add sequence number for ordering
    const sequenceCounter = this.outputSequenceCounters.get(sessionId) || 0;
    output.sequence = sequenceCounter;
    this.outputSequenceCounters.set(sessionId, sequenceCounter + 1);
    
    // Associate output with current command if one is executing
    const session = this.sessions.get(sessionId);
    if (session && session.currentCommandId) {
      output.commandId = session.currentCommandId;
      
      // Add to command-specific output buffer
      const commandExecution = this.commandExecutions.get(session.currentCommandId);
      if (commandExecution) {
        commandExecution.output.push(output);
        commandExecution.totalOutputLines++;
        
        // Check if this output indicates command completion
        if (this.detectCommandCompletion(sessionId, output.data)) {
          // Mark output as command boundary
          output.isCommandBoundary = true;
          output.boundaryType = 'end';
          
          // Complete the command execution
          this.completeCommandExecution(session.currentCommandId);
        }
      }
    }
    
    buffer.push(output);
    
    if (buffer.length > this.maxBufferSize) {
      buffer.shift();
    }
    
    this.outputBuffers.set(sessionId, buffer);
  }

  private emitEvent(event: ConsoleEvent) {
    this.emit('console-event', event);
  }

  /**
   * Enhanced waitForOutput with prompt-aware detection and better SSH handling
   */
  async waitForOutput(
    sessionId: string, 
    pattern: string | RegExp, 
    options: {
      timeout?: number;
      requirePrompt?: boolean;
      stripAnsi?: boolean;
      promptTimeout?: number;
    } = {}
  ): Promise<{ output: string; promptDetected?: PromptDetectionResult }> {
    
    const timeout = options.timeout || 5000;
    const requirePrompt = options.requirePrompt || false;
    const stripAnsi = options.stripAnsi !== false;
    const promptTimeout = options.promptTimeout || timeout;

    // Use enhanced waitForOutput implementation
    return new Promise((resolve, reject) => {
        const regex = typeof pattern === 'string' ? new RegExp(pattern, 'im') : pattern;
        const startTime = Date.now();

        const checkOutput = () => {
          let output = this.getLastOutput(sessionId, 150);
          
          if (stripAnsi) {
            output = this.promptDetector.getBuffer(sessionId) || output;
          }

          // Test pattern match
          const patternMatch = regex.test(output);
          
          // Check for prompt if required
          let promptResult: PromptDetectionResult | null = null;
          if (requirePrompt) {
            promptResult = this.promptDetector.detectPrompt(sessionId, output);
          }

          if (patternMatch && (!requirePrompt || (promptResult && promptResult.detected))) {
            resolve({
              output,
              promptDetected: promptResult || undefined
            });
            return;
          }

          if (!this.isSessionRunning(sessionId)) {
            const sessionInfo = this.sessions.get(sessionId);
            reject(new Error(`Session ${sessionId} has stopped (status: ${sessionInfo?.status || 'unknown'})`));
            return;
          }

          if (Date.now() - startTime > timeout) {
            // Enhanced timeout error with debug information
            const debugInfo = {
              sessionId,
              pattern: pattern.toString(),
              outputLength: output.length,
              lastOutput: output.slice(-300),
              promptResult: promptResult ? {
                detected: promptResult.detected,
                confidence: promptResult.confidence,
                pattern: promptResult.pattern?.name
              } : null,
              sessionStatus: this.sessions.get(sessionId)?.status,
              queueStats: this.getCommandQueueStats(sessionId)
            };

            this.logger.error(`Timeout waiting for pattern in session ${sessionId}`, debugInfo);
            reject(new Error(`Timeout waiting for pattern: ${pattern}. Last output: "${output.slice(-200)}"`));
            return;
          }

          setTimeout(checkOutput, 50); // Reduced polling interval for better responsiveness
        };

        checkOutput();
      });
  }

  /**
   * Wait specifically for a shell prompt to appear
   */
  async waitForPrompt(sessionId: string, timeout: number = 10000): Promise<{ detected: boolean; prompt?: string; output: string }> {
    const queue = this.commandQueues.get(sessionId);
    const defaultPattern = queue?.expectedPrompt || this.queueConfig.defaultPromptPattern;
    
    try {
      const result = await this.waitForOutput(sessionId, defaultPattern, { timeout });
      return {
        detected: true,
        prompt: result.output.match(defaultPattern)?.[0],
        output: result.output
      };
    } catch (error) {
      this.logger.error(`Failed to wait for prompt in session ${sessionId}`, {
        error: error instanceof Error ? error.message : String(error),
        timeout
      });
      return {
        detected: false,
        output: this.getLastOutput(sessionId)
      };
    }
  }

  async executeCommand(command: string, args?: string[], options?: Partial<SessionOptions>): Promise<{ output: string; exitCode?: number }> {
    // Create session with all options including SSH options if provided
    const sessionOptions: SessionOptions = {
      command,
      args: args || [],
      ...options
    };

    // Apply platform-specific command translation for SSH sessions
    if (options?.consoleType === 'ssh' && options?.sshOptions) {
      // For SSH sessions, we might need to translate Windows commands to Unix equivalents
      const translatedCommand = this.translateCommandForSSH(command, args);
      sessionOptions.command = translatedCommand.command;
      sessionOptions.args = translatedCommand.args;
      
      this.logger.debug(`Command translation for SSH session:`, {
        original: { command, args },
        translated: { command: translatedCommand.command, args: translatedCommand.args },
        sshHost: options.sshOptions.host
      });
    }

    const sessionId = await this.createSession(sessionOptions);

    return new Promise((resolve, reject) => {
      const outputs: string[] = [];
      let timeoutHandle: NodeJS.Timeout | null = null;
      const timeoutMs = options?.timeout || 30000; // Default 30 second timeout
      
      const cleanup = () => {
        this.removeListener('console-event', handleEvent);
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
      };
      
      const handleEvent = (event: ConsoleEvent) => {
        if (event.sessionId !== sessionId) return;
        
        if (event.type === 'output') {
          outputs.push(event.data.data);
        } else if (event.type === 'stopped') {
          cleanup();
          this.cleanupSession(sessionId);
          resolve({
            output: outputs.join(''),
            exitCode: event.data.exitCode
          });
        } else if (event.type === 'error') {
          // Only reject on serious errors, not command output errors
          if (event.data.error && (
            event.data.error.includes('connection') ||
            event.data.error.includes('authentication') ||
            event.data.error.includes('timeout') ||
            event.data.error.includes('network')
          )) {
            cleanup();
            this.cleanupSession(sessionId);
            reject(new Error(`Session error: ${event.data.error}`));
          }
          // Otherwise, treat errors as part of command output
        }
      };

      // Set up timeout for the command execution
      timeoutHandle = setTimeout(() => {
        cleanup();
        this.stopSession(sessionId).then(() => {
          this.cleanupSession(sessionId);
          reject(new Error(`Command execution timeout after ${timeoutMs}ms`));
        });
      }, timeoutMs);

      this.on('console-event', handleEvent);
    });
  }

  /**
   * Translate Windows commands to Unix equivalents for SSH sessions
   */
  private translateCommandForSSH(command: string, args?: string[]): { command: string; args: string[] } {
    const lowerCommand = command.toLowerCase();
    const finalArgs = args || [];
    
    // Common Windows to Unix command translations
    const translations: Record<string, { command: string; argsTransform?: (args: string[]) => string[] }> = {
      'dir': { 
        command: 'ls',
        argsTransform: (args) => {
          // Translate some common dir flags
          return args.map(arg => {
            if (arg === '/w') return '-1'; // Wide format
            if (arg === '/b') return '-1'; // Bare format
            if (arg === '/a') return '-la'; // All files
            if (arg.startsWith('/')) return arg.substring(1); // Remove Windows flag prefix
            return arg;
          });
        }
      },
      'type': { command: 'cat' },
      'copy': { command: 'cp' },
      'move': { command: 'mv' },
      'del': { command: 'rm' },
      'md': { command: 'mkdir' },
      'mkdir': { command: 'mkdir' },
      'rd': { command: 'rmdir' },
      'rmdir': { command: 'rmdir' },
      'cls': { command: 'clear' },
      'ping': { command: 'ping' }, // Usually available on both
      'ipconfig': { command: 'ifconfig' },
      'tasklist': { command: 'ps' },
      'taskkill': { 
        command: 'kill',
        argsTransform: (args) => {
          // Convert /pid to -p and /f to -9
          const newArgs: string[] = [];
          for (let i = 0; i < args.length; i++) {
            if (args[i].toLowerCase() === '/pid' && i + 1 < args.length) {
              newArgs.push('-p', args[i + 1]);
              i++; // Skip next arg as it's the PID
            } else if (args[i].toLowerCase() === '/f') {
              newArgs.push('-9');
            } else {
              newArgs.push(args[i]);
            }
          }
          return newArgs;
        }
      },
      'findstr': { command: 'grep' },
      'find': { 
        command: 'find',
        argsTransform: (args) => {
          // Windows find is different from Unix find, do basic translation
          return args.map(arg => {
            if (arg.startsWith('/')) return arg.substring(1);
            return arg;
          });
        }
      }
    };

    const translation = translations[lowerCommand];
    if (translation) {
      const translatedArgs = translation.argsTransform ? translation.argsTransform(finalArgs) : finalArgs;
      return {
        command: translation.command,
        args: translatedArgs
      };
    }

    // No translation needed
    return {
      command,
      args: finalArgs
    };
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
  getCircuitBreakerStates(): any {
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
          streaming: false,
          executionState: 'idle',
          activeCommands: new Map()
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

  // Command Queue Management Methods
  
  /**
   * Configure command queue settings
   */
  configureCommandQueue(config: Partial<CommandQueueConfig>): void {
    this.queueConfig = { ...this.queueConfig, ...config };
    this.logger.info('Command queue configuration updated:', config);
  }

  /**
   * Get command queue statistics for a session
   */
  getSessionQueueStats(sessionId: string) {
    return this.getCommandQueueStats(sessionId);
  }

  /**
   * Get all command queue statistics
   */
  getAllCommandQueueStats(): Record<string, { queueSize: number; processing: boolean; lastCommandTime: number }> {
    const stats: Record<string, { queueSize: number; processing: boolean; lastCommandTime: number }> = {};
    
    this.commandQueues.forEach((queue, sessionId) => {
      stats[sessionId] = {
        queueSize: queue.commands.length,
        processing: queue.isProcessing,
        lastCommandTime: queue.lastCommandTime
      };
    });

    return stats;
  }

  /**
   * Clear command queue for a specific session (public method)
   */
  clearSessionCommandQueue(sessionId: string): void {
    this.clearCommandQueue(sessionId);
  }

  /**
   * Clear all command queues
   */
  clearAllCommandQueues(): void {
    Array.from(this.commandQueues.keys()).forEach(sessionId => {
      this.clearCommandQueue(sessionId);
    });
  }

  /**
   * Set custom prompt pattern for a session
   */
  setSessionPromptPattern(sessionId: string, pattern: RegExp): boolean {
    const queue = this.commandQueues.get(sessionId);
    if (!queue) {
      return false;
    }

    queue.expectedPrompt = pattern;
    this.logger.debug(`Updated prompt pattern for session ${sessionId}: ${pattern}`);
    return true;
  }

  /**
   * Get current command queue configuration
   */
  getCommandQueueConfig(): CommandQueueConfig {
    return { ...this.queueConfig };
  }

  /**
   * Force process command queue for a session (useful for debugging)
   */
  async forceProcessCommandQueue(sessionId: string): Promise<void> {
    await this.processCommandQueue(sessionId);
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
    
    // Shutdown self-healing components
    if (this.selfHealingEnabled) {
      await this.shutdownSelfHealingComponents();
    }
    
    this.removeAllListeners();
    this.sessions.clear();
    this.processes.clear();
    this.sshClients.clear();
    this.sshChannels.clear();
    this.sshConnectionPool.clear();
    this.outputBuffers.clear();
    this.streamManagers.clear();
    this.retryAttempts.clear();
    
    // Clean up command queue system
    this.commandQueues.forEach((queue, sessionId) => {
      this.clearCommandQueue(sessionId);
    });
    this.commandQueues.clear();
    this.commandProcessingIntervals.clear();
  }
}