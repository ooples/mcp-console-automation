/**
 * Enterprise Audit Manager
 * Comprehensive audit trail system for compliance and security monitoring
 */

import { EventEmitter } from 'events';
import { createHash, createCipher, createDecipher } from 'crypto';
import {
  AuditEvent,
  AuditConfig,
  ComplianceRule,
  ComplianceCondition,
  ComplianceAction,
  EnterpriseConsoleSession
} from '../types/enterprise.js';
import { Logger } from '../../utils/logger.js';

export interface AuditQuery {
  userId?: string;
  action?: string;
  resource?: string;
  outcome?: 'success' | 'failure' | 'warning';
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
  correlationId?: string;
  complianceFlags?: string[];
}

export interface AuditDestination {
  type: 'database' | 'file' | 'syslog' | 'elasticsearch' | 'splunk' | 'webhook';
  config: Record<string, any>;
  isActive: boolean;
  formatters?: AuditFormatter[];
}

export interface AuditFormatter {
  type: 'json' | 'cef' | 'leef' | 'custom';
  config?: Record<string, any>;
}

export interface ComplianceReport {
  id: string;
  standard: string;
  generatedAt: Date;
  period: { start: Date; end: Date };
  summary: {
    totalEvents: number;
    violations: number;
    warnings: number;
    riskScore: number;
  };
  violations: ComplianceViolation[];
  recommendations: string[];
}

export interface ComplianceViolation {
  ruleId: string;
  ruleName: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  eventId: string;
  description: string;
  timestamp: Date;
  userId?: string;
  remediation?: string;
}

export class AuditManager extends EventEmitter {
  private logger: Logger;
  private config: AuditConfig;
  private events: Map<string, AuditEvent>;
  private complianceRules: Map<string, ComplianceRule>;
  private destinations: AuditDestination[];
  private encryptionKey: string;
  private integrityHashes: Map<string, string>;

  constructor(config: AuditConfig, encryptionKey: string) {
    super();
    this.logger = new Logger('AuditManager');
    this.config = config;
    this.encryptionKey = encryptionKey;
    this.events = new Map();
    this.complianceRules = new Map();
    this.destinations = [];
    this.integrityHashes = new Map();

    this.initializeComplianceRules();
    this.startRetentionCleanup();
    this.initializeDestinations();
  }

  private initializeComplianceRules() {
    // SOC 2 Type II Controls
    this.addComplianceRule({
      id: 'soc2-access-logging',
      name: 'SOC 2 - Access Logging',
      description: 'All system access must be logged',
      standard: 'SOC2',
      type: 'detective',
      severity: 'high',
      conditions: [
        { field: 'action', operator: 'in', value: ['login', 'logout', 'access'] }
      ],
      actions: [
        { type: 'log', config: { level: 'info', retention: '2555' } } // 7 years
      ],
      isActive: true
    });

    // HIPAA Security Rule
    this.addComplianceRule({
      id: 'hipaa-audit-controls',
      name: 'HIPAA - Audit Controls',
      description: 'Hardware, software, and/or procedural mechanisms that record and examine activity',
      standard: 'HIPAA',
      type: 'detective',
      severity: 'critical',
      conditions: [
        { field: 'resource', operator: 'contains', value: 'patient' },
        { field: 'resource', operator: 'contains', value: 'medical' },
        { field: 'resource', operator: 'contains', value: 'phi' }
      ],
      actions: [
        { type: 'log', config: { level: 'audit', retention: '2555', encryption: true } },
        { type: 'notify', config: { channels: ['security-team'], severity: 'high' } }
      ],
      isActive: true
    });

    // PCI DSS Requirement 10
    this.addComplianceRule({
      id: 'pci-dss-logging',
      name: 'PCI DSS - Track and Monitor Access',
      description: 'Track and monitor all access to network resources and cardholder data',
      standard: 'PCI-DSS',
      type: 'detective',
      severity: 'critical',
      conditions: [
        { field: 'resource', operator: 'contains', value: 'payment' },
        { field: 'resource', operator: 'contains', value: 'card' },
        { field: 'resource', operator: 'contains', value: 'financial' }
      ],
      actions: [
        { type: 'log', config: { level: 'audit', retention: '365', encryption: true } },
        { type: 'block', config: { quarantine: true } }
      ],
      isActive: true
    });

    // ISO 27001 A.12.4.1
    this.addComplianceRule({
      id: 'iso27001-event-logging',
      name: 'ISO 27001 - Event Logging',
      description: 'Event logs recording user activities, exceptions, faults and information security events shall be produced, kept and regularly reviewed',
      standard: 'ISO27001',
      type: 'detective',
      severity: 'medium',
      conditions: [
        { field: 'outcome', operator: 'equals', value: 'failure' }
      ],
      actions: [
        { type: 'log', config: { level: 'warning', retention: '365' } },
        { type: 'warn', config: { threshold: 5, timeWindow: 300 } } // 5 failures in 5 minutes
      ],
      isActive: true
    });

    this.logger.info(`Initialized ${this.complianceRules.size} compliance rules`);
  }

  private initializeDestinations() {
    // Default file destination
    this.destinations.push({
      type: 'file',
      config: {
        path: './logs/audit.log',
        rotation: 'daily',
        maxSize: '100MB'
      },
      isActive: true,
      formatters: [{ type: 'json' }]
    });

    if (this.config.destinations) {
      // Initialize configured destinations
      for (const destConfig of this.config.destinations) {
        this.destinations.push({
          type: destConfig as any,
          config: {},
          isActive: true,
          formatters: [{ type: 'json' }]
        });
      }
    }
  }

  async logEvent(eventData: Omit<AuditEvent, 'id' | 'timestamp' | 'correlationId'>): Promise<string> {
    const eventId = this.generateEventId();
    const correlationId = eventData.correlationId || this.generateCorrelationId();

    const auditEvent: AuditEvent = {
      id: eventId,
      timestamp: new Date(),
      correlationId,
      ...eventData
    };

    // Enrich event with additional context
    await this.enrichEvent(auditEvent);

    // Validate event completeness
    this.validateEvent(auditEvent);

    // Check compliance rules
    await this.checkCompliance(auditEvent);

    // Store event
    await this.storeEvent(auditEvent);

    // Generate integrity hash for tamper detection
    if (this.config.tamperProtection) {
      const hash = this.generateIntegrityHash(auditEvent);
      this.integrityHashes.set(eventId, hash);
    }

    // Send to destinations
    await this.sendToDestinations(auditEvent);

    // Real-time analysis
    if (this.config.realTimeAnalysis) {
      await this.performRealTimeAnalysis(auditEvent);
    }

    this.emit('audit:logged', auditEvent);
    return eventId;
  }

  private async enrichEvent(event: AuditEvent): Promise<void> {
    // Add system context
    event.details = event.details || {};
    event.details.hostname = require('os').hostname();
    event.details.platform = process.platform;
    event.details.nodeVersion = process.version;
    event.details.pid = process.pid;

    // Add geolocation for IP addresses
    if (event.ipAddress && event.ipAddress !== 'unknown') {
      try {
        event.details.geolocation = await this.getGeolocation(event.ipAddress);
      } catch (error) {
        this.logger.debug(`Failed to get geolocation for ${event.ipAddress}:`, error);
      }
    }

    // Add risk scoring
    event.riskLevel = this.calculateRiskLevel(event);

    // Add compliance flags
    event.complianceFlags = this.getComplianceFlags(event);
  }

  private validateEvent(event: AuditEvent): void {
    const required = ['id', 'timestamp', 'userId', 'action', 'resource', 'outcome'];
    for (const field of required) {
      if (!event[field as keyof AuditEvent]) {
        throw new Error(`Audit event missing required field: ${field}`);
      }
    }

    // Validate timestamp is not in the future
    if (event.timestamp > new Date()) {
      throw new Error('Audit event timestamp cannot be in the future');
    }
  }

  private calculateRiskLevel(event: AuditEvent): 'low' | 'medium' | 'high' | 'critical' {
    let score = 0;

    // High-risk actions
    const highRiskActions = ['delete', 'destroy', 'admin', 'privilege', 'sudo', 'root'];
    if (highRiskActions.some(action => event.action.toLowerCase().includes(action))) {
      score += 3;
    }

    // Failed attempts
    if (event.outcome === 'failure') {
      score += 2;
    }

    // Off-hours access
    const hour = event.timestamp.getHours();
    if (hour < 6 || hour > 22) {
      score += 1;
    }

    // Multiple failures pattern
    if (this.hasRecentFailures(event.userId, event.ipAddress)) {
      score += 2;
    }

    // Sensitive resources
    const sensitivePatterns = ['admin', 'root', 'system', 'config', 'secret', 'key', 'password'];
    if (sensitivePatterns.some(pattern => event.resource.toLowerCase().includes(pattern))) {
      score += 2;
    }

    if (score >= 6) return 'critical';
    if (score >= 4) return 'high';
    if (score >= 2) return 'medium';
    return 'low';
  }

  private getComplianceFlags(event: AuditEvent): string[] {
    const flags: string[] = [];

    // Check each compliance rule
    for (const rule of this.complianceRules.values()) {
      if (rule.isActive && this.evaluateRuleConditions(rule.conditions, event)) {
        flags.push(rule.standard);
      }
    }

    return flags;
  }

  private hasRecentFailures(userId: string, ipAddress: string): boolean {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const recentFailures = Array.from(this.events.values()).filter(event =>
      event.userId === userId &&
      event.ipAddress === ipAddress &&
      event.outcome === 'failure' &&
      event.timestamp >= fiveMinutesAgo
    );

    return recentFailures.length >= 3;
  }

  private async checkCompliance(event: AuditEvent): Promise<void> {
    const violations: ComplianceViolation[] = [];

    for (const rule of this.complianceRules.values()) {
      if (!rule.isActive) continue;

      const matches = this.evaluateRuleConditions(rule.conditions, event);
      if (matches) {
        // Execute compliance actions
        for (const action of rule.actions) {
          await this.executeComplianceAction(action, event, rule);
        }

        // Check if this constitutes a violation
        if (rule.type === 'preventive' && event.outcome === 'success') {
          violations.push({
            ruleId: rule.id,
            ruleName: rule.name,
            severity: rule.severity,
            eventId: event.id,
            description: `Compliance rule violated: ${rule.description}`,
            timestamp: event.timestamp,
            userId: event.userId,
            remediation: this.getRemediation(rule)
          });
        }
      }
    }

    if (violations.length > 0) {
      this.emit('compliance:violation', { event, violations });
      this.logger.warn(`Compliance violations detected for event ${event.id}:`, violations);
    }
  }

  private evaluateRuleConditions(conditions: ComplianceCondition[], event: AuditEvent): boolean {
    return conditions.every(condition => {
      const fieldValue = this.getEventFieldValue(condition.field, event);
      return this.evaluateCondition(condition, fieldValue);
    });
  }

  private getEventFieldValue(field: string, event: AuditEvent): any {
    const parts = field.split('.');
    let value: any = event;

    for (const part of parts) {
      if (value && typeof value === 'object') {
        value = value[part];
      } else {
        return undefined;
      }
    }

    return value;
  }

  private evaluateCondition(condition: ComplianceCondition, fieldValue: any): boolean {
    if (fieldValue === undefined && condition.operator !== 'eq') {
      return false;
    }

    switch (condition.operator) {
      case 'equals':
        return fieldValue === condition.value;
      case 'contains':
        return String(fieldValue).includes(String(condition.value));
      case 'regex':
        return new RegExp(condition.value).test(String(fieldValue));
      case 'gt':
        return Number(fieldValue) > Number(condition.value);
      case 'lt':
        return Number(fieldValue) < Number(condition.value);
      case 'in':
        return Array.isArray(condition.value) && condition.value.includes(fieldValue);
      default:
        return false;
    }
  }

  private async executeComplianceAction(action: ComplianceAction, event: AuditEvent, rule: ComplianceRule): Promise<void> {
    switch (action.type) {
      case 'block':
        this.emit('compliance:block', { event, rule, action });
        break;
      case 'warn':
        this.logger.warn(`Compliance warning for rule ${rule.name}:`, event);
        break;
      case 'log':
        // Already logged as part of audit event
        break;
      case 'notify':
        this.emit('compliance:notify', { event, rule, action });
        break;
      case 'quarantine':
        this.emit('compliance:quarantine', { event, rule, action });
        break;
    }
  }

  private getRemediation(rule: ComplianceRule): string {
    const remediations: Record<string, string> = {
      'soc2-access-logging': 'Ensure all access is properly authenticated and authorized',
      'hipaa-audit-controls': 'Review access to PHI and ensure proper authorization',
      'pci-dss-logging': 'Immediate review required for payment system access',
      'iso27001-event-logging': 'Investigate failed access attempt and review user permissions'
    };

    return remediations[rule.id] || 'Review the event and take appropriate action';
  }

  private async storeEvent(event: AuditEvent): Promise<void> {
    if (this.config.encryptionEnabled) {
      const encryptedEvent = this.encryptEvent(event);
      this.events.set(event.id, encryptedEvent);
    } else {
      this.events.set(event.id, event);
    }
  }

  private encryptEvent(event: AuditEvent): AuditEvent {
    const sensitiveFields = ['details', 'userAgent'];
    const encryptedEvent = { ...event };

    for (const field of sensitiveFields) {
      if (encryptedEvent[field as keyof AuditEvent]) {
        const cipher = createCipher('aes-256-cbc', this.encryptionKey);
        let encrypted = cipher.update(JSON.stringify(encryptedEvent[field as keyof AuditEvent]), 'utf8', 'hex');
        encrypted += cipher.final('hex');
        (encryptedEvent as any)[field] = encrypted;
      }
    }

    return encryptedEvent;
  }

  private decryptEvent(event: AuditEvent): AuditEvent {
    const sensitiveFields = ['details', 'userAgent'];
    const decryptedEvent = { ...event };

    for (const field of sensitiveFields) {
      if (decryptedEvent[field as keyof AuditEvent] && typeof decryptedEvent[field as keyof AuditEvent] === 'string') {
        try {
          const decipher = createDecipher('aes-256-cbc', this.encryptionKey);
          let decrypted = decipher.update(decryptedEvent[field as keyof AuditEvent] as string, 'hex', 'utf8');
          decrypted += decipher.final('utf8');
          (decryptedEvent as any)[field] = JSON.parse(decrypted);
        } catch (error) {
          this.logger.warn(`Failed to decrypt field ${field} for event ${event.id}`);
        }
      }
    }

    return decryptedEvent;
  }

  private generateIntegrityHash(event: AuditEvent): string {
    const eventString = JSON.stringify(event, Object.keys(event).sort());
    return createHash('sha256').update(eventString + this.encryptionKey).digest('hex');
  }

  private async sendToDestinations(event: AuditEvent): Promise<void> {
    for (const destination of this.destinations) {
      if (!destination.isActive) continue;

      try {
        const formattedEvent = this.formatEvent(event, destination.formatters || []);
        await this.sendToDestination(formattedEvent, destination);
      } catch (error) {
        this.logger.error(`Failed to send audit event to destination ${destination.type}:`, error);
      }
    }
  }

  private formatEvent(event: AuditEvent, formatters: AuditFormatter[]): any {
    let formatted = event;

    for (const formatter of formatters) {
      switch (formatter.type) {
        case 'json':
          formatted = JSON.stringify(formatted);
          break;
        case 'cef':
          formatted = this.formatAsCEF(event);
          break;
        case 'leef':
          formatted = this.formatAsLEEF(event);
          break;
        case 'custom':
          // Apply custom formatting logic
          break;
      }
    }

    return formatted;
  }

  private formatAsCEF(event: AuditEvent): string {
    // Common Event Format (CEF)
    const version = '0';
    const deviceVendor = 'Enterprise Console';
    const deviceProduct = 'MCP Automation';
    const deviceVersion = '1.0';
    const signatureId = event.action;
    const name = `${event.action} on ${event.resource}`;
    const severity = this.mapRiskToCEFSeverity(event.riskLevel);

    const extensions = [
      `src=${event.ipAddress}`,
      `suser=${event.userId}`,
      `act=${event.action}`,
      `outcome=${event.outcome}`,
      `rt=${event.timestamp.getTime()}`
    ];

    return `CEF:${version}|${deviceVendor}|${deviceProduct}|${deviceVersion}|${signatureId}|${name}|${severity}|${extensions.join(' ')}`;
  }

  private formatAsLEEF(event: AuditEvent): string {
    // Log Event Extended Format (LEEF)
    const version = '2.0';
    const vendor = 'Enterprise Console';
    const product = 'MCP Automation';
    const productVersion = '1.0';
    const eventId = event.action;

    const attributes = [
      `devTime=${event.timestamp.toISOString()}`,
      `src=${event.ipAddress}`,
      `usrName=${event.userId}`,
      `cat=${event.action}`,
      `outcome=${event.outcome}`,
      `severity=${this.mapRiskToLEEFSeverity(event.riskLevel)}`
    ];

    return `LEEF:${version}|${vendor}|${product}|${productVersion}|${eventId}|${attributes.join('\t')}`;
  }

  private mapRiskToCEFSeverity(riskLevel: string): number {
    const mapping: Record<string, number> = {
      'low': 2,
      'medium': 5,
      'high': 8,
      'critical': 10
    };
    return mapping[riskLevel] || 5;
  }

  private mapRiskToLEEFSeverity(riskLevel: string): number {
    return this.mapRiskToCEFSeverity(riskLevel);
  }

  private async sendToDestination(event: any, destination: AuditDestination): Promise<void> {
    switch (destination.type) {
      case 'file':
        await this.sendToFile(event, destination.config);
        break;
      case 'syslog':
        await this.sendToSyslog(event, destination.config);
        break;
      case 'elasticsearch':
        await this.sendToElasticsearch(event, destination.config);
        break;
      case 'splunk':
        await this.sendToSplunk(event, destination.config);
        break;
      case 'webhook':
        await this.sendToWebhook(event, destination.config);
        break;
      default:
        this.logger.warn(`Unknown destination type: ${destination.type}`);
    }
  }

  private async sendToFile(event: any, config: any): Promise<void> {
    // Implement file logging
    const fs = await import('fs/promises');
    await fs.appendFile(config.path || './logs/audit.log', JSON.stringify(event) + '\n');
  }

  private async sendToSyslog(event: any, config: any): Promise<void> {
    // Implement syslog integration
    this.logger.debug('Sending to syslog:', event);
  }

  private async sendToElasticsearch(event: any, config: any): Promise<void> {
    // Implement Elasticsearch integration
    this.logger.debug('Sending to Elasticsearch:', event);
  }

  private async sendToSplunk(event: any, config: any): Promise<void> {
    // Implement Splunk integration
    this.logger.debug('Sending to Splunk:', event);
  }

  private async sendToWebhook(event: any, config: any): Promise<void> {
    // Implement webhook integration
    const axios = await import('axios');
    await axios.default.post(config.url, event, {
      headers: config.headers || {},
      timeout: config.timeout || 5000
    });
  }

  private async performRealTimeAnalysis(event: AuditEvent): Promise<void> {
    // Implement real-time security analysis
    // Look for patterns, anomalies, attack indicators
    
    // Example: Detect brute force attempts
    if (event.outcome === 'failure' && event.action === 'login') {
      const recentFailures = this.getRecentFailures(event.userId, event.ipAddress, 5 * 60 * 1000);
      if (recentFailures.length >= 5) {
        this.emit('security:brute-force-detected', {
          userId: event.userId,
          ipAddress: event.ipAddress,
          attempts: recentFailures.length,
          timeWindow: 5
        });
      }
    }

    // Example: Detect unusual access patterns
    if (event.outcome === 'success') {
      const userHistory = await this.getUserAccessHistory(event.userId, 30);
      if (this.isUnusualAccess(event, userHistory)) {
        this.emit('security:unusual-access', event);
      }
    }
  }

  private getRecentFailures(userId: string, ipAddress: string, timeWindow: number): AuditEvent[] {
    const cutoff = new Date(Date.now() - timeWindow);
    return Array.from(this.events.values()).filter(event =>
      event.userId === userId &&
      event.ipAddress === ipAddress &&
      event.outcome === 'failure' &&
      event.timestamp >= cutoff
    );
  }

  private async getUserAccessHistory(userId: string, days: number): Promise<AuditEvent[]> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return Array.from(this.events.values()).filter(event =>
      event.userId === userId &&
      event.timestamp >= cutoff &&
      event.outcome === 'success'
    );
  }

  private isUnusualAccess(event: AuditEvent, history: AuditEvent[]): boolean {
    // Check for access from unusual locations
    const usualLocations = new Set(history.map(e => e.ipAddress).slice(-10));
    if (!usualLocations.has(event.ipAddress)) {
      return true;
    }

    // Check for access at unusual times
    const hour = event.timestamp.getHours();
    const usualHours = history.map(e => e.timestamp.getHours());
    const hourFreq = usualHours.reduce((acc, h) => {
      acc[h] = (acc[h] || 0) + 1;
      return acc;
    }, {} as Record<number, number>);

    if ((hourFreq[hour] || 0) < history.length * 0.1) { // Less than 10% of historical access
      return true;
    }

    return false;
  }

  // Query and reporting methods
  async queryEvents(query: AuditQuery): Promise<{ events: AuditEvent[]; total: number }> {
    let filteredEvents = Array.from(this.events.values());

    // Apply filters
    if (query.userId) {
      filteredEvents = filteredEvents.filter(e => e.userId === query.userId);
    }
    if (query.action) {
      filteredEvents = filteredEvents.filter(e => e.action.includes(query.action));
    }
    if (query.resource) {
      filteredEvents = filteredEvents.filter(e => e.resource.includes(query.resource));
    }
    if (query.outcome) {
      filteredEvents = filteredEvents.filter(e => e.outcome === query.outcome);
    }
    if (query.riskLevel) {
      filteredEvents = filteredEvents.filter(e => e.riskLevel === query.riskLevel);
    }
    if (query.startDate) {
      filteredEvents = filteredEvents.filter(e => e.timestamp >= query.startDate!);
    }
    if (query.endDate) {
      filteredEvents = filteredEvents.filter(e => e.timestamp <= query.endDate!);
    }
    if (query.correlationId) {
      filteredEvents = filteredEvents.filter(e => e.correlationId === query.correlationId);
    }
    if (query.complianceFlags && query.complianceFlags.length > 0) {
      filteredEvents = filteredEvents.filter(e =>
        query.complianceFlags!.some(flag => e.complianceFlags?.includes(flag))
      );
    }

    // Sort by timestamp (newest first)
    filteredEvents.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    const total = filteredEvents.length;

    // Apply pagination
    if (query.offset) {
      filteredEvents = filteredEvents.slice(query.offset);
    }
    if (query.limit) {
      filteredEvents = filteredEvents.slice(0, query.limit);
    }

    // Decrypt events if needed
    const events = this.config.encryptionEnabled
      ? filteredEvents.map(e => this.decryptEvent(e))
      : filteredEvents;

    return { events, total };
  }

  async generateComplianceReport(standard: string, startDate: Date, endDate: Date): Promise<ComplianceReport> {
    const reportId = `compliance_${standard}_${Date.now()}`;
    const events = await this.queryEvents({
      startDate,
      endDate,
      complianceFlags: [standard]
    });

    const violations: ComplianceViolation[] = [];
    const warnings = events.events.filter(e => e.outcome === 'warning').length;
    let riskScore = 0;

    // Calculate risk score and identify violations
    for (const event of events.events) {
      const riskValue = { low: 1, medium: 3, high: 7, critical: 10 }[event.riskLevel];
      riskScore += riskValue;

      if (event.outcome === 'failure' && event.riskLevel === 'critical') {
        violations.push({
          ruleId: `${standard}-violation`,
          ruleName: `${standard} Compliance Violation`,
          severity: 'high',
          eventId: event.id,
          description: `High-risk failure: ${event.action} on ${event.resource}`,
          timestamp: event.timestamp,
          userId: event.userId,
          remediation: 'Review and remediate immediately'
        });
      }
    }

    const recommendations = this.generateRecommendations(standard, events.events, violations);

    return {
      id: reportId,
      standard,
      generatedAt: new Date(),
      period: { start: startDate, end: endDate },
      summary: {
        totalEvents: events.total,
        violations: violations.length,
        warnings,
        riskScore: Math.min(100, Math.round(riskScore / events.total))
      },
      violations,
      recommendations
    };
  }

  private generateRecommendations(standard: string, events: AuditEvent[], violations: ComplianceViolation[]): string[] {
    const recommendations: string[] = [];

    if (violations.length > 0) {
      recommendations.push(`Address ${violations.length} compliance violations immediately`);
    }

    const failureRate = events.filter(e => e.outcome === 'failure').length / events.length;
    if (failureRate > 0.1) {
      recommendations.push('High failure rate detected - review access controls and user training');
    }

    const offHoursAccess = events.filter(e => {
      const hour = e.timestamp.getHours();
      return hour < 6 || hour > 22;
    });
    if (offHoursAccess.length > events.length * 0.2) {
      recommendations.push('Significant off-hours access - consider implementing time-based restrictions');
    }

    return recommendations;
  }

  private async getGeolocation(ipAddress: string): Promise<any> {
    // Mock implementation - integrate with actual geolocation service
    return {
      country: 'US',
      region: 'CA',
      city: 'San Francisco',
      latitude: 37.7749,
      longitude: -122.4194
    };
  }

  private addComplianceRule(rule: ComplianceRule): void {
    this.complianceRules.set(rule.id, rule);
  }

  private startRetentionCleanup(): void {
    setInterval(() => {
      const cutoff = new Date(Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000);
      let cleanedCount = 0;

      for (const [eventId, event] of this.events.entries()) {
        if (event.timestamp < cutoff) {
          this.events.delete(eventId);
          this.integrityHashes.delete(eventId);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        this.logger.info(`Cleaned up ${cleanedCount} expired audit events`);
      }
    }, 24 * 60 * 60 * 1000); // Daily cleanup
  }

  private generateEventId(): string {
    return `audit_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  }

  private generateCorrelationId(): string {
    return `corr_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  }

  // Integrity verification
  async verifyIntegrity(eventId: string): Promise<boolean> {
    if (!this.config.tamperProtection) {
      return true;
    }

    const event = this.events.get(eventId);
    const storedHash = this.integrityHashes.get(eventId);

    if (!event || !storedHash) {
      return false;
    }

    const currentHash = this.generateIntegrityHash(event);
    return currentHash === storedHash;
  }

  // Statistics
  getStatistics(): any {
    const events = Array.from(this.events.values());
    const last24h = events.filter(e => e.timestamp >= new Date(Date.now() - 24 * 60 * 60 * 1000));

    return {
      totalEvents: events.length,
      last24Hours: last24h.length,
      riskDistribution: this.getRiskDistribution(events),
      outcomeDistribution: this.getOutcomeDistribution(events),
      topUsers: this.getTopUsers(events),
      topActions: this.getTopActions(events),
      complianceFlags: this.getComplianceFlagStats(events)
    };
  }

  private getRiskDistribution(events: AuditEvent[]): Record<string, number> {
    return events.reduce((acc, event) => {
      acc[event.riskLevel] = (acc[event.riskLevel] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }

  private getOutcomeDistribution(events: AuditEvent[]): Record<string, number> {
    return events.reduce((acc, event) => {
      acc[event.outcome] = (acc[event.outcome] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }

  private getTopUsers(events: AuditEvent[], limit: number = 10): Array<{ userId: string; count: number }> {
    const userCounts = events.reduce((acc, event) => {
      acc[event.userId] = (acc[event.userId] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return Object.entries(userCounts)
      .map(([userId, count]) => ({ userId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  private getTopActions(events: AuditEvent[], limit: number = 10): Array<{ action: string; count: number }> {
    const actionCounts = events.reduce((acc, event) => {
      acc[event.action] = (acc[event.action] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return Object.entries(actionCounts)
      .map(([action, count]) => ({ action, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  private getComplianceFlagStats(events: AuditEvent[]): Record<string, number> {
    const flagCounts: Record<string, number> = {};

    events.forEach(event => {
      event.complianceFlags?.forEach(flag => {
        flagCounts[flag] = (flagCounts[flag] || 0) + 1;
      });
    });

    return flagCounts;
  }
}