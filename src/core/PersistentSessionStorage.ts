import { EventEmitter } from 'events';
import {
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  readdirSync,
  statSync,
} from 'fs';
import { join, dirname } from 'path';
import { Logger } from '../utils/logger.js';
import { ConsoleSession, SessionState } from '../types/index.js';

export interface PersistentSessionData {
  sessionId: string;
  sessionState: SessionState;
  originalSession: ConsoleSession;
  outputHistory: OutputHistoryEntry[];
  connectionState: ConnectionState;
  lastHeartbeat: Date;
  persistedAt: Date;
  metadata: {
    outputLineCount: number;
    sessionAge: number;
    lastActivity: Date;
    reconnectAttempts: number;
    totalUptime: number;
  };
}

export interface OutputHistoryEntry {
  timestamp: Date;
  type: 'stdout' | 'stderr' | 'stdin';
  data: string;
  sequence: number;
  commandId?: string;
}

export interface ConnectionState {
  isConnected: boolean;
  lastConnectionTime?: Date;
  connectionAttempts: number;
  lastError?: string;
  processId?: number;
  workingDirectory: string;
  environment: Record<string, string>;
}

export interface PersistentStorageConfig {
  storageDirectory: string;
  outputHistoryLines: number;
  maxSessionAge: number;
  cleanupPolicy: 'time' | 'size' | 'manual';
  compressionEnabled: boolean;
  encryptionEnabled: boolean;
  backupEnabled: boolean;
  maxStorageSize: number; // in bytes
  syncInterval: number; // milliseconds
}

export interface StorageMetrics {
  totalSessions: number;
  totalStorageSize: number;
  oldestSession: Date | null;
  newestSession: Date | null;
  averageSessionSize: number;
  compressionRatio?: number;
  backupCount: number;
  lastCleanup: Date | null;
}

/**
 * Enhanced Persistent Session Storage System
 * Provides durable storage for session state with configurable retention policies
 */
export class PersistentSessionStorage extends EventEmitter {
  private config: PersistentStorageConfig;
  private logger: Logger;
  private sessions: Map<string, PersistentSessionData> = new Map();
  private syncTimer: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private isInitialized = false;

  // Storage paths
  private sessionsDir: string;
  private backupDir: string;
  private metadataFile: string;

  // Metrics
  private metrics: StorageMetrics = {
    totalSessions: 0,
    totalStorageSize: 0,
    oldestSession: null,
    newestSession: null,
    averageSessionSize: 0,
    backupCount: 0,
    lastCleanup: null,
  };

  constructor(config?: Partial<PersistentStorageConfig>) {
    super();
    this.logger = new Logger('PersistentStorage');

    this.config = {
      storageDirectory:
        config?.storageDirectory || './data/persistent-sessions',
      outputHistoryLines: config?.outputHistoryLines || 1000,
      maxSessionAge: config?.maxSessionAge || 7 * 24 * 60 * 60 * 1000, // 7 days
      cleanupPolicy: config?.cleanupPolicy || 'time',
      compressionEnabled: config?.compressionEnabled ?? false,
      encryptionEnabled: config?.encryptionEnabled ?? false,
      backupEnabled: config?.backupEnabled ?? true,
      maxStorageSize: config?.maxStorageSize || 1024 * 1024 * 1024, // 1GB
      syncInterval: config?.syncInterval || 30000, // 30 seconds
    };

    this.setupStoragePaths();
    this.logger.info(
      'PersistentSessionStorage initialized with config:',
      this.config
    );
  }

  /**
   * Initialize the storage system
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      this.logger.warn('Storage already initialized');
      return;
    }

    try {
      this.createDirectories();
      await this.loadExistingSessions();
      this.startPeriodicSync();
      this.startPeriodicCleanup();
      this.isInitialized = true;

      this.logger.info(
        `Loaded ${this.sessions.size} persistent sessions from storage`
      );
      this.emit('initialized', { sessionCount: this.sessions.size });
    } catch (error) {
      this.logger.error('Failed to initialize storage:', error);
      throw error;
    }
  }

  /**
   * Store a session persistently
   */
  async storeSession(
    sessionId: string,
    sessionState: SessionState,
    originalSession: ConsoleSession,
    outputHistory: OutputHistoryEntry[] = []
  ): Promise<void> {
    try {
      const connectionState: ConnectionState = {
        isConnected: sessionState.status === 'running',
        lastConnectionTime: sessionState.lastActivity,
        connectionAttempts: sessionState.recoveryAttempts || 0,
        processId: originalSession.pid,
        workingDirectory: originalSession.cwd,
        environment: originalSession.env || {},
      };

      // Limit output history to configured size
      const limitedHistory = outputHistory.slice(
        -this.config.outputHistoryLines
      );

      const persistentData: PersistentSessionData = {
        sessionId,
        sessionState: { ...sessionState },
        originalSession: { ...originalSession },
        outputHistory: limitedHistory,
        connectionState,
        lastHeartbeat: new Date(),
        persistedAt: new Date(),
        metadata: {
          outputLineCount: limitedHistory.length,
          sessionAge: Date.now() - sessionState.createdAt.getTime(),
          lastActivity: sessionState.lastActivity || new Date(),
          reconnectAttempts: sessionState.recoveryAttempts || 0,
          totalUptime: this.calculateUptime(sessionState),
        },
      };

      this.sessions.set(sessionId, persistentData);
      await this.persistSessionToDisk(persistentData);
      this.updateMetrics();

      this.emit('session-stored', {
        sessionId,
        size: this.estimateSessionSize(persistentData),
      });
      this.logger.debug(
        `Stored session ${sessionId} with ${limitedHistory.length} history entries`
      );
    } catch (error) {
      this.logger.error(`Failed to store session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Retrieve a persistent session
   */
  async retrieveSession(
    sessionId: string
  ): Promise<PersistentSessionData | null> {
    try {
      let sessionData = this.sessions.get(sessionId);

      if (!sessionData) {
        // Try loading from disk
        sessionData = await this.loadSessionFromDisk(sessionId);
        if (sessionData) {
          this.sessions.set(sessionId, sessionData);
        }
      }

      if (sessionData) {
        // Update last access time
        sessionData.lastHeartbeat = new Date();
        this.emit('session-accessed', { sessionId });
      }

      return sessionData;
    } catch (error) {
      this.logger.error(`Failed to retrieve session ${sessionId}:`, error);
      return null;
    }
  }

  /**
   * Update session heartbeat
   */
  async updateHeartbeat(sessionId: string): Promise<void> {
    const sessionData = this.sessions.get(sessionId);
    if (sessionData) {
      sessionData.lastHeartbeat = new Date();
      sessionData.metadata.lastActivity = new Date();

      // Persist heartbeat update less frequently to reduce I/O
      if (
        Date.now() - sessionData.persistedAt.getTime() >
        this.config.syncInterval
      ) {
        await this.persistSessionToDisk(sessionData);
      }
    }
  }

  /**
   * Add output to session history
   */
  async addOutputToHistory(
    sessionId: string,
    type: 'stdout' | 'stderr' | 'stdin',
    data: string,
    commandId?: string
  ): Promise<void> {
    const sessionData = this.sessions.get(sessionId);
    if (!sessionData) {
      return;
    }

    const entry: OutputHistoryEntry = {
      timestamp: new Date(),
      type,
      data,
      sequence: sessionData.outputHistory.length,
      commandId,
    };

    sessionData.outputHistory.push(entry);
    sessionData.metadata.outputLineCount = sessionData.outputHistory.length;
    sessionData.metadata.lastActivity = new Date();

    // Trim history if it exceeds the limit
    if (sessionData.outputHistory.length > this.config.outputHistoryLines) {
      sessionData.outputHistory = sessionData.outputHistory.slice(
        -this.config.outputHistoryLines
      );
      sessionData.metadata.outputLineCount = sessionData.outputHistory.length;
    }

    this.emit('output-added', { sessionId, type, dataLength: data.length });
  }

  /**
   * Get session history
   */
  getSessionHistory(sessionId: string, lines?: number): OutputHistoryEntry[] {
    const sessionData = this.sessions.get(sessionId);
    if (!sessionData) {
      return [];
    }

    if (lines) {
      return sessionData.outputHistory.slice(-lines);
    }

    return [...sessionData.outputHistory];
  }

  /**
   * List all persistent sessions
   */
  listSessions(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Get all persistent sessions with metadata
   */
  getAllSessionsWithMetadata(): Array<{
    sessionId: string;
    metadata: PersistentSessionData['metadata'];
    lastHeartbeat: Date;
  }> {
    return Array.from(this.sessions.entries()).map(([sessionId, data]) => ({
      sessionId,
      metadata: data.metadata,
      lastHeartbeat: data.lastHeartbeat,
    }));
  }

  /**
   * Remove a session from persistent storage
   */
  async removeSession(sessionId: string): Promise<boolean> {
    try {
      const existed = this.sessions.has(sessionId);
      this.sessions.delete(sessionId);

      // Remove from disk
      const sessionFile = this.getSessionFilePath(sessionId);
      if (existsSync(sessionFile)) {
        unlinkSync(sessionFile);
      }

      if (existed) {
        this.updateMetrics();
        this.emit('session-removed', { sessionId });
        this.logger.debug(
          `Removed session ${sessionId} from persistent storage`
        );
      }

      return existed;
    } catch (error) {
      this.logger.error(`Failed to remove session ${sessionId}:`, error);
      return false;
    }
  }

  /**
   * Perform cleanup based on configured policy
   */
  async performCleanup(): Promise<{ removed: number; sizeSaved: number }> {
    const startTime = Date.now();
    let removedCount = 0;
    let sizeSaved = 0;

    try {
      const sessionsToRemove: string[] = [];
      const now = Date.now();

      for (const [sessionId, data] of this.sessions.entries()) {
        let shouldRemove = false;

        switch (this.config.cleanupPolicy) {
          case 'time':
            const sessionAge = now - data.sessionState.createdAt.getTime();
            const inactiveTime = now - data.lastHeartbeat.getTime();
            shouldRemove =
              sessionAge > this.config.maxSessionAge ||
              inactiveTime > this.config.maxSessionAge / 2;
            break;

          case 'size':
            const totalSize = this.calculateTotalStorageSize();
            if (totalSize > this.config.maxStorageSize) {
              // Remove oldest sessions first
              const sorted = Array.from(this.sessions.entries()).sort(
                ([, a], [, b]) =>
                  a.lastHeartbeat.getTime() - b.lastHeartbeat.getTime()
              );
              const removeCount = Math.ceil(sorted.length * 0.1); // Remove 10%
              if (sorted.findIndex(([id]) => id === sessionId) < removeCount) {
                shouldRemove = true;
              }
            }
            break;

          case 'manual':
          default:
            // No automatic cleanup
            break;
        }

        if (shouldRemove) {
          sessionsToRemove.push(sessionId);
          sizeSaved += this.estimateSessionSize(data);
        }
      }

      // Remove identified sessions
      for (const sessionId of sessionsToRemove) {
        await this.removeSession(sessionId);
        removedCount++;
      }

      this.metrics.lastCleanup = new Date();

      const duration = Date.now() - startTime;
      this.logger.info(
        `Cleanup completed: removed ${removedCount} sessions, saved ${this.formatBytes(sizeSaved)}, took ${duration}ms`
      );

      this.emit('cleanup-completed', {
        removed: removedCount,
        sizeSaved,
        duration,
      });

      return { removed: removedCount, sizeSaved };
    } catch (error) {
      this.logger.error('Cleanup failed:', error);
      throw error;
    }
  }

  /**
   * Get storage metrics
   */
  getMetrics(): StorageMetrics {
    this.updateMetrics();
    return { ...this.metrics };
  }

  /**
   * Create backup of all sessions
   */
  async createBackup(): Promise<string> {
    if (!this.config.backupEnabled) {
      throw new Error('Backups are disabled');
    }

    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFile = join(
        this.backupDir,
        `sessions-backup-${timestamp}.json`
      );

      const backupData = {
        timestamp: new Date(),
        sessions: Object.fromEntries(this.sessions.entries()),
        metrics: this.metrics,
        config: this.config,
      };

      writeFileSync(backupFile, JSON.stringify(backupData, null, 2));
      this.metrics.backupCount++;

      this.logger.info(`Backup created: ${backupFile}`);
      this.emit('backup-created', {
        backupFile,
        sessionCount: this.sessions.size,
      });

      return backupFile;
    } catch (error) {
      this.logger.error('Backup creation failed:', error);
      throw error;
    }
  }

  /**
   * Restore from backup
   */
  async restoreFromBackup(backupFile: string): Promise<number> {
    try {
      const backupData = JSON.parse(readFileSync(backupFile, 'utf-8'));

      // Clear current sessions
      this.sessions.clear();

      // Restore sessions
      for (const [sessionId, data] of Object.entries(backupData.sessions)) {
        this.sessions.set(sessionId, data as PersistentSessionData);
      }

      // Persist all restored sessions
      for (const sessionData of this.sessions.values()) {
        await this.persistSessionToDisk(sessionData);
      }

      this.updateMetrics();
      this.logger.info(
        `Restored ${this.sessions.size} sessions from backup: ${backupFile}`
      );
      this.emit('backup-restored', {
        backupFile,
        sessionCount: this.sessions.size,
      });

      return this.sessions.size;
    } catch (error) {
      this.logger.error(`Backup restoration failed for ${backupFile}:`, error);
      throw error;
    }
  }

  /**
   * Shutdown the storage system
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down persistent storage...');

    // Clear timers
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // Final sync
    await this.syncAllSessions();

    // Create shutdown backup if enabled
    if (this.config.backupEnabled) {
      try {
        await this.createBackup();
      } catch (error) {
        this.logger.error('Failed to create shutdown backup:', error);
      }
    }

    this.isInitialized = false;
    this.emit('shutdown');
    this.logger.info('Persistent storage shutdown complete');
  }

  // Private methods

  private setupStoragePaths(): void {
    this.sessionsDir = join(this.config.storageDirectory, 'sessions');
    this.backupDir = join(this.config.storageDirectory, 'backups');
    this.metadataFile = join(this.config.storageDirectory, 'metadata.json');
  }

  private createDirectories(): void {
    mkdirSync(this.config.storageDirectory, { recursive: true });
    mkdirSync(this.sessionsDir, { recursive: true });

    if (this.config.backupEnabled) {
      mkdirSync(this.backupDir, { recursive: true });
    }
  }

  private async loadExistingSessions(): Promise<void> {
    if (!existsSync(this.sessionsDir)) {
      return;
    }

    const files = readdirSync(this.sessionsDir);
    const sessionFiles = files.filter((f) => f.endsWith('.json'));

    for (const file of sessionFiles) {
      try {
        const sessionId = file.replace('.json', '');
        const sessionData = await this.loadSessionFromDisk(sessionId);

        if (sessionData) {
          // Check if session is still valid
          const sessionAge =
            Date.now() - sessionData.sessionState.createdAt.getTime();
          if (sessionAge <= this.config.maxSessionAge) {
            this.sessions.set(sessionId, sessionData);
          } else {
            // Remove expired session
            const sessionFile = this.getSessionFilePath(sessionId);
            if (existsSync(sessionFile)) {
              unlinkSync(sessionFile);
            }
          }
        }
      } catch (error) {
        this.logger.error(`Failed to load session from ${file}:`, error);
      }
    }
  }

  private async loadSessionFromDisk(
    sessionId: string
  ): Promise<PersistentSessionData | null> {
    const sessionFile = this.getSessionFilePath(sessionId);

    if (!existsSync(sessionFile)) {
      return null;
    }

    try {
      const data = readFileSync(sessionFile, 'utf-8');
      const sessionData: PersistentSessionData = JSON.parse(data);

      // Convert date strings back to Date objects
      sessionData.sessionState.createdAt = new Date(
        sessionData.sessionState.createdAt
      );
      sessionData.sessionState.lastActivity = new Date(
        sessionData.sessionState.lastActivity ||
          sessionData.sessionState.createdAt
      );
      sessionData.lastHeartbeat = new Date(sessionData.lastHeartbeat);
      sessionData.persistedAt = new Date(sessionData.persistedAt);
      sessionData.metadata.lastActivity = new Date(
        sessionData.metadata.lastActivity
      );

      if (sessionData.connectionState.lastConnectionTime) {
        sessionData.connectionState.lastConnectionTime = new Date(
          sessionData.connectionState.lastConnectionTime
        );
      }

      sessionData.outputHistory.forEach((entry) => {
        entry.timestamp = new Date(entry.timestamp);
      });

      return sessionData;
    } catch (error) {
      this.logger.error(`Failed to parse session file ${sessionFile}:`, error);
      return null;
    }
  }

  private async persistSessionToDisk(
    sessionData: PersistentSessionData
  ): Promise<void> {
    const sessionFile = this.getSessionFilePath(sessionData.sessionId);
    sessionData.persistedAt = new Date();

    try {
      const data = JSON.stringify(sessionData, null, 2);
      writeFileSync(sessionFile, data, 'utf-8');
    } catch (error) {
      this.logger.error(
        `Failed to persist session ${sessionData.sessionId}:`,
        error
      );
      throw error;
    }
  }

  private getSessionFilePath(sessionId: string): string {
    return join(this.sessionsDir, `${sessionId}.json`);
  }

  private startPeriodicSync(): void {
    if (this.config.syncInterval <= 0) {
      return;
    }

    this.syncTimer = setInterval(async () => {
      await this.syncAllSessions();
    }, this.config.syncInterval);
  }

  private startPeriodicCleanup(): void {
    // Run cleanup every hour
    this.cleanupTimer = setInterval(
      async () => {
        await this.performCleanup();
      },
      60 * 60 * 1000
    );
  }

  private async syncAllSessions(): Promise<void> {
    try {
      const syncPromises = Array.from(this.sessions.values())
        .filter(
          (data) =>
            Date.now() - data.persistedAt.getTime() > this.config.syncInterval
        )
        .map((data) => this.persistSessionToDisk(data));

      await Promise.all(syncPromises);

      if (syncPromises.length > 0) {
        this.logger.debug(`Synced ${syncPromises.length} sessions to disk`);
      }
    } catch (error) {
      this.logger.error('Session sync failed:', error);
    }
  }

  private updateMetrics(): void {
    this.metrics.totalSessions = this.sessions.size;
    this.metrics.totalStorageSize = this.calculateTotalStorageSize();

    if (this.sessions.size > 0) {
      const sessions = Array.from(this.sessions.values());
      const sessionAges = sessions.map((s) =>
        s.sessionState.createdAt.getTime()
      );

      this.metrics.oldestSession = new Date(Math.min(...sessionAges));
      this.metrics.newestSession = new Date(Math.max(...sessionAges));
      this.metrics.averageSessionSize =
        this.metrics.totalStorageSize / this.sessions.size;
    } else {
      this.metrics.oldestSession = null;
      this.metrics.newestSession = null;
      this.metrics.averageSessionSize = 0;
    }
  }

  private calculateTotalStorageSize(): number {
    return Array.from(this.sessions.values()).reduce(
      (total, data) => total + this.estimateSessionSize(data),
      0
    );
  }

  private estimateSessionSize(sessionData: PersistentSessionData): number {
    return JSON.stringify(sessionData).length * 2; // Rough UTF-16 estimate
  }

  private calculateUptime(sessionState: SessionState): number {
    const now = Date.now();
    const created = sessionState.createdAt.getTime();
    return now - created;
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}
