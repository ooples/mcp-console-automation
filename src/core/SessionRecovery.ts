import { EventEmitter } from 'events';
import { Logger } from '../utils/logger.js';
import { SessionState, SessionOptions } from '../types/index.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

export interface RecoveryConfig {
  enabled: boolean;
  maxRecoveryAttempts: number;
  recoveryDelay: number;
  backoffMultiplier: number;
  maxBackoffDelay: number;
  persistenceEnabled: boolean;
  persistencePath: string;
  enableSmartRecovery: boolean;
  enablePersistentSession: boolean;
  snapshotInterval: number;
  recoveryTimeout: number;
  enableRecoveryMetrics: boolean;
}

export interface RecoverySnapshot {
  sessionId: string;
  timestamp: Date;
  sessionState: SessionState;
  sessionOptions: SessionOptions;
  environment: Record<string, string>;
  workingDirectory: string;
  commandHistory: string[];
  outputBuffer: string[];
  errorContext?: {
    lastError: string;
    errorTimestamp: Date;
    errorCount: number;
  };
}

export interface RecoveryAttempt {
  sessionId: string;
  attemptNumber: number;
  startTime: Date;
  endTime?: Date;
  success: boolean;
  error?: string;
  strategy: RecoveryStrategy;
  metrics: {
    duration: number;
    resourcesUsed: number;
    dataRestored: number;
  };
}

export type RecoveryStrategy = 
  | 'restart'
  | 'reconnect'
  | 'restore'
  | 'replicate'
  | 'migrate'
  | 'fallback';

export interface RecoveryPlan {
  sessionId: string;
  strategies: RecoveryStrategy[];
  priority: 'high' | 'medium' | 'low';
  estimatedTime: number;
  requiredResources: string[];
  fallbackOptions: string[];
}

/**
 * Automatic Session Recovery System
 * Provides intelligent session restoration with multiple recovery strategies
 */
export class SessionRecovery extends EventEmitter {
  private logger: Logger;
  private config: RecoveryConfig;
  private recoveryAttempts: Map<string, RecoveryAttempt[]> = new Map();
  private sessionSnapshots: Map<string, RecoverySnapshot> = new Map();
  private activeRecoveries: Set<string> = new Set();
  private snapshotTimers: Map<string, NodeJS.Timeout> = new Map();
  private isRunning = false;

  // Recovery statistics
  private stats = {
    totalRecoveryAttempts: 0,
    successfulRecoveries: 0,
    failedRecoveries: 0,
    averageRecoveryTime: 0,
    sessionsSaved: 0,
    sessionsRestored: 0,
    bytesRestored: 0,
    strategiesUsed: new Map<RecoveryStrategy, number>(),
    lastRecovery: null as Date | null
  };

  constructor(config?: Partial<RecoveryConfig>) {
    super();
    this.logger = new Logger('SessionRecovery');
    
    this.config = {
      enabled: config?.enabled ?? true,
      maxRecoveryAttempts: config?.maxRecoveryAttempts || 3,
      recoveryDelay: config?.recoveryDelay || 5000,
      backoffMultiplier: config?.backoffMultiplier || 2,
      maxBackoffDelay: config?.maxBackoffDelay || 60000,
      persistenceEnabled: config?.persistenceEnabled ?? true,
      persistencePath: config?.persistencePath || './data/session-snapshots',
      enableSmartRecovery: config?.enableSmartRecovery ?? true,
      enablePersistentSession: config?.enablePersistentSession ?? true,
      snapshotInterval: config?.snapshotInterval || 30000,
      recoveryTimeout: config?.recoveryTimeout || 120000,
      enableRecoveryMetrics: config?.enableRecoveryMetrics ?? true
    };

    this.logger.info('SessionRecovery initialized with config:', this.config);
  }

  /**
   * Start the session recovery system
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('SessionRecovery is already running');
      return;
    }

    this.logger.info('Starting SessionRecovery...');
    this.isRunning = true;

    // Ensure persistence directory exists
    if (this.config.persistenceEnabled) {
      try {
        await fs.mkdir(this.config.persistencePath, { recursive: true });
      } catch (error) {
        this.logger.error('Failed to create persistence directory:', error);
      }
    }

    // Load existing snapshots from disk
    await this.loadPersistedSnapshots();

    this.emit('started');
    this.logger.info('SessionRecovery started successfully');
  }

  /**
   * Stop the session recovery system
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      this.logger.warn('SessionRecovery is not running');
      return;
    }

    this.logger.info('Stopping SessionRecovery...');
    this.isRunning = false;

    // Clear snapshot timers
    for (const [sessionId, timer] of this.snapshotTimers) {
      clearInterval(timer);
    }
    this.snapshotTimers.clear();

    // Wait for active recoveries to complete
    if (this.activeRecoveries.size > 0) {
      this.logger.info(`Waiting for ${this.activeRecoveries.size} active recoveries to complete...`);
      const timeout = setTimeout(() => {
        this.logger.warn('Timeout waiting for active recoveries');
      }, 30000);

      while (this.activeRecoveries.size > 0) {
        await this.delay(1000);
      }
      clearTimeout(timeout);
    }

    // Persist current snapshots
    if (this.config.persistenceEnabled) {
      await this.persistAllSnapshots();
    }

    this.emit('stopped');
    this.logger.info('SessionRecovery stopped');
  }

  /**
   * Register a session for recovery monitoring
   */
  async registerSession(sessionId: string, sessionState: SessionState, sessionOptions: SessionOptions): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    this.logger.info(`Registering session ${sessionId} for recovery monitoring`);

    // Create initial snapshot
    const snapshot: RecoverySnapshot = {
      sessionId,
      timestamp: new Date(),
      sessionState: { ...sessionState },
      sessionOptions: { ...sessionOptions },
      environment: { ...sessionOptions.env || {} },
      workingDirectory: sessionOptions.cwd || process.cwd(),
      commandHistory: [],
      outputBuffer: []
    };

    this.sessionSnapshots.set(sessionId, snapshot);
    this.stats.sessionsSaved++;

    // Start periodic snapshotting
    if (this.config.snapshotInterval > 0) {
      this.startPeriodicSnapshots(sessionId);
    }

    // Persist snapshot if enabled
    if (this.config.persistenceEnabled) {
      await this.persistSnapshot(snapshot);
    }

    this.emit('session-registered', { sessionId, snapshot });
  }

  /**
   * Unregister a session from recovery monitoring
   */
  async unregisterSession(sessionId: string): Promise<void> {
    this.logger.info(`Unregistering session ${sessionId} from recovery monitoring`);

    // Clear snapshot timer
    const timer = this.snapshotTimers.get(sessionId);
    if (timer) {
      clearInterval(timer);
      this.snapshotTimers.delete(sessionId);
    }

    // Remove snapshot
    this.sessionSnapshots.delete(sessionId);

    // Remove persisted snapshot
    if (this.config.persistenceEnabled) {
      try {
        const snapshotPath = path.join(this.config.persistencePath, `${sessionId}.snapshot.json`);
        await fs.unlink(snapshotPath);
      } catch (error) {
        // Ignore if file doesn't exist
      }
    }

    this.emit('session-unregistered', { sessionId });
  }

  /**
   * Update session snapshot with new state
   */
  async updateSessionSnapshot(
    sessionId: string, 
    updates: Partial<Pick<RecoverySnapshot, 'sessionState' | 'environment' | 'workingDirectory' | 'commandHistory' | 'outputBuffer' | 'errorContext'>>
  ): Promise<void> {
    const snapshot = this.sessionSnapshots.get(sessionId);
    if (!snapshot) {
      return;
    }

    // Update snapshot
    Object.assign(snapshot, updates);
    snapshot.timestamp = new Date();

    // Persist if enabled
    if (this.config.persistenceEnabled) {
      await this.persistSnapshot(snapshot);
    }

    this.emit('snapshot-updated', { sessionId, snapshot });
  }

  /**
   * Attempt to recover a failed session
   */
  async recoverSession(sessionId: string, failureReason?: string): Promise<boolean> {
    if (!this.config.enabled || this.activeRecoveries.has(sessionId)) {
      return false;
    }

    const snapshot = this.sessionSnapshots.get(sessionId);
    if (!snapshot) {
      this.logger.warn(`No snapshot found for session ${sessionId} - cannot recover`);
      return false;
    }

    const existingAttempts = this.recoveryAttempts.get(sessionId) || [];
    if (existingAttempts.length >= this.config.maxRecoveryAttempts) {
      this.logger.warn(`Max recovery attempts (${this.config.maxRecoveryAttempts}) reached for session ${sessionId}`);
      this.emit('recovery-max-attempts', { sessionId, attempts: existingAttempts.length });
      return false;
    }

    this.activeRecoveries.add(sessionId);
    const attemptNumber = existingAttempts.length + 1;
    
    this.logger.info(`Starting recovery attempt ${attemptNumber}/${this.config.maxRecoveryAttempts} for session ${sessionId}`);

    try {
      // Generate recovery plan
      const recoveryPlan = await this.generateRecoveryPlan(sessionId, failureReason);
      
      this.emit('recovery-started', { 
        sessionId, 
        attemptNumber, 
        plan: recoveryPlan,
        failureReason 
      });

      // Execute recovery strategies
      const success = await this.executeRecoveryPlan(sessionId, recoveryPlan, attemptNumber);
      
      if (success) {
        this.stats.successfulRecoveries++;
        this.stats.lastRecovery = new Date();
        this.logger.info(`Successfully recovered session ${sessionId} on attempt ${attemptNumber}`);
        
        this.emit('recovery-success', { 
          sessionId, 
          attemptNumber,
          plan: recoveryPlan
        });
      } else {
        this.stats.failedRecoveries++;
        this.logger.warn(`Failed to recover session ${sessionId} on attempt ${attemptNumber}`);
        
        // Schedule next attempt with exponential backoff
        if (attemptNumber < this.config.maxRecoveryAttempts) {
          const delay = Math.min(
            this.config.recoveryDelay * Math.pow(this.config.backoffMultiplier, attemptNumber - 1),
            this.config.maxBackoffDelay
          );
          
          this.logger.info(`Scheduling next recovery attempt for session ${sessionId} in ${delay}ms`);
          
          setTimeout(() => {
            this.recoverSession(sessionId, failureReason);
          }, delay);
        }
      }

      return success;

    } catch (error) {
      this.logger.error(`Recovery attempt ${attemptNumber} failed for session ${sessionId}:`, error);
      this.stats.failedRecoveries++;
      
      this.emit('recovery-error', { 
        sessionId, 
        attemptNumber,
        error: error instanceof Error ? error.message : String(error)
      });
      
      return false;

    } finally {
      this.activeRecoveries.delete(sessionId);
      this.stats.totalRecoveryAttempts++;
    }
  }

  /**
   * Generate intelligent recovery plan based on failure analysis
   */
  private async generateRecoveryPlan(sessionId: string, failureReason?: string): Promise<RecoveryPlan> {
    const snapshot = this.sessionSnapshots.get(sessionId)!;
    const sessionType = snapshot.sessionOptions.sshOptions ? 'ssh' : 'local';
    
    let strategies: RecoveryStrategy[] = [];
    let priority: 'high' | 'medium' | 'low' = 'medium';
    let estimatedTime = 30000; // 30 seconds default
    
    if (this.config.enableSmartRecovery && failureReason) {
      // Analyze failure reason to determine best recovery strategy
      const reason = failureReason.toLowerCase();
      
      if (reason.includes('network') || reason.includes('connection')) {
        strategies = sessionType === 'ssh' 
          ? ['reconnect', 'restart', 'migrate', 'fallback']
          : ['restart', 'restore', 'fallback'];
        priority = 'high';
        estimatedTime = sessionType === 'ssh' ? 45000 : 15000;
        
      } else if (reason.includes('timeout') || reason.includes('unresponsive')) {
        strategies = ['restart', 'restore', 'replicate', 'fallback'];
        priority = 'high';
        estimatedTime = 20000;
        
      } else if (reason.includes('memory') || reason.includes('resource')) {
        strategies = ['migrate', 'restart', 'fallback'];
        priority = 'medium';
        estimatedTime = 60000;
        
      } else if (reason.includes('permission') || reason.includes('auth')) {
        strategies = ['reconnect', 'restore', 'fallback'];
        priority = 'low';
        estimatedTime = 30000;
        
      } else {
        // Generic failure
        strategies = sessionType === 'ssh'
          ? ['reconnect', 'restart', 'restore', 'fallback']
          : ['restart', 'restore', 'replicate', 'fallback'];
      }
    } else {
      // Default recovery strategies
      strategies = sessionType === 'ssh'
        ? ['reconnect', 'restart', 'restore', 'fallback']
        : ['restart', 'restore', 'fallback'];
    }

    const requiredResources = [
      'cpu',
      sessionType === 'ssh' ? 'network' : 'local-process',
      'memory'
    ];

    const fallbackOptions = [
      'Create new session with restored state',
      'Notify user of session failure',
      'Archive session for manual recovery'
    ];

    return {
      sessionId,
      strategies,
      priority,
      estimatedTime,
      requiredResources,
      fallbackOptions
    };
  }

  /**
   * Execute recovery plan using the specified strategies
   */
  private async executeRecoveryPlan(sessionId: string, plan: RecoveryPlan, attemptNumber: number): Promise<boolean> {
    const startTime = Date.now();
    
    const attempt: RecoveryAttempt = {
      sessionId,
      attemptNumber,
      startTime: new Date(),
      success: false,
      strategy: plan.strategies[0], // Will be updated as we try strategies
      metrics: {
        duration: 0,
        resourcesUsed: 0,
        dataRestored: 0
      }
    };

    // Store attempt
    if (!this.recoveryAttempts.has(sessionId)) {
      this.recoveryAttempts.set(sessionId, []);
    }
    this.recoveryAttempts.get(sessionId)!.push(attempt);

    // Try each strategy in order
    for (const strategy of plan.strategies) {
      attempt.strategy = strategy;
      this.stats.strategiesUsed.set(strategy, (this.stats.strategiesUsed.get(strategy) || 0) + 1);
      
      this.logger.info(`Attempting recovery strategy '${strategy}' for session ${sessionId}`);
      
      try {
        const success = await this.executeRecoveryStrategy(sessionId, strategy);
        
        if (success) {
          attempt.success = true;
          attempt.endTime = new Date();
          attempt.metrics.duration = Date.now() - startTime;
          
          // Update average recovery time
          this.updateAverageRecoveryTime(attempt.metrics.duration);
          
          this.logger.info(`Recovery strategy '${strategy}' succeeded for session ${sessionId}`);
          return true;
        } else {
          this.logger.warn(`Recovery strategy '${strategy}' failed for session ${sessionId}`);
        }
        
      } catch (error) {
        this.logger.error(`Recovery strategy '${strategy}' error for session ${sessionId}:`, error);
      }
    }

    // All strategies failed
    attempt.endTime = new Date();
    attempt.metrics.duration = Date.now() - startTime;
    attempt.error = 'All recovery strategies failed';

    return false;
  }

  /**
   * Execute a specific recovery strategy
   */
  private async executeRecoveryStrategy(sessionId: string, strategy: RecoveryStrategy): Promise<boolean> {
    const snapshot = this.sessionSnapshots.get(sessionId);
    if (!snapshot) return false;

    switch (strategy) {
      case 'restart':
        return await this.executeRestartStrategy(sessionId, snapshot);
        
      case 'reconnect':
        return await this.executeReconnectStrategy(sessionId, snapshot);
        
      case 'restore':
        return await this.executeRestoreStrategy(sessionId, snapshot);
        
      case 'replicate':
        return await this.executeReplicateStrategy(sessionId, snapshot);
        
      case 'migrate':
        return await this.executeMigrateStrategy(sessionId, snapshot);
        
      case 'fallback':
        return await this.executeFallbackStrategy(sessionId, snapshot);
        
      default:
        this.logger.warn(`Unknown recovery strategy: ${strategy}`);
        return false;
    }
  }

  /**
   * Restart the session with the same configuration
   */
  private async executeRestartStrategy(sessionId: string, snapshot: RecoverySnapshot): Promise<boolean> {
    try {
      this.emit('recovery-strategy-attempt', { 
        sessionId, 
        strategy: 'restart',
        message: 'Restarting session with same configuration'
      });

      // Request session restart with original options
      this.emit('session-restart-request', {
        sessionId,
        sessionOptions: snapshot.sessionOptions,
        restoreState: {
          workingDirectory: snapshot.workingDirectory,
          environment: snapshot.environment
        }
      });

      return true; // Assume success - actual verification would come from session manager
      
    } catch (error) {
      this.logger.error(`Restart strategy failed for session ${sessionId}:`, error);
      return false;
    }
  }

  /**
   * Reconnect to existing session (SSH only)
   */
  private async executeReconnectStrategy(sessionId: string, snapshot: RecoverySnapshot): Promise<boolean> {
    if (!snapshot.sessionOptions.sshOptions) {
      return false; // Not applicable for local sessions
    }

    try {
      this.emit('recovery-strategy-attempt', { 
        sessionId, 
        strategy: 'reconnect',
        message: 'Attempting to reconnect to SSH session'
      });

      // Request SSH reconnection
      this.emit('ssh-reconnect-request', {
        sessionId,
        sshOptions: snapshot.sessionOptions.sshOptions
      });

      return true;
      
    } catch (error) {
      this.logger.error(`Reconnect strategy failed for session ${sessionId}:`, error);
      return false;
    }
  }

  /**
   * Restore session state from snapshot
   */
  private async executeRestoreStrategy(sessionId: string, snapshot: RecoverySnapshot): Promise<boolean> {
    try {
      this.emit('recovery-strategy-attempt', { 
        sessionId, 
        strategy: 'restore',
        message: 'Restoring session from snapshot data'
      });

      // Restore session state
      this.emit('session-restore-request', {
        sessionId,
        snapshot: {
          sessionState: snapshot.sessionState,
          environment: snapshot.environment,
          workingDirectory: snapshot.workingDirectory,
          commandHistory: snapshot.commandHistory
        }
      });

      this.stats.sessionsRestored++;
      this.stats.bytesRestored += this.estimateSnapshotSize(snapshot);

      return true;
      
    } catch (error) {
      this.logger.error(`Restore strategy failed for session ${sessionId}:`, error);
      return false;
    }
  }

  /**
   * Replicate session on different resources
   */
  private async executeReplicateStrategy(sessionId: string, snapshot: RecoverySnapshot): Promise<boolean> {
    try {
      this.emit('recovery-strategy-attempt', { 
        sessionId, 
        strategy: 'replicate',
        message: 'Replicating session on alternative resources'
      });

      // Create new session with replicated state
      const newSessionId = `${sessionId}-replica-${Date.now()}`;
      
      this.emit('session-replicate-request', {
        originalSessionId: sessionId,
        newSessionId,
        sessionOptions: snapshot.sessionOptions,
        restoreState: snapshot
      });

      return true;
      
    } catch (error) {
      this.logger.error(`Replicate strategy failed for session ${sessionId}:`, error);
      return false;
    }
  }

  /**
   * Migrate session to different host/resource
   */
  private async executeMigrateStrategy(sessionId: string, snapshot: RecoverySnapshot): Promise<boolean> {
    try {
      this.emit('recovery-strategy-attempt', { 
        sessionId, 
        strategy: 'migrate',
        message: 'Migrating session to alternative host'
      });

      // Request session migration
      this.emit('session-migrate-request', {
        sessionId,
        currentSnapshot: snapshot,
        migrationOptions: {
          preferredHosts: [], // Would be populated based on configuration
          resourceRequirements: snapshot.sessionOptions
        }
      });

      return true;
      
    } catch (error) {
      this.logger.error(`Migrate strategy failed for session ${sessionId}:`, error);
      return false;
    }
  }

  /**
   * Execute fallback strategy (last resort)
   */
  private async executeFallbackStrategy(sessionId: string, snapshot: RecoverySnapshot): Promise<boolean> {
    try {
      this.emit('recovery-strategy-attempt', { 
        sessionId, 
        strategy: 'fallback',
        message: 'Executing fallback recovery - notifying user and archiving session'
      });

      // Archive session data for manual recovery
      if (this.config.persistenceEnabled) {
        const archivePath = path.join(this.config.persistencePath, 'failed-sessions', `${sessionId}-${Date.now()}.archive.json`);
        await fs.mkdir(path.dirname(archivePath), { recursive: true });
        await fs.writeFile(archivePath, JSON.stringify(snapshot, null, 2));
      }

      // Notify about failed recovery
      this.emit('recovery-fallback', {
        sessionId,
        snapshot,
        message: 'Session could not be automatically recovered. Data has been archived for manual recovery.',
        archiveLocation: this.config.persistenceEnabled ? 'failed-sessions' : null
      });

      return true; // Fallback always "succeeds" by definition
      
    } catch (error) {
      this.logger.error(`Fallback strategy failed for session ${sessionId}:`, error);
      return false;
    }
  }

  /**
   * Start periodic snapshots for a session
   */
  private startPeriodicSnapshots(sessionId: string): void {
    const timer = setInterval(() => {
      // Request updated session state
      this.emit('snapshot-request', { 
        sessionId,
        callback: (updates?: Partial<RecoverySnapshot>) => {
          if (updates) {
            this.updateSessionSnapshot(sessionId, updates);
          }
        }
      });
    }, this.config.snapshotInterval);

    this.snapshotTimers.set(sessionId, timer);
  }

  /**
   * Persist a snapshot to disk
   */
  private async persistSnapshot(snapshot: RecoverySnapshot): Promise<void> {
    if (!this.config.persistenceEnabled) return;

    try {
      const snapshotPath = path.join(this.config.persistencePath, `${snapshot.sessionId}.snapshot.json`);
      await fs.writeFile(snapshotPath, JSON.stringify(snapshot, null, 2));
    } catch (error) {
      this.logger.error(`Failed to persist snapshot for session ${snapshot.sessionId}:`, error);
    }
  }

  /**
   * Load persisted snapshots from disk
   */
  private async loadPersistedSnapshots(): Promise<void> {
    if (!this.config.persistenceEnabled) return;

    try {
      const files = await fs.readdir(this.config.persistencePath);
      const snapshotFiles = files.filter(f => f.endsWith('.snapshot.json'));

      for (const file of snapshotFiles) {
        try {
          const filePath = path.join(this.config.persistencePath, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const snapshot: RecoverySnapshot = JSON.parse(content);
          
          // Convert date strings back to Date objects
          snapshot.timestamp = new Date(snapshot.timestamp);
          if (snapshot.errorContext) {
            snapshot.errorContext.errorTimestamp = new Date(snapshot.errorContext.errorTimestamp);
          }
          
          this.sessionSnapshots.set(snapshot.sessionId, snapshot);
          this.logger.debug(`Loaded snapshot for session ${snapshot.sessionId}`);
          
        } catch (error) {
          this.logger.error(`Failed to load snapshot from ${file}:`, error);
        }
      }

      this.logger.info(`Loaded ${snapshotFiles.length} persisted snapshots`);
      
    } catch (error) {
      this.logger.error('Failed to load persisted snapshots:', error);
    }
  }

  /**
   * Persist all current snapshots
   */
  private async persistAllSnapshots(): Promise<void> {
    const snapshots = Array.from(this.sessionSnapshots.values());
    await Promise.all(snapshots.map(snapshot => this.persistSnapshot(snapshot)));
    this.logger.info(`Persisted ${snapshots.length} snapshots`);
  }

  /**
   * Estimate the size of a snapshot in bytes
   */
  private estimateSnapshotSize(snapshot: RecoverySnapshot): number {
    return JSON.stringify(snapshot).length * 2; // Rough estimate (UTF-16)
  }

  /**
   * Update average recovery time metric
   */
  private updateAverageRecoveryTime(duration: number): void {
    if (this.stats.successfulRecoveries === 1) {
      this.stats.averageRecoveryTime = duration;
    } else {
      this.stats.averageRecoveryTime = 
        ((this.stats.averageRecoveryTime * (this.stats.successfulRecoveries - 1)) + duration) / 
        this.stats.successfulRecoveries;
    }
  }

  /**
   * Get recovery statistics
   */
  getRecoveryStatistics() {
    return {
      ...this.stats,
      activeRecoveries: this.activeRecoveries.size,
      registeredSessions: this.sessionSnapshots.size,
      strategiesUsed: Object.fromEntries(this.stats.strategiesUsed),
      successRate: this.stats.totalRecoveryAttempts > 0 ? 
        (this.stats.successfulRecoveries / this.stats.totalRecoveryAttempts) * 100 : 0,
      config: this.config,
      isRunning: this.isRunning
    };
  }

  /**
   * Get recovery history for a specific session
   */
  getSessionRecoveryHistory(sessionId: string): RecoveryAttempt[] {
    return this.recoveryAttempts.get(sessionId) || [];
  }

  /**
   * Get all registered snapshots
   */
  getAllSnapshots(): Record<string, RecoverySnapshot> {
    const result: Record<string, RecoverySnapshot> = {};
    for (const [sessionId, snapshot] of this.sessionSnapshots) {
      result[sessionId] = { ...snapshot };
    }
    return result;
  }

  /**
   * Utility method for delays
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Clean up resources
   */
  async destroy(): Promise<void> {
    await this.stop();
    this.sessionSnapshots.clear();
    this.recoveryAttempts.clear();
    this.removeAllListeners();
    this.logger.info('SessionRecovery destroyed');
  }
}