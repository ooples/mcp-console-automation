import { EventEmitter } from 'events';
import { Logger } from '../utils/logger.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { performance } from 'perf_hooks';

export interface MetricsConfig {
  enabled: boolean;
  collectionInterval: number;
  retentionPeriod: number;
  aggregationWindow: number;
  enableRealTimeMetrics: boolean;
  enableHistoricalMetrics: boolean;
  enablePredictiveMetrics: boolean;
  persistenceEnabled: boolean;
  persistencePath: string;
  exportFormats: ('json' | 'csv' | 'prometheus')[];
  alertThresholds: {
    errorRate: number;
    responseTime: number;
    throughput: number;
    availability: number;
  };
}

export interface Metric {
  name: string;
  value: number;
  timestamp: Date;
  labels: Record<string, string>;
  type: 'counter' | 'gauge' | 'histogram' | 'summary';
  unit?: string;
  description?: string;
}

export interface AggregatedMetrics {
  timestamp: Date;
  period: string;
  metrics: {
    // Command execution metrics
    totalCommands: number;
    successfulCommands: number;
    failedCommands: number;
    successRate: number;
    errorRate: number;

    // Performance metrics
    averageResponseTime: number;
    medianResponseTime: number;
    p95ResponseTime: number;
    p99ResponseTime: number;
    throughput: number;

    // Session metrics
    totalSessions: number;
    activeSessions: number;
    sessionsCreated: number;
    sessionsTerminated: number;
    sessionFailures: number;
    averageSessionDuration: number;

    // Connection metrics
    connectionAttempts: number;
    successfulConnections: number;
    failedConnections: number;
    connectionSuccessRate: number;
    averageConnectionTime: number;

    // Health metrics
    healthChecksPassed: number;
    healthChecksFailed: number;
    systemHealthScore: number;

    // Resource utilization
    cpuUsage: number;
    memoryUsage: number;
    diskUsage: number;
    networkLatency: number;

    // Recovery metrics
    recoveryAttempts: number;
    successfulRecoveries: number;
    failedRecoveries: number;
    recoverySuccessRate: number;
    averageRecoveryTime: number;
  };
  trends: {
    successRateTrend: 'improving' | 'stable' | 'degrading';
    performanceTrend: 'improving' | 'stable' | 'degrading';
    volumeTrend: 'increasing' | 'stable' | 'decreasing';
    predictedIssues: string[];
  };
}

export interface MetricsSnapshot {
  timestamp: Date;
  counters: Record<string, number>;
  gauges: Record<string, number>;
  histograms: Record<string, number[]>;
  timers: Record<string, { start: number; duration?: number }>;
}

/**
 * Comprehensive Metrics Collection and Analysis System
 * Tracks all aspects of system performance and reliability
 */
export class MetricsCollector extends EventEmitter {
  private logger: Logger;
  private config: MetricsConfig;
  private metrics: Map<string, Metric[]> = new Map();
  private counters: Map<string, number> = new Map();
  private gauges: Map<string, number> = new Map();
  private histograms: Map<string, number[]> = new Map();
  private timers: Map<string, { start: number; duration?: number }> = new Map();
  private isRunning = false;
  private collectionTimer?: NodeJS.Timeout;
  private aggregationTimer?: NodeJS.Timeout;

  // Historical data for trend analysis
  private historicalData: AggregatedMetrics[] = [];
  private currentSnapshot?: MetricsSnapshot;

  constructor(config?: Partial<MetricsConfig>) {
    super();
    this.logger = new Logger('MetricsCollector');

    this.config = {
      enabled: config?.enabled ?? true,
      collectionInterval: config?.collectionInterval || 10000, // 10 seconds
      retentionPeriod: config?.retentionPeriod || 7 * 24 * 60 * 60 * 1000, // 7 days
      aggregationWindow: config?.aggregationWindow || 60000, // 1 minute
      enableRealTimeMetrics: config?.enableRealTimeMetrics ?? true,
      enableHistoricalMetrics: config?.enableHistoricalMetrics ?? true,
      enablePredictiveMetrics: config?.enablePredictiveMetrics ?? true,
      persistenceEnabled: config?.persistenceEnabled ?? true,
      persistencePath: config?.persistencePath || './data/metrics',
      exportFormats: config?.exportFormats || ['json'],
      alertThresholds: {
        errorRate: 0.05, // 5%
        responseTime: 5000, // 5 seconds
        throughput: 10, // 10 operations/minute
        availability: 0.99, // 99%
        ...config?.alertThresholds,
      },
    };

    this.logger.info('MetricsCollector initialized with config:', this.config);
  }

  /**
   * Start metrics collection
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('MetricsCollector is already running');
      return;
    }

    this.logger.info('Starting MetricsCollector...');
    this.isRunning = true;

    // Ensure persistence directory exists
    if (this.config.persistenceEnabled) {
      try {
        await fs.mkdir(this.config.persistencePath, { recursive: true });
      } catch (error) {
        this.logger.error('Failed to create persistence directory:', error);
      }
    }

    // Load historical data
    if (this.config.enableHistoricalMetrics) {
      await this.loadHistoricalData();
    }

    // Start collection timer
    if (this.config.collectionInterval > 0) {
      this.collectionTimer = setInterval(() => {
        this.collectMetrics();
      }, this.config.collectionInterval);
    }

    // Start aggregation timer
    if (this.config.aggregationWindow > 0) {
      this.aggregationTimer = setInterval(() => {
        this.aggregateMetrics();
      }, this.config.aggregationWindow);
    }

    // Initial collection
    await this.collectMetrics();

    this.emit('started');
    this.logger.info('MetricsCollector started successfully');
  }

  /**
   * Stop metrics collection
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      this.logger.warn('MetricsCollector is not running');
      return;
    }

    this.logger.info('Stopping MetricsCollector...');
    this.isRunning = false;

    // Clear timers
    if (this.collectionTimer) {
      clearInterval(this.collectionTimer);
      this.collectionTimer = undefined;
    }

    if (this.aggregationTimer) {
      clearInterval(this.aggregationTimer);
      this.aggregationTimer = undefined;
    }

    // Final aggregation and persistence
    await this.aggregateMetrics();

    if (this.config.persistenceEnabled) {
      await this.persistHistoricalData();
    }

    this.emit('stopped');
    this.logger.info('MetricsCollector stopped');
  }

  /**
   * Record a metric value
   */
  recordMetric(
    name: string,
    value: number,
    labels: Record<string, string> = {},
    type: Metric['type'] = 'counter',
    unit?: string,
    description?: string
  ): void {
    if (!this.config.enabled) return;

    const metric: Metric = {
      name,
      value,
      timestamp: new Date(),
      labels,
      type,
      unit,
      description,
    };

    // Store in metrics history
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }
    this.metrics.get(name)!.push(metric);

    // Update counters/gauges
    switch (type) {
      case 'counter':
        this.counters.set(name, (this.counters.get(name) || 0) + value);
        break;
      case 'gauge':
        this.gauges.set(name, value);
        break;
      case 'histogram':
        if (!this.histograms.has(name)) {
          this.histograms.set(name, []);
        }
        this.histograms.get(name)!.push(value);
        break;
    }

    // Emit real-time metric if enabled
    if (this.config.enableRealTimeMetrics) {
      this.emit('metric-recorded', metric);
    }

    this.logger.debug(
      `Recorded metric: ${name}=${value} ${unit || ''} (${type})`
    );
  }

  /**
   * Start timing an operation
   */
  startTimer(name: string): void {
    if (!this.config.enabled) return;

    this.timers.set(name, { start: performance.now() });
  }

  /**
   * Stop timing an operation and record the duration
   */
  stopTimer(name: string, labels: Record<string, string> = {}): number | null {
    if (!this.config.enabled) return null;

    const timer = this.timers.get(name);
    if (!timer) {
      this.logger.warn(`Timer '${name}' not found`);
      return null;
    }

    const duration = performance.now() - timer.start;
    timer.duration = duration;

    // Record as histogram metric
    this.recordMetric(
      `${name}_duration`,
      duration,
      labels,
      'histogram',
      'ms',
      `Duration of ${name} operation`
    );

    this.timers.delete(name);
    return duration;
  }

  /**
   * Increment a counter
   */
  incrementCounter(
    name: string,
    value: number = 1,
    labels: Record<string, string> = {}
  ): void {
    this.recordMetric(name, value, labels, 'counter');
  }

  /**
   * Set a gauge value
   */
  setGauge(
    name: string,
    value: number,
    labels: Record<string, string> = {}
  ): void {
    this.recordMetric(name, value, labels, 'gauge');
  }

  /**
   * Record a histogram value
   */
  recordHistogram(
    name: string,
    value: number,
    labels: Record<string, string> = {}
  ): void {
    this.recordMetric(name, value, labels, 'histogram');
  }

  /**
   * Record command execution metrics
   */
  recordCommandExecution(
    success: boolean,
    duration: number,
    commandType: string,
    sessionId?: string
  ): void {
    const labels = {
      command_type: commandType,
      ...(sessionId && { session_id: sessionId }),
    };

    this.incrementCounter('commands_total', 1, labels);

    if (success) {
      this.incrementCounter('commands_success', 1, labels);
    } else {
      this.incrementCounter('commands_failed', 1, labels);
    }

    this.recordHistogram('command_duration', duration, labels);
  }

  /**
   * Record session lifecycle metrics
   */
  recordSessionLifecycle(
    event: 'created' | 'terminated' | 'failed',
    sessionId: string,
    sessionType: string,
    duration?: number
  ): void {
    const labels = {
      session_type: sessionType,
      session_id: sessionId,
    };

    switch (event) {
      case 'created':
        this.incrementCounter('sessions_created', 1, labels);
        this.setGauge(
          'active_sessions',
          this.gauges.get('active_sessions') || 0 + 1
        );
        break;
      case 'terminated':
        this.incrementCounter('sessions_terminated', 1, labels);
        this.setGauge(
          'active_sessions',
          Math.max(0, (this.gauges.get('active_sessions') || 0) - 1)
        );
        if (duration) {
          this.recordHistogram('session_duration', duration, labels);
        }
        break;
      case 'failed':
        this.incrementCounter('sessions_failed', 1, labels);
        this.setGauge(
          'active_sessions',
          Math.max(0, (this.gauges.get('active_sessions') || 0) - 1)
        );
        break;
    }
  }

  /**
   * Record connection metrics
   */
  recordConnectionMetrics(
    success: boolean,
    duration: number,
    hostType: string
  ): void {
    const labels = { host_type: hostType };

    this.incrementCounter('connection_attempts', 1, labels);

    if (success) {
      this.incrementCounter('connections_success', 1, labels);
    } else {
      this.incrementCounter('connections_failed', 1, labels);
    }

    this.recordHistogram('connection_duration', duration, labels);
  }

  /**
   * Record health check metrics
   */
  recordHealthCheck(
    success: boolean,
    checkType: string,
    duration: number,
    sessionId?: string
  ): void {
    const labels = {
      check_type: checkType,
      ...(sessionId && { session_id: sessionId }),
    };

    this.incrementCounter('health_checks_total', 1, labels);

    if (success) {
      this.incrementCounter('health_checks_passed', 1, labels);
    } else {
      this.incrementCounter('health_checks_failed', 1, labels);
    }

    this.recordHistogram('health_check_duration', duration, labels);
  }

  /**
   * Record recovery metrics
   */
  recordRecoveryAttempt(
    success: boolean,
    strategy: string,
    duration: number,
    sessionId: string
  ): void {
    const labels = {
      recovery_strategy: strategy,
      session_id: sessionId,
    };

    this.incrementCounter('recovery_attempts', 1, labels);

    if (success) {
      this.incrementCounter('recovery_success', 1, labels);
    } else {
      this.incrementCounter('recovery_failed', 1, labels);
    }

    this.recordHistogram('recovery_duration', duration, labels);
  }

  /**
   * Record system resource metrics
   */
  recordSystemMetrics(
    cpuUsage: number,
    memoryUsage: number,
    diskUsage: number,
    networkLatency: number
  ): void {
    this.setGauge('system_cpu_usage', cpuUsage, { unit: 'percent' });
    this.setGauge('system_memory_usage', memoryUsage, { unit: 'percent' });
    this.setGauge('system_disk_usage', diskUsage, { unit: 'percent' });
    this.setGauge('system_network_latency', networkLatency, { unit: 'ms' });
  }

  /**
   * Collect current metrics snapshot
   */
  private async collectMetrics(): Promise<void> {
    if (!this.config.enabled) return;

    const snapshot: MetricsSnapshot = {
      timestamp: new Date(),
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      histograms: Object.fromEntries(this.histograms),
      timers: Object.fromEntries(
        Array.from(this.timers.entries()).map(([name, timer]) => [
          name,
          { start: timer.start, duration: timer.duration },
        ])
      ),
    };

    this.currentSnapshot = snapshot;

    // Emit snapshot if real-time metrics enabled
    if (this.config.enableRealTimeMetrics) {
      this.emit('metrics-snapshot', snapshot);
    }

    // Clean up old histogram data
    this.cleanupHistograms();
  }

  /**
   * Aggregate metrics over the configured window
   */
  private async aggregateMetrics(): Promise<void> {
    if (!this.currentSnapshot) return;

    const now = new Date();
    const aggregated = await this.calculateAggregatedMetrics(
      this.currentSnapshot
    );

    // Add to historical data
    if (this.config.enableHistoricalMetrics) {
      this.historicalData.push(aggregated);

      // Clean up old historical data
      const cutoffTime = now.getTime() - this.config.retentionPeriod;
      this.historicalData = this.historicalData.filter(
        (data) => data.timestamp.getTime() > cutoffTime
      );
    }

    // Check alert thresholds
    this.checkAlertThresholds(aggregated);

    // Emit aggregated metrics
    this.emit('metrics-aggregated', aggregated);

    this.logger.debug('Metrics aggregated successfully');
  }

  /**
   * Calculate aggregated metrics from current snapshot
   */
  private async calculateAggregatedMetrics(
    snapshot: MetricsSnapshot
  ): Promise<AggregatedMetrics> {
    const now = new Date();

    // Calculate rates and percentiles
    const commandHistogram = this.histograms.get('command_duration') || [];
    const connectionHistogram =
      this.histograms.get('connection_duration') || [];
    const sessionHistogram = this.histograms.get('session_duration') || [];
    const recoveryHistogram = this.histograms.get('recovery_duration') || [];
    const healthCheckHistogram =
      this.histograms.get('health_check_duration') || [];

    const aggregated: AggregatedMetrics = {
      timestamp: now,
      period: `${this.config.aggregationWindow / 1000}s`,
      metrics: {
        // Command metrics
        totalCommands: snapshot.counters['commands_total'] || 0,
        successfulCommands: snapshot.counters['commands_success'] || 0,
        failedCommands: snapshot.counters['commands_failed'] || 0,
        successRate: this.calculateRate(
          snapshot.counters['commands_success'],
          snapshot.counters['commands_total']
        ),
        errorRate: this.calculateRate(
          snapshot.counters['commands_failed'],
          snapshot.counters['commands_total']
        ),

        // Performance metrics
        averageResponseTime: this.calculateAverage(commandHistogram),
        medianResponseTime: this.calculatePercentile(commandHistogram, 50),
        p95ResponseTime: this.calculatePercentile(commandHistogram, 95),
        p99ResponseTime: this.calculatePercentile(commandHistogram, 99),
        throughput: this.calculateThroughput(
          snapshot.counters['commands_total']
        ),

        // Session metrics
        totalSessions:
          (snapshot.counters['sessions_created'] || 0) +
          (snapshot.counters['sessions_terminated'] || 0),
        activeSessions: snapshot.gauges['active_sessions'] || 0,
        sessionsCreated: snapshot.counters['sessions_created'] || 0,
        sessionsTerminated: snapshot.counters['sessions_terminated'] || 0,
        sessionFailures: snapshot.counters['sessions_failed'] || 0,
        averageSessionDuration: this.calculateAverage(sessionHistogram),

        // Connection metrics
        connectionAttempts: snapshot.counters['connection_attempts'] || 0,
        successfulConnections: snapshot.counters['connections_success'] || 0,
        failedConnections: snapshot.counters['connections_failed'] || 0,
        connectionSuccessRate: this.calculateRate(
          snapshot.counters['connections_success'],
          snapshot.counters['connection_attempts']
        ),
        averageConnectionTime: this.calculateAverage(connectionHistogram),

        // Health metrics
        healthChecksPassed: snapshot.counters['health_checks_passed'] || 0,
        healthChecksFailed: snapshot.counters['health_checks_failed'] || 0,
        systemHealthScore: this.calculateSystemHealthScore(snapshot),

        // Resource metrics
        cpuUsage: snapshot.gauges['system_cpu_usage'] || 0,
        memoryUsage: snapshot.gauges['system_memory_usage'] || 0,
        diskUsage: snapshot.gauges['system_disk_usage'] || 0,
        networkLatency: snapshot.gauges['system_network_latency'] || 0,

        // Recovery metrics
        recoveryAttempts: snapshot.counters['recovery_attempts'] || 0,
        successfulRecoveries: snapshot.counters['recovery_success'] || 0,
        failedRecoveries: snapshot.counters['recovery_failed'] || 0,
        recoverySuccessRate: this.calculateRate(
          snapshot.counters['recovery_success'],
          snapshot.counters['recovery_attempts']
        ),
        averageRecoveryTime: this.calculateAverage(recoveryHistogram),
      },
      trends: {
        successRateTrend: 'stable' as 'improving' | 'stable' | 'degrading',
        performanceTrend: 'stable' as 'improving' | 'stable' | 'degrading',
        volumeTrend: 'stable' as 'increasing' | 'stable' | 'decreasing',
        predictedIssues: [],
      },
    };

    // Calculate trends after aggregated object is fully created
    aggregated.trends = this.calculateTrends(aggregated);

    return aggregated;
  }

  /**
   * Calculate trends based on historical data
   */
  private calculateTrends(
    current: AggregatedMetrics
  ): AggregatedMetrics['trends'] {
    if (this.historicalData.length < 5) {
      return {
        successRateTrend: 'stable',
        performanceTrend: 'stable',
        volumeTrend: 'stable',
        predictedIssues: [],
      };
    }

    const recent = this.historicalData.slice(-5);
    const older = this.historicalData.slice(-10, -5);

    const trends: AggregatedMetrics['trends'] = {
      successRateTrend: this.calculateTrend(
        recent.map((d) => d.metrics.successRate),
        older.map((d) => d.metrics.successRate)
      ),
      performanceTrend: this.calculateTrend(
        recent.map((d) => d.metrics.averageResponseTime),
        older.map((d) => d.metrics.averageResponseTime),
        true // Lower is better for response time
      ),
      volumeTrend: this.calculateVolumeTrend(
        recent.map((d) => d.metrics.totalCommands),
        older.map((d) => d.metrics.totalCommands)
      ),
      predictedIssues: [],
    };

    // Add predictive analysis if enabled
    if (this.config.enablePredictiveMetrics) {
      trends.predictedIssues = this.predictPotentialIssues(current);
    }

    return trends;
  }

  /**
   * Calculate trend direction
   */
  private calculateTrend(
    recent: number[],
    older: number[],
    lowerIsBetter = false
  ): 'improving' | 'stable' | 'degrading' {
    if (recent.length === 0 || older.length === 0) return 'stable';

    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;

    const changePercent = ((recentAvg - olderAvg) / olderAvg) * 100;

    if (Math.abs(changePercent) < 5) return 'stable';

    if (lowerIsBetter) {
      return changePercent < 0 ? 'improving' : 'degrading';
    } else {
      return changePercent > 0 ? 'improving' : 'degrading';
    }
  }

  /**
   * Calculate volume trend direction
   */
  private calculateVolumeTrend(
    recent: number[],
    older: number[]
  ): 'increasing' | 'stable' | 'decreasing' {
    if (recent.length === 0 || older.length === 0) return 'stable';

    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;

    const changePercent = ((recentAvg - olderAvg) / olderAvg) * 100;

    if (Math.abs(changePercent) < 5) return 'stable';

    return changePercent > 0 ? 'increasing' : 'decreasing';
  }

  /**
   * Predict potential issues based on current metrics and trends
   */
  private predictPotentialIssues(current: AggregatedMetrics): string[] {
    const issues: string[] = [];

    // Error rate prediction
    if (
      current.metrics.errorRate >
      this.config.alertThresholds.errorRate * 0.8
    ) {
      issues.push(
        'Error rate approaching threshold - investigate potential causes'
      );
    }

    // Performance degradation
    if (
      current.metrics.averageResponseTime >
      this.config.alertThresholds.responseTime * 0.8
    ) {
      issues.push('Response times increasing - monitor system resources');
    }

    // Resource utilization
    if (current.metrics.cpuUsage > 80 || current.metrics.memoryUsage > 80) {
      issues.push(
        'High resource utilization - consider scaling or optimization'
      );
    }

    // Connection issues
    if (current.metrics.connectionSuccessRate < 0.95) {
      issues.push(
        'Connection reliability declining - check network conditions'
      );
    }

    // Session stability
    const sessionFailureRate =
      current.metrics.sessionFailures /
      Math.max(1, current.metrics.totalSessions);
    if (sessionFailureRate > 0.1) {
      issues.push('Session failure rate elevated - review session management');
    }

    return issues;
  }

  /**
   * Check alert thresholds and emit alerts
   */
  private checkAlertThresholds(aggregated: AggregatedMetrics): void {
    const alerts: string[] = [];

    if (aggregated.metrics.errorRate > this.config.alertThresholds.errorRate) {
      alerts.push(
        `Error rate ${(aggregated.metrics.errorRate * 100).toFixed(2)}% exceeds threshold ${(this.config.alertThresholds.errorRate * 100).toFixed(2)}%`
      );
    }

    if (
      aggregated.metrics.averageResponseTime >
      this.config.alertThresholds.responseTime
    ) {
      alerts.push(
        `Average response time ${aggregated.metrics.averageResponseTime.toFixed(0)}ms exceeds threshold ${this.config.alertThresholds.responseTime}ms`
      );
    }

    if (
      aggregated.metrics.successRate < this.config.alertThresholds.availability
    ) {
      alerts.push(
        `Success rate ${(aggregated.metrics.successRate * 100).toFixed(2)}% below availability threshold ${(this.config.alertThresholds.availability * 100).toFixed(2)}%`
      );
    }

    if (
      aggregated.metrics.throughput < this.config.alertThresholds.throughput
    ) {
      alerts.push(
        `Throughput ${aggregated.metrics.throughput.toFixed(2)} ops/min below threshold ${this.config.alertThresholds.throughput} ops/min`
      );
    }

    if (alerts.length > 0) {
      this.emit('metrics-alert', { alerts, metrics: aggregated });
    }
  }

  /**
   * Calculate system health score
   */
  private calculateSystemHealthScore(snapshot: MetricsSnapshot): number {
    let score = 100;

    // Factor in error rates
    const errorRate = this.calculateRate(
      snapshot.counters['commands_failed'],
      snapshot.counters['commands_total']
    );
    score -= errorRate * 100 * 2; // 2x weight for errors

    // Factor in resource usage
    const cpuUsage = snapshot.gauges['system_cpu_usage'] || 0;
    const memoryUsage = snapshot.gauges['system_memory_usage'] || 0;
    const diskUsage = snapshot.gauges['system_disk_usage'] || 0;

    if (cpuUsage > 90) score -= 20;
    else if (cpuUsage > 80) score -= 10;
    else if (cpuUsage > 70) score -= 5;

    if (memoryUsage > 90) score -= 20;
    else if (memoryUsage > 80) score -= 10;
    else if (memoryUsage > 70) score -= 5;

    if (diskUsage > 95) score -= 15;
    else if (diskUsage > 90) score -= 10;

    // Factor in health check failures
    const healthCheckFailureRate = this.calculateRate(
      snapshot.counters['health_checks_failed'],
      snapshot.counters['health_checks_total']
    );
    score -= healthCheckFailureRate * 100;

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Utility methods
   */
  private calculateRate(numerator?: number, denominator?: number): number {
    if (!denominator || denominator === 0) return 0;
    return (numerator || 0) / denominator;
  }

  private calculateAverage(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  private calculatePercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;
    const sorted = values.sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
  }

  private calculateThroughput(totalOperations?: number): number {
    if (!totalOperations) return 0;
    return (totalOperations / this.config.aggregationWindow) * 60000; // ops per minute
  }

  private cleanupHistograms(): void {
    // Keep only last 1000 values per histogram to prevent memory growth
    for (const [name, values] of this.histograms) {
      if (values.length > 1000) {
        this.histograms.set(name, values.slice(-1000));
      }
    }
  }

  /**
   * Persistence methods
   */
  private async loadHistoricalData(): Promise<void> {
    if (!this.config.persistenceEnabled) return;

    try {
      const filePath = path.join(
        this.config.persistencePath,
        'historical-metrics.json'
      );
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content);

      this.historicalData = data.map((item: any) => ({
        ...item,
        timestamp: new Date(item.timestamp),
      }));

      this.logger.info(
        `Loaded ${this.historicalData.length} historical metric records`
      );
    } catch (error) {
      // File might not exist, which is fine
      this.logger.debug('No historical metrics file found - starting fresh');
    }
  }

  private async persistHistoricalData(): Promise<void> {
    if (!this.config.persistenceEnabled || this.historicalData.length === 0)
      return;

    try {
      const filePath = path.join(
        this.config.persistencePath,
        'historical-metrics.json'
      );
      await fs.writeFile(
        filePath,
        JSON.stringify(this.historicalData, null, 2)
      );

      this.logger.info(
        `Persisted ${this.historicalData.length} historical metric records`
      );
    } catch (error) {
      this.logger.error('Failed to persist historical metrics:', error);
    }
  }

  /**
   * Export metrics in various formats
   */
  async exportMetrics(
    format: 'json' | 'csv' | 'prometheus' = 'json'
  ): Promise<string> {
    if (!this.currentSnapshot) {
      throw new Error('No metrics snapshot available');
    }

    switch (format) {
      case 'json':
        return JSON.stringify(
          {
            snapshot: this.currentSnapshot,
            historical: this.historicalData,
          },
          null,
          2
        );

      case 'csv':
        return this.exportToCSV();

      case 'prometheus':
        return this.exportToPrometheus();

      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }

  private exportToCSV(): string {
    // Implementation would convert metrics to CSV format
    return 'timestamp,metric_name,value,labels\n'; // Simplified
  }

  private exportToPrometheus(): string {
    // Implementation would convert metrics to Prometheus format
    return '# HELP metrics_total Total metrics collected\n'; // Simplified
  }

  /**
   * Get current metrics summary
   */
  getCurrentMetrics(): Record<string, any> {
    return {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      historicalDataPoints: this.historicalData.length,
      lastCollection: this.currentSnapshot?.timestamp,
      isRunning: this.isRunning,
    };
  }

  /**
   * Get historical aggregated metrics
   */
  getHistoricalMetrics(limit = 100): AggregatedMetrics[] {
    return this.historicalData.slice(-limit);
  }

  /**
   * Clean up resources
   */
  async destroy(): Promise<void> {
    await this.stop();
    this.metrics.clear();
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
    this.timers.clear();
    this.historicalData.length = 0;
    this.removeAllListeners();
    this.logger.info('MetricsCollector destroyed');
  }
}
