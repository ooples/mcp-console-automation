import { EventEmitter } from 'events';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { spawn, ChildProcess } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from '../utils/logger.js';
import {
  SessionState,
  SessionManagerConfig,
  SessionManagerStats,
  SessionRecoveryOptions,
  ConsoleSession,
  BackgroundJob,
  BackgroundJobOptions,
  BackgroundJobResult,
  JobMetrics,
} from '../types/index.js';

/**
 * Production-ready Session Manager
 * Tracks all active sessions with persistence, recovery, and monitoring
 */
export class SessionManager extends EventEmitter {
  private sessions: Map<string, SessionState> = new Map();
  private sessionsByType: Map<
    | 'local'
    | 'ssh'
    | 'azure'
    | 'serial'
    | 'kubernetes'
    | 'docker'
    | 'aws-ssm'
    | 'wsl'
    | 'sftp'
    | 'rdp'
    | 'winrm'
    | 'vnc'
    | 'ipc'
    | 'ipmi'
    | 'websocket-terminal',
    Set<string>
  > = new Map();
  private config: SessionManagerConfig;
  private logger: Logger;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private persistenceTimer: NodeJS.Timeout | null = null;

  // Background job management
  private backgroundJobs: Map<string, BackgroundJob> = new Map();
  private jobQueue: BackgroundJob[] = [];
  private activeJobs: Set<string> = new Set();
  private maxConcurrentJobs = 5;
  private outputSequenceCounter = 0;

  private metrics: {
    sessionsCreated: number;
    sessionsDestroyed: number;
    recoveryAttempts: number;
    successfulRecoveries: number;
    failedRecoveries: number;
    heartbeatChecks: number;
    cleanupOperations: number;
    jobsExecuted: number;
    jobsSuccessful: number;
    jobsFailed: number;
  };

  constructor(config: Partial<SessionManagerConfig> = {}) {
    super();

    this.config = {
      maxSessions: config.maxSessions ?? 100,
      sessionTimeout: config.sessionTimeout ?? 24 * 60 * 60 * 1000, // 24 hours
      cleanupInterval: config.cleanupInterval ?? 5 * 60 * 1000, // 5 minutes
      persistenceEnabled: config.persistenceEnabled ?? true,
      persistencePath: config.persistencePath ?? './data/sessions.json',
      recoveryOptions: {
        enableAutoRecovery: config.recoveryOptions?.enableAutoRecovery ?? true,
        maxRecoveryAttempts: config.recoveryOptions?.maxRecoveryAttempts ?? 3,
        recoveryDelay: config.recoveryOptions?.recoveryDelay ?? 5000,
        backoffMultiplier: config.recoveryOptions?.backoffMultiplier ?? 2.0,
        persistSessionData: config.recoveryOptions?.persistSessionData ?? true,
        healthCheckInterval:
          config.recoveryOptions?.healthCheckInterval ?? 30 * 1000,
      },
      enableMetrics: config.enableMetrics ?? true,
      enableLogging: config.enableLogging ?? true,
      heartbeatInterval: config.heartbeatInterval ?? 30 * 1000, // 30 seconds
    };

    this.logger = new Logger('SessionManager');
    this.metrics = {
      sessionsCreated: 0,
      sessionsDestroyed: 0,
      recoveryAttempts: 0,
      successfulRecoveries: 0,
      failedRecoveries: 0,
      heartbeatChecks: 0,
      cleanupOperations: 0,
      jobsExecuted: 0,
      jobsSuccessful: 0,
      jobsFailed: 0,
    };

    // Initialize session type tracking
    this.sessionsByType.set('local', new Set());
    this.sessionsByType.set('ssh', new Set());
    this.sessionsByType.set('azure', new Set());
    this.sessionsByType.set('serial', new Set());
    this.sessionsByType.set('kubernetes', new Set());
    this.sessionsByType.set('docker', new Set());
    this.sessionsByType.set('aws-ssm', new Set());
    this.sessionsByType.set('wsl', new Set());
    this.sessionsByType.set('sftp', new Set());
    this.sessionsByType.set('rdp', new Set());
    this.sessionsByType.set('winrm', new Set());
    this.sessionsByType.set('vnc', new Set());
    this.sessionsByType.set('ipc', new Set());
    this.sessionsByType.set('ipmi', new Set());
    this.sessionsByType.set('websocket-terminal', new Set());

    this.initializePersistence();
    this.startHeartbeat();
    this.startCleanupProcess();

    if (this.config.enableLogging) {
      this.logger.info('SessionManager initialized with config:', this.config);
    }
  }

  /**
   * Register a new session
   */
  async registerSession(
    sessionData: ConsoleSession,
    type:
      | 'local'
      | 'ssh'
      | 'azure'
      | 'serial'
      | 'kubernetes'
      | 'docker'
      | 'aws-ssm'
      | 'wsl'
      | 'sftp'
      | 'rdp'
      | 'winrm'
      | 'vnc'
      | 'ipc'
      | 'ipmi'
      | 'websocket-terminal' = 'local'
  ): Promise<SessionState> {
    if (this.sessions.size >= this.config.maxSessions) {
      throw new Error(
        `Maximum session limit (${this.config.maxSessions}) reached`
      );
    }

    const sessionState: SessionState = {
      id: sessionData.id,
      status: 'initializing',
      type,
      createdAt: sessionData.createdAt,
      lastActivity: new Date(),
      recoveryAttempts: 0,
      maxRecoveryAttempts: this.config.recoveryOptions.maxRecoveryAttempts,
      persistentData: this.config.recoveryOptions.persistSessionData
        ? {
            command: sessionData.command,
            args: sessionData.args,
            cwd: sessionData.cwd,
            env: sessionData.env,
            consoleType: sessionData.type,
            streaming: sessionData.streaming,
          }
        : undefined,
      pid: sessionData.pid,
      healthScore: 100,
      metadata: {
        originalSession: sessionData,
      },
    };

    this.sessions.set(sessionData.id, sessionState);
    this.sessionsByType.get(type)!.add(sessionData.id);
    this.metrics.sessionsCreated++;

    if (this.config.enableLogging) {
      this.logger.info(
        `Registered ${type} session ${sessionData.id}: ${sessionData.command}`
      );
    }

    this.emit('sessionRegistered', {
      sessionId: sessionData.id,
      type,
      sessionState,
    });

    await this.persistSessions();

    return sessionState;
  }

  /**
   * Update session status
   */
  async updateSessionStatus(
    sessionId: string,
    status: SessionState['status'],
    metadata?: Record<string, any>
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const oldStatus = session.status;
    session.status = status;
    session.lastActivity = new Date();

    if (metadata) {
      session.metadata = { ...session.metadata, ...metadata };
    }

    // Update health score based on status
    switch (status) {
      case 'running':
        session.healthScore = Math.min(100, session.healthScore + 5);
        break;
      case 'failed':
        session.healthScore = Math.max(0, session.healthScore - 20);
        break;
      case 'recovering':
        session.healthScore = Math.max(0, session.healthScore - 10);
        break;
    }

    if (this.config.enableLogging && oldStatus !== status) {
      this.logger.info(
        `Session ${sessionId} status changed: ${oldStatus} -> ${status}`
      );
    }

    this.emit('sessionStatusChanged', {
      sessionId,
      oldStatus,
      newStatus: status,
      sessionState: session,
    });

    // Handle session recovery if needed
    if (status === 'failed' && this.config.recoveryOptions.enableAutoRecovery) {
      await this.attemptSessionRecovery(sessionId);
    }

    await this.persistSessions();
  }

  /**
   * Update session activity timestamp
   */
  updateSessionActivity(
    sessionId: string,
    metadata?: Record<string, any>
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    session.lastActivity = new Date();
    session.healthScore = Math.min(100, session.healthScore + 1);

    if (metadata) {
      session.metadata = { ...session.metadata, ...metadata };
    }

    this.emit('sessionActivity', {
      sessionId,
      timestamp: session.lastActivity,
      metadata,
    });
  }

  /**
   * Pause a session
   */
  async pauseSession(sessionId: string): Promise<void> {
    await this.updateSessionStatus(sessionId, 'paused');

    if (this.config.enableLogging) {
      this.logger.info(`Paused session ${sessionId}`);
    }
  }

  /**
   * Resume a paused session
   */
  async resumeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (session.status !== 'paused') {
      throw new Error(
        `Session ${sessionId} is not paused (current status: ${session.status})`
      );
    }

    await this.updateSessionStatus(sessionId, 'running');

    if (this.config.enableLogging) {
      this.logger.info(`Resumed session ${sessionId}`);
    }
  }

  /**
   * Unregister and clean up a session
   */
  async unregisterSession(sessionId: string, reason?: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    // Update status to stopped if not already terminal
    if (!['stopped', 'failed'].includes(session.status)) {
      session.status = 'stopped';
    }

    // Remove from tracking
    this.sessions.delete(sessionId);
    this.sessionsByType.get(session.type)!.delete(sessionId);
    this.metrics.sessionsDestroyed++;

    if (this.config.enableLogging) {
      this.logger.info(
        `Unregistered session ${sessionId}${reason ? `: ${reason}` : ''}`
      );
    }

    this.emit('sessionUnregistered', {
      sessionId,
      type: session.type,
      reason,
      finalStatus: session.status,
    });

    await this.persistSessions();
  }

  /**
   * Get session state
   */
  getSession(sessionId: string): SessionState | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get all sessions
   */
  getAllSessions(): SessionState[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get sessions by status
   */
  getSessionsByStatus(status: SessionState['status']): SessionState[] {
    return Array.from(this.sessions.values()).filter(
      (s) => s.status === status
    );
  }

  /**
   * Get sessions by type
   */
  getSessionsByType(
    type:
      | 'local'
      | 'ssh'
      | 'azure'
      | 'serial'
      | 'kubernetes'
      | 'docker'
      | 'aws-ssm'
      | 'wsl'
      | 'sftp'
      | 'rdp'
      | 'winrm'
      | 'vnc'
      | 'ipc'
      | 'ipmi'
      | 'websocket-terminal'
  ): SessionState[] {
    const sessionIds = this.sessionsByType.get(type) || new Set();
    return Array.from(sessionIds)
      .map((id) => this.sessions.get(id)!)
      .filter(Boolean);
  }

  /**
   * Check if session exists
   */
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Get session manager statistics
   */
  getStats(): SessionManagerStats {
    const sessions = Array.from(this.sessions.values());
    const now = Date.now();

    const sessionsByType: Record<string, number> = {
      local: this.sessionsByType.get('local')!.size,
      ssh: this.sessionsByType.get('ssh')!.size,
    };

    const averageSessionAge =
      sessions.length > 0
        ? sessions.reduce(
            (sum, session) => sum + (now - session.createdAt.getTime()),
            0
          ) / sessions.length
        : 0;

    return {
      totalSessions: sessions.length,
      activeSessions: sessions.filter((s) => s.status === 'running').length,
      pausedSessions: sessions.filter((s) => s.status === 'paused').length,
      failedSessions: sessions.filter((s) => s.status === 'failed').length,
      recoveringSessions: sessions.filter((s) => s.status === 'recovering')
        .length,
      sessionsByType,
      averageSessionAge,
      totalRecoveryAttempts: this.metrics.recoveryAttempts,
      successfulRecoveries: this.metrics.successfulRecoveries,
      failedRecoveries: this.metrics.failedRecoveries,
      lastCleanupAt: new Date(),
    };
  }

  /**
   * Get detailed metrics
   */
  getDetailedMetrics() {
    return {
      ...this.metrics,
      stats: this.getStats(),
      config: this.config,
    };
  }

  /**
   * Perform health check on all sessions
   */
  async performHealthCheck(): Promise<void> {
    const sessions = Array.from(this.sessions.values());
    const now = Date.now();

    if (this.config.enableLogging && sessions.length > 0) {
      this.logger.debug(
        `Performing health check on ${sessions.length} sessions`
      );
    }

    for (const session of sessions) {
      const timeSinceLastActivity = now - session.lastActivity.getTime();

      // Decrease health score for inactive sessions
      if (
        timeSinceLastActivity > this.config.recoveryOptions.healthCheckInterval
      ) {
        session.healthScore = Math.max(0, session.healthScore - 5);
      }

      // Mark sessions as failed if health score is too low
      if (session.healthScore <= 10 && session.status === 'running') {
        await this.updateSessionStatus(session.id, 'failed', {
          failureReason: 'Low health score',
          lastHealthScore: session.healthScore,
        });
      }

      // Check for session timeout
      const sessionAge = now - session.createdAt.getTime();
      if (
        sessionAge > this.config.sessionTimeout &&
        session.status === 'running'
      ) {
        await this.updateSessionStatus(session.id, 'stopped', {
          reason: 'Session timeout',
          sessionAge,
        });
      }
    }

    this.metrics.heartbeatChecks++;
  }

  /**
   * Attempt to recover a failed session
   */
  private async attemptSessionRecovery(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || session.recoveryAttempts >= session.maxRecoveryAttempts) {
      return;
    }

    session.recoveryAttempts++;
    session.status = 'recovering';
    this.metrics.recoveryAttempts++;

    const delay =
      this.config.recoveryOptions.recoveryDelay *
      Math.pow(
        this.config.recoveryOptions.backoffMultiplier,
        session.recoveryAttempts - 1
      );

    if (this.config.enableLogging) {
      this.logger.info(
        `Attempting recovery ${session.recoveryAttempts}/${session.maxRecoveryAttempts} for session ${sessionId} in ${delay}ms`
      );
    }

    setTimeout(async () => {
      try {
        // Emit recovery event for external handlers to implement recovery logic
        this.emit('sessionRecoveryAttempt', {
          sessionId,
          attempt: session.recoveryAttempts,
          maxAttempts: session.maxRecoveryAttempts,
          sessionState: session,
          persistentData: session.persistentData,
        });

        // Recovery success is determined by external handlers updating the session status
        // For now, we'll wait and check if the session was recovered
        setTimeout(
          async () => {
            const currentSession = this.sessions.get(sessionId);
            if (currentSession && currentSession.status === 'recovering') {
              // Recovery failed - session status wasn't updated by external handler
              this.metrics.failedRecoveries++;

              if (
                currentSession.recoveryAttempts >=
                currentSession.maxRecoveryAttempts
              ) {
                await this.updateSessionStatus(sessionId, 'failed', {
                  reason: 'Max recovery attempts exceeded',
                  recoveryAttempts: currentSession.recoveryAttempts,
                });

                if (this.config.enableLogging) {
                  this.logger.warn(
                    `Session ${sessionId} recovery failed after ${currentSession.recoveryAttempts} attempts`
                  );
                }
              } else {
                // Try again
                await this.attemptSessionRecovery(sessionId);
              }
            } else if (currentSession && currentSession.status === 'running') {
              // Recovery succeeded
              this.metrics.successfulRecoveries++;
              currentSession.recoveryAttempts = 0; // Reset on success
              currentSession.healthScore = Math.min(
                100,
                currentSession.healthScore + 20
              );

              if (this.config.enableLogging) {
                this.logger.info(`Session ${sessionId} recovered successfully`);
              }

              this.emit('sessionRecovered', {
                sessionId,
                sessionState: currentSession,
              });
            }
          },
          Math.min(delay, 5000)
        ); // Check recovery status after delay or 5s, whichever is shorter
      } catch (error) {
        this.metrics.failedRecoveries++;

        if (this.config.enableLogging) {
          this.logger.error(`Session recovery error for ${sessionId}:`, error);
        }

        await this.updateSessionStatus(sessionId, 'failed', {
          reason: 'Recovery error',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, delay);
  }

  /**
   * Initialize persistence system
   */
  private initializePersistence(): void {
    if (!this.config.persistenceEnabled || !this.config.persistencePath) {
      return;
    }

    try {
      // Ensure persistence directory exists
      const persistenceDir = dirname(this.config.persistencePath);
      if (!existsSync(persistenceDir)) {
        mkdirSync(persistenceDir, { recursive: true });
      }

      // Load existing sessions
      this.loadSessions();

      // Setup periodic persistence
      this.persistenceTimer = setInterval(async () => {
        await this.persistSessions();
      }, 60000); // Persist every minute
    } catch (error) {
      if (this.config.enableLogging) {
        this.logger.error('Failed to initialize persistence:', error);
      }
    }
  }

  /**
   * Load sessions from persistence
   */
  private loadSessions(): void {
    if (
      !this.config.persistencePath ||
      !existsSync(this.config.persistencePath)
    ) {
      return;
    }

    try {
      const data = readFileSync(this.config.persistencePath, 'utf8');
      const persistedSessions: SessionState[] = JSON.parse(data);

      let loadedCount = 0;
      for (const session of persistedSessions) {
        // Convert date strings back to Date objects
        session.createdAt = new Date(session.createdAt);
        session.lastActivity = new Date(session.lastActivity);

        // Only load sessions that aren't too old
        const sessionAge = Date.now() - session.createdAt.getTime();
        if (sessionAge < this.config.sessionTimeout) {
          // Mark as recovering if it was running when persisted
          if (session.status === 'running') {
            session.status = 'recovering';
            session.recoveryAttempts = 0;
          }

          this.sessions.set(session.id, session);
          this.sessionsByType.get(session.type)!.add(session.id);
          loadedCount++;
        }
      }

      if (this.config.enableLogging && loadedCount > 0) {
        this.logger.info(`Loaded ${loadedCount} sessions from persistence`);
      }
    } catch (error) {
      if (this.config.enableLogging) {
        this.logger.error('Failed to load sessions from persistence:', error);
      }
    }
  }

  /**
   * Persist sessions to storage
   */
  private async persistSessions(): Promise<void> {
    if (!this.config.persistenceEnabled || !this.config.persistencePath) {
      return;
    }

    try {
      const sessions = Array.from(this.sessions.values());
      const data = JSON.stringify(sessions, null, 2);
      writeFileSync(this.config.persistencePath, data, 'utf8');
    } catch (error) {
      if (this.config.enableLogging) {
        this.logger.error('Failed to persist sessions:', error);
      }
    }
  }

  /**
   * Start heartbeat monitoring
   */
  private startHeartbeat(): void {
    if (!this.config.heartbeatInterval || this.config.heartbeatInterval <= 0) {
      return;
    }

    this.heartbeatInterval = setInterval(async () => {
      await this.performHealthCheck();
    }, this.config.heartbeatInterval);
  }

  /**
   * Start cleanup process
   */
  private startCleanupProcess(): void {
    if (!this.config.cleanupInterval || this.config.cleanupInterval <= 0) {
      return;
    }

    this.cleanupInterval = setInterval(async () => {
      await this.performCleanup();
    }, this.config.cleanupInterval);
  }

  /**
   * Perform cleanup of old/stopped sessions
   */
  private async performCleanup(): Promise<void> {
    const sessions = Array.from(this.sessions.values());
    const now = Date.now();
    const sessionsToCleanup: string[] = [];

    for (const session of sessions) {
      const sessionAge = now - session.createdAt.getTime();
      const inactiveTime = now - session.lastActivity.getTime();

      // Clean up sessions that are:
      // 1. Stopped/failed and older than 1 hour
      // 2. Any session older than session timeout
      // 3. Sessions inactive for more than half the session timeout
      const shouldCleanup =
        (['stopped', 'failed'].includes(session.status) &&
          sessionAge > 60 * 60 * 1000) ||
        sessionAge > this.config.sessionTimeout ||
        (inactiveTime > this.config.sessionTimeout / 2 &&
          session.status !== 'running');

      if (shouldCleanup) {
        sessionsToCleanup.push(session.id);
      }
    }

    if (sessionsToCleanup.length > 0) {
      if (this.config.enableLogging) {
        this.logger.info(
          `Cleaning up ${sessionsToCleanup.length} old/inactive sessions`
        );
      }

      for (const sessionId of sessionsToCleanup) {
        await this.unregisterSession(
          sessionId,
          'Cleanup - session expired or inactive'
        );
      }

      this.metrics.cleanupOperations++;
      this.emit('sessionsCleanedUp', { count: sessionsToCleanup.length });
    }
  }

  /**
   * Shutdown the session manager
   */
  async shutdown(): Promise<void> {
    if (this.config.enableLogging) {
      this.logger.info('Shutting down session manager');
    }

    // Clear intervals
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    if (this.persistenceTimer) {
      clearInterval(this.persistenceTimer);
      this.persistenceTimer = null;
    }

    // Final persistence save
    await this.persistSessions();

    this.removeAllListeners();
  }

  // Background Job Management Methods
  async executeBackgroundJob(options: BackgroundJobOptions): Promise<string> {
    const jobId = uuidv4();
    const job: BackgroundJob = {
      id: jobId,
      command: options.command,
      sessionId: options.sessionId,
      args: options.args || [],
      cwd: options.cwd,
      env: options.env,
      timeout: options.timeout || 30000,
      priority: options.priority || 5,
      status: 'pending',
      createdAt: new Date(),
      output: [],
      progress: { current: 0, total: 100, message: 'Initializing...' },
    };

    this.backgroundJobs.set(jobId, job);
    this.jobQueue.push(job);
    this.processJobQueue();

    this.logger.info(`Background job ${jobId} queued`);
    return jobId;
  }

  getJobStatus(jobId: string): BackgroundJob | null {
    return this.backgroundJobs.get(jobId) || null;
  }

  getAllJobs(): BackgroundJob[] {
    return Array.from(this.backgroundJobs.values());
  }

  cancelJob(jobId: string): boolean {
    const job = this.backgroundJobs.get(jobId);
    if (!job) return false;

    if (job.process) {
      job.process.kill();
    }

    job.status = 'cancelled';
    job.finishedAt = new Date();
    this.activeJobs.delete(jobId);

    this.emit('jobCancelled', job);
    return true;
  }

  private async processJobQueue(): Promise<void> {
    if (this.activeJobs.size >= this.maxConcurrentJobs) {
      return;
    }

    // Sort by priority (higher first)
    this.jobQueue.sort((a, b) => (b.priority || 5) - (a.priority || 5));

    const job = this.jobQueue.shift();
    if (!job) return;

    this.activeJobs.add(job.id);
    job.status = 'running';
    job.startedAt = new Date();

    try {
      await this.runJob(job);
      this.metrics.jobsSuccessful++;
    } catch (error) {
      job.error = error instanceof Error ? error.message : String(error);
      job.status = 'failed';
      this.metrics.jobsFailed++;
      this.logger.error(`Job ${job.id} failed:`, error);
    } finally {
      this.activeJobs.delete(job.id);
      this.metrics.jobsExecuted++;
      job.finishedAt = new Date();

      // Continue processing queue
      if (this.jobQueue.length > 0) {
        setImmediate(() => this.processJobQueue());
      }
    }
  }

  private async runJob(job: BackgroundJob): Promise<void> {
    return new Promise((resolve, reject) => {
      const childProcess = spawn(job.command, job.args || [], {
        cwd: job.cwd,
        env: { ...process.env, ...job.env },
        shell: true,
      });

      job.process = childProcess;

      let output = '';

      childProcess.stdout?.on('data', (data) => {
        const text = data.toString();
        output += text;
        job.output.push({
          type: 'stdout',
          data: text,
          timestamp: new Date(),
          sequence: ++this.outputSequenceCounter,
        });
        this.emit('jobOutput', { jobId: job.id, output: text, type: 'stdout' });
      });

      childProcess.stderr?.on('data', (data) => {
        const text = data.toString();
        output += text;
        job.output.push({
          type: 'stderr',
          data: text,
          timestamp: new Date(),
          sequence: ++this.outputSequenceCounter,
        });
        this.emit('jobOutput', { jobId: job.id, output: text, type: 'stderr' });
      });

      childProcess.on('close', (code) => {
        job.exitCode = code;
        job.status = code === 0 ? 'completed' : 'failed';
        job.result = {
          jobId: job.id,
          status: job.status,
          output,
          exitCode: code,
        };

        this.emit('jobCompleted', job);
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Process exited with code ${code}`));
        }
      });

      childProcess.on('error', (error) => {
        job.status = 'failed';
        job.error = error.message;
        this.emit('jobError', { jobId: job.id, error });
        reject(error);
      });

      // Handle timeout
      if (job.timeout > 0) {
        setTimeout(() => {
          if (job.status === 'running') {
            childProcess.kill();
            job.status = 'failed';
            job.error = 'Timeout';
            reject(new Error('Job timeout'));
          }
        }, job.timeout);
      }
    });
  }

  getJobMetrics(): JobMetrics {
    const jobs = Array.from(this.backgroundJobs.values());
    const completedJobs = jobs.filter((j) => j.status === 'completed');
    const totalExecutionTime = completedJobs.reduce((sum, job) => {
      if (job.startedAt && job.finishedAt) {
        return sum + (job.finishedAt.getTime() - job.startedAt.getTime());
      }
      return sum;
    }, 0);

    const jobsByStatus: Record<string, number> = {};
    const jobsBySession: Record<string, number> = {};

    jobs.forEach((job) => {
      jobsByStatus[job.status] = (jobsByStatus[job.status] || 0) + 1;
      if (job.sessionId) {
        jobsBySession[job.sessionId] = (jobsBySession[job.sessionId] || 0) + 1;
      }
    });

    return {
      totalJobs: this.backgroundJobs.size,
      runningJobs: this.activeJobs.size,
      completedJobs: completedJobs.length,
      failedJobs: jobs.filter((j) => j.status === 'failed').length,
      averageExecutionTime:
        completedJobs.length > 0
          ? totalExecutionTime / completedJobs.length
          : 0,
      queueSize: this.jobQueue.length,
      jobsByStatus,
      jobsBySession,
    };
  }

  getJobOutput(jobId: string, latest?: boolean): any {
    const job = this.backgroundJobs.get(jobId);
    if (!job) return null;

    if (latest && job.output.length > 0) {
      return job.output[job.output.length - 1];
    }
    return job.output;
  }

  getJobProgress(jobId: string): any {
    const job = this.backgroundJobs.get(jobId);
    return job?.progress || null;
  }

  getJobResult(jobId: string): BackgroundJobResult | null {
    const job = this.backgroundJobs.get(jobId);
    return job?.result || null;
  }

  listJobs(sessionId?: string): BackgroundJob[] {
    const jobs = Array.from(this.backgroundJobs.values());
    if (sessionId) {
      return jobs.filter((job) => job.sessionId === sessionId);
    }
    return jobs;
  }

  cleanupCompletedJobs(olderThan?: Date): number {
    const cutoff = olderThan || new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
    let cleanedCount = 0;

    const entries = Array.from(this.backgroundJobs.entries());
    for (const [jobId, job] of entries) {
      if (
        (job.status === 'completed' ||
          job.status === 'failed' ||
          job.status === 'cancelled') &&
        job.finishedAt &&
        job.finishedAt < cutoff
      ) {
        this.backgroundJobs.delete(jobId);
        cleanedCount++;
      }
    }

    return cleanedCount;
  }

  getMetrics(): any {
    return {
      ...this.metrics,
      jobs: this.getJobMetrics(),
    };
  }

  destroy(): void {
    // Cancel all running jobs
    const jobs = Array.from(this.backgroundJobs.values());
    for (const job of jobs) {
      if (job.status === 'running' && job.process) {
        job.process.kill();
      }
    }

    this.backgroundJobs.clear();
    this.jobQueue.length = 0;
    this.activeJobs.clear();
  }
}
