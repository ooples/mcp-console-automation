import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import * as nodemailer from 'nodemailer';
import axios from 'axios';
import {
  Alert,
  NotificationConfig,
  NotificationTrigger,
  Anomaly,
} from '../types/index.js';
import { Logger } from '../utils/logger.js';

interface AlertRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  conditions: AlertCondition[];
  notifications: NotificationConfig[];
  cooldownMinutes: number;
  lastTriggered?: Date;
}

interface AlertCondition {
  metric: string;
  operator: 'gt' | 'lt' | 'eq' | 'ne' | 'gte' | 'lte';
  threshold: number;
  duration: number; // minutes
}

interface NotificationChannel {
  type: 'email' | 'webhook' | 'slack' | 'console';
  config: Record<string, any>;
  enabled: boolean;
}

export class AlertManager extends EventEmitter {
  private logger: Logger;
  private alerts: Map<string, Alert> = new Map();
  private alertRules: Map<string, AlertRule> = new Map();
  private notificationChannels: Map<string, NotificationChannel> = new Map();
  private metricValues: Map<string, { value: number; timestamp: Date }[]> =
    new Map();
  private isRunning: boolean = false;
  private evaluationInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.logger = new Logger('AlertManager');
    this.setupDefaultRules();
  }

  start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.logger.info('Starting alert manager');

    // Evaluate rules every minute
    this.evaluationInterval = setInterval(() => {
      this.evaluateRules();
    }, 60000);
  }

  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.evaluationInterval) {
      clearInterval(this.evaluationInterval);
      this.evaluationInterval = null;
    }

    this.logger.info('Stopped alert manager');
  }

  // Setup default alert rules
  private setupDefaultRules(): void {
    // High CPU usage alert
    this.addAlertRule({
      id: 'high-cpu-usage',
      name: 'High CPU Usage',
      description: 'Alert when CPU usage exceeds 90% for more than 5 minutes',
      enabled: true,
      conditions: [
        {
          metric: 'cpu_usage',
          operator: 'gt',
          threshold: 90,
          duration: 5,
        },
      ],
      notifications: [],
      cooldownMinutes: 15,
    });

    // High memory usage alert
    this.addAlertRule({
      id: 'high-memory-usage',
      name: 'High Memory Usage',
      description:
        'Alert when memory usage exceeds 95% for more than 3 minutes',
      enabled: true,
      conditions: [
        {
          metric: 'memory_usage',
          operator: 'gt',
          threshold: 95,
          duration: 3,
        },
      ],
      notifications: [],
      cooldownMinutes: 10,
    });

    // Session failure alert
    this.addAlertRule({
      id: 'session-failure-rate',
      name: 'High Session Failure Rate',
      description: 'Alert when session failure rate exceeds 10% in 10 minutes',
      enabled: true,
      conditions: [
        {
          metric: 'session_failure_rate',
          operator: 'gt',
          threshold: 10,
          duration: 10,
        },
      ],
      notifications: [],
      cooldownMinutes: 30,
    });

    // Disk space alert
    this.addAlertRule({
      id: 'low-disk-space',
      name: 'Low Disk Space',
      description: 'Alert when disk usage exceeds 95%',
      enabled: true,
      conditions: [
        {
          metric: 'disk_usage',
          operator: 'gt',
          threshold: 95,
          duration: 1,
        },
      ],
      notifications: [],
      cooldownMinutes: 60,
    });
  }

  // Add a new alert rule
  addAlertRule(rule: AlertRule): void {
    this.alertRules.set(rule.id, rule);
    this.logger.info(`Added alert rule: ${rule.name}`);
  }

  // Update an existing alert rule
  updateAlertRule(ruleId: string, updates: Partial<AlertRule>): void {
    const rule = this.alertRules.get(ruleId);
    if (!rule) {
      throw new Error(`Alert rule not found: ${ruleId}`);
    }

    const updatedRule = { ...rule, ...updates };
    this.alertRules.set(ruleId, updatedRule);
    this.logger.info(`Updated alert rule: ${rule.name}`);
  }

  // Remove an alert rule
  removeAlertRule(ruleId: string): void {
    const rule = this.alertRules.get(ruleId);
    if (rule) {
      this.alertRules.delete(ruleId);
      this.logger.info(`Removed alert rule: ${rule.name}`);
    }
  }

  // Add notification channel
  addNotificationChannel(
    channelId: string,
    channel: NotificationChannel
  ): void {
    this.notificationChannels.set(channelId, channel);
    this.logger.info(`Added notification channel: ${channel.type}`);
  }

  // Update metric value for rule evaluation
  updateMetricValue(metricName: string, value: number): void {
    const history = this.metricValues.get(metricName) || [];
    history.push({ value, timestamp: new Date() });

    // Keep only last 24 hours of data
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const filteredHistory = history.filter(
      (h) => h.timestamp.getTime() > cutoff
    );

    this.metricValues.set(metricName, filteredHistory);
  }

  // Process anomaly and create alert if needed
  processAnomaly(anomaly: Anomaly): void {
    const alert: Alert = {
      id: uuidv4(),
      timestamp: anomaly.timestamp,
      type: 'anomaly',
      severity: anomaly.severity,
      title: `Anomaly Detected: ${anomaly.metric}`,
      description: anomaly.description,
      sessionId: anomaly.sessionId,
      source: 'anomaly-detector',
      resolved: false,
      metadata: {
        anomalyId: anomaly.id,
        metric: anomaly.metric,
        value: anomaly.value,
        expectedValue: anomaly.expectedValue,
        deviation: anomaly.deviation,
        confidence: anomaly.confidence,
        type: anomaly.type,
      },
    };

    this.createAlert(alert);
  }

  // Create a new alert
  createAlert(alert: Alert): void {
    this.alerts.set(alert.id, alert);
    this.emit('alert-created', alert);

    // Send notifications based on alert severity and type
    this.sendNotifications(alert);

    this.logger.warn(`Alert created: ${alert.title} (${alert.severity})`);
  }

  // Resolve an alert
  resolveAlert(alertId: string, resolution?: string): void {
    const alert = this.alerts.get(alertId);
    if (!alert) {
      throw new Error(`Alert not found: ${alertId}`);
    }

    alert.resolved = true;
    alert.resolvedAt = new Date();
    if (resolution) {
      alert.metadata = { ...alert.metadata, resolution };
    }

    this.alerts.set(alertId, alert);
    this.emit('alert-resolved', alert);
    this.logger.info(`Alert resolved: ${alert.title}`);
  }

  // Evaluate all alert rules
  private evaluateRules(): void {
    this.alertRules.forEach((rule) => {
      if (rule.enabled) {
        this.evaluateRule(rule);
      }
    });
  }

  // Evaluate a single alert rule
  private evaluateRule(rule: AlertRule): void {
    try {
      // Check cooldown period
      if (rule.lastTriggered) {
        const timeSinceLastTrigger = Date.now() - rule.lastTriggered.getTime();
        const cooldownMs = rule.cooldownMinutes * 60 * 1000;
        if (timeSinceLastTrigger < cooldownMs) {
          return; // Still in cooldown
        }
      }

      // Evaluate all conditions
      const conditionsMet = rule.conditions.every((condition) =>
        this.evaluateCondition(condition)
      );

      if (conditionsMet) {
        this.triggerRule(rule);
      }
    } catch (error) {
      this.logger.error(`Error evaluating rule ${rule.name}: ${error}`);
    }
  }

  // Evaluate a single condition
  private evaluateCondition(condition: AlertCondition): boolean {
    const metricHistory = this.metricValues.get(condition.metric);
    if (!metricHistory || metricHistory.length === 0) {
      return false;
    }

    // Check if condition has been met for the required duration
    const durationMs = condition.duration * 60 * 1000;
    const cutoff = Date.now() - durationMs;

    const recentValues = metricHistory.filter(
      (h) => h.timestamp.getTime() > cutoff
    );

    if (recentValues.length === 0) {
      return false;
    }

    // Check if all recent values meet the condition
    return recentValues.every((h) =>
      this.compareValues(h.value, condition.operator, condition.threshold)
    );
  }

  // Compare values based on operator
  private compareValues(
    value: number,
    operator: string,
    threshold: number
  ): boolean {
    switch (operator) {
      case 'gt':
        return value > threshold;
      case 'lt':
        return value < threshold;
      case 'eq':
        return value === threshold;
      case 'ne':
        return value !== threshold;
      case 'gte':
        return value >= threshold;
      case 'lte':
        return value <= threshold;
      default:
        return false;
    }
  }

  // Trigger an alert rule
  private triggerRule(rule: AlertRule): void {
    const alert: Alert = {
      id: uuidv4(),
      timestamp: new Date(),
      type: 'performance',
      severity: this.getSeverityFromRule(rule),
      title: rule.name,
      description: rule.description,
      source: 'alert-manager',
      resolved: false,
      metadata: {
        ruleId: rule.id,
        conditions: rule.conditions,
      },
    };

    rule.lastTriggered = new Date();
    this.alertRules.set(rule.id, rule);

    this.createAlert(alert);
  }

  // Determine severity from rule
  private getSeverityFromRule(
    rule: AlertRule
  ): 'low' | 'medium' | 'high' | 'critical' {
    // Simple heuristic based on thresholds
    const hasHighThresholds = rule.conditions.some((c) => c.threshold > 90);
    const hasLowDuration = rule.conditions.some((c) => c.duration < 5);

    if (hasHighThresholds && hasLowDuration) return 'critical';
    if (hasHighThresholds) return 'high';
    if (hasLowDuration) return 'medium';
    return 'low';
  }

  // Send notifications for an alert
  private async sendNotifications(alert: Alert): Promise<void> {
    // Send notifications based on alert severity
    const relevantChannels = Array.from(
      this.notificationChannels.values()
    ).filter((channel) => channel.enabled);

    for (const channel of relevantChannels) {
      try {
        await this.sendNotification(channel, alert);
      } catch (error) {
        this.logger.error(
          `Failed to send notification via ${channel.type}: ${error}`
        );
      }
    }
  }

  // Send notification through specific channel
  private async sendNotification(
    channel: NotificationChannel,
    alert: Alert
  ): Promise<void> {
    switch (channel.type) {
      case 'email':
        await this.sendEmailNotification(channel.config, alert);
        break;
      case 'webhook':
        await this.sendWebhookNotification(channel.config, alert);
        break;
      case 'slack':
        await this.sendSlackNotification(channel.config, alert);
        break;
      case 'console':
        this.sendConsoleNotification(alert);
        break;
      default:
        this.logger.warn(`Unknown notification channel type: ${channel.type}`);
    }
  }

  // Send email notification
  private async sendEmailNotification(
    config: any,
    alert: Alert
  ): Promise<void> {
    if (!config.smtp) {
      throw new Error('SMTP configuration required for email notifications');
    }

    const transporter = nodemailer.createTransport(config.smtp);

    const subject = `[${alert.severity.toUpperCase()}] ${alert.title}`;
    const html = this.generateEmailHTML(alert);

    await transporter.sendMail({
      from: config.from,
      to: config.to,
      subject,
      html,
    });

    this.logger.info(`Email notification sent for alert: ${alert.title}`);
  }

  // Send webhook notification
  private async sendWebhookNotification(
    config: any,
    alert: Alert
  ): Promise<void> {
    const payload = {
      alert,
      timestamp: alert.timestamp.toISOString(),
      severity: alert.severity,
      title: alert.title,
      description: alert.description,
    };

    await axios.post(config.url, payload, {
      headers: {
        'Content-Type': 'application/json',
        ...config.headers,
      },
      timeout: 10000,
    });

    this.logger.info(`Webhook notification sent for alert: ${alert.title}`);
  }

  // Send Slack notification
  private async sendSlackNotification(
    config: any,
    alert: Alert
  ): Promise<void> {
    const color = this.getSlackColor(alert.severity);
    const payload = {
      text: `Alert: ${alert.title}`,
      attachments: [
        {
          color,
          title: alert.title,
          text: alert.description,
          fields: [
            {
              title: 'Severity',
              value: alert.severity.toUpperCase(),
              short: true,
            },
            {
              title: 'Time',
              value: alert.timestamp.toISOString(),
              short: true,
            },
            {
              title: 'Source',
              value: alert.source,
              short: true,
            },
          ],
          footer: 'Console Automation MCP',
          ts: Math.floor(alert.timestamp.getTime() / 1000),
        },
      ],
    };

    await axios.post(config.webhookUrl, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000,
    });

    this.logger.info(`Slack notification sent for alert: ${alert.title}`);
  }

  // Send console notification
  private sendConsoleNotification(alert: Alert): void {
    const severity = alert.severity.toUpperCase();
    const timestamp = alert.timestamp.toISOString();
    console.log(
      `[${timestamp}] [ALERT-${severity}] ${alert.title}: ${alert.description}`
    );
  }

  // Generate HTML for email notifications
  private generateEmailHTML(alert: Alert): string {
    const severityColor = this.getSeverityColor(alert.severity);

    return `
      <html>
        <body style="font-family: Arial, sans-serif; margin: 20px;">
          <div style="border-left: 4px solid ${severityColor}; padding-left: 20px;">
            <h2 style="color: ${severityColor}; margin-top: 0;">
              ${alert.title}
            </h2>
            <p><strong>Severity:</strong> ${alert.severity.toUpperCase()}</p>
            <p><strong>Time:</strong> ${alert.timestamp.toISOString()}</p>
            <p><strong>Source:</strong> ${alert.source}</p>
            ${alert.sessionId ? `<p><strong>Session ID:</strong> ${alert.sessionId}</p>` : ''}
            <p><strong>Description:</strong></p>
            <p>${alert.description}</p>
            ${
              alert.metadata
                ? `
              <details>
                <summary>Additional Details</summary>
                <pre>${JSON.stringify(alert.metadata, null, 2)}</pre>
              </details>
            `
                : ''
            }
          </div>
        </body>
      </html>
    `;
  }

  // Get color for severity
  private getSeverityColor(severity: string): string {
    switch (severity) {
      case 'critical':
        return '#DC2626';
      case 'high':
        return '#EA580C';
      case 'medium':
        return '#D97706';
      case 'low':
        return '#65A30D';
      default:
        return '#6B7280';
    }
  }

  // Get Slack color for severity
  private getSlackColor(severity: string): string {
    switch (severity) {
      case 'critical':
        return 'danger';
      case 'high':
        return 'warning';
      case 'medium':
        return '#D97706';
      case 'low':
        return 'good';
      default:
        return '#6B7280';
    }
  }

  // Get all alerts
  getAlerts(): Alert[] {
    return Array.from(this.alerts.values());
  }

  // Get active (unresolved) alerts
  getActiveAlerts(): Alert[] {
    return Array.from(this.alerts.values()).filter((alert) => !alert.resolved);
  }

  // Get alerts by severity
  getAlertsBySeverity(
    severity: 'low' | 'medium' | 'high' | 'critical'
  ): Alert[] {
    return Array.from(this.alerts.values()).filter(
      (alert) => alert.severity === severity
    );
  }

  // Get alerts for time range
  getAlertsInTimeRange(startTime: Date, endTime: Date): Alert[] {
    return Array.from(this.alerts.values()).filter(
      (alert) => alert.timestamp >= startTime && alert.timestamp <= endTime
    );
  }

  // Get alert statistics
  getStats(): {
    totalAlerts: number;
    activeAlerts: number;
    alertsBySeverity: Record<string, number>;
    alertsByType: Record<string, number>;
    rulesEnabled: number;
    rulesTotal: number;
    notificationChannels: number;
  } {
    const alerts = Array.from(this.alerts.values());
    const activeAlerts = alerts.filter((a) => !a.resolved);

    const alertsBySeverity = {
      low: alerts.filter((a) => a.severity === 'low').length,
      medium: alerts.filter((a) => a.severity === 'medium').length,
      high: alerts.filter((a) => a.severity === 'high').length,
      critical: alerts.filter((a) => a.severity === 'critical').length,
    };

    const alertsByType = {
      performance: alerts.filter((a) => a.type === 'performance').length,
      error: alerts.filter((a) => a.type === 'error').length,
      security: alerts.filter((a) => a.type === 'security').length,
      compliance: alerts.filter((a) => a.type === 'compliance').length,
      anomaly: alerts.filter((a) => a.type === 'anomaly').length,
    };

    const rules = Array.from(this.alertRules.values());

    return {
      totalAlerts: alerts.length,
      activeAlerts: activeAlerts.length,
      alertsBySeverity,
      alertsByType,
      rulesEnabled: rules.filter((r) => r.enabled).length,
      rulesTotal: rules.length,
      notificationChannels: this.notificationChannels.size,
    };
  }

  // Clear old alerts to prevent memory leaks
  cleanupOldAlerts(maxAge: number = 7 * 24 * 60 * 60 * 1000): void {
    // 7 days default
    const cutoff = Date.now() - maxAge;

    Array.from(this.alerts.entries()).forEach(([id, alert]) => {
      if (alert.timestamp.getTime() < cutoff) {
        this.alerts.delete(id);
      }
    });
  }

  destroy(): void {
    this.stop();
    this.alerts.clear();
    this.alertRules.clear();
    this.notificationChannels.clear();
    this.metricValues.clear();
    this.removeAllListeners();
  }
}
