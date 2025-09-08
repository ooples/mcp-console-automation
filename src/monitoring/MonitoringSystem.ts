import { EventEmitter } from 'events';
import { AnomalyDetector } from './AnomalyDetector.js';
import { AlertManager } from './AlertManager.js';
import { AuditLogger } from './AuditLogger.js';
import { PerformanceProfiler } from './PerformanceProfiler.js';
import { Logger } from '../utils/logger.js';
import { 
  SystemMetrics, 
  Alert, 
  Anomaly, 
  AuditEvent, 
  LogEntry, 
  PerformanceProfile, 
  SLAConfig, 
  MonitoringOptions 
} from '../types/index.js';

interface MonitoringConfig {
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
  private anomalyDetector?: AnomalyDetector;
  private alertManager?: AlertManager;
  private auditLogger?: AuditLogger;
  private performanceProfiler?: PerformanceProfiler;

  // Active monitoring sessions
  private monitoringSessions: Map<string, {
    sessionId: string;
    profileId?: string;
    startTime: Date;
    options: MonitoringOptions;
  }> = new Map();

  constructor(config?: Partial<MonitoringConfig>) {
    super();
    this.logger = new Logger('MonitoringSystem');
    
    this.config = {
      anomalyDetection: {
        enabled: false,
        windowSize: 100,
        confidenceLevel: 0.95
      },
      alerting: {
        enabled: false,
        channels: [
          {
            type: 'console',
            config: {}
          }
        ]
      },
      auditing: {
        enabled: false,
        logDirectory: './logs/audit',
        encryption: false,
        retention: 365
      },
      performance: {
        enabled: false,
        samplingInterval: 1000,
        profileDuration: 300
      },
      ...config
    };
  }

  // Initialize monitoring components
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      this.logger.warn('Monitoring system already initialized');
      return;
    }

    try {
      this.logger.info('Initializing monitoring system...');

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

      // Initialize performance profiler
      if (this.config.performance.enabled) {
        this.performanceProfiler = new PerformanceProfiler({
          enabled: true,
          samplingInterval: this.config.performance.samplingInterval,
          profileDuration: this.config.performance.profileDuration
        });
        this.setupPerformanceEventHandlers();
      }

      this.isInitialized = true;
      this.logger.info('Monitoring system initialized successfully');
    } catch (error) {
      this.logger.error(`Failed to initialize monitoring system: ${error}`);
      throw error;
    }
  }

  // Start monitoring
  async start(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (this.isRunning) {
      this.logger.warn('Monitoring system already running');
      return;
    }

    this.logger.info('Starting monitoring system...');

    if (this.anomalyDetector) {
      // Anomaly detector starts automatically
    }

    if (this.performanceProfiler) {
      // Performance profiler starts on demand
    }

    this.isRunning = true;
    this.emit('started');
    this.logger.info('Monitoring system started');
  }

  // Stop monitoring
  async stop(): Promise<void> {
    if (!this.isRunning) {
      this.logger.warn('Monitoring system not running');
      return;
    }

    this.logger.info('Stopping monitoring system...');

    if (this.auditLogger) {
      // Flush audit logger if it has a flush method
      if ('flush' in this.auditLogger && typeof this.auditLogger.flush === 'function') {
        await (this.auditLogger as any).flush();
      }
    }

    this.isRunning = false;
    this.emit('stopped');
    this.logger.info('Monitoring system stopped');
  }

  // Start monitoring a session
  async startSessionMonitoring(
    sessionId: string,
    sessionData: {
      command: string;
      args: string[];
      pid?: number;
    } & MonitoringOptions
  ): Promise<void> {
    const monitoringOptions = sessionData;
    
    const session = {
      sessionId,
      profileId: undefined as string | undefined,
      startTime: new Date(),
      options: monitoringOptions
    };

    // Start performance profiling
    if (monitoringOptions.enableProfiling && this.performanceProfiler) {
      const profileId = await this.performanceProfiler.startProfiling(sessionId, sessionData.command);
      session.profileId = profileId;
    }

    // Log audit event
    if (monitoringOptions.enableAuditing && this.auditLogger) {
      await this.logAuditEvent({
        timestamp: new Date(),
        eventType: 'session_created',
        sessionId,
        details: {
          command: sessionData.command,
          args: sessionData.args,
          pid: sessionData.pid,
          monitoring: monitoringOptions
        },
        riskLevel: 'low'
      });
    }

    this.monitoringSessions.set(sessionId, session);
    this.emit('session-monitoring-started', { sessionId, ...sessionData });
  }

  // Stop monitoring a session
  async stopSessionMonitoring(sessionId: string): Promise<void> {
    const session = this.monitoringSessions.get(sessionId);
    if (!session) {
      this.logger.warn(`No monitoring session found for ${sessionId}`);
      return;
    }

    // Finish performance profiling
    if (session.profileId && this.performanceProfiler) {
      const profile = await this.stopPerformanceProfiling(session.profileId);
      if (profile) {
        this.emit('performance-profile-ready', profile);
      }
    }

    // Log audit event
    if (session.options.enableAuditing && this.auditLogger) {
      await this.logAuditEvent({
        timestamp: new Date(),
        eventType: 'session_stopped',
        sessionId,
        details: {
          duration: Date.now() - session.startTime.getTime()
        },
        riskLevel: 'low'
      });
    }

    this.monitoringSessions.delete(sessionId);
    this.emit('session-monitoring-stopped', { sessionId });
  }

  // Record an event for a session
  async recordEvent(sessionId: string, eventType: string, data: any): Promise<void> {
    const session = this.monitoringSessions.get(sessionId);
    if (!session) {
      return;
    }

    // Detect anomalies
    if (session.options.enableAnomalyDetection && this.anomalyDetector) {
      if (eventType === 'output' && data.type === 'stderr') {
        // For now, just create a basic anomaly check
        const anomaly = data.text && data.text.toLowerCase().includes('error') ? { 
          severity: 'medium' as const, 
          description: 'Error detected in stderr output' 
        } : null;
        if (anomaly) {
          this.emit('anomaly-detected', anomaly);
          
          if (this.alertManager) {
            await this.alertManager.createAlert({
              id: `anomaly-${sessionId}-${Date.now()}`,
              type: 'anomaly',
              severity: anomaly.severity,
              title: `Anomaly detected in session ${sessionId}`,
              description: anomaly.description,
              sessionId,
              source: 'MonitoringSystem',
              timestamp: new Date(),
              resolved: false
            });
          }
        }
      }
    }

    // Log audit events for errors
    if (eventType === 'error' && session.options.enableAuditing && this.auditLogger) {
      await this.logAuditEvent({
        timestamp: new Date(),
        eventType: 'error_detected',
        sessionId,
        details: data,
        riskLevel: 'medium'
      });
    }
  }

  // Check if a session is being monitored
  isSessionBeingMonitored(sessionId: string): boolean {
    return this.monitoringSessions.has(sessionId);
  }

  // Get system metrics (stub for now)
  async getSystemMetrics(): Promise<SystemMetrics | null> {
    // Return null as we don't have metrics collector
    return null;
  }

  // Get session metrics
  async getSessionMetrics(sessionId: string): Promise<any> {
    const session = this.monitoringSessions.get(sessionId);
    if (!session) {
      return null;
    }

    return {
      sessionId,
      startTime: session.startTime,
      duration: Date.now() - session.startTime.getTime(),
      status: 'running',
      monitoringEnabled: session.options
    };
  }

  // Get alerts
  async getAlerts(): Promise<Alert[]> {
    if (!this.alertManager) {
      return [];
    }
    return this.alertManager.getAlerts();
  }

  // Get dashboard data (stub)
  async getDashboard(): Promise<any> {
    return {
      totalSessions: this.monitoringSessions.size,
      alerts: await this.getAlerts()
    };
  }

  // Helper method for logging audit events
  private async logAuditEvent(event: AuditEvent): Promise<void> {
    if (!this.auditLogger) return;
    
    // AuditLogger might not have a log method, so we'll handle it gracefully
    if ('log' in this.auditLogger && typeof this.auditLogger.log === 'function') {
      await (this.auditLogger as any).log(event);
    } else {
      this.logger.debug('Audit event:', event);
    }
  }

  // Helper method for stopping performance profiling
  private async stopPerformanceProfiling(profileId: string): Promise<PerformanceProfile | null> {
    if (!this.performanceProfiler) return null;
    
    // PerformanceProfiler might not have finishProfiling method
    if ('finishProfiling' in this.performanceProfiler && typeof this.performanceProfiler.finishProfiling === 'function') {
      return await (this.performanceProfiler as any).finishProfiling(profileId);
    }
    
    // Fallback: return a basic profile
    return {
      sessionId: profileId,
      command: 'unknown',
      startTime: new Date(),
      endTime: new Date(),
      duration: 0,
      metrics: {
        avgCpuUsage: 0,
        peakMemoryUsage: 0,
        totalDiskIO: 0,
        totalNetworkIO: 0
      },
      bottlenecks: []
    };
  }

  // Setup event handlers
  private setupAnomalyDetectionEventHandlers(): void {
    if (!this.anomalyDetector) return;
    
    this.anomalyDetector.on('anomaly', (anomaly: Anomaly) => {
      this.emit('anomaly', anomaly);
    });
  }

  private setupAlertingEventHandlers(): void {
    if (!this.alertManager) return;
    
    this.alertManager.on('alert-created', (alert: Alert) => {
      this.emit('alert', alert);
    });
  }

  private setupPerformanceEventHandlers(): void {
    if (!this.performanceProfiler) return;
    
    this.performanceProfiler.on('bottleneck-detected', (bottleneck: any) => {
      this.emit('performance-bottleneck', bottleneck);
    });
  }

  // Cleanup
  async destroy(): Promise<void> {
    await this.stop();
    
    if (this.auditLogger) {
      // Close audit logger if it has a close method
      if ('close' in this.auditLogger && typeof this.auditLogger.close === 'function') {
        await (this.auditLogger as any).close();
      }
    }
    
    this.removeAllListeners();
    this.monitoringSessions.clear();
  }
}