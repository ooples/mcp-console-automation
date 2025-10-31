import { EventEmitter } from 'events';
import { Logger } from '../utils/logger.js';
import {
  ConsoleSession,
  SessionState,
  SSHConnectionOptions,
} from '../types/index.js';
import {
  PersistentSessionStorage,
  PersistentSessionData,
} from './PersistentSessionStorage.js';

export interface ReconnectionConfig {
  enabled: boolean;
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  healthCheckInterval: number;
  connectionTimeout: number;
  keepAliveInterval: number;
  autoReconnect: boolean;
  preserveState: boolean;
}

export interface ReconnectionAttempt {
  sessionId: string;
  attemptNumber: number;
  startTime: Date;
  endTime?: Date;
  success: boolean;
  error?: string;
  strategy: ReconnectionStrategy;
  duration: number;
  metadata?: Record<string, any>;
}

export type ReconnectionStrategy =
  | 'simple-reconnect'
  | 'session-restore'
  | 'process-restart'
  | 'ssh-reconnect'
  | 'state-recovery'
  | 'force-reconnect';

export interface ReconnectionState {
  sessionId: string;
  isReconnecting: boolean;
  attempts: ReconnectionAttempt[];
  lastSuccessfulConnection: Date | null;
  lastFailure: Date | null;
  nextRetryTime: Date | null;
  strategy: ReconnectionStrategy;
  preservedState?: {
    workingDirectory: string;
    environment: Record<string, string>;
    lastCommand?: string;
  };
}

/**
 * Automatic Session Reconnection System
 * Handles network disconnections and provides seamless session restoration
 */
export class SessionReconnection extends EventEmitter {
  private config: ReconnectionConfig;
  private logger: Logger;
  private storage: PersistentSessionStorage;
  private reconnectionStates: Map<string, ReconnectionState> = new Map();
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private activeReconnections: Set<string> = new Set();

  // Statistics
  private stats = {
    totalAttempts: 0,
    successfulReconnections: 0,
    failedReconnections: 0,
    averageReconnectionTime: 0,
    networkDisconnections: 0,
    processRestarts: 0,
    lastReconnection: null as Date | null,
  };

  constructor(
    storage: PersistentSessionStorage,
    config?: Partial<ReconnectionConfig>
  ) {
    super();
    this.logger = new Logger('SessionReconnection');
    this.storage = storage;

    this.config = {
      enabled: config?.enabled ?? true,
      maxRetries: config?.maxRetries || 5,
      baseDelay: config?.baseDelay || 2000,
      maxDelay: config?.maxDelay || 30000,
      backoffMultiplier: config?.backoffMultiplier || 1.5,
      healthCheckInterval: config?.healthCheckInterval || 30000,
      connectionTimeout: config?.connectionTimeout || 15000,
      keepAliveInterval: config?.keepAliveInterval || 60000,
      autoReconnect: config?.autoReconnect ?? true,
      preserveState: config?.preserveState ?? true,
    };

    this.logger.info(
      'SessionReconnection initialized with config:',
      this.config
    );
  }

  /**
   * Start the reconnection monitoring system
   */
  async start(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.info('Session reconnection is disabled');
      return;
    }

    this.logger.info('Starting session reconnection monitoring...');

    // Start health check monitoring
    this.startHealthCheck();

    // Load existing reconnection states
    await this.loadReconnectionStates();

    this.emit('started');
    this.logger.info('Session reconnection monitoring started');
  }

  /**
   * Stop the reconnection system
   */
  async stop(): Promise<void> {
    this.logger.info('Stopping session reconnection...');

    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    // Wait for active reconnections to complete
    if (this.activeReconnections.size > 0) {
      this.logger.info(
        `Waiting for ${this.activeReconnections.size} active reconnections to complete...`
      );
      const timeout = setTimeout(() => {
        this.logger.warn('Timeout waiting for active reconnections');
      }, 30000);

      while (this.activeReconnections.size > 0) {
        await this.delay(1000);
      }
      clearTimeout(timeout);
    }

    this.emit('stopped');
    this.logger.info('Session reconnection stopped');
  }

  /**
   * Register a session for reconnection monitoring
   */
  async registerSession(
    sessionId: string,
    session: ConsoleSession
  ): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    this.logger.info(
      `Registering session ${sessionId} for reconnection monitoring`
    );

    const reconnectionState: ReconnectionState = {
      sessionId,
      isReconnecting: false,
      attempts: [],
      lastSuccessfulConnection: new Date(),
      lastFailure: null,
      nextRetryTime: null,
      strategy: 'simple-reconnect',
      preservedState: this.config.preserveState
        ? {
            workingDirectory: session.cwd,
            environment: session.env || {},
            lastCommand: session.command,
          }
        : undefined,
    };

    this.reconnectionStates.set(sessionId, reconnectionState);
    this.emit('session-registered', { sessionId, state: reconnectionState });
  }

  /**
   * Unregister a session from reconnection monitoring
   */
  async unregisterSession(sessionId: string): Promise<void> {
    this.logger.info(
      `Unregistering session ${sessionId} from reconnection monitoring`
    );

    const state = this.reconnectionStates.get(sessionId);
    if (state?.isReconnecting) {
      this.logger.warn(
        `Session ${sessionId} is currently reconnecting - marking for cleanup`
      );
    }

    this.reconnectionStates.delete(sessionId);
    this.activeReconnections.delete(sessionId);

    this.emit('session-unregistered', { sessionId });
  }

  /**
   * Handle session disconnection
   */
  async handleDisconnection(
    sessionId: string,
    reason: string,
    error?: Error
  ): Promise<void> {
    if (!this.config.enabled || !this.config.autoReconnect) {
      return;
    }

    const state = this.reconnectionStates.get(sessionId);
    if (!state) {
      this.logger.warn(`No reconnection state found for session ${sessionId}`);
      return;
    }

    if (state.isReconnecting) {
      this.logger.debug(`Session ${sessionId} is already reconnecting`);
      return;
    }

    this.logger.warn(`Session ${sessionId} disconnected: ${reason}`);

    state.lastFailure = new Date();
    this.stats.networkDisconnections++;

    // Determine reconnection strategy based on disconnect reason
    const strategy = this.determineReconnectionStrategy(reason, error);
    state.strategy = strategy;

    this.emit('session-disconnected', {
      sessionId,
      reason,
      error: error?.message,
      strategy,
    });

    // Start reconnection process
    await this.attemptReconnection(sessionId);
  }

  /**
   * Manually trigger reconnection for a session
   */
  async forceReconnection(
    sessionId: string,
    strategy?: ReconnectionStrategy
  ): Promise<boolean> {
    const state = this.reconnectionStates.get(sessionId);
    if (!state) {
      throw new Error(`No reconnection state found for session ${sessionId}`);
    }

    if (strategy) {
      state.strategy = strategy;
    }

    this.logger.info(
      `Forcing reconnection for session ${sessionId} using strategy: ${state.strategy}`
    );
    return await this.attemptReconnection(sessionId);
  }

  /**
   * Get reconnection state for a session
   */
  getReconnectionState(sessionId: string): ReconnectionState | undefined {
    return this.reconnectionStates.get(sessionId);
  }

  /**
   * Get reconnection statistics
   */
  getReconnectionStats() {
    return {
      ...this.stats,
      activeReconnections: this.activeReconnections.size,
      registeredSessions: this.reconnectionStates.size,
      successRate:
        this.stats.totalAttempts > 0
          ? (this.stats.successfulReconnections / this.stats.totalAttempts) *
            100
          : 0,
    };
  }

  /**
   * Get all reconnection states
   */
  getAllReconnectionStates(): Record<string, ReconnectionState> {
    const result: Record<string, ReconnectionState> = {};
    for (const [sessionId, state] of this.reconnectionStates) {
      result[sessionId] = { ...state };
    }
    return result;
  }

  // Private methods

  private async attemptReconnection(sessionId: string): Promise<boolean> {
    const state = this.reconnectionStates.get(sessionId);
    if (!state || state.isReconnecting) {
      return false;
    }

    // Check if max retries exceeded
    if (state.attempts.length >= this.config.maxRetries) {
      this.logger.warn(
        `Max reconnection attempts (${this.config.maxRetries}) exceeded for session ${sessionId}`
      );
      this.emit('reconnection-max-attempts', {
        sessionId,
        attempts: state.attempts.length,
      });
      return false;
    }

    state.isReconnecting = true;
    this.activeReconnections.add(sessionId);

    const attemptNumber = state.attempts.length + 1;
    this.logger.info(
      `Starting reconnection attempt ${attemptNumber}/${this.config.maxRetries} for session ${sessionId}`
    );

    const attempt: ReconnectionAttempt = {
      sessionId,
      attemptNumber,
      startTime: new Date(),
      success: false,
      strategy: state.strategy,
      duration: 0,
    };

    try {
      this.emit('reconnection-started', {
        sessionId,
        attemptNumber,
        strategy: state.strategy,
      });

      // Execute reconnection strategy
      const success = await this.executeReconnectionStrategy(
        sessionId,
        state.strategy
      );

      attempt.success = success;
      attempt.endTime = new Date();
      attempt.duration =
        attempt.endTime.getTime() - attempt.startTime.getTime();

      if (success) {
        state.lastSuccessfulConnection = new Date();
        state.nextRetryTime = null;
        this.stats.successfulReconnections++;
        this.stats.lastReconnection = new Date();
        this.updateAverageReconnectionTime(attempt.duration);

        this.logger.info(
          `Successfully reconnected session ${sessionId} on attempt ${attemptNumber}`
        );
        this.emit('reconnection-success', {
          sessionId,
          attemptNumber,
          duration: attempt.duration,
          strategy: state.strategy,
        });
      } else {
        this.stats.failedReconnections++;
        this.logger.warn(
          `Failed to reconnect session ${sessionId} on attempt ${attemptNumber}`
        );

        // Schedule next retry with exponential backoff
        if (attemptNumber < this.config.maxRetries) {
          const delay = Math.min(
            this.config.baseDelay *
              Math.pow(this.config.backoffMultiplier, attemptNumber - 1),
            this.config.maxDelay
          );

          state.nextRetryTime = new Date(Date.now() + delay);
          this.logger.info(
            `Scheduling next reconnection attempt for session ${sessionId} in ${delay}ms`
          );

          setTimeout(() => {
            this.attemptReconnection(sessionId);
          }, delay);
        }
      }

      state.attempts.push(attempt);
      this.stats.totalAttempts++;

      return success;
    } catch (error) {
      attempt.success = false;
      attempt.error = error instanceof Error ? error.message : String(error);
      attempt.endTime = new Date();
      attempt.duration =
        attempt.endTime.getTime() - attempt.startTime.getTime();

      state.attempts.push(attempt);
      this.stats.totalAttempts++;
      this.stats.failedReconnections++;

      this.logger.error(
        `Reconnection attempt ${attemptNumber} failed for session ${sessionId}:`,
        error
      );
      this.emit('reconnection-error', {
        sessionId,
        attemptNumber,
        error: error instanceof Error ? error.message : String(error),
      });

      return false;
    } finally {
      state.isReconnecting = false;
      this.activeReconnections.delete(sessionId);
    }
  }

  private async executeReconnectionStrategy(
    sessionId: string,
    strategy: ReconnectionStrategy
  ): Promise<boolean> {
    switch (strategy) {
      case 'simple-reconnect':
        return await this.executeSimpleReconnect(sessionId);

      case 'session-restore':
        return await this.executeSessionRestore(sessionId);

      case 'process-restart':
        return await this.executeProcessRestart(sessionId);

      case 'ssh-reconnect':
        return await this.executeSSHReconnect(sessionId);

      case 'state-recovery':
        return await this.executeStateRecovery(sessionId);

      case 'force-reconnect':
        return await this.executeForceReconnect(sessionId);

      default:
        this.logger.warn(`Unknown reconnection strategy: ${strategy}`);
        return false;
    }
  }

  private async executeSimpleReconnect(sessionId: string): Promise<boolean> {
    try {
      this.emit('reconnection-strategy-attempt', {
        sessionId,
        strategy: 'simple-reconnect',
        message: 'Attempting simple reconnection',
      });

      // Request simple reconnection from session manager
      this.emit('reconnection-request', {
        sessionId,
        type: 'simple-reconnect',
      });

      return true; // Assume success - actual verification would come from session manager
    } catch (error) {
      this.logger.error(
        `Simple reconnect failed for session ${sessionId}:`,
        error
      );
      return false;
    }
  }

  private async executeSessionRestore(sessionId: string): Promise<boolean> {
    try {
      this.emit('reconnection-strategy-attempt', {
        sessionId,
        strategy: 'session-restore',
        message: 'Restoring session from persistent storage',
      });

      // Get persistent session data
      const sessionData = await this.storage.retrieveSession(sessionId);
      if (!sessionData) {
        this.logger.warn(`No persistent data found for session ${sessionId}`);
        return false;
      }

      // Request session restoration
      this.emit('session-restore-request', {
        sessionId,
        sessionData,
        preserveState: this.config.preserveState,
      });

      return true;
    } catch (error) {
      this.logger.error(
        `Session restore failed for session ${sessionId}:`,
        error
      );
      return false;
    }
  }

  private async executeProcessRestart(sessionId: string): Promise<boolean> {
    try {
      this.emit('reconnection-strategy-attempt', {
        sessionId,
        strategy: 'process-restart',
        message: 'Restarting process with preserved state',
      });

      const state = this.reconnectionStates.get(sessionId);
      const sessionData = await this.storage.retrieveSession(sessionId);

      // Request process restart
      this.emit('process-restart-request', {
        sessionId,
        sessionData,
        preservedState: state?.preservedState,
      });

      this.stats.processRestarts++;
      return true;
    } catch (error) {
      this.logger.error(
        `Process restart failed for session ${sessionId}:`,
        error
      );
      return false;
    }
  }

  private async executeSSHReconnect(sessionId: string): Promise<boolean> {
    try {
      this.emit('reconnection-strategy-attempt', {
        sessionId,
        strategy: 'ssh-reconnect',
        message: 'Reconnecting SSH session',
      });

      const sessionData = await this.storage.retrieveSession(sessionId);
      if (!sessionData?.originalSession.sshOptions) {
        return false; // Not an SSH session
      }

      // Request SSH reconnection
      this.emit('ssh-reconnect-request', {
        sessionId,
        sshOptions: sessionData.originalSession.sshOptions,
        preservedState: this.reconnectionStates.get(sessionId)?.preservedState,
      });

      return true;
    } catch (error) {
      this.logger.error(
        `SSH reconnect failed for session ${sessionId}:`,
        error
      );
      return false;
    }
  }

  private async executeStateRecovery(sessionId: string): Promise<boolean> {
    try {
      this.emit('reconnection-strategy-attempt', {
        sessionId,
        strategy: 'state-recovery',
        message: 'Recovering session state and context',
      });

      const sessionData = await this.storage.retrieveSession(sessionId);
      const state = this.reconnectionStates.get(sessionId);

      if (!sessionData) {
        return false;
      }

      // Request comprehensive state recovery
      this.emit('state-recovery-request', {
        sessionId,
        sessionData,
        preservedState: state?.preservedState,
        outputHistory: this.storage.getSessionHistory(sessionId),
      });

      return true;
    } catch (error) {
      this.logger.error(
        `State recovery failed for session ${sessionId}:`,
        error
      );
      return false;
    }
  }

  private async executeForceReconnect(sessionId: string): Promise<boolean> {
    try {
      this.emit('reconnection-strategy-attempt', {
        sessionId,
        strategy: 'force-reconnect',
        message: 'Forcing reconnection with aggressive recovery',
      });

      // Force reconnection by trying multiple strategies
      const strategies: ReconnectionStrategy[] = [
        'simple-reconnect',
        'session-restore',
        'process-restart',
      ];

      for (const strategy of strategies) {
        const success = await this.executeReconnectionStrategy(
          sessionId,
          strategy
        );
        if (success) {
          return true;
        }

        // Wait between attempts
        await this.delay(1000);
      }

      return false;
    } catch (error) {
      this.logger.error(
        `Force reconnect failed for session ${sessionId}:`,
        error
      );
      return false;
    }
  }

  private determineReconnectionStrategy(
    reason: string,
    error?: Error
  ): ReconnectionStrategy {
    const reasonLower = reason.toLowerCase();
    const errorMessage = error?.message?.toLowerCase() || '';

    // Network-related disconnections
    if (
      reasonLower.includes('network') ||
      reasonLower.includes('connection') ||
      errorMessage.includes('econnreset') ||
      errorMessage.includes('enotfound')
    ) {
      return 'simple-reconnect';
    }

    // SSH-specific issues
    if (reasonLower.includes('ssh') || errorMessage.includes('ssh')) {
      return 'ssh-reconnect';
    }

    // Process-related issues
    if (
      reasonLower.includes('process') ||
      reasonLower.includes('killed') ||
      errorMessage.includes('spawn') ||
      errorMessage.includes('exit')
    ) {
      return 'process-restart';
    }

    // Timeout issues
    if (reasonLower.includes('timeout') || errorMessage.includes('timeout')) {
      return 'session-restore';
    }

    // State corruption
    if (reasonLower.includes('state') || reasonLower.includes('corrupt')) {
      return 'state-recovery';
    }

    // Default strategy
    return 'simple-reconnect';
  }

  private startHealthCheck(): void {
    if (this.config.healthCheckInterval <= 0) {
      return;
    }

    this.healthCheckTimer = setInterval(async () => {
      await this.performHealthCheck();
    }, this.config.healthCheckInterval);
  }

  private async performHealthCheck(): Promise<void> {
    const now = Date.now();

    for (const [sessionId, state] of this.reconnectionStates.entries()) {
      // Check for pending retries
      if (
        state.nextRetryTime &&
        now >= state.nextRetryTime.getTime() &&
        !state.isReconnecting
      ) {
        this.logger.debug(
          `Triggering scheduled reconnection for session ${sessionId}`
        );
        await this.attemptReconnection(sessionId);
      }

      // Request health check from external systems
      this.emit('health-check-request', { sessionId, state });
    }
  }

  private async loadReconnectionStates(): Promise<void> {
    // Load any persistent reconnection states if needed
    // This could be implemented to restore reconnection states across process restarts
    this.logger.debug('Loading reconnection states...');
  }

  private updateAverageReconnectionTime(duration: number): void {
    if (this.stats.successfulReconnections === 1) {
      this.stats.averageReconnectionTime = duration;
    } else {
      this.stats.averageReconnectionTime =
        (this.stats.averageReconnectionTime *
          (this.stats.successfulReconnections - 1) +
          duration) /
        this.stats.successfulReconnections;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
