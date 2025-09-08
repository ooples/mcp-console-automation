import { EventEmitter } from 'events';
import { MetricsCollector } from './MetricsCollector.js';
import { TracingManager } from './TracingManager.js';
import { AnomalyDetector } from './AnomalyDetector.js';
import { AlertManager } from './AlertManager.js';
import { AuditLogger } from './AuditLogger.js';
import { LogAggregator } from './LogAggregator.js';
import { MonitoringDashboard } from './MonitoringDashboard.js';
import { PerformanceProfiler } from './PerformanceProfiler.js';
import { Logger } from '../utils/logger.js';
import { SystemMetrics, Alert, Anomaly, AuditEvent, LogEntry, PerformanceProfile, SLAConfig, MonitoringOptions } from '../types/index.js';

interface MonitoringConfig {
  metrics: {
    enabled: boolean;
    collectionInterval: number;
  };
  tracing: {
    enabled: boolean;
    serviceName: string;
    agentHost?: string;
    agentPort?: number;
  };
  anomalyDetection: {
    enabled: boolean;
    windowSize: number;
    confidenceLevel: number;
  };
  alerting: {
    enabled: boolean;
    channels: Array<{
      type: 'email' | 'webhook' | 'slack' | 'console';
      config: Record<string, any>;
    }>;
  };
  auditing: {
    enabled: boolean;
    logDirectory: string;
    encryption: boolean;
    retention: number;
  };
  logAggregation: {
    enabled: boolean;
    sources: Array<{
      id: string;
      name: string;
      type: string;
      config: Record<string, any>;
    }>;
  };
  dashboard: {
    enabled: boolean;
    port: number;
  };
  performance: {
    enabled: boolean;
    samplingInterval: number;
    profileDuration: number;
  };
}

export class MonitoringSystem extends EventEmitter {
  private logger: Logger;
  private config: MonitoringConfig;
  private isInitialized: boolean = false;
  private isRunning: boolean = false;

  // Monitoring components
  private metricsCollector?: MetricsCollector;
  private tracingManager?: TracingManager;
  private anomalyDetector?: AnomalyDetector;
  private alertManager?: AlertManager;
  private auditLogger?: AuditLogger;
  private logAggregator?: LogAggregator;
  private monitoringDashboard?: MonitoringDashboard;
  private performanceProfiler?: PerformanceProfiler;

  // Active monitoring sessions
  private monitoringSessions: Map<string, {
    sessionId: string;
    traceId?: string;
    profileId?: string;
    startTime: Date;
    options: MonitoringOptions;
  }> = new Map();

  constructor(config?: Partial<MonitoringConfig>) {
    super();
    this.logger = new Logger('MonitoringSystem');
    
    this.config = {
      metrics: {
        enabled: true,
        collectionInterval: 5000
      },
      tracing: {
        enabled: true,
        serviceName: 'console-automation-mcp',
        agentHost: 'localhost',
        agentPort: 6832
      },
      anomalyDetection: {
        enabled: true,
        windowSize: 100,
        confidenceLevel: 0.95
      },
      alerting: {
        enabled: true,
        channels: [
          {
            type: 'console',
            config: {}
          }
        ]
      },
      auditing: {
        enabled: true,
        logDirectory: './logs/audit',
        encryption: false,
        retention: 365
      },
      logAggregation: {
        enabled: true,
        sources: []
      },
      dashboard: {
        enabled: true,
        port: 3001
      },
      performance: {
        enabled: true,
        samplingInterval: 1000,
        profileDuration: 300
      },
      ...config
    };
  }

  // Initialize all monitoring components
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      this.logger.warn('Monitoring system already initialized');
      return;
    }

    try {
      this.logger.info('Initializing monitoring system...');

      // Initialize metrics collection
      if (this.config.metrics.enabled) {
        this.metricsCollector = new MetricsCollector(this.config.metrics.collectionInterval);
        this.setupMetricsEventHandlers();
      }

      // Initialize distributed tracing
      if (this.config.tracing.enabled) {
        this.tracingManager = new TracingManager();
        this.tracingManager.initialize(this.config.tracing);
      }

      // Initialize anomaly detection
      if (this.config.anomalyDetection.enabled) {
        this.anomalyDetector = new AnomalyDetector({
          enabled: true,
          statisticalConfig: {
            windowSize: this.config.anomalyDetection.windowSize,
            confidenceLevel: this.config.anomalyDetection.confidenceLevel,
            seasonalityPeriod: 24
          }
        });
        this.setupAnomalyDetectionEventHandlers();
      }

      // Initialize alert management
      if (this.config.alerting.enabled) {
        this.alertManager = new AlertManager();
        this.setupAlertingEventHandlers();
        
        // Setup notification channels
        this.config.alerting.channels.forEach((channel, index) => {
          this.alertManager!.addNotificationChannel(`channel-${index}`, {
            type: channel.type as any,
            config: channel.config,
            enabled: true
          });
        });
      }

      // Initialize audit logging
      if (this.config.auditing.enabled) {
        this.auditLogger = new AuditLogger({
          enabled: true,
          logDirectory: this.config.auditing.logDirectory,
          encryption: {
            enabled: this.config.auditing.encryption,
            algorithm: 'aes-256-cbc',
            key: process.env.AUDIT_ENCRYPTION_KEY || 'default-key'
          },
          retention: {
            days: this.config.auditing.retention,
            maxFileSizeMB: 100,
            compressionEnabled: true
          }
        });
        await this.auditLogger.initialize();
      }

      // Initialize log aggregation
      if (this.config.logAggregation.enabled) {
        this.logAggregator = new LogAggregator({
          enabled: true,
          sources: this.config.logAggregation.sources as any
        });
        await this.logAggregator.initialize();
        this.setupLogAggregationEventHandlers();
      }

      // Initialize performance profiler
      if (this.config.performance.enabled) {
        this.performanceProfiler = new PerformanceProfiler({
          enabled: true,
          samplingInterval: this.config.performance.samplingInterval,
          profileDuration: this.config.performance.profileDuration
        });
        this.setupPerformanceEventHandlers();
      }

      // Initialize monitoring dashboard
      if (this.config.dashboard.enabled) {
        this.monitoringDashboard = new MonitoringDashboard(this.config.dashboard.port);
        this.monitoringDashboard.initialize({
          metricsCollector: this.metricsCollector,
          alertManager: this.alertManager,
          anomalyDetector: this.anomalyDetector
        });
      }

      this.isInitialized = true;
      this.logger.info('Monitoring system initialized successfully');
    } catch (error) {
      this.logger.error(`Failed to initialize monitoring system: ${error}`);
      throw error;
    }
  }

  // Start all monitoring components
  async start(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (this.isRunning) {
      this.logger.warn('Monitoring system already running');
      return;
    }

    try {
      this.logger.info('Starting monitoring system...');

      // Start metrics collection
      if (this.metricsCollector) {
        await this.metricsCollector.startCollection();
      }

      // Start anomaly detection
      if (this.anomalyDetector) {
        this.anomalyDetector.start();
      }

      // Start alert management
      if (this.alertManager) {
        this.alertManager.start();
      }

      // Start performance profiler
      if (this.performanceProfiler) {
        this.performanceProfiler.start();
      }

      // Start monitoring dashboard
      if (this.monitoringDashboard) {
        await this.monitoringDashboard.start();
      }

      this.isRunning = true;
      this.logger.info('Monitoring system started successfully');
      this.emit('monitoring-started');

    } catch (error) {
      this.logger.error(`Failed to start monitoring system: ${error}`);
      throw error;
    }
  }

  // Stop all monitoring components
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      this.logger.info('Stopping monitoring system...');

      // Stop all components
      if (this.metricsCollector) {
        this.metricsCollector.stopCollection();
      }

      if (this.anomalyDetector) {
        this.anomalyDetector.stop();
      }

      if (this.alertManager) {
        this.alertManager.stop();
      }

      if (this.performanceProfiler) {
        this.performanceProfiler.stop();
      }

      if (this.monitoringDashboard) {
        await this.monitoringDashboard.stop();
      }

      if (this.logAggregator) {
        this.logAggregator.stop();
      }

      // Clean up active sessions
      this.monitoringSessions.clear();

      this.isRunning = false;
      this.logger.info('Monitoring system stopped');
      this.emit('monitoring-stopped');

    } catch (error) {
      this.logger.error(`Failed to stop monitoring system: ${error}`);
      throw error;
    }
  }

  // Start monitoring a session
  async startSessionMonitoring(sessionId: string, command: string, options?: MonitoringOptions): Promise<void> {
    if (!this.isRunning) {
      this.logger.warn('Monitoring system not running');
      return;
    }

    const monitoringOptions = options || {};
    let traceId: string | undefined;
    let profileId: string | undefined;

    try {
      // Start distributed tracing
      if (monitoringOptions.enableTracing && this.tracingManager) {
        traceId = this.tracingManager.startSessionTrace(sessionId, command) || undefined;
      }

      // Start performance profiling
      if (monitoringOptions.enableProfiling && this.performanceProfiler) {
        profileId = this.performanceProfiler.startProfiling(sessionId, command);
      }

      // Log audit event
      if (monitoringOptions.enableAuditing && this.auditLogger) {
        await this.auditLogger.logSessionCreation(sessionId, command, undefined, {
          monitoring: monitoringOptions,
          traceId,
          profileId
        });
      }

      // Store monitoring session
      this.monitoringSessions.set(sessionId, {
        sessionId,
        traceId,
        profileId,
        startTime: new Date(),
        options: monitoringOptions
      });

      this.emit('session-monitoring-started', {
        sessionId,
        command,
        traceId,
        profileId,
        options: monitoringOptions
      });

      this.logger.info(`Started monitoring for session: ${sessionId}`);
    } catch (error) {
      this.logger.error(`Failed to start session monitoring: ${error}`);
    }
  }

  // Stop monitoring a session
  async stopSessionMonitoring(sessionId: string, exitCode?: number, metadata?: Record<string, any>): Promise<void> {
    const session = this.monitoringSessions.get(sessionId);
    if (!session) {
      return;
    }

    try {
      // Stop distributed tracing
      if (session.traceId && this.tracingManager) {
        this.tracingManager.finishSpan(session.traceId);
      }

      // Stop performance profiling
      let performanceProfile: PerformanceProfile | undefined;
      if (session.profileId && this.performanceProfiler) {
        performanceProfile = this.performanceProfiler.stopProfiling(session.profileId) || undefined;
      }

      // Log audit event
      if (session.options.enableAuditing && this.auditLogger) {
        await this.auditLogger.logSessionTermination(sessionId, exitCode, undefined, {
          ...metadata,
          duration: Date.now() - session.startTime.getTime(),
          performanceProfile: performanceProfile ? {
            avgCpuUsage: performanceProfile.metrics.avgCpuUsage,
            peakMemoryUsage: performanceProfile.metrics.peakMemoryUsage,
            bottlenecks: performanceProfile.bottlenecks.length
          } : undefined
        });
      }

      // Remove monitoring session
      this.monitoringSessions.delete(sessionId);

      this.emit('session-monitoring-stopped', {
        sessionId,
        exitCode,
        performanceProfile,
        duration: Date.now() - session.startTime.getTime()
      });

      this.logger.info(`Stopped monitoring for session: ${sessionId}`);
    } catch (error) {
      this.logger.error(`Failed to stop session monitoring: ${error}`);
    }
  }

  // Record command execution
  async recordCommandExecution(sessionId: string, command: string, args: string[], metadata?: Record<string, any>): Promise<void> {
    const session = this.monitoringSessions.get(sessionId);
    if (!session) {
      return;
    }

    try {
      // Add tracing span for command
      if (session.traceId && this.tracingManager) {
        const commandSpan = this.tracingManager.startCommandTrace(sessionId, command, session.traceId);
        if (commandSpan) {
          // Add metadata to span
          this.tracingManager.setSpanTag(commandSpan, 'command.args', args.join(' '));
          if (metadata) {
            Object.entries(metadata).forEach(([key, value]) => {
              this.tracingManager!.setSpanTag(commandSpan, key, value);
            });
          }
          
          // Finish span immediately for completed commands
          this.tracingManager.finishSpan(commandSpan);
        }
      }

      // Record metrics
      if (this.metricsCollector) {
        this.metricsCollector.recordCommandExecution(command, 'executed', 'auto');
      }

      // Log audit event
      if (session.options.enableAuditing && this.auditLogger) {
        await this.auditLogger.logCommandExecution(sessionId, command, args, undefined, metadata);
      }

      this.logger.debug(`Recorded command execution: ${command} for session ${sessionId}`);
    } catch (error) {
      this.logger.error(`Failed to record command execution: ${error}`);
    }
  }

  // Record error detection
  async recordErrorDetection(sessionId: string, errors: any[], metadata?: Record<string, any>): Promise<void> {
    const session = this.monitoringSessions.get(sessionId);
    if (!session) {
      return;
    }

    try {
      // Record metrics
      if (this.metricsCollector) {
        errors.forEach(error => {
          this.metricsCollector!.recordSessionError(sessionId, error.type || 'unknown', error.severity || 'medium');
        });
      }

      // Log audit event
      if (session.options.enableAuditing && this.auditLogger) {
        await this.auditLogger.logErrorDetection(sessionId, errors, undefined, metadata);
      }

      // Create alert if errors are severe
      const severeErrors = errors.filter(e => ['high', 'critical'].includes(e.severity));
      if (severeErrors.length > 0 && this.alertManager) {
        const alert: Alert = {
          id: `error-${sessionId}-${Date.now()}`,
          timestamp: new Date(),
          type: 'error',
          severity: severeErrors.some(e => e.severity === 'critical') ? 'critical' : 'high',
          title: `Errors detected in session ${sessionId}`,
          description: `${severeErrors.length} severe errors detected: ${severeErrors.map(e => e.message).join(', ')}`,
          sessionId,
          source: 'error-detector',
          resolved: false,
          metadata: { errors: severeErrors }
        };

        this.alertManager.createAlert(alert);
      }

      this.logger.debug(`Recorded error detection: ${errors.length} errors for session ${sessionId}`);
    } catch (error) {
      this.logger.error(`Failed to record error detection: ${error}`);
    }
  }

  // Check SLA compliance
  async checkSLACompliance(sessionId: string, slaConfig: SLAConfig): Promise<boolean> {
    if (!this.performanceProfiler) {
      return true;
    }

    try {
      const compliant = this.performanceProfiler.checkSLACompliance(sessionId, slaConfig);
      
      if (!compliant && this.auditLogger) {
        await this.auditLogger.logSLABreach(
          sessionId,
          'multiple',
          0, // threshold
          0, // actual
          undefined
        );
      }

      return compliant;
    } catch (error) {
      this.logger.error(`Failed to check SLA compliance: ${error}`);
      return true;
    }
  }

  // Setup event handlers for metrics collector
  private setupMetricsEventHandlers(): void {
    if (!this.metricsCollector) return;

    this.metricsCollector.on('metrics', (metrics: SystemMetrics) => {
      // Pass metrics to anomaly detector
      if (this.anomalyDetector) {
        this.anomalyDetector.processSystemMetrics(metrics);
      }

      // Update alert manager with metric values
      if (this.alertManager) {
        this.alertManager.updateMetricValue('cpu_usage', metrics.cpu.usage);
        this.alertManager.updateMetricValue('memory_usage', metrics.memory.percentage);
        this.alertManager.updateMetricValue('disk_usage', metrics.disk.percentage);
      }

      // Emit to external listeners
      this.emit('metrics', metrics);
    });
  }

  // Setup event handlers for anomaly detector
  private setupAnomalyDetectionEventHandlers(): void {
    if (!this.anomalyDetector) return;

    this.anomalyDetector.on('anomaly-detected', (anomaly: Anomaly) => {
      // Pass anomaly to alert manager
      if (this.alertManager) {
        this.alertManager.processAnomaly(anomaly);
      }

      this.emit('anomaly-detected', anomaly);
    });
  }

  // Setup event handlers for alert manager
  private setupAlertingEventHandlers(): void {
    if (!this.alertManager) return;

    this.alertManager.on('alert-created', (alert: Alert) => {
      this.emit('alert-created', alert);
    });

    this.alertManager.on('alert-resolved', (alert: Alert) => {
      this.emit('alert-resolved', alert);
    });
  }

  // Setup event handlers for log aggregator
  private setupLogAggregationEventHandlers(): void {
    if (!this.logAggregator) return;

    this.logAggregator.on('log-entry', (entry: LogEntry) => {
      this.emit('log-entry', entry);
    });

    this.logAggregator.on('pattern-alert', (alert: any) => {
      this.emit('pattern-alert', alert);
    });
  }

  // Setup event handlers for performance profiler
  private setupPerformanceEventHandlers(): void {
    if (!this.performanceProfiler) return;

    this.performanceProfiler.on('bottleneck-detected', (bottleneck: any, sessionId?: string) => {
      this.emit('bottleneck-detected', bottleneck, sessionId);
    });

    this.performanceProfiler.on('sla-breach', (breach: any, sessionId: string) => {
      this.emit('sla-breach', breach, sessionId);
    });

    this.performanceProfiler.on('profile-completed', (profile: PerformanceProfile) => {
      this.emit('profile-completed', profile);
    });
  }

  // Get monitoring statistics
  getMonitoringStats(): {
    isRunning: boolean;
    activeSessions: number;
    components: {
      metricsCollector: boolean;
      tracingManager: boolean;
      anomalyDetector: boolean;
      alertManager: boolean;
      auditLogger: boolean;
      logAggregator: boolean;
      performanceProfiler: boolean;
      monitoringDashboard: boolean;
    };
    stats: {
      metrics?: any;
      alerts?: any;
      anomalies?: any;
      performance?: any;
      audit?: any;
      logs?: any;
      tracing?: any;
      dashboard?: any;
    };
  } {
    return {
      isRunning: this.isRunning,
      activeSessions: this.monitoringSessions.size,
      components: {
        metricsCollector: !!this.metricsCollector,
        tracingManager: !!this.tracingManager,
        anomalyDetector: !!this.anomalyDetector,
        alertManager: !!this.alertManager,
        auditLogger: !!this.auditLogger,
        logAggregator: !!this.logAggregator,
        performanceProfiler: !!this.performanceProfiler,
        monitoringDashboard: !!this.monitoringDashboard
      },
      stats: {
        metrics: this.metricsCollector ? {} : undefined,
        alerts: this.alertManager?.getStats(),
        anomalies: this.anomalyDetector?.getStats(),
        performance: this.performanceProfiler?.getPerformanceStats(),
        audit: this.auditLogger?.getAuditStats(),
        logs: this.logAggregator?.getStats(),
        tracing: this.tracingManager?.getStats(),
        dashboard: this.monitoringDashboard?.getStats()
      }
    };
  }

  // Get monitoring session info
  getMonitoringSession(sessionId: string): any {
    return this.monitoringSessions.get(sessionId);
  }

  // Get all active monitoring sessions
  getActiveMonitoringSessions(): any[] {
    return Array.from(this.monitoringSessions.values());
  }

  // Get component instances (for advanced usage)
  getComponents(): {
    metricsCollector?: MetricsCollector;
    tracingManager?: TracingManager;
    anomalyDetector?: AnomalyDetector;
    alertManager?: AlertManager;
    auditLogger?: AuditLogger;
    logAggregator?: LogAggregator;
    performanceProfiler?: PerformanceProfiler;
    monitoringDashboard?: MonitoringDashboard;
  } {
    return {
      metricsCollector: this.metricsCollector,
      tracingManager: this.tracingManager,
      anomalyDetector: this.anomalyDetector,
      alertManager: this.alertManager,
      auditLogger: this.auditLogger,
      logAggregator: this.logAggregator,
      performanceProfiler: this.performanceProfiler,
      monitoringDashboard: this.monitoringDashboard
    };
  }

  // Destroy the monitoring system
  async destroy(): Promise<void> {
    try {
      await this.stop();

      // Destroy all components
      this.metricsCollector?.destroy();
      this.tracingManager?.destroy();
      this.anomalyDetector?.destroy();
      this.alertManager?.destroy();
      this.auditLogger?.destroy();
      this.logAggregator?.destroy();
      this.performanceProfiler?.destroy();
      this.monitoringDashboard?.destroy();

      this.monitoringSessions.clear();
      this.removeAllListeners();

      this.logger.info('Monitoring system destroyed');
    } catch (error) {
      this.logger.error(`Failed to destroy monitoring system: ${error}`);
    }
  }
}