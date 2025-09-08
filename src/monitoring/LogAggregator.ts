import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { Transform, Writable } from 'stream';
import { createHash } from 'crypto';
import { LogEntry } from '../types/index.js';
import { Logger } from '../utils/logger.js';
import Redis from 'ioredis';
import { InfluxDB, Point, WriteApi } from '@influxdata/influxdb-client';

interface LogAggregatorConfig {
  enabled: boolean;
  sources: LogSource[];
  storage: {
    type: 'file' | 'redis' | 'influxdb' | 'elasticsearch';
    config: Record<string, any>;
  };
  parsing: {
    patterns: LogPattern[];
    enableStructuredParsing: boolean;
    enableGrokParsing: boolean;
  };
  filtering: {
    levels: string[];
    sources: string[];
    includePatterns: RegExp[];
    excludePatterns: RegExp[];
  };
  indexing: {
    enabled: boolean;
    fields: string[];
    fullTextSearch: boolean;
  };
  retention: {
    days: number;
    maxEntriesPerSource: number;
    compressionEnabled: boolean;
  };
  alerting: {
    errorThreshold: number;
    warningThreshold: number;
    patternAlerts: PatternAlert[];
  };
}

interface LogSource {
  id: string;
  name: string;
  type: 'file' | 'stream' | 'syslog' | 'journald' | 'eventlog';
  config: Record<string, any>;
  enabled: boolean;
  parser?: string;
  tags: Record<string, string>;
}

interface LogPattern {
  name: string;
  pattern: RegExp;
  fields: string[];
  transform?: (match: RegExpMatchArray) => Record<string, any>;
}

interface PatternAlert {
  name: string;
  pattern: RegExp;
  threshold: number;
  timeWindow: number; // minutes
  severity: 'low' | 'medium' | 'high' | 'critical';
}

interface LogIndex {
  timestamp: Date;
  level: string;
  source: string;
  message: string;
  fields: Record<string, any>;
  hash: string;
}

export class LogAggregator extends EventEmitter {
  private logger: Logger;
  private config: LogAggregatorConfig;
  private logEntries: Map<string, LogEntry[]> = new Map(); // source -> entries
  private logIndex: Map<string, LogIndex> = new Map(); // hash -> index
  private sources: Map<string, LogSource> = new Map();
  private isRunning: boolean = false;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private alertCounters: Map<string, { count: number; windowStart: Date }> = new Map();

  // Storage backends
  private redisClient?: Redis;
  private influxDB?: InfluxDB;
  private influxWriter?: WriteApi;

  // Stream processors
  private logStreams: Map<string, Transform> = new Map();

  constructor(config?: Partial<LogAggregatorConfig>) {
    super();
    this.logger = new Logger('LogAggregator');
    
    this.config = {
      enabled: true,
      sources: [],
      storage: {
        type: 'file',
        config: {
          directory: './logs',
          rotateDaily: true,
          maxFileSizeMB: 100
        }
      },
      parsing: {
        patterns: [],
        enableStructuredParsing: true,
        enableGrokParsing: false
      },
      filtering: {
        levels: ['info', 'warn', 'error', 'fatal'],
        sources: [],
        includePatterns: [],
        excludePatterns: []
      },
      indexing: {
        enabled: true,
        fields: ['timestamp', 'level', 'source', 'message', 'sessionId', 'userId'],
        fullTextSearch: true
      },
      retention: {
        days: 30,
        maxEntriesPerSource: 100000,
        compressionEnabled: true
      },
      alerting: {
        errorThreshold: 10, // errors per minute
        warningThreshold: 50, // warnings per minute
        patternAlerts: []
      },
      ...config
    };

    this.setupDefaultPatterns();
  }

  // Initialize the log aggregator
  async initialize(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.info('Log aggregation is disabled');
      return;
    }

    try {
      // Initialize storage backend
      await this.initializeStorage();

      // Setup default log sources
      this.setupDefaultSources();

      // Start log processing
      await this.startLogProcessing();

      // Start cleanup timer
      this.startCleanupTimer();

      this.logger.info('Log aggregator initialized');
    } catch (error) {
      this.logger.error(`Failed to initialize log aggregator: ${error}`);
      throw error;
    }
  }

  // Initialize storage backend
  private async initializeStorage(): Promise<void> {
    switch (this.config.storage.type) {
      case 'redis':
        this.redisClient = new Redis(this.config.storage.config);
        await this.redisClient.ping();
        this.logger.info('Connected to Redis for log storage');
        break;

      case 'influxdb':
        const { url, token, org, bucket } = this.config.storage.config;
        this.influxDB = new InfluxDB({ url, token });
        this.influxWriter = this.influxDB.getWriteApi(org, bucket);
        this.logger.info('Connected to InfluxDB for log storage');
        break;

      case 'file':
        const logDir = this.config.storage.config.directory || './logs';
        await fs.mkdir(logDir, { recursive: true });
        this.logger.info(`Using file storage in directory: ${logDir}`);
        break;

      default:
        this.logger.warn(`Unknown storage type: ${this.config.storage.type}`);
    }
  }

  // Setup default log parsing patterns
  private setupDefaultPatterns(): void {
    const commonPatterns: LogPattern[] = [
      // Standard log format: [timestamp] [level] message
      {
        name: 'standard',
        pattern: /^\[([^\]]+)\]\s*\[([^\]]+)\]\s*(.+)$/,
        fields: ['timestamp', 'level', 'message'],
        transform: (match) => ({
          timestamp: new Date(match[1]),
          level: match[2].toLowerCase(),
          message: match[3]
        })
      },
      
      // JSON log format
      {
        name: 'json',
        pattern: /^{.+}$/,
        fields: ['*'],
        transform: (match) => {
          try {
            return JSON.parse(match[0]);
          } catch {
            return { message: match[0] };
          }
        }
      },

      // Syslog format
      {
        name: 'syslog',
        pattern: /^([A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+([^\s]+)\s+([^:\s]+):\s*(.+)$/,
        fields: ['timestamp', 'hostname', 'process', 'message'],
        transform: (match) => ({
          timestamp: new Date(match[1]),
          hostname: match[2],
          process: match[3],
          message: match[4]
        })
      },

      // Error stack trace pattern
      {
        name: 'error-stack',
        pattern: /^(\w+Error): (.+)\n\s+at (.+)/m,
        fields: ['errorType', 'errorMessage', 'stackTrace'],
        transform: (match) => ({
          level: 'error',
          errorType: match[1],
          message: `${match[1]}: ${match[2]}`,
          stackTrace: match[3]
        })
      },

      // HTTP access log pattern
      {
        name: 'http-access',
        pattern: /^([^\s]+)\s+[^\s]+\s+[^\s]+\s+\[([^\]]+)\]\s+"([^"]+)"\s+(\d+)\s+(\d+|-)\s*"([^"]*)"?\s*"([^"]*)"?/,
        fields: ['ip', 'timestamp', 'request', 'status', 'size', 'referer', 'userAgent'],
        transform: (match) => ({
          clientIP: match[1],
          timestamp: new Date(match[2]),
          request: match[3],
          statusCode: parseInt(match[4]),
          responseSize: match[5] === '-' ? 0 : parseInt(match[5]),
          referer: match[6],
          userAgent: match[7]
        })
      }
    ];

    this.config.parsing.patterns = [...commonPatterns, ...this.config.parsing.patterns];
  }

  // Setup default log sources
  private setupDefaultSources(): void {
    const defaultSources: LogSource[] = [
      {
        id: 'console-manager',
        name: 'Console Manager',
        type: 'stream',
        config: {},
        enabled: true,
        tags: { component: 'console-manager' }
      },
      {
        id: 'mcp-server',
        name: 'MCP Server',
        type: 'stream',
        config: {},
        enabled: true,
        tags: { component: 'mcp-server' }
      },
      {
        id: 'system-logs',
        name: 'System Logs',
        type: 'file',
        config: {
          path: process.platform === 'win32' ? 
            'C:\\Windows\\System32\\winevt\\Logs\\System.evtx' :
            '/var/log/syslog'
        },
        enabled: true,
        tags: { component: 'system' }
      }
    ];

    defaultSources.forEach(source => {
      this.sources.set(source.id, source);
    });
  }

  // Start log processing
  private async startLogProcessing(): Promise<void> {
    this.isRunning = true;

    // Process each configured log source
    for (const [sourceId, source] of this.sources) {
      if (source.enabled) {
        await this.startSourceProcessing(sourceId, source);
      }
    }

    this.logger.info('Started log processing for all sources');
  }

  // Start processing a specific log source
  private async startSourceProcessing(sourceId: string, source: LogSource): Promise<void> {
    try {
      switch (source.type) {
        case 'file':
          await this.startFileProcessing(sourceId, source);
          break;
        case 'stream':
          await this.startStreamProcessing(sourceId, source);
          break;
        case 'syslog':
          await this.startSyslogProcessing(sourceId, source);
          break;
        default:
          this.logger.warn(`Unsupported log source type: ${source.type}`);
      }
    } catch (error) {
      this.logger.error(`Failed to start processing for source ${sourceId}: ${error}`);
    }
  }

  // Start file-based log processing
  private async startFileProcessing(sourceId: string, source: LogSource): Promise<void> {
    // This would implement file watching and processing
    this.logger.info(`Started file processing for source: ${sourceId}`);
  }

  // Start stream-based log processing
  private async startStreamProcessing(sourceId: string, source: LogSource): Promise<void> {
    const logStream = new Transform({
      objectMode: true,
      transform: (chunk, encoding, callback) => {
        const logLine = chunk.toString();
        this.processLogLine(sourceId, logLine, source.tags);
        callback();
      }
    });

    this.logStreams.set(sourceId, logStream);
    this.logger.info(`Started stream processing for source: ${sourceId}`);
  }

  // Start syslog processing
  private async startSyslogProcessing(sourceId: string, source: LogSource): Promise<void> {
    // This would implement syslog server/client functionality
    this.logger.info(`Started syslog processing for source: ${sourceId}`);
  }

  // Process a single log line
  private async processLogLine(sourceId: string, line: string, tags: Record<string, string> = {}): Promise<void> {
    try {
      // Skip empty lines
      if (!line.trim()) {
        return;
      }

      // Parse the log line
      const parsedLog = this.parseLogLine(line);
      if (!parsedLog) {
        return;
      }

      // Create log entry
      const logEntry: LogEntry = {
        timestamp: parsedLog.timestamp || new Date(),
        level: parsedLog.level || 'info',
        message: parsedLog.message || line,
        source: sourceId,
        metadata: {
          ...parsedLog,
          ...tags,
          raw: line
        }
      };

      // Apply filters
      if (!this.shouldProcessLog(logEntry)) {
        return;
      }

      // Store the log entry
      await this.storeLogEntry(logEntry);

      // Update index if enabled
      if (this.config.indexing.enabled) {
        this.updateLogIndex(logEntry);
      }

      // Check for pattern alerts
      this.checkPatternAlerts(logEntry);

      // Emit event
      this.emit('log-entry', logEntry);

    } catch (error) {
      this.logger.error(`Failed to process log line from ${sourceId}: ${error}`);
    }
  }

  // Parse a log line using configured patterns
  private parseLogLine(line: string): Record<string, any> | null {
    // Try JSON parsing first if enabled
    if (this.config.parsing.enableStructuredParsing) {
      try {
        const parsed = JSON.parse(line);
        if (typeof parsed === 'object' && parsed !== null) {
          return parsed;
        }
      } catch {
        // Not JSON, continue with pattern matching
      }
    }

    // Try pattern matching
    for (const pattern of this.config.parsing.patterns) {
      const match = line.match(pattern.pattern);
      if (match) {
        if (pattern.transform) {
          return pattern.transform(match);
        } else {
          // Default mapping based on field names
          const result: Record<string, any> = {};
          pattern.fields.forEach((field, index) => {
            if (field !== '*' && match[index + 1] !== undefined) {
              result[field] = match[index + 1];
            }
          });
          return result;
        }
      }
    }

    // Return basic structure if no patterns match
    return {
      message: line,
      timestamp: new Date()
    };
  }

  // Check if log should be processed based on filters
  private shouldProcessLog(logEntry: LogEntry): boolean {
    // Level filter
    if (this.config.filtering.levels.length > 0 && 
        !this.config.filtering.levels.includes(logEntry.level)) {
      return false;
    }

    // Source filter
    if (this.config.filtering.sources.length > 0 && 
        !this.config.filtering.sources.includes(logEntry.source)) {
      return false;
    }

    // Include patterns
    if (this.config.filtering.includePatterns.length > 0) {
      const matchesInclude = this.config.filtering.includePatterns.some(pattern =>
        pattern.test(logEntry.message)
      );
      if (!matchesInclude) {
        return false;
      }
    }

    // Exclude patterns
    if (this.config.filtering.excludePatterns.length > 0) {
      const matchesExclude = this.config.filtering.excludePatterns.some(pattern =>
        pattern.test(logEntry.message)
      );
      if (matchesExclude) {
        return false;
      }
    }

    return true;
  }

  // Store log entry in configured backend
  private async storeLogEntry(logEntry: LogEntry): Promise<void> {
    switch (this.config.storage.type) {
      case 'redis':
        await this.storeInRedis(logEntry);
        break;
      case 'influxdb':
        await this.storeInInfluxDB(logEntry);
        break;
      case 'file':
        await this.storeInFile(logEntry);
        break;
      default:
        // Store in memory as fallback
        this.storeInMemory(logEntry);
    }
  }

  // Store in Redis
  private async storeInRedis(logEntry: LogEntry): Promise<void> {
    if (!this.redisClient) return;

    const key = `logs:${logEntry.source}`;
    const score = logEntry.timestamp.getTime();
    const value = JSON.stringify(logEntry);

    await this.redisClient.zadd(key, score, value);
    
    // Cleanup old entries to maintain size limits
    const maxEntries = this.config.retention.maxEntriesPerSource;
    await this.redisClient.zremrangebyrank(key, 0, -(maxEntries + 1));
  }

  // Store in InfluxDB
  private async storeInInfluxDB(logEntry: LogEntry): Promise<void> {
    if (!this.influxWriter) return;

    const point = new Point('log_entry')
      .timestamp(logEntry.timestamp)
      .tag('source', logEntry.source)
      .tag('level', logEntry.level)
      .stringField('message', logEntry.message);

    // Add metadata as fields
    if (logEntry.metadata) {
      Object.entries(logEntry.metadata).forEach(([key, value]) => {
        if (typeof value === 'string') {
          point.stringField(key, value);
        } else if (typeof value === 'number') {
          point.floatField(key, value);
        } else if (typeof value === 'boolean') {
          point.booleanField(key, value);
        }
      });
    }

    this.influxWriter.writePoint(point);
  }

  // Store in file
  private async storeInFile(logEntry: LogEntry): Promise<void> {
    const logDir = this.config.storage.config.directory || './logs';
    const dateStr = logEntry.timestamp.toISOString().split('T')[0];
    const filename = `${logEntry.source}-${dateStr}.log`;
    const filepath = join(logDir, filename);

    const logLine = JSON.stringify(logEntry) + '\n';
    await fs.appendFile(filepath, logLine, 'utf8');
  }

  // Store in memory (fallback)
  private storeInMemory(logEntry: LogEntry): void {
    const sourceEntries = this.logEntries.get(logEntry.source) || [];
    sourceEntries.push(logEntry);

    // Maintain size limits
    const maxEntries = this.config.retention.maxEntriesPerSource;
    if (sourceEntries.length > maxEntries) {
      sourceEntries.splice(0, sourceEntries.length - maxEntries);
    }

    this.logEntries.set(logEntry.source, sourceEntries);
  }

  // Update log index for searching
  private updateLogIndex(logEntry: LogEntry): void {
    const hash = createHash('sha256')
      .update(`${logEntry.source}:${logEntry.timestamp.getTime()}:${logEntry.message}`)
      .digest('hex');

    const indexEntry: LogIndex = {
      timestamp: logEntry.timestamp,
      level: logEntry.level,
      source: logEntry.source,
      message: logEntry.message,
      fields: logEntry.metadata || {},
      hash
    };

    this.logIndex.set(hash, indexEntry);
  }

  // Check for pattern-based alerts
  private checkPatternAlerts(logEntry: LogEntry): void {
    this.config.alerting.patternAlerts.forEach(alert => {
      if (alert.pattern.test(logEntry.message)) {
        const now = new Date();
        const key = `alert:${alert.name}`;
        const counter = this.alertCounters.get(key);

        if (!counter || now.getTime() - counter.windowStart.getTime() > alert.timeWindow * 60 * 1000) {
          // Start new time window
          this.alertCounters.set(key, { count: 1, windowStart: now });
        } else {
          // Increment counter in current window
          counter.count++;
          
          if (counter.count >= alert.threshold) {
            this.emit('pattern-alert', {
              name: alert.name,
              count: counter.count,
              threshold: alert.threshold,
              severity: alert.severity,
              timeWindow: alert.timeWindow,
              triggeringEntry: logEntry
            });
            
            // Reset counter to avoid spam
            this.alertCounters.delete(key);
          }
        }
      }
    });
  }

  // Search logs
  async searchLogs(query: {
    sources?: string[];
    levels?: string[];
    startTime?: Date;
    endTime?: Date;
    text?: string;
    fields?: Record<string, any>;
    limit?: number;
    offset?: number;
  }): Promise<LogEntry[]> {
    let results: LogEntry[] = [];

    if (this.config.storage.type === 'redis' && this.redisClient) {
      results = await this.searchInRedis(query);
    } else if (this.config.storage.type === 'influxdb' && this.influxDB) {
      results = await this.searchInInfluxDB(query);
    } else {
      results = await this.searchInMemory(query);
    }

    return results;
  }

  // Search in Redis
  private async searchInRedis(query: any): Promise<LogEntry[]> {
    if (!this.redisClient) return [];

    const results: LogEntry[] = [];
    const sources = query.sources || Array.from(this.sources.keys());

    for (const source of sources) {
      const key = `logs:${source}`;
      const startScore = query.startTime?.getTime() || 0;
      const endScore = query.endTime?.getTime() || Date.now();

      const entries = await this.redisClient.zrangebyscore(
        key, 
        startScore, 
        endScore,
        'LIMIT',
        query.offset || 0,
        query.limit || 100
      );

      for (const entry of entries) {
        try {
          const logEntry = JSON.parse(entry) as LogEntry;
          if (this.matchesQuery(logEntry, query)) {
            results.push(logEntry);
          }
        } catch (error) {
          this.logger.error(`Failed to parse log entry: ${error}`);
        }
      }
    }

    return results.slice(0, query.limit || 100);
  }

  // Search in InfluxDB
  private async searchInInfluxDB(query: any): Promise<LogEntry[]> {
    // Implementation would use InfluxDB query language
    this.logger.debug('InfluxDB search not implemented');
    return [];
  }

  // Search in memory
  private async searchInMemory(query: any): Promise<LogEntry[]> {
    let results: LogEntry[] = [];

    // Get entries from all sources or specified sources
    const sources = query.sources || Array.from(this.logEntries.keys());
    
    for (const source of sources) {
      const entries = this.logEntries.get(source) || [];
      results.push(...entries);
    }

    // Apply filters
    results = results.filter(entry => this.matchesQuery(entry, query));

    // Sort by timestamp
    results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Apply pagination
    const offset = query.offset || 0;
    const limit = query.limit || 100;
    return results.slice(offset, offset + limit);
  }

  // Check if log entry matches query
  private matchesQuery(entry: LogEntry, query: any): boolean {
    // Level filter
    if (query.levels && !query.levels.includes(entry.level)) {
      return false;
    }

    // Time range filter
    if (query.startTime && entry.timestamp < query.startTime) {
      return false;
    }
    if (query.endTime && entry.timestamp > query.endTime) {
      return false;
    }

    // Text search
    if (query.text) {
      const searchText = query.text.toLowerCase();
      if (!entry.message.toLowerCase().includes(searchText)) {
        return false;
      }
    }

    // Field filters
    if (query.fields) {
      for (const [key, value] of Object.entries(query.fields)) {
        const entryValue = entry.metadata?.[key];
        if (entryValue !== value) {
          return false;
        }
      }
    }

    return true;
  }

  // Add log source
  addLogSource(source: LogSource): void {
    this.sources.set(source.id, source);
    
    if (this.isRunning && source.enabled) {
      this.startSourceProcessing(source.id, source);
    }

    this.logger.info(`Added log source: ${source.name}`);
  }

  // Remove log source
  removeLogSource(sourceId: string): void {
    const source = this.sources.get(sourceId);
    if (source) {
      this.sources.delete(sourceId);
      
      // Stop processing stream if exists
      const stream = this.logStreams.get(sourceId);
      if (stream) {
        stream.destroy();
        this.logStreams.delete(sourceId);
      }

      this.logger.info(`Removed log source: ${source.name}`);
    }
  }

  // Add log entry programmatically
  async addLogEntry(entry: Partial<LogEntry>): Promise<void> {
    const logEntry: LogEntry = {
      timestamp: new Date(),
      level: 'info',
      message: '',
      source: 'manual',
      ...entry
    };

    await this.processLogLine(logEntry.source, logEntry.message, logEntry.metadata);
  }

  // Get aggregated statistics
  getStats(): {
    sources: number;
    totalEntries: number;
    entriesByLevel: Record<string, number>;
    entriesBySource: Record<string, number>;
    storage: string;
    isRunning: boolean;
  } {
    const entriesByLevel: Record<string, number> = {};
    const entriesBySource: Record<string, number> = {};
    let totalEntries = 0;

    // Count entries from memory storage
    for (const [source, entries] of this.logEntries) {
      entriesBySource[source] = entries.length;
      totalEntries += entries.length;

      entries.forEach(entry => {
        entriesByLevel[entry.level] = (entriesByLevel[entry.level] || 0) + 1;
      });
    }

    return {
      sources: this.sources.size,
      totalEntries,
      entriesByLevel,
      entriesBySource,
      storage: this.config.storage.type,
      isRunning: this.isRunning
    };
  }

  // Start cleanup timer
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupOldEntries();
    }, 60 * 60 * 1000); // Cleanup every hour
  }

  // Cleanup old entries
  private cleanupOldEntries(): void {
    const cutoffTime = new Date(Date.now() - this.config.retention.days * 24 * 60 * 60 * 1000);

    // Cleanup memory storage
    for (const [source, entries] of this.logEntries) {
      const filteredEntries = entries.filter(entry => entry.timestamp > cutoffTime);
      this.logEntries.set(source, filteredEntries);
    }

    // Cleanup index
    for (const [hash, indexEntry] of this.logIndex) {
      if (indexEntry.timestamp < cutoffTime) {
        this.logIndex.delete(hash);
      }
    }

    this.logger.debug('Cleaned up old log entries');
  }

  // Stop log aggregation
  stop(): void {
    this.isRunning = false;

    // Stop cleanup timer
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // Close storage connections
    if (this.redisClient) {
      this.redisClient.disconnect();
    }

    if (this.influxWriter) {
      this.influxWriter.close();
    }

    // Close log streams
    this.logStreams.forEach(stream => stream.destroy());
    this.logStreams.clear();

    this.logger.info('Log aggregator stopped');
  }

  destroy(): void {
    this.stop();
    this.logEntries.clear();
    this.logIndex.clear();
    this.sources.clear();
    this.alertCounters.clear();
    this.removeAllListeners();
  }
}