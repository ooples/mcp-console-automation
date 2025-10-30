import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  createHash,
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'crypto';
import { AuditEvent, ComplianceInfo, LogEntry } from '../types/index.js';
import { Logger } from '../utils/logger.js';

interface AuditConfig {
  enabled: boolean;
  logDirectory: string;
  encryption: {
    enabled: boolean;
    algorithm: string;
    key: string;
  };
  retention: {
    days: number;
    maxFileSizeMB: number;
    compressionEnabled: boolean;
  };
  compliance: {
    standards: string[];
    classification: 'public' | 'internal' | 'confidential' | 'restricted';
    requireDigitalSignature: boolean;
    immutableStorage: boolean;
  };
  filtering: {
    includeEvents: string[];
    excludeEvents: string[];
    sensitiveFields: string[];
  };
}

interface AuditLogFile {
  filename: string;
  path: string;
  startDate: Date;
  endDate: Date;
  eventCount: number;
  sizeMB: number;
  checksum: string;
  encrypted: boolean;
  compressed: boolean;
}

export class AuditLogger extends EventEmitter {
  private logger: Logger;
  private config: AuditConfig;
  private currentLogFile: string | null = null;
  private currentEventCount: number = 0;
  private auditEvents: Map<string, AuditEvent> = new Map();
  private logFiles: Map<string, AuditLogFile> = new Map();
  private rotationTimer: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(config?: Partial<AuditConfig>) {
    super();
    this.logger = new Logger('AuditLogger');

    this.config = {
      enabled: true,
      logDirectory: './logs/audit',
      encryption: {
        enabled: false,
        algorithm: 'aes-256-cbc',
        key: process.env.AUDIT_ENCRYPTION_KEY || 'default-key-change-me',
      },
      retention: {
        days: 365, // 1 year retention for compliance
        maxFileSizeMB: 100,
        compressionEnabled: true,
      },
      compliance: {
        standards: ['SOX', 'GDPR', 'HIPAA'],
        classification: 'internal',
        requireDigitalSignature: false,
        immutableStorage: true,
      },
      filtering: {
        includeEvents: [], // Empty means include all
        excludeEvents: [],
        sensitiveFields: ['password', 'token', 'key', 'secret'],
      },
      ...config,
    };
  }

  async initialize(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.info('Audit logging is disabled');
      return;
    }

    try {
      // Create log directory if it doesn't exist
      await fs.mkdir(this.config.logDirectory, { recursive: true });

      // Initialize current log file
      await this.rotateLogFile();

      // Start automatic rotation and cleanup timers
      this.startTimers();

      this.logger.info('Audit logger initialized');
    } catch (error) {
      this.logger.error(`Failed to initialize audit logger: ${error}`);
      throw error;
    }
  }

  // Log an audit event
  async logEvent(event: Partial<AuditEvent>): Promise<void> {
    if (!this.config.enabled || !this.currentLogFile) {
      return;
    }

    try {
      // Filter events if configured
      if (this.shouldFilterEvent(event.eventType || '')) {
        return;
      }

      const auditEvent: AuditEvent = {
        timestamp: new Date(),
        eventType: 'session_created',
        details: {},
        riskLevel: 'low',
        ...event,
        compliance: this.generateComplianceInfo(),
      };

      // Add unique ID
      const eventId = uuidv4();

      // Sanitize sensitive fields
      auditEvent.details = this.sanitizeSensitiveFields(auditEvent.details);

      // Store in memory map
      this.auditEvents.set(eventId, auditEvent);

      // Write to file
      await this.writeEventToFile(auditEvent);

      this.currentEventCount++;
      this.emit('audit-event-logged', auditEvent);

      // Check if log rotation is needed
      if (await this.shouldRotateLogFile()) {
        await this.rotateLogFile();
      }
    } catch (error) {
      this.logger.error(`Failed to log audit event: ${error}`);
    }
  }

  // Log session creation
  async logSessionCreation(
    sessionId: string,
    command: string,
    userId?: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    await this.logEvent({
      eventType: 'session_created',
      sessionId,
      userId,
      details: {
        command,
        ...metadata,
      },
      riskLevel: this.assessRiskLevel(command, metadata),
    });
  }

  // Log session termination
  async logSessionTermination(
    sessionId: string,
    exitCode?: number,
    userId?: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    await this.logEvent({
      eventType: 'session_stopped',
      sessionId,
      userId,
      details: {
        exitCode,
        ...metadata,
      },
      riskLevel: exitCode === 0 ? 'low' : 'medium',
    });
  }

  // Log command execution
  async logCommandExecution(
    sessionId: string,
    command: string,
    args: string[],
    userId?: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    await this.logEvent({
      eventType: 'command_executed',
      sessionId,
      userId,
      details: {
        command,
        args,
        ...metadata,
      },
      riskLevel: this.assessCommandRisk(command, args),
    });
  }

  // Log error detection
  async logErrorDetection(
    sessionId: string,
    errors: any[],
    userId?: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    await this.logEvent({
      eventType: 'error_detected',
      sessionId,
      userId,
      details: {
        errorCount: errors.length,
        errors: errors.slice(0, 10), // Limit to first 10 errors
        ...metadata,
      },
      riskLevel: errors.length > 5 ? 'high' : 'medium',
    });
  }

  // Log SLA breach
  async logSLABreach(
    sessionId: string,
    metric: string,
    threshold: number,
    actual: number,
    userId?: string
  ): Promise<void> {
    await this.logEvent({
      eventType: 'sla_breach',
      sessionId,
      userId,
      details: {
        metric,
        threshold,
        actual,
        deviation: actual - threshold,
      },
      riskLevel: actual > threshold * 2 ? 'critical' : 'high',
    });
  }

  // Write event to file
  private async writeEventToFile(event: AuditEvent): Promise<void> {
    if (!this.currentLogFile) {
      throw new Error('No active log file');
    }

    let eventData = JSON.stringify(event) + '\n';

    // Encrypt if enabled
    if (this.config.encryption.enabled) {
      eventData = this.encrypt(eventData);
    }

    try {
      await fs.appendFile(this.currentLogFile, eventData, 'utf8');
    } catch (error) {
      this.logger.error(`Failed to write audit event to file: ${error}`);
      throw error;
    }
  }

  // Check if log file should be rotated
  private async shouldRotateLogFile(): Promise<boolean> {
    if (!this.currentLogFile) {
      return true;
    }

    try {
      const stats = await fs.stat(this.currentLogFile);
      const fileSizeMB = stats.size / (1024 * 1024);

      return fileSizeMB >= this.config.retention.maxFileSizeMB;
    } catch (error) {
      return true; // Rotate if we can't check file size
    }
  }

  // Rotate log file
  private async rotateLogFile(): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `audit-${timestamp}.log`;
    const filepath = join(this.config.logDirectory, filename);

    // Finalize current log file if it exists
    if (this.currentLogFile) {
      await this.finalizeLogFile(this.currentLogFile);
    }

    this.currentLogFile = filepath;
    this.currentEventCount = 0;

    // Create new log file with header
    const header = this.generateLogFileHeader();
    await fs.writeFile(this.currentLogFile, header + '\n', 'utf8');

    this.logger.info(`Rotated to new audit log file: ${filename}`);
  }

  // Finalize log file (calculate checksum, compress, etc.)
  private async finalizeLogFile(filepath: string): Promise<void> {
    try {
      const stats = await fs.stat(filepath);
      const content = await fs.readFile(filepath, 'utf8');
      const checksum = this.calculateChecksum(content);
      const filename = filepath.split('/').pop() || '';

      const logFileInfo: AuditLogFile = {
        filename,
        path: filepath,
        startDate: new Date(stats.birthtime),
        endDate: new Date(),
        eventCount: this.currentEventCount,
        sizeMB: stats.size / (1024 * 1024),
        checksum,
        encrypted: this.config.encryption.enabled,
        compressed: false,
      };

      // Compress if enabled
      if (this.config.retention.compressionEnabled) {
        await this.compressLogFile(filepath);
        logFileInfo.compressed = true;
      }

      // Generate integrity metadata
      const metadataFile = filepath + '.meta';
      const metadata = {
        ...logFileInfo,
        compliance: this.config.compliance,
        signature: this.config.compliance.requireDigitalSignature
          ? this.generateDigitalSignature(content)
          : null,
      };

      await fs.writeFile(
        metadataFile,
        JSON.stringify(metadata, null, 2),
        'utf8'
      );
      this.logFiles.set(filename, logFileInfo);

      this.logger.info(`Finalized audit log file: ${filename}`);
    } catch (error) {
      this.logger.error(`Failed to finalize log file: ${error}`);
    }
  }

  // Generate log file header
  private generateLogFileHeader(): string {
    return JSON.stringify({
      type: 'audit-log-header',
      version: '1.0',
      created: new Date().toISOString(),
      system: 'console-automation-mcp',
      compliance: this.config.compliance,
      encryption: this.config.encryption.enabled,
      fields: [
        'timestamp',
        'eventType',
        'sessionId',
        'userId',
        'details',
        'riskLevel',
        'compliance',
      ],
    });
  }

  // Filter events based on configuration
  private shouldFilterEvent(eventType: string): boolean {
    if (this.config.filtering.includeEvents.length > 0) {
      return !this.config.filtering.includeEvents.includes(eventType);
    }

    return this.config.filtering.excludeEvents.includes(eventType);
  }

  // Sanitize sensitive fields
  private sanitizeSensitiveFields(
    details: Record<string, any>
  ): Record<string, any> {
    const sanitized = { ...details };

    this.config.filtering.sensitiveFields.forEach((field) => {
      if (field in sanitized) {
        sanitized[field] = '[REDACTED]';
      }
    });

    return sanitized;
  }

  // Assess risk level based on command and metadata
  private assessRiskLevel(
    command?: string,
    metadata?: Record<string, any>
  ): 'low' | 'medium' | 'high' | 'critical' {
    if (!command) return 'low';

    // High-risk commands
    const highRiskCommands = [
      'rm',
      'del',
      'format',
      'dd',
      'sudo',
      'su',
      'passwd',
      'chmod',
      'chown',
    ];
    const criticalCommands = [
      'rm -rf',
      'format c:',
      'dd if=',
      'shutdown',
      'reboot',
    ];

    const lowerCommand = command.toLowerCase();

    if (criticalCommands.some((cmd) => lowerCommand.includes(cmd))) {
      return 'critical';
    }

    if (highRiskCommands.some((cmd) => lowerCommand.includes(cmd))) {
      return 'high';
    }

    // Check for privilege escalation
    if (
      lowerCommand.includes('sudo') ||
      lowerCommand.includes('su ') ||
      lowerCommand.includes('runas')
    ) {
      return 'high';
    }

    // Check for system modifications
    if (
      lowerCommand.includes('install') ||
      lowerCommand.includes('update') ||
      lowerCommand.includes('upgrade')
    ) {
      return 'medium';
    }

    return 'low';
  }

  // Assess command risk
  private assessCommandRisk(
    command: string,
    args: string[]
  ): 'low' | 'medium' | 'high' | 'critical' {
    const fullCommand = `${command} ${args.join(' ')}`;
    return this.assessRiskLevel(fullCommand);
  }

  // Generate compliance information
  private generateComplianceInfo(): ComplianceInfo {
    return {
      standards: this.config.compliance.standards,
      classification: this.config.compliance.classification,
      retention: this.config.retention.days,
      encrypted: this.config.encryption.enabled,
    };
  }

  // Encrypt data
  private encrypt(data: string): string {
    if (!this.config.encryption.enabled) {
      return data;
    }

    try {
      const algorithm = 'aes-256-cbc';
      const key = createHash('sha256')
        .update(this.config.encryption.key)
        .digest();
      const iv = randomBytes(16);

      const cipher = createCipheriv(algorithm, key, iv);
      let encrypted = cipher.update(data, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      // Prepend IV to encrypted data
      return iv.toString('hex') + ':' + encrypted;
    } catch (error) {
      this.logger.error(`Encryption failed: ${error}`);
      return data; // Return unencrypted if encryption fails
    }
  }

  // Decrypt data
  private decrypt(encryptedData: string): string {
    if (!this.config.encryption.enabled) {
      return encryptedData;
    }

    try {
      const algorithm = 'aes-256-cbc';
      const key = createHash('sha256')
        .update(this.config.encryption.key)
        .digest();

      // Extract IV from encrypted data
      const parts = encryptedData.split(':');
      if (parts.length !== 2) {
        throw new Error('Invalid encrypted data format');
      }

      const iv = Buffer.from(parts[0], 'hex');
      const encrypted = parts[1];

      const decipher = createDecipheriv(algorithm, key, iv);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (error) {
      this.logger.error(`Decryption failed: ${error}`);
      return encryptedData;
    }
  }

  // Calculate checksum
  private calculateChecksum(data: string): string {
    return createHash('sha256').update(data).digest('hex');
  }

  // Generate digital signature (simplified)
  private generateDigitalSignature(data: string): string {
    const hash = createHash('sha256').update(data).digest('hex');
    return createHash('sha256')
      .update(hash + this.config.encryption.key)
      .digest('hex');
  }

  // Compress log file (placeholder - would use actual compression library)
  private async compressLogFile(filepath: string): Promise<void> {
    // This is a placeholder. In a real implementation, you'd use a compression library
    // like zlib or gzip to compress the file
    this.logger.debug(`Compressing log file: ${filepath}`);
  }

  // Start timers for rotation and cleanup
  private startTimers(): void {
    // Rotate logs daily
    this.rotationTimer = setInterval(
      () => {
        this.rotateLogFile().catch((error) => {
          this.logger.error(`Automatic log rotation failed: ${error}`);
        });
      },
      24 * 60 * 60 * 1000
    ); // 24 hours

    // Cleanup old logs weekly
    this.cleanupTimer = setInterval(
      () => {
        this.cleanupOldLogs().catch((error) => {
          this.logger.error(`Automatic cleanup failed: ${error}`);
        });
      },
      7 * 24 * 60 * 60 * 1000
    ); // 7 days
  }

  // Cleanup old log files based on retention policy
  private async cleanupOldLogs(): Promise<void> {
    const retentionMs = this.config.retention.days * 24 * 60 * 60 * 1000;
    const cutoffDate = new Date(Date.now() - retentionMs);

    try {
      const files = await fs.readdir(this.config.logDirectory);

      for (const file of files) {
        if (file.endsWith('.log') || file.endsWith('.meta')) {
          const filepath = join(this.config.logDirectory, file);
          const stats = await fs.stat(filepath);

          if (stats.mtime < cutoffDate) {
            await fs.unlink(filepath);
            this.logger.info(`Deleted old audit log file: ${file}`);
          }
        }
      }
    } catch (error) {
      this.logger.error(`Failed to cleanup old logs: ${error}`);
    }
  }

  // Search audit events
  async searchEvents(criteria: {
    eventType?: string;
    sessionId?: string;
    userId?: string;
    riskLevel?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
  }): Promise<AuditEvent[]> {
    let events = Array.from(this.auditEvents.values());

    // Apply filters
    if (criteria.eventType) {
      events = events.filter((e) => e.eventType === criteria.eventType);
    }

    if (criteria.sessionId) {
      events = events.filter((e) => e.sessionId === criteria.sessionId);
    }

    if (criteria.userId) {
      events = events.filter((e) => e.userId === criteria.userId);
    }

    if (criteria.riskLevel) {
      events = events.filter((e) => e.riskLevel === criteria.riskLevel);
    }

    if (criteria.startDate) {
      events = events.filter((e) => e.timestamp >= criteria.startDate!);
    }

    if (criteria.endDate) {
      events = events.filter((e) => e.timestamp <= criteria.endDate!);
    }

    // Sort by timestamp (newest first)
    events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Apply limit
    if (criteria.limit) {
      events = events.slice(0, criteria.limit);
    }

    return events;
  }

  // Get audit statistics
  getAuditStats(): {
    eventsLogged: number;
    logFiles: number;
    totalSizeMB: number;
    oldestEvent?: Date;
    newestEvent?: Date;
    eventsByType: Record<string, number>;
    eventsByRisk: Record<string, number>;
  } {
    const events = Array.from(this.auditEvents.values());
    const files = Array.from(this.logFiles.values());

    const eventsByType: Record<string, number> = {};
    const eventsByRisk: Record<string, number> = {};

    events.forEach((event) => {
      eventsByType[event.eventType] = (eventsByType[event.eventType] || 0) + 1;
      eventsByRisk[event.riskLevel] = (eventsByRisk[event.riskLevel] || 0) + 1;
    });

    return {
      eventsLogged: events.length,
      logFiles: files.length,
      totalSizeMB: files.reduce((sum, file) => sum + file.sizeMB, 0),
      oldestEvent:
        events.length > 0
          ? new Date(Math.min(...events.map((e) => e.timestamp.getTime())))
          : undefined,
      newestEvent:
        events.length > 0
          ? new Date(Math.max(...events.map((e) => e.timestamp.getTime())))
          : undefined,
      eventsByType,
      eventsByRisk,
    };
  }

  // Export audit data for compliance
  async exportAuditData(
    startDate: Date,
    endDate: Date,
    format: 'json' | 'csv' = 'json'
  ): Promise<string> {
    const events = await this.searchEvents({ startDate, endDate });

    if (format === 'csv') {
      return this.exportToCSV(events);
    } else {
      return JSON.stringify(events, null, 2);
    }
  }

  // Export to CSV format
  private exportToCSV(events: AuditEvent[]): string {
    if (events.length === 0) return '';

    const headers = [
      'timestamp',
      'eventType',
      'sessionId',
      'userId',
      'riskLevel',
      'details',
    ];
    const rows = events.map((event) => [
      event.timestamp.toISOString(),
      event.eventType,
      event.sessionId || '',
      event.userId || '',
      event.riskLevel,
      JSON.stringify(event.details),
    ]);

    return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
  }

  destroy(): void {
    if (this.rotationTimer) {
      clearInterval(this.rotationTimer);
    }

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    // Finalize current log file
    if (this.currentLogFile) {
      this.finalizeLogFile(this.currentLogFile).catch((error) => {
        this.logger.error(
          `Failed to finalize log file during destroy: ${error}`
        );
      });
    }

    this.auditEvents.clear();
    this.logFiles.clear();
    this.removeAllListeners();
  }
}
