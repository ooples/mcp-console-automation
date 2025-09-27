import { EventEmitter } from 'events';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { Logger } from '../utils/logger.js';

interface DiagnosticEvent {
  id: string;
  timestamp: Date;
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  category: string;
  operation: string;
  sessionId?: string;
  message: string;
  data?: any;
  stack?: string;
  duration?: number;
  metadata?: Record<string, any>;
}

interface SessionDiagnostics {
  sessionId: string;
  createdAt: Date;
  lastActivity: Date;
  state: 'initializing' | 'ready' | 'active' | 'idle' | 'error' | 'terminated';
  operations: OperationTrace[];
  errors: ErrorTrace[];
  performance: PerformanceMetrics;
  networkStats?: NetworkDiagnostics;
  resourceUsage: ResourceMetrics;
  stateTransitions: StateTransition[];
  commandQueue: CommandQueueDiagnostics;
  healthChecks: HealthCheckResult[];
}

interface OperationTrace {
  operationId: string;
  operationName: string;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'timeout';
  input?: any;
  output?: any;
  error?: string;
  retries?: number;
  metadata?: Record<string, any>;
}

interface ErrorTrace {
  errorId: string;
  timestamp: Date;
  errorType: string;
  errorMessage: string;
  stack?: string;
  context: Record<string, any>;
  recoveryAttempted: boolean;
  recoverySuccess?: boolean;
  impact: 'low' | 'medium' | 'high' | 'critical';
}

interface PerformanceMetrics {
  avgResponseTime: number;
  maxResponseTime: number;
  minResponseTime: number;
  totalOperations: number;
  failedOperations: number;
  successRate: number;
  throughput: number;
  latencyP50: number;
  latencyP95: number;
  latencyP99: number;
}

interface NetworkDiagnostics {
  connectionType: string;
  connectionState: 'connected' | 'disconnected' | 'reconnecting' | 'error';
  latency: number;
  packetLoss: number;
  bandwidth: number;
  lastPingTime?: Date;
  reconnectAttempts: number;
  sshDetails?: {
    host: string;
    port: number;
    username: string;
    authMethod: 'password' | 'key' | 'agent';
    compressionEnabled: boolean;
    keepAliveInterval: number;
    lastKeepAlive?: Date;
  };
}

interface ResourceMetrics {
  cpuUsage: number;
  memoryUsage: number;
  memoryLimit: number;
  outputBufferSize: number;
  commandQueueSize: number;
  activeHandlers: number;
  fileDescriptors?: number;
}

interface StateTransition {
  fromState: string;
  toState: string;
  timestamp: Date;
  trigger: string;
  duration: number;
  metadata?: Record<string, any>;
}

interface CommandQueueDiagnostics {
  queueSize: number;
  processingRate: number;
  averageWaitTime: number;
  droppedCommands: number;
  retriedCommands: number;
  lastProcessedTime?: Date;
  queueState: 'idle' | 'processing' | 'blocked' | 'error';
  blockReason?: string;
}

interface HealthCheckResult {
  timestamp: Date;
  checkType: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  details: Record<string, any>;
  recommendations?: string[];
}

interface DiagnosticReport {
  reportId: string;
  generatedAt: Date;
  systemInfo: SystemDiagnostics;
  sessions: SessionDiagnostics[];
  recentEvents: DiagnosticEvent[];
  alerts: DiagnosticAlert[];
  recommendations: string[];
  performanceSummary: PerformanceMetrics;
  errorSummary: ErrorSummary;
}

interface SystemDiagnostics {
  version: string;
  uptime: number;
  platform: string;
  nodeVersion: string;
  totalSessions: number;
  activeSessions: number;
  failedSessions: number;
  systemResources: ResourceMetrics;
  configuration: Record<string, any>;
}

interface DiagnosticAlert {
  alertId: string;
  timestamp: Date;
  severity: 'info' | 'warning' | 'error' | 'critical';
  category: string;
  message: string;
  affectedSessions?: string[];
  suggestedAction?: string;
  autoResolved: boolean;
  resolvedAt?: Date;
}

interface ErrorSummary {
  totalErrors: number;
  errorsByType: Record<string, number>;
  errorsBySession: Record<string, number>;
  topErrors: { error: string; count: number; lastOccurred: Date }[];
  errorTrend: 'increasing' | 'stable' | 'decreasing';
}

interface DiagnosticMetrics {
  totalSessions: number;
  failedSessions: number;
  averageResponseTime: number;
  successRate: number;
  sessions: Record<string, any>;
}

export class DiagnosticsManager extends EventEmitter {
  private static instance: DiagnosticsManager | null = null;
  private logger: Logger;
  private events: DiagnosticEvent[] = [];
  private sessionDiagnostics: Map<string, SessionDiagnostics> = new Map();
  private alerts: DiagnosticAlert[] = [];
  private operationTraces: Map<string, OperationTrace> = new Map();
  private performanceData: Map<string, number[]> = new Map();
  private maxEventsStored = 10000;
  private diagnosticsDir = './diagnostics';
  private metricsInterval: NodeJS.Timeout | null = null;
  private isRecording = true;
  private verboseMode = false;

  constructor(private config: {
    enableDiagnostics?: boolean;
    verboseLogging?: boolean;
    persistDiagnostics?: boolean;
    diagnosticsPath?: string;
    maxEventHistory?: number;
    metricsIntervalMs?: number;
  } = {}) {
    super();
    this.logger = new Logger('DiagnosticsManager');
    this.diagnosticsDir = config.diagnosticsPath || './diagnostics';
    this.maxEventsStored = config.maxEventHistory || 10000;
    this.verboseMode = config.verboseLogging || false;
    this.isRecording = config.enableDiagnostics !== false;

    if (config.persistDiagnostics) {
      this.ensureDiagnosticsDirectory();
    }

    if (config.metricsIntervalMs) {
      this.startMetricsCollection(config.metricsIntervalMs);
    }

    this.logger.info('DiagnosticsManager initialized', { config });
  }

  static getInstance(config?: {
    enableDiagnostics?: boolean;
    verboseLogging?: boolean;
    persistDiagnostics?: boolean;
    diagnosticsPath?: string;
    maxEventHistory?: number;
    metricsIntervalMs?: number;
  }): DiagnosticsManager {
    if (!DiagnosticsManager.instance) {
      DiagnosticsManager.instance = new DiagnosticsManager(config || {});
    }
    return DiagnosticsManager.instance;
  }

  private ensureDiagnosticsDirectory() {
    if (!existsSync(this.diagnosticsDir)) {
      mkdirSync(this.diagnosticsDir, { recursive: true });
    }
  }

  // Core diagnostic recording
  recordEvent(event: Omit<DiagnosticEvent, 'id' | 'timestamp'>): string {
    if (!this.isRecording) return '';

    const diagnosticEvent: DiagnosticEvent = {
      id: this.generateEventId(),
      timestamp: new Date(),
      ...event
    };

    this.events.push(diagnosticEvent);
    
    // Trim old events
    if (this.events.length > this.maxEventsStored) {
      this.events = this.events.slice(-this.maxEventsStored);
    }

    // Log based on level
    this.logEvent(diagnosticEvent);

    // Check for alert conditions
    this.checkAlertConditions(diagnosticEvent);

    // Emit for real-time monitoring
    this.emit('diagnostic-event', diagnosticEvent);

    return diagnosticEvent.id;
  }

  private logEvent(event: DiagnosticEvent) {
    const logMessage = `[${event.category}] ${event.operation}: ${event.message}`;
    
    if (this.verboseMode || event.level === 'error' || event.level === 'fatal') {
      const logData = {
        sessionId: event.sessionId,
        data: event.data,
        metadata: event.metadata,
        stack: event.stack
      };

      switch (event.level) {
        case 'trace':
        case 'debug':
          this.logger.debug(logMessage, logData);
          break;
        case 'info':
          this.logger.info(logMessage, logData);
          break;
        case 'warn':
          this.logger.warn(logMessage, logData);
          break;
        case 'error':
          this.logger.error(logMessage, logData);
          break;
        case 'fatal':
          this.logger.error(`FATAL: ${logMessage}`, logData);
          break;
      }
    }
  }

  // Session lifecycle tracking
  startSessionDiagnostics(sessionId: string, metadata?: Record<string, any>): void {
    const diagnostics: SessionDiagnostics = {
      sessionId,
      createdAt: new Date(),
      lastActivity: new Date(),
      state: 'initializing',
      operations: [],
      errors: [],
      performance: this.createEmptyPerformanceMetrics(),
      resourceUsage: this.getCurrentResourceMetrics(),
      stateTransitions: [],
      commandQueue: this.createEmptyCommandQueueDiagnostics(),
      healthChecks: []
    };

    this.sessionDiagnostics.set(sessionId, diagnostics);

    this.recordEvent({
      level: 'info',
      category: 'session',
      operation: 'session_start',
      sessionId,
      message: `Session ${sessionId} diagnostics started`,
      data: metadata
    });
  }

  updateSessionState(sessionId: string, newState: SessionDiagnostics['state'], trigger: string): void {
    const diagnostics = this.sessionDiagnostics.get(sessionId);
    if (!diagnostics) {
      this.recordEvent({
        level: 'warn',
        category: 'session',
        operation: 'state_update_failed',
        sessionId,
        message: `Cannot update state for unknown session ${sessionId}`
      });
      return;
    }

    const oldState = diagnostics.state;
    const transitionStart = Date.now();
    
    diagnostics.state = newState;
    diagnostics.lastActivity = new Date();

    const transition: StateTransition = {
      fromState: oldState,
      toState: newState,
      timestamp: new Date(),
      trigger,
      duration: Date.now() - transitionStart
    };

    diagnostics.stateTransitions.push(transition);

    this.recordEvent({
      level: 'debug',
      category: 'session',
      operation: 'state_transition',
      sessionId,
      message: `Session state: ${oldState} -> ${newState}`,
      data: { transition, trigger }
    });
  }

  // Operation tracking
  startOperation(sessionId: string, operationName: string, input?: any): string {
    const operationId = this.generateOperationId();
    
    const trace: OperationTrace = {
      operationId,
      operationName,
      startTime: new Date(),
      status: 'running',
      input
    };

    this.operationTraces.set(operationId, trace);

    // Add to session diagnostics
    const diagnostics = this.sessionDiagnostics.get(sessionId);
    if (diagnostics) {
      diagnostics.operations.push(trace);
      diagnostics.lastActivity = new Date();
    }

    this.recordEvent({
      level: 'debug',
      category: 'operation',
      operation: 'start',
      sessionId,
      message: `Starting operation: ${operationName}`,
      data: { operationId, input }
    });

    return operationId;
  }

  endOperation(operationId: string, status: 'completed' | 'failed' | 'timeout', output?: any, error?: string): void {
    const trace = this.operationTraces.get(operationId);
    if (!trace) {
      this.logger.warn(`Cannot end unknown operation: ${operationId}`);
      return;
    }

    trace.endTime = new Date();
    trace.duration = trace.endTime.getTime() - trace.startTime.getTime();
    trace.status = status;
    trace.output = output;
    trace.error = error;

    // Update performance metrics
    this.updatePerformanceMetrics(trace);

    this.recordEvent({
      level: status === 'failed' ? 'error' : 'debug',
      category: 'operation',
      operation: 'end',
      message: `Operation ${trace.operationName} ${status}`,
      data: { operationId, duration: trace.duration, status, error },
      duration: trace.duration
    });
  }

  // Error tracking
  recordError(sessionId: string, error: Error | string, context: Record<string, any>, impact: ErrorTrace['impact'] = 'medium'): string {
    const errorId = this.generateErrorId();
    
    const errorTrace: ErrorTrace = {
      errorId,
      timestamp: new Date(),
      errorType: error instanceof Error ? error.constructor.name : 'Error',
      errorMessage: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
      context,
      recoveryAttempted: false,
      impact
    };

    const diagnostics = this.sessionDiagnostics.get(sessionId);
    if (diagnostics) {
      diagnostics.errors.push(errorTrace);
      diagnostics.lastActivity = new Date();
    }

    this.recordEvent({
      level: impact === 'critical' ? 'fatal' : 'error',
      category: 'error',
      operation: 'error_recorded',
      sessionId,
      message: errorTrace.errorMessage,
      data: { errorId, context },
      stack: errorTrace.stack
    });

    // Check if we need to raise an alert
    if (impact === 'critical' || impact === 'high') {
      this.raiseAlert({
        severity: impact === 'critical' ? 'critical' : 'error',
        category: 'error',
        message: `High impact error in session ${sessionId}: ${errorTrace.errorMessage}`,
        affectedSessions: [sessionId],
        suggestedAction: 'Investigate immediately and consider session recovery'
      });
    }

    return errorId;
  }

  recordRecoveryAttempt(errorId: string, success: boolean): void {
    // Find the error across all sessions
    for (const diagnostics of this.sessionDiagnostics.values()) {
      const error = diagnostics.errors.find(e => e.errorId === errorId);
      if (error) {
        error.recoveryAttempted = true;
        error.recoverySuccess = success;
        
        this.recordEvent({
          level: success ? 'info' : 'warn',
          category: 'recovery',
          operation: 'recovery_attempt',
          sessionId: diagnostics.sessionId,
          message: `Recovery ${success ? 'successful' : 'failed'} for error ${errorId}`,
          data: { errorId, success }
        });
        break;
      }
    }
  }

  // Performance monitoring
  recordPerformanceMetric(sessionId: string, metricName: string, value: number): void {
    const key = `${sessionId}:${metricName}`;
    
    if (!this.performanceData.has(key)) {
      this.performanceData.set(key, []);
    }
    
    const values = this.performanceData.get(key)!;
    values.push(value);
    
    // Keep only recent values (last 1000)
    if (values.length > 1000) {
      values.shift();
    }

    // Check for performance degradation
    if (metricName === 'response_time' && value > 5000) {
      this.recordEvent({
        level: 'warn',
        category: 'performance',
        operation: 'slow_response',
        sessionId,
        message: `Slow response time detected: ${value}ms`,
        data: { metric: metricName, value }
      });
    }
  }

  private updatePerformanceMetrics(operation: OperationTrace): void {
    if (!operation.duration) return;

    const sessionId = this.findSessionForOperation(operation.operationId);
    if (!sessionId) return;

    const diagnostics = this.sessionDiagnostics.get(sessionId);
    if (!diagnostics) return;

    const metrics = diagnostics.performance;
    
    // Update metrics
    metrics.totalOperations++;
    if (operation.status === 'failed') {
      metrics.failedOperations++;
    }
    
    // Update response times
    const responseTimes = this.performanceData.get(`${sessionId}:response_time`) || [];
    responseTimes.push(operation.duration);
    
    if (responseTimes.length > 0) {
      metrics.avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
      metrics.maxResponseTime = Math.max(...responseTimes);
      metrics.minResponseTime = Math.min(...responseTimes);
      
      // Calculate percentiles
      const sorted = [...responseTimes].sort((a, b) => a - b);
      metrics.latencyP50 = this.getPercentile(sorted, 50);
      metrics.latencyP95 = this.getPercentile(sorted, 95);
      metrics.latencyP99 = this.getPercentile(sorted, 99);
    }
    
    metrics.successRate = ((metrics.totalOperations - metrics.failedOperations) / metrics.totalOperations) * 100;
    
    // Calculate throughput (operations per second)
    const sessionAge = Date.now() - diagnostics.createdAt.getTime();
    metrics.throughput = (metrics.totalOperations / sessionAge) * 1000;
  }

  private getPercentile(sortedValues: number[], percentile: number): number {
    const index = Math.ceil((percentile / 100) * sortedValues.length) - 1;
    return sortedValues[Math.max(0, index)];
  }

  // Health checks
  recordHealthCheck(sessionId: string, checkType: string, status: HealthCheckResult['status'], details: Record<string, any>): void {
    const diagnostics = this.sessionDiagnostics.get(sessionId);
    if (!diagnostics) return;

    const healthCheck: HealthCheckResult = {
      timestamp: new Date(),
      checkType,
      status,
      details,
      recommendations: this.generateHealthRecommendations(status, details)
    };

    diagnostics.healthChecks.push(healthCheck);
    
    // Keep only recent health checks
    if (diagnostics.healthChecks.length > 100) {
      diagnostics.healthChecks = diagnostics.healthChecks.slice(-100);
    }

    if (status === 'unhealthy') {
      this.recordEvent({
        level: 'error',
        category: 'health',
        operation: 'health_check_failed',
        sessionId,
        message: `Health check failed: ${checkType}`,
        data: { status, details }
      });
    }
  }

  private generateHealthRecommendations(status: HealthCheckResult['status'], details: Record<string, any>): string[] {
    const recommendations: string[] = [];

    if (status === 'unhealthy') {
      if (details.connectionError) {
        recommendations.push('Check network connectivity');
        recommendations.push('Verify firewall settings');
        recommendations.push('Consider reconnecting the session');
      }
      if (details.highMemoryUsage) {
        recommendations.push('Clear output buffers');
        recommendations.push('Consider restarting the session');
      }
      if (details.commandQueueBlocked) {
        recommendations.push('Check for hanging commands');
        recommendations.push('Consider sending interrupt signal (Ctrl+C)');
      }
    } else if (status === 'degraded') {
      if (details.slowResponse) {
        recommendations.push('Monitor network latency');
        recommendations.push('Check system resources');
      }
      if (details.highErrorRate) {
        recommendations.push('Review recent errors');
        recommendations.push('Consider session recovery');
      }
    }

    return recommendations;
  }

  // Alert management
  private raiseAlert(alert: Omit<DiagnosticAlert, 'alertId' | 'timestamp' | 'autoResolved' | 'resolvedAt'>): void {
    const diagnosticAlert: DiagnosticAlert = {
      alertId: this.generateAlertId(),
      timestamp: new Date(),
      autoResolved: false,
      ...alert
    };

    this.alerts.push(diagnosticAlert);
    
    // Keep only recent alerts
    if (this.alerts.length > 100) {
      this.alerts = this.alerts.slice(-100);
    }

    this.emit('diagnostic-alert', diagnosticAlert);

    this.recordEvent({
      level: alert.severity === 'critical' ? 'fatal' : alert.severity === 'error' ? 'error' : 'warn',
      category: 'alert',
      operation: 'alert_raised',
      message: alert.message,
      data: { alertId: diagnosticAlert.alertId, severity: alert.severity }
    });
  }

  private checkAlertConditions(event: DiagnosticEvent): void {
    // Check for critical patterns
    if (event.level === 'fatal') {
      this.raiseAlert({
        severity: 'critical',
        category: 'system',
        message: `Fatal error detected: ${event.message}`,
        affectedSessions: event.sessionId ? [event.sessionId] : undefined,
        suggestedAction: 'Immediate investigation required'
      });
    }

    // Check for error patterns
    if (event.level === 'error') {
      const recentErrors = this.events.filter(
        e => e.level === 'error' && 
        e.timestamp.getTime() > Date.now() - 60000 // Last minute
      );

      if (recentErrors.length > 10) {
        this.raiseAlert({
          severity: 'warning',
          category: 'error_rate',
          message: `High error rate detected: ${recentErrors.length} errors in last minute`,
          suggestedAction: 'Review error logs and consider system health check'
        });
      }
    }

    // Check for session issues
    if (event.category === 'session' && event.message.includes('not found')) {
      const sessionLostEvents = this.events.filter(
        e => e.message.includes('not found') &&
        e.timestamp.getTime() > Date.now() - 300000 // Last 5 minutes
      );

      if (sessionLostEvents.length > 5) {
        this.raiseAlert({
          severity: 'error',
          category: 'session_management',
          message: `Multiple session loss events detected: ${sessionLostEvents.length} in last 5 minutes`,
          suggestedAction: 'Check session manager and consider restart'
        });
      }
    }
  }

  // Diagnostic reports
  generateReport(): DiagnosticReport {
    return this.generateDiagnosticReport();
  }

  generateDiagnosticReport(): DiagnosticReport {
    const report: DiagnosticReport = {
      reportId: this.generateReportId(),
      generatedAt: new Date(),
      systemInfo: this.getSystemDiagnostics(),
      sessions: Array.from(this.sessionDiagnostics.values()),
      recentEvents: this.events.slice(-100), // Last 100 events
      alerts: this.alerts.filter(a => !a.autoResolved),
      recommendations: this.generateSystemRecommendations(),
      performanceSummary: this.calculateOverallPerformance(),
      errorSummary: this.generateErrorSummary()
    };

    // Persist report if configured
    if (this.config.persistDiagnostics) {
      this.persistReport(report);
    }

    return report;
  }

  private getSystemDiagnostics(): SystemDiagnostics {
    const sessions = Array.from(this.sessionDiagnostics.values());
    
    return {
      version: '1.0.0',
      uptime: process.uptime(),
      platform: process.platform,
      nodeVersion: process.version,
      totalSessions: sessions.length,
      activeSessions: sessions.filter(s => s.state === 'active').length,
      failedSessions: sessions.filter(s => s.state === 'error').length,
      systemResources: this.getCurrentResourceMetrics(),
      configuration: this.config
    };
  }

  private getCurrentResourceMetrics(): ResourceMetrics {
    const memUsage = process.memoryUsage();
    
    return {
      cpuUsage: process.cpuUsage().user / 1000000, // Convert to seconds
      memoryUsage: memUsage.heapUsed / 1024 / 1024, // MB
      memoryLimit: memUsage.heapTotal / 1024 / 1024, // MB
      outputBufferSize: 0, // Would need to be tracked
      commandQueueSize: 0, // Would need to be tracked
      activeHandlers: this.listenerCount('diagnostic-event'),
      fileDescriptors: process.platform === 'win32' ? undefined : process.getActiveResourcesInfo?.()?.length
    };
  }

  private calculateOverallPerformance(): PerformanceMetrics {
    const allMetrics: PerformanceMetrics = {
      avgResponseTime: 0,
      maxResponseTime: 0,
      minResponseTime: Number.MAX_VALUE,
      totalOperations: 0,
      failedOperations: 0,
      successRate: 0,
      throughput: 0,
      latencyP50: 0,
      latencyP95: 0,
      latencyP99: 0
    };

    const sessions = Array.from(this.sessionDiagnostics.values());
    
    if (sessions.length === 0) {
      return allMetrics;
    }

    // Aggregate metrics from all sessions
    sessions.forEach(session => {
      const metrics = session.performance;
      allMetrics.totalOperations += metrics.totalOperations;
      allMetrics.failedOperations += metrics.failedOperations;
      allMetrics.maxResponseTime = Math.max(allMetrics.maxResponseTime, metrics.maxResponseTime);
      allMetrics.minResponseTime = Math.min(allMetrics.minResponseTime, metrics.minResponseTime);
      allMetrics.avgResponseTime += metrics.avgResponseTime;
      allMetrics.throughput += metrics.throughput;
    });

    // Average the averages
    allMetrics.avgResponseTime /= sessions.length;
    allMetrics.throughput /= sessions.length;
    allMetrics.successRate = ((allMetrics.totalOperations - allMetrics.failedOperations) / allMetrics.totalOperations) * 100;

    return allMetrics;
  }

  private generateErrorSummary(): ErrorSummary {
    const allErrors: ErrorTrace[] = [];
    const errorsByType: Record<string, number> = {};
    const errorsBySession: Record<string, number> = {};

    // Collect all errors
    this.sessionDiagnostics.forEach((diagnostics, sessionId) => {
      diagnostics.errors.forEach(error => {
        allErrors.push(error);
        errorsByType[error.errorType] = (errorsByType[error.errorType] || 0) + 1;
        errorsBySession[sessionId] = (errorsBySession[sessionId] || 0) + 1;
      });
    });

    // Calculate top errors
    const errorCounts: Record<string, { count: number; lastOccurred: Date }> = {};
    allErrors.forEach(error => {
      const key = error.errorMessage;
      if (!errorCounts[key]) {
        errorCounts[key] = { count: 0, lastOccurred: error.timestamp };
      }
      errorCounts[key].count++;
      if (error.timestamp > errorCounts[key].lastOccurred) {
        errorCounts[key].lastOccurred = error.timestamp;
      }
    });

    const topErrors = Object.entries(errorCounts)
      .map(([error, data]) => ({ error, ...data }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Determine trend
    const recentErrors = allErrors.filter(e => e.timestamp.getTime() > Date.now() - 3600000); // Last hour
    const olderErrors = allErrors.filter(e => 
      e.timestamp.getTime() > Date.now() - 7200000 && 
      e.timestamp.getTime() <= Date.now() - 3600000
    ); // Previous hour

    let errorTrend: ErrorSummary['errorTrend'] = 'stable';
    if (recentErrors.length > olderErrors.length * 1.2) {
      errorTrend = 'increasing';
    } else if (recentErrors.length < olderErrors.length * 0.8) {
      errorTrend = 'decreasing';
    }

    return {
      totalErrors: allErrors.length,
      errorsByType,
      errorsBySession,
      topErrors,
      errorTrend
    };
  }

  private generateSystemRecommendations(): string[] {
    const recommendations: string[] = [];
    const errorSummary = this.generateErrorSummary();
    const performance = this.calculateOverallPerformance();
    const sessions = Array.from(this.sessionDiagnostics.values());

    // Check error trends
    if (errorSummary.errorTrend === 'increasing') {
      recommendations.push('Error rate is increasing - investigate recent changes');
    }

    if (errorSummary.totalErrors > 100) {
      recommendations.push('High error count detected - review error logs and consider system health check');
    }

    // Check performance
    if (performance.avgResponseTime > 1000) {
      recommendations.push('Average response time is high - check network and system resources');
    }

    if (performance.successRate < 95) {
      recommendations.push('Success rate below 95% - investigate failing operations');
    }

    // Check sessions
    const staleSessions = sessions.filter(s => 
      s.state === 'idle' && 
      Date.now() - s.lastActivity.getTime() > 3600000 // 1 hour
    );

    if (staleSessions.length > 0) {
      recommendations.push(`${staleSessions.length} idle sessions detected - consider cleanup`);
    }

    const erroredSessions = sessions.filter(s => s.state === 'error');
    if (erroredSessions.length > 0) {
      recommendations.push(`${erroredSessions.length} sessions in error state - consider recovery or restart`);
    }

    // Check resource usage
    const resources = this.getCurrentResourceMetrics();
    if (resources.memoryUsage / resources.memoryLimit > 0.8) {
      recommendations.push('High memory usage detected - consider increasing memory limit or cleaning up sessions');
    }

    return recommendations;
  }

  private persistReport(report: DiagnosticReport): void {
    try {
      const filename = `diagnostic-report-${report.reportId}-${new Date().toISOString().replace(/:/g, '-')}.json`;
      const filepath = join(this.diagnosticsDir, filename);
      writeFileSync(filepath, JSON.stringify(report, null, 2));
      this.logger.info(`Diagnostic report saved to ${filepath}`);
    } catch (error) {
      this.logger.error('Failed to persist diagnostic report:', error);
    }
  }

  // Utility methods
  private generateEventId(): string {
    return `evt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateOperationId(): string {
    return `op-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateErrorId(): string {
    return `err-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateAlertId(): string {
    return `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateReportId(): string {
    return `report-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private findSessionForOperation(operationId: string): string | undefined {
    for (const [sessionId, diagnostics] of this.sessionDiagnostics) {
      if (diagnostics.operations.some(op => op.operationId === operationId)) {
        return sessionId;
      }
    }
    return undefined;
  }

  private createEmptyPerformanceMetrics(): PerformanceMetrics {
    return {
      avgResponseTime: 0,
      maxResponseTime: 0,
      minResponseTime: 0,
      totalOperations: 0,
      failedOperations: 0,
      successRate: 100,
      throughput: 0,
      latencyP50: 0,
      latencyP95: 0,
      latencyP99: 0
    };
  }

  private createEmptyCommandQueueDiagnostics(): CommandQueueDiagnostics {
    return {
      queueSize: 0,
      processingRate: 0,
      averageWaitTime: 0,
      droppedCommands: 0,
      retriedCommands: 0,
      queueState: 'idle'
    };
  }

  private startMetricsCollection(intervalMs: number): void {
    this.metricsInterval = setInterval(() => {
      this.collectMetrics();
    }, intervalMs);
  }

  private collectMetrics(): void {
    // Collect metrics for all active sessions
    this.sessionDiagnostics.forEach((diagnostics, sessionId) => {
      if (diagnostics.state === 'active' || diagnostics.state === 'ready') {
        const resources = this.getCurrentResourceMetrics();
        diagnostics.resourceUsage = resources;
        
        // Record as event for tracking
        this.recordEvent({
          level: 'trace',
          category: 'metrics',
          operation: 'collect',
          sessionId,
          message: 'Metrics collected',
          data: resources
        });
      }
    });
  }

  // Public API for getting diagnostic info
  getSessionDiagnostics(sessionId: string): SessionDiagnostics | undefined {
    return this.sessionDiagnostics.get(sessionId);
  }

  getAllSessionDiagnostics(): SessionDiagnostics[] {
    return Array.from(this.sessionDiagnostics.values());
  }


  getActiveAlerts(): DiagnosticAlert[] {
    return this.alerts.filter(a => !a.autoResolved);
  }

  getErrorsForSession(sessionId: string): ErrorTrace[] {
    const diagnostics = this.sessionDiagnostics.get(sessionId);
    return diagnostics ? diagnostics.errors : [];
  }

  getPerformanceMetrics(sessionId?: string): PerformanceMetrics {
    if (sessionId) {
      const diagnostics = this.sessionDiagnostics.get(sessionId);
      return diagnostics ? diagnostics.performance : this.createEmptyPerformanceMetrics();
    }
    return this.calculateOverallPerformance();
  }

  // Public API methods
  trackEvent(event: Omit<DiagnosticEvent, 'id' | 'timestamp'>): string {
    return this.recordEvent(event);
  }

  trackPerformance(operation: string, duration: number): void {
    if (!this.performanceData.has(operation)) {
      this.performanceData.set(operation, []);
    }
    const data = this.performanceData.get(operation)!;
    data.push(duration);

    // Keep only last 1000 data points per operation
    if (data.length > 1000) {
      this.performanceData.set(operation, data.slice(-1000));
    }

    this.recordEvent({
      level: 'trace',
      category: 'performance',
      operation: operation,
      message: `Operation completed in ${duration}ms`,
      duration: duration
    });
  }

  trackError(error: Error | any, context?: Record<string, any>): void {
    const errorTrace: ErrorTrace = {
      errorId: this.generateErrorId(),
      timestamp: new Date(),
      errorType: error.name || 'Unknown',
      errorMessage: error.message || String(error),
      stack: error.stack,
      context: context || {},
      recoveryAttempted: false,
      impact: this.assessErrorImpact(error)
    };

    // Add to session diagnostics if sessionId is in context
    if (context?.sessionId) {
      const sessionDiag = this.sessionDiagnostics.get(context.sessionId);
      if (sessionDiag) {
        sessionDiag.errors.push(errorTrace);
        sessionDiag.lastActivity = new Date();
      }
    }

    this.recordEvent({
      level: 'error',
      category: 'error',
      operation: context?.operation || 'unknown',
      sessionId: context?.sessionId,
      message: error.message || String(error),
      data: errorTrace,
      stack: error.stack
    });
  }

  private assessErrorImpact(error: any): 'low' | 'medium' | 'high' | 'critical' {
    if (error.message?.includes('Session not found')) return 'high';
    if (error.message?.includes('timeout')) return 'medium';
    if (error.message?.includes('ECONNREFUSED')) return 'critical';
    return 'low';
  }

  getMetrics(): DiagnosticMetrics {
    return {
      totalSessions: this.sessionDiagnostics.size,
      failedSessions: Array.from(this.sessionDiagnostics.values()).filter(s => s.state === 'error').length,
      averageResponseTime: this.calculateAverageResponseTime(),
      successRate: this.calculateSuccessRate(),
      sessions: this.getSessionMetrics()
    };
  }

  private calculateAverageResponseTime(): number {
    const allDurations: number[] = [];
    this.performanceData.forEach(durations => {
      allDurations.push(...durations);
    });
    if (allDurations.length === 0) return 0;
    return allDurations.reduce((a, b) => a + b, 0) / allDurations.length;
  }

  private calculateSuccessRate(): number {
    const total = this.operationTraces.size;
    if (total === 0) return 100;
    const successful = Array.from(this.operationTraces.values())
      .filter(op => op.status === 'completed').length;
    return (successful / total) * 100;
  }

  private getSessionMetrics(): Record<string, any> {
    const metrics: Record<string, any> = {};
    this.sessionDiagnostics.forEach((diag, sessionId) => {
      metrics[sessionId] = {
        state: diag.state,
        operationCount: diag.operations.length,
        errorCount: diag.errors.length,
        performance: diag.performance
      };
    });
    return metrics;
  }

  getRecentErrors(count: number = 10): any[] {
    return this.events
      .filter(e => e.level === 'error')
      .slice(-count)
      .map(e => ({
        timestamp: e.timestamp,
        message: e.message,
        sessionId: e.sessionId,
        data: e.data
      }));
  }

  getRecentEvents(count: number = 100, sessionId?: string): DiagnosticEvent[] {
    let events = this.events;

    if (sessionId) {
      events = events.filter(e => e.sessionId === sessionId);
    }

    return events.slice(-count);
  }

  async getHealthStatus(): Promise<{ healthy: boolean; checks: Record<string, any> }> {
    const checks: Record<string, any> = {
      sessions: {
        healthy: this.sessionDiagnostics.size < 40,
        message: `${this.sessionDiagnostics.size}/50 sessions`
      },
      errors: {
        healthy: this.getRecentErrors(10).length < 5,
        message: `${this.getRecentErrors(10).length} recent errors`
      },
      memory: {
        healthy: process.memoryUsage().heapUsed < 500 * 1024 * 1024,
        message: `${Math.floor(process.memoryUsage().heapUsed / 1024 / 1024)}MB used`
      }
    };

    const healthy = Object.values(checks).every(c => c.healthy);
    return { healthy, checks };
  }

  getEventCount(): number {
    return this.events.length;
  }

  trimEvents(maxEvents: number): void {
    if (this.events.length > maxEvents) {
      this.events = this.events.slice(-maxEvents);
    }
  }

  // Control methods
  setVerboseMode(verbose: boolean): void {
    this.verboseMode = verbose;
    this.logger.info(`Verbose mode ${verbose ? 'enabled' : 'disabled'}`);
  }

  setRecording(enabled: boolean): void {
    this.isRecording = enabled;
    this.logger.info(`Diagnostic recording ${enabled ? 'enabled' : 'disabled'}`);
  }

  clearDiagnostics(sessionId?: string): void {
    if (sessionId) {
      this.sessionDiagnostics.delete(sessionId);
      this.events = this.events.filter(e => e.sessionId !== sessionId);
      this.logger.info(`Cleared diagnostics for session ${sessionId}`);
    } else {
      this.sessionDiagnostics.clear();
      this.events = [];
      this.alerts = [];
      this.operationTraces.clear();
      this.performanceData.clear();
      this.logger.info('Cleared all diagnostics');
    }
  }

  // Cleanup
  cleanup(): void {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }
    
    // Generate final report if configured
    if (this.config.persistDiagnostics && this.sessionDiagnostics.size > 0) {
      this.generateDiagnosticReport();
    }
    
    this.removeAllListeners();
    this.logger.info('DiagnosticsManager cleaned up');
  }
}

export default DiagnosticsManager;