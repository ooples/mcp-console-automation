import { EventEmitter } from 'events';
import { Logger } from '../utils/logger.js';
import {
  SessionState,
  SystemMetrics,
  ProcessMetrics,
  HealthCheckResult,
} from '../types/index.js';
import * as os from 'os';
import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface HealthMonitorConfig {
  enabledChecks: {
    session: boolean;
    system: boolean;
    network: boolean;
    process: boolean;
    disk: boolean;
    memory: boolean;
    ssh: boolean;
  };
  thresholds: {
    cpu: number;
    memory: number;
    disk: number;
    networkLatency: number;
    processResponseTime: number;
    sshConnectionLatency: number;
    sshHealthScore: number;
  };
  checkInterval: number;
  sshHealthCheckInterval: number;
  alertThresholds: {
    consecutive_failures: number;
    response_time_threshold: number;
    memory_usage_threshold: number;
    error_rate_threshold: number;
    ssh_connection_timeout: number;
    ssh_failure_rate_threshold: number;
  };
  recovery: {
    enabled: boolean;
    maxAttempts: number;
    backoffMultiplier: number;
    baseDelay: number;
    sshProactiveReconnect: boolean;
  };
  monitoring: {
    enableMetrics: boolean;
    enableAlerting: boolean;
    enablePredictiveAnalysis: boolean;
    enableSSHHealthPrediction: boolean;
  };
}

// HealthCheckResult is imported from types/index.ts

export interface SSHHealthMetrics {
  connectionLatency: number;
  lastKeepAliveTimestamp?: number; // Changed from Date to number timestamp
  lastKeepAlive?: Date; // Keep for compatibility
  consecutiveFailures: number;
  connectionUptime: number;
  throughput: number;
  errorRate: number;
  authenticationType?: 'password' | 'publickey' | 'keyboard-interactive';
  encryptionAlgorithm?: string;
  compressionEnabled?: number; // Changed to number (0 or 1)
  serverVersion?: string;
  clientVersion?: string;
}

export interface SSHHealthResult extends HealthCheckResult {
  sshMetrics?: SSHHealthMetrics;
  connectionId?: string;
  hostInfo?: {
    hostname: string;
    port: number;
    username: string;
  };
  predictiveScores?: {
    connectionStability: number;
    performanceDegradation: number;
    authenticationRisk: number;
    networkQuality: number;
    overallFailureRisk: number;
  };
}

export interface SSHSessionHealth {
  sessionId: string;
  connectionId: string;
  hostname: string;
  port: number;
  username: string;
  connectedAt: Date;
  lastActivity: Date;
  healthScore: number;
  connectionLatencyHistory: number[];
  throughputHistory: number[];
  errorHistory: { timestamp: Date; error: string; recoverable: boolean }[];
  keepAliveStatus: 'active' | 'failed' | 'degraded';
  connectionStability: number;
  predictiveFailureScore: number;
  authenticationMethod: string;
  encryptionInfo: {
    algorithm: string;
    keySize: number;
    compressionEnabled: boolean;
  };
  serverInfo: {
    version: string;
    protocol: string;
    supportedAlgorithms: string[];
  };
  performanceMetrics: {
    averageLatency: number;
    maxLatency: number;
    minLatency: number;
    throughputBytesPerSecond: number;
    commandExecutionTime: number;
    dataTransferTime: number;
  };
}

export interface SSHPredictionModel {
  sessionId: string;
  connectionStabilityTrend: number[];
  latencyTrend: number[];
  throughputTrend: number[];
  errorRateTrend: number[];
  keepAliveSuccessRate: number;
  lastUpdated: Date;
  confidenceScore: number;
  predictedFailureTime?: Date;
  riskFactors: {
    networkInstability: number;
    performanceDegradation: number;
    authenticationIssues: number;
    serverOverload: number;
    connectionAging: number;
  };
}

export interface HealthReport {
  overall: 'healthy' | 'warning' | 'unhealthy' | 'critical';
  timestamp: Date;
  checks: HealthCheckResult[];
  metrics: {
    totalChecks: number;
    healthyChecks: number;
    warningChecks: number;
    unhealthyChecks: number;
    criticalChecks: number;
    averageResponseTime: number;
  };
  trends: {
    healthScore: number;
    healthScoreTrend: 'improving' | 'stable' | 'degrading';
    predictionNextHour?: 'healthy' | 'warning' | 'unhealthy' | 'critical';
  };
  actionItems: string[];
  sshHealthSummary?: {
    totalSSHSessions: number;
    healthySSHSessions: number;
    unhealthySSHSessions: number;
    averageSSHLatency: number;
    predictedFailures: number;
    proactiveReconnections: number;
  };
}

/**
 * Comprehensive Health Monitor for session and system health
 * Provides real-time health checks, predictive analysis, and automatic recovery
 */
export class HealthMonitor extends EventEmitter {
  private logger: Logger;
  private config: HealthMonitorConfig;
  private healthHistory: Map<string, HealthCheckResult[]> = new Map();
  private activeChecks: Map<string, NodeJS.Timeout> = new Map();
  private healthScoreHistory: number[] = [];
  private lastSystemMetrics?: SystemMetrics;
  private monitoringInterval?: NodeJS.Timeout;
  private sshHealthInterval?: NodeJS.Timeout;
  private isRunning = false;

  // SSH-specific monitoring data
  private sshSessions: Map<string, SSHSessionHealth> = new Map();
  private sshHealthHistory: Map<string, SSHHealthResult[]> = new Map();
  private sshPredictionModels: Map<string, SSHPredictionModel> = new Map();

  // Health check statistics
  private stats = {
    totalChecks: 0,
    successfulChecks: 0,
    failedChecks: 0,
    averageResponseTime: 0,
    consecutiveFailures: new Map<string, number>(),
    lastCheckTimes: new Map<string, Date>(),
    errorRates: new Map<string, number>(),
  };

  constructor(config?: Partial<HealthMonitorConfig>) {
    super();
    this.logger = new Logger('HealthMonitor');

    this.config = {
      enabledChecks: {
        session: true,
        system: true,
        network: true,
        process: true,
        disk: true,
        memory: true,
        ssh: true,
        ...config?.enabledChecks,
      },
      thresholds: {
        cpu: 80,
        memory: 85,
        disk: 90,
        networkLatency: 1000,
        processResponseTime: 5000,
        sshConnectionLatency: 2000,
        sshHealthScore: 70,
        ...config?.thresholds,
      },
      checkInterval: config?.checkInterval || 30000,
      sshHealthCheckInterval: config?.sshHealthCheckInterval || 15000,
      alertThresholds: {
        consecutive_failures: 3,
        response_time_threshold: 10000,
        memory_usage_threshold: 95,
        error_rate_threshold: 0.1,
        ssh_connection_timeout: 30000,
        ssh_failure_rate_threshold: 0.05,
        ...config?.alertThresholds,
      },
      recovery: {
        enabled: true,
        maxAttempts: 3,
        backoffMultiplier: 2,
        baseDelay: 5000,
        sshProactiveReconnect: true,
        ...config?.recovery,
      },
      monitoring: {
        enableMetrics: true,
        enableAlerting: true,
        enablePredictiveAnalysis: true,
        enableSSHHealthPrediction: true,
        ...config?.monitoring,
      },
    };

    this.logger.info('HealthMonitor initialized with config:', this.config);
  }

  /**
   * Start the health monitoring system
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('HealthMonitor is already running');
      return;
    }

    this.logger.info('Starting HealthMonitor...');
    this.isRunning = true;

    // Start periodic health checks
    this.monitoringInterval = setInterval(async () => {
      await this.performHealthChecks();
    }, this.config.checkInterval);

    // Start SSH-specific health monitoring if enabled
    if (this.config.enabledChecks.ssh) {
      this.sshHealthInterval = setInterval(async () => {
        await this.performSSHHealthChecks();
      }, this.config.sshHealthCheckInterval);
    }

    // Perform initial health checks
    await this.performHealthChecks();
    if (this.config.enabledChecks.ssh) {
      await this.performSSHHealthChecks();
    }

    this.emit('started');
    this.logger.info('HealthMonitor started successfully');
  }

  /**
   * Stop the health monitoring system
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      this.logger.warn('HealthMonitor is not running');
      return;
    }

    this.logger.info('Stopping HealthMonitor...');
    this.isRunning = false;

    // Clear monitoring interval
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }

    // Clear SSH health monitoring interval
    if (this.sshHealthInterval) {
      clearInterval(this.sshHealthInterval);
      this.sshHealthInterval = undefined;
    }

    // Clear active checks
    this.activeChecks.forEach((timeout, checkId) => {
      clearTimeout(timeout);
    });
    this.activeChecks.clear();

    this.emit('stopped');
    this.logger.info('HealthMonitor stopped');
  }

  /**
   * Perform comprehensive health checks
   */
  private async performHealthChecks(): Promise<void> {
    const startTime = Date.now();
    const checks: HealthCheckResult[] = [];

    try {
      // System health checks
      if (this.config.enabledChecks.system) {
        checks.push(await this.performSystemHealthCheck());
      }

      // Memory health check
      if (this.config.enabledChecks.memory) {
        checks.push(await this.performMemoryHealthCheck());
      }

      // Disk health check
      if (this.config.enabledChecks.disk) {
        checks.push(await this.performDiskHealthCheck());
      }

      // Network health check
      if (this.config.enabledChecks.network) {
        checks.push(await this.performNetworkHealthCheck());
      }

      // Update statistics
      this.updateHealthStatistics(checks);

      // Generate health report
      const report = await this.generateHealthReport(checks);

      // Emit health report
      this.emit('health-report', report);

      // Check for critical issues requiring immediate action
      await this.handleCriticalIssues(report);

      // Update health score history for trend analysis
      this.updateHealthTrends(report);
    } catch (error) {
      this.logger.error('Error during health checks:', error);
      this.emit('health-check-error', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const duration = Date.now() - startTime;
    this.logger.debug(`Health checks completed in ${duration}ms`);
  }

  /**
   * Perform system-level health check
   */
  private async performSystemHealthCheck(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const checkId = `system-${Date.now()}`;

    try {
      const cpuUsage = await this.getCPUUsage();
      const memoryUsage = process.memoryUsage();
      const uptime = os.uptime();
      const loadAvg = os.loadavg();

      const memoryPercent =
        (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;
      const isHealthy =
        cpuUsage < this.config.thresholds.cpu &&
        memoryPercent < this.config.thresholds.memory;

      const status: HealthCheckResult['status'] =
        cpuUsage > 90 || memoryPercent > 95
          ? 'critical'
          : cpuUsage > this.config.thresholds.cpu ||
              memoryPercent > this.config.thresholds.memory
            ? 'unhealthy'
            : cpuUsage > 60 || memoryPercent > 70
              ? 'warning'
              : 'healthy';

      return {
        checkId,
        checkType: 'system',
        timestamp: new Date(),
        status,
        metrics: {
          cpuUsage,
          memoryPercent,
          uptime,
          loadAvg1: loadAvg[0],
          loadAvg5: loadAvg[1],
          loadAvg15: loadAvg[2],
        },
        details: {
          message: `System health: CPU ${cpuUsage.toFixed(1)}%, Memory ${memoryPercent.toFixed(1)}%`,
          diagnosis:
            status !== 'healthy'
              ? `High resource usage detected. CPU: ${cpuUsage.toFixed(1)}% (threshold: ${this.config.thresholds.cpu}%), Memory: ${memoryPercent.toFixed(1)}% (threshold: ${this.config.thresholds.memory}%)`
              : 'System resources within normal parameters',
          recommendations:
            status !== 'healthy'
              ? [
                  'Monitor system resource usage closely',
                  'Consider reducing concurrent operations',
                  'Check for memory leaks in running processes',
                  'Review system performance optimization',
                ]
              : [],
          recoverable: status !== 'critical',
        },
        duration: Date.now() - startTime,
        checks: {
          cpu: {
            checkStatus:
              cpuUsage > this.config.thresholds.cpu
                ? 'fail'
                : cpuUsage > 60
                  ? 'warn'
                  : 'pass',
            value: cpuUsage,
            message: `CPU usage: ${cpuUsage.toFixed(1)}%`,
            duration: Date.now() - startTime,
          },
          memory: {
            checkStatus:
              memoryPercent > this.config.thresholds.memory
                ? 'fail'
                : memoryPercent > 70
                  ? 'warn'
                  : 'pass',
            value: memoryPercent,
            message: `Memory usage: ${memoryPercent.toFixed(1)}%`,
            duration: Date.now() - startTime,
          },
        },
        overallScore:
          status === 'healthy'
            ? 100
            : status === 'warning'
              ? 75
              : status === 'unhealthy'
                ? 50
                : 0,
      };
    } catch (error) {
      return {
        checkId,
        checkType: 'system',
        timestamp: new Date(),
        status: 'critical',
        metrics: {},
        details: {
          message: `System health check failed: ${error instanceof Error ? error.message : String(error)}`,
          diagnosis: 'Unable to retrieve system metrics',
          recommendations: [
            'Check system monitoring tools',
            'Verify system stability',
          ],
          recoverable: true,
        },
        duration: Date.now() - startTime,
        checks: {
          system: {
            checkStatus: 'fail',
            message: `System health check failed: ${error instanceof Error ? error.message : String(error)}`,
          },
        },
        overallScore: 0,
      };
    }
  }

  /**
   * Perform memory-specific health check
   */
  private async performMemoryHealthCheck(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const checkId = `memory-${Date.now()}`;

    try {
      const memInfo = await this.getMemoryInfo();
      const processMemory = process.memoryUsage();

      const systemMemoryPercent =
        ((memInfo.total - memInfo.free) / memInfo.total) * 100;
      const processMemoryMB = processMemory.heapUsed / 1024 / 1024;

      const status: HealthCheckResult['status'] =
        systemMemoryPercent > 95
          ? 'critical'
          : systemMemoryPercent > this.config.thresholds.memory
            ? 'unhealthy'
            : systemMemoryPercent > 70
              ? 'warning'
              : 'healthy';

      return {
        checkId,
        checkType: 'system',
        timestamp: new Date(),
        status,
        metrics: {
          systemMemoryPercent,
          processMemoryMB,
          totalMemoryGB: memInfo.total / 1024 / 1024 / 1024,
          freeMemoryGB: memInfo.free / 1024 / 1024 / 1024,
          heapUsedMB: processMemory.heapUsed / 1024 / 1024,
          heapTotalMB: processMemory.heapTotal / 1024 / 1024,
        },
        details: {
          message: `Memory usage: System ${systemMemoryPercent.toFixed(1)}%, Process ${processMemoryMB.toFixed(1)}MB`,
          diagnosis:
            status !== 'healthy'
              ? `High memory usage detected. System: ${systemMemoryPercent.toFixed(1)}% (threshold: ${this.config.thresholds.memory}%)`
              : 'Memory usage within normal parameters',
          recommendations:
            status !== 'healthy'
              ? [
                  'Monitor for memory leaks',
                  'Consider garbage collection optimization',
                  'Review buffer sizes and data structures',
                  'Implement memory pressure relief mechanisms',
                ]
              : [],
          recoverable: status !== 'critical',
        },
        duration: Date.now() - startTime,
        checks: {
          system_memory: {
            checkStatus:
              systemMemoryPercent > 95
                ? 'fail'
                : systemMemoryPercent > this.config.thresholds.memory
                  ? 'fail'
                  : systemMemoryPercent > 70
                    ? 'warn'
                    : 'pass',
            value: systemMemoryPercent,
            message: `System memory usage: ${systemMemoryPercent.toFixed(1)}%`,
            duration: Date.now() - startTime,
          },
          process_memory: {
            checkStatus: 'pass',
            value: processMemoryMB,
            message: `Process memory usage: ${processMemoryMB.toFixed(1)}MB`,
            duration: Date.now() - startTime,
          },
        },
        overallScore:
          status === 'healthy'
            ? 100
            : status === 'warning'
              ? 75
              : status === 'unhealthy'
                ? 50
                : 0,
      };
    } catch (error) {
      return {
        checkId,
        checkType: 'system',
        timestamp: new Date(),
        status: 'critical',
        metrics: {},
        details: {
          message: `Memory health check failed: ${error instanceof Error ? error.message : String(error)}`,
          diagnosis: 'Unable to retrieve memory metrics',
          recommendations: [
            'Check system memory monitoring',
            'Verify system stability',
          ],
          recoverable: true,
        },
        duration: Date.now() - startTime,
        checks: {
          memory: {
            checkStatus: 'fail',
            message: `Memory health check failed: ${error instanceof Error ? error.message : String(error)}`,
          },
        },
        overallScore: 0,
      };
    }
  }

  /**
   * Perform disk health check
   */
  private async performDiskHealthCheck(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const checkId = `disk-${Date.now()}`;

    try {
      const diskInfo = await this.getDiskInfo();
      const diskUsagePercent = (diskInfo.used / diskInfo.total) * 100;

      const status: HealthCheckResult['status'] =
        diskUsagePercent > 95
          ? 'critical'
          : diskUsagePercent > this.config.thresholds.disk
            ? 'unhealthy'
            : diskUsagePercent > 80
              ? 'warning'
              : 'healthy';

      return {
        checkId,
        checkType: 'system',
        timestamp: new Date(),
        status,
        metrics: {
          diskUsagePercent,
          totalGB: diskInfo.total / 1024 / 1024 / 1024,
          usedGB: diskInfo.used / 1024 / 1024 / 1024,
          freeGB: diskInfo.free / 1024 / 1024 / 1024,
        },
        details: {
          message: `Disk usage: ${diskUsagePercent.toFixed(1)}% (${(diskInfo.free / 1024 / 1024 / 1024).toFixed(1)}GB free)`,
          diagnosis:
            status !== 'healthy'
              ? `High disk usage detected: ${diskUsagePercent.toFixed(1)}% (threshold: ${this.config.thresholds.disk}%)`
              : 'Disk usage within normal parameters',
          recommendations:
            status !== 'healthy'
              ? [
                  'Clean up temporary files and logs',
                  'Archive old session data',
                  'Monitor disk space regularly',
                  'Consider log rotation and cleanup policies',
                ]
              : [],
          recoverable: status !== 'critical',
        },
        duration: Date.now() - startTime,
        checks: {
          disk_usage: {
            checkStatus:
              diskUsagePercent > 95
                ? 'fail'
                : diskUsagePercent > this.config.thresholds.disk
                  ? 'fail'
                  : diskUsagePercent > 80
                    ? 'warn'
                    : 'pass',
            value: diskUsagePercent,
            message: `Disk usage: ${diskUsagePercent.toFixed(1)}%`,
            duration: Date.now() - startTime,
          },
        },
        overallScore:
          status === 'healthy'
            ? 100
            : status === 'warning'
              ? 75
              : status === 'unhealthy'
                ? 50
                : 0,
      };
    } catch (error) {
      return {
        checkId,
        checkType: 'system',
        timestamp: new Date(),
        status: 'critical',
        metrics: {},
        details: {
          message: `Disk health check failed: ${error instanceof Error ? error.message : String(error)}`,
          diagnosis: 'Unable to retrieve disk metrics',
          recommendations: [
            'Check disk monitoring tools',
            'Verify filesystem health',
          ],
          recoverable: true,
        },
        duration: Date.now() - startTime,
        checks: {
          disk: {
            checkStatus: 'fail',
            message: `Disk health check failed: ${error instanceof Error ? error.message : String(error)}`,
          },
        },
        overallScore: 0,
      };
    }
  }

  /**
   * Perform network health check
   */
  private async performNetworkHealthCheck(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const checkId = `network-${Date.now()}`;

    try {
      // Test network connectivity with multiple targets
      const testTargets = ['8.8.8.8', '1.1.1.1', 'google.com'];
      const networkTests = await Promise.allSettled(
        testTargets.map((target) => this.pingHost(target))
      );

      const successfulTests = networkTests.filter(
        (result) => result.status === 'fulfilled'
      );
      const avgLatency =
        successfulTests.length > 0
          ? (successfulTests as PromiseFulfilledResult<number>[]).reduce(
              (sum, result) => sum + result.value,
              0
            ) / successfulTests.length
          : Infinity;

      const connectivityPercent =
        (successfulTests.length / testTargets.length) * 100;

      const status: HealthCheckResult['status'] =
        connectivityPercent === 0
          ? 'critical'
          : connectivityPercent < 50 ||
              avgLatency > this.config.thresholds.networkLatency
            ? 'unhealthy'
            : connectivityPercent < 100 || avgLatency > 500
              ? 'warning'
              : 'healthy';

      return {
        checkId,
        checkType: 'network',
        timestamp: new Date(),
        status,
        metrics: {
          connectivityPercent,
          avgLatency: avgLatency === Infinity ? -1 : avgLatency,
          successfulTests: successfulTests.length,
          totalTests: testTargets.length,
        },
        details: {
          message: `Network connectivity: ${connectivityPercent.toFixed(0)}% (${successfulTests.length}/${testTargets.length} targets), avg latency: ${avgLatency === Infinity ? 'N/A' : avgLatency.toFixed(0)}ms`,
          diagnosis:
            status !== 'healthy'
              ? `Network connectivity issues detected. Success rate: ${connectivityPercent.toFixed(0)}%, Average latency: ${avgLatency === Infinity ? 'N/A' : avgLatency.toFixed(0)}ms`
              : 'Network connectivity within normal parameters',
          recommendations:
            status !== 'healthy'
              ? [
                  'Check network connectivity and firewall settings',
                  'Verify DNS resolution',
                  'Test with different network targets',
                  'Monitor network interface statistics',
                ]
              : [],
          recoverable: status !== 'critical',
        },
        duration: Date.now() - startTime,
        checks: {
          connectivity: {
            checkStatus:
              connectivityPercent === 0
                ? 'fail'
                : connectivityPercent < 50
                  ? 'fail'
                  : connectivityPercent < 100
                    ? 'warn'
                    : 'pass',
            value: connectivityPercent,
            message: `Network connectivity: ${connectivityPercent.toFixed(0)}%`,
            duration: Date.now() - startTime,
          },
          latency: {
            checkStatus:
              avgLatency === Infinity
                ? 'fail'
                : avgLatency > this.config.thresholds.networkLatency
                  ? 'fail'
                  : avgLatency > 500
                    ? 'warn'
                    : 'pass',
            value: avgLatency === Infinity ? -1 : avgLatency,
            message: `Average latency: ${avgLatency === Infinity ? 'N/A' : avgLatency.toFixed(0)}ms`,
            duration: Date.now() - startTime,
          },
        },
        overallScore:
          status === 'healthy'
            ? 100
            : status === 'warning'
              ? 75
              : status === 'unhealthy'
                ? 50
                : 0,
      };
    } catch (error) {
      return {
        checkId,
        checkType: 'network',
        timestamp: new Date(),
        status: 'critical',
        metrics: {},
        details: {
          message: `Network health check failed: ${error instanceof Error ? error.message : String(error)}`,
          diagnosis: 'Unable to perform network connectivity tests',
          recommendations: [
            'Check network configuration',
            'Verify internet connectivity',
          ],
          recoverable: true,
        },
        duration: Date.now() - startTime,
        checks: {
          network: {
            checkStatus: 'fail',
            message: `Network health check failed: ${error instanceof Error ? error.message : String(error)}`,
          },
        },
        overallScore: 0,
      };
    }
  }

  /**
   * Check health of a specific session
   */
  async checkSessionHealth(
    sessionState: SessionState
  ): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const checkId = `session-${sessionState.id}-${Date.now()}`;

    try {
      const now = Date.now();
      const timeSinceLastActivity = now - sessionState.lastActivity.getTime();
      const sessionAge = now - sessionState.createdAt.getTime();

      // Calculate session health score
      let healthScore = sessionState.healthScore || 100;

      // Deduct points based on various factors
      if (
        sessionState.status === 'failed' ||
        sessionState.status === 'recovering'
      ) {
        healthScore -= 30;
      }
      if (timeSinceLastActivity > 300000) {
        // 5 minutes of inactivity
        healthScore -= 20;
      }
      if (sessionState.recoveryAttempts > 0) {
        healthScore -= sessionState.recoveryAttempts * 10;
      }

      const status: HealthCheckResult['status'] =
        healthScore < 20 || sessionState.status === 'failed'
          ? 'critical'
          : healthScore < 50 || sessionState.status === 'recovering'
            ? 'unhealthy'
            : healthScore < 80 || timeSinceLastActivity > 180000
              ? 'warning'
              : 'healthy';

      return {
        checkId,
        checkType: 'session',
        sessionId: sessionState.id,
        timestamp: new Date(),
        status,
        metrics: {
          healthScore,
          timeSinceLastActivityMs: timeSinceLastActivity,
          sessionAgeMs: sessionAge,
          recoveryAttempts: sessionState.recoveryAttempts,
        },
        details: {
          message: `Session health: Score ${healthScore.toFixed(0)}/100, Status: ${sessionState.status}`,
          diagnosis:
            status !== 'healthy'
              ? `Session health degraded. Score: ${healthScore.toFixed(0)}/100, Status: ${sessionState.status}, Last activity: ${Math.floor(timeSinceLastActivity / 1000)}s ago`
              : 'Session operating normally',
          recommendations:
            status !== 'healthy'
              ? [
                  'Monitor session activity patterns',
                  'Check for underlying connection issues',
                  'Consider session restart if persistently unhealthy',
                  'Review session configuration and resource allocation',
                ]
              : [],
          recoverable:
            sessionState.status !== 'failed' ||
            sessionState.recoveryAttempts < sessionState.maxRecoveryAttempts,
        },
        duration: Date.now() - startTime,
        checks: {
          session_status: {
            checkStatus:
              sessionState.status === 'failed'
                ? 'fail'
                : sessionState.status === 'recovering'
                  ? 'warn'
                  : 'pass',
            value: sessionState.status,
            message: `Session status: ${sessionState.status}`,
            duration: Date.now() - startTime,
          },
          health_score: {
            checkStatus:
              healthScore < 20
                ? 'fail'
                : healthScore < 50
                  ? 'fail'
                  : healthScore < 80
                    ? 'warn'
                    : 'pass',
            value: healthScore,
            message: `Health score: ${healthScore.toFixed(0)}/100`,
            duration: Date.now() - startTime,
          },
          activity: {
            checkStatus: timeSinceLastActivity > 300000 ? 'warn' : 'pass',
            value: timeSinceLastActivity,
            message: `Last activity: ${Math.floor(timeSinceLastActivity / 1000)}s ago`,
            duration: Date.now() - startTime,
          },
        },
        overallScore:
          status === 'healthy'
            ? 100
            : status === 'warning'
              ? 75
              : status === 'unhealthy'
                ? 50
                : 0,
      };
    } catch (error) {
      return {
        checkId,
        checkType: 'session',
        sessionId: sessionState.id,
        timestamp: new Date(),
        status: 'critical',
        metrics: {},
        details: {
          message: `Session health check failed: ${error instanceof Error ? error.message : String(error)}`,
          diagnosis: 'Unable to assess session health',
          recommendations: [
            'Check session state consistency',
            'Review session monitoring',
          ],
          recoverable: true,
        },
        duration: Date.now() - startTime,
        checks: {
          session: {
            checkStatus: 'fail',
            message: `Session health check failed: ${error instanceof Error ? error.message : String(error)}`,
          },
        },
        overallScore: 0,
      };
    }
  }

  /**
   * Register SSH session for health monitoring
   */
  registerSSHSession(
    sessionId: string,
    connectionInfo: {
      hostname: string;
      port: number;
      username: string;
      authenticationMethod?: string;
    }
  ): void {
    const sshHealth: SSHSessionHealth = {
      sessionId,
      connectionId: `${connectionInfo.hostname}:${connectionInfo.port}`,
      hostname: connectionInfo.hostname,
      port: connectionInfo.port,
      username: connectionInfo.username,
      connectedAt: new Date(),
      lastActivity: new Date(),
      healthScore: 100,
      connectionLatencyHistory: [],
      throughputHistory: [],
      errorHistory: [],
      keepAliveStatus: 'active',
      connectionStability: 1.0,
      predictiveFailureScore: 0,
      authenticationMethod: connectionInfo.authenticationMethod || 'unknown',
      encryptionInfo: {
        algorithm: 'unknown',
        keySize: 0,
        compressionEnabled: false,
      },
      serverInfo: {
        version: 'unknown',
        protocol: 'unknown',
        supportedAlgorithms: [],
      },
      performanceMetrics: {
        averageLatency: 0,
        maxLatency: 0,
        minLatency: 0,
        throughputBytesPerSecond: 0,
        commandExecutionTime: 0,
        dataTransferTime: 0,
      },
    };

    this.sshSessions.set(sessionId, sshHealth);
    this.sshHealthHistory.set(sessionId, []);

    // Initialize prediction model
    const predictionModel: SSHPredictionModel = {
      sessionId,
      connectionStabilityTrend: [1.0],
      latencyTrend: [],
      throughputTrend: [],
      errorRateTrend: [0],
      keepAliveSuccessRate: 1.0,
      lastUpdated: new Date(),
      confidenceScore: 0.5,
      riskFactors: {
        networkInstability: 0,
        performanceDegradation: 0,
        authenticationIssues: 0,
        serverOverload: 0,
        connectionAging: 0,
      },
    };

    this.sshPredictionModels.set(sessionId, predictionModel);

    this.logger.info(
      `SSH session ${sessionId} registered for health monitoring: ${connectionInfo.hostname}:${connectionInfo.port}`
    );
    this.emit('ssh-session-registered', {
      sessionId,
      connectionInfo,
      sshHealth,
    });
  }

  /**
   * Unregister SSH session from health monitoring
   */
  unregisterSSHSession(sessionId: string): void {
    this.sshSessions.delete(sessionId);
    this.sshHealthHistory.delete(sessionId);
    this.sshPredictionModels.delete(sessionId);

    this.logger.info(
      `SSH session ${sessionId} unregistered from health monitoring`
    );
    this.emit('ssh-session-unregistered', { sessionId });
  }

  /**
   * Update SSH session activity
   */
  updateSSHSessionActivity(
    sessionId: string,
    activityData: {
      latency?: number;
      throughput?: number;
      commandExecutionTime?: number;
      dataTransferSize?: number;
      error?: { message: string; recoverable: boolean };
    }
  ): void {
    const sshHealth = this.sshSessions.get(sessionId);
    if (!sshHealth) {
      return;
    }

    sshHealth.lastActivity = new Date();

    if (activityData.latency !== undefined) {
      sshHealth.connectionLatencyHistory.push(activityData.latency);
      if (sshHealth.connectionLatencyHistory.length > 100) {
        sshHealth.connectionLatencyHistory.shift();
      }

      // Update performance metrics
      const latencies = sshHealth.connectionLatencyHistory;
      sshHealth.performanceMetrics.averageLatency =
        latencies.reduce((a, b) => a + b, 0) / latencies.length;
      sshHealth.performanceMetrics.maxLatency = Math.max(...latencies);
      sshHealth.performanceMetrics.minLatency = Math.min(...latencies);
    }

    if (activityData.throughput !== undefined) {
      sshHealth.throughputHistory.push(activityData.throughput);
      if (sshHealth.throughputHistory.length > 100) {
        sshHealth.throughputHistory.shift();
      }

      sshHealth.performanceMetrics.throughputBytesPerSecond =
        sshHealth.throughputHistory.reduce((a, b) => a + b, 0) /
        sshHealth.throughputHistory.length;
    }

    if (activityData.commandExecutionTime !== undefined) {
      sshHealth.performanceMetrics.commandExecutionTime =
        activityData.commandExecutionTime;
    }

    if (activityData.error) {
      sshHealth.errorHistory.push({
        timestamp: new Date(),
        error: activityData.error.message,
        recoverable: activityData.error.recoverable,
      });

      if (sshHealth.errorHistory.length > 50) {
        sshHealth.errorHistory.shift();
      }
    }

    // Update health score and prediction model
    this.updateSSHHealthScore(sessionId);
    this.updateSSHPredictionModel(sessionId);
  }

  /**
   * Perform SSH-specific health checks
   */
  private async performSSHHealthChecks(): Promise<void> {
    if (this.sshSessions.size === 0) {
      return;
    }

    const startTime = Date.now();
    const sshResults: SSHHealthResult[] = [];

    try {
      const sessionEntries = Array.from(this.sshSessions.entries());
      for (const [sessionId, sshHealth] of sessionEntries) {
        const healthResult = await this.checkSSHSessionHealth(
          sessionId,
          sshHealth
        );
        sshResults.push(healthResult);

        // Store in history
        const history = this.sshHealthHistory.get(sessionId) || [];
        history.push(healthResult);

        // Keep only last 100 checks
        if (history.length > 100) {
          history.shift();
        }
        this.sshHealthHistory.set(sessionId, history);

        // Check for critical issues requiring immediate action
        if (
          healthResult.status === 'critical' ||
          (healthResult.predictiveScores?.overallFailureRisk || 0) > 0.8
        ) {
          await this.handleCriticalSSHIssue(sessionId, healthResult);
        } else if (
          healthResult.status === 'unhealthy' ||
          (healthResult.predictiveScores?.overallFailureRisk || 0) > 0.6
        ) {
          this.emit('ssh-session-degraded', { sessionId, healthResult });
        }

        // Check for proactive reconnection needs
        if (
          this.config.recovery.sshProactiveReconnect &&
          (healthResult.predictiveScores?.overallFailureRisk || 0) > 0.7
        ) {
          this.emit('ssh-proactive-reconnect-needed', {
            sessionId,
            healthResult,
            reason: 'predictive-failure-risk',
            urgency: 'medium',
          });
        }
      }

      this.emit('ssh-health-checks-completed', {
        results: sshResults,
        duration: Date.now() - startTime,
        timestamp: new Date(),
      });
    } catch (error) {
      this.logger.error('Error during SSH health checks:', error);
      this.emit('ssh-health-check-error', {
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date(),
      });
    }

    const duration = Date.now() - startTime;
    this.logger.debug(
      `SSH health checks completed in ${duration}ms for ${this.sshSessions.size} sessions`
    );
  }

  /**
   * Check health of a specific SSH session
   */
  private async checkSSHSessionHealth(
    sessionId: string,
    sshHealth: SSHSessionHealth
  ): Promise<SSHHealthResult> {
    const startTime = Date.now();
    const checkId = `ssh-${sessionId}-${Date.now()}`;

    try {
      const now = Date.now();
      const timeSinceLastActivity = now - sshHealth.lastActivity.getTime();
      const connectionAge = now - sshHealth.connectedAt.getTime();

      // Perform actual SSH connection test
      const connectionTest = await this.testSSHConnection(sessionId, sshHealth);

      // Calculate predictive scores
      const predictiveScores = this.calculateSSHPredictiveScores(
        sessionId,
        sshHealth
      );

      // Update health score based on test results and predictions
      let healthScore = sshHealth.healthScore;

      if (!connectionTest.success) {
        healthScore = Math.max(0, healthScore - 30);
      }

      if (timeSinceLastActivity > 300000) {
        // 5 minutes of inactivity
        healthScore = Math.max(0, healthScore - 10);
      }

      if (predictiveScores.overallFailureRisk > 0.5) {
        healthScore = Math.max(
          0,
          healthScore - predictiveScores.overallFailureRisk * 20
        );
      }

      const status: SSHHealthResult['status'] =
        healthScore < 20 || predictiveScores.overallFailureRisk > 0.9
          ? 'critical'
          : healthScore < 50 || predictiveScores.overallFailureRisk > 0.7
            ? 'unhealthy'
            : healthScore < 80 || predictiveScores.overallFailureRisk > 0.5
              ? 'warning'
              : 'healthy';

      // Update SSH health object
      sshHealth.healthScore = healthScore;
      sshHealth.predictiveFailureScore = predictiveScores.overallFailureRisk;

      const sshMetrics: Record<string, number> = {
        connectionLatency: connectionTest.latency,
        lastKeepAliveTimestamp: Date.now(),
        consecutiveFailures: connectionTest.success
          ? 0
          : sshHealth.errorHistory.filter(
              (e) => Date.now() - e.timestamp.getTime() < 300000
            ).length,
        connectionUptime: connectionAge,
        throughput: sshHealth.performanceMetrics.throughputBytesPerSecond,
        errorRate: this.calculateSSHErrorRate(sshHealth),
        compressionEnabled: sshHealth.encryptionInfo.compressionEnabled ? 1 : 0,
      };

      return {
        checkId,
        checkType: 'session',
        sessionId,
        timestamp: new Date(),
        status,
        metrics: {
          healthScore,
          connectionLatency: connectionTest.latency,
          timeSinceLastActivityMs: timeSinceLastActivity,
          connectionAgeMs: connectionAge,
          ...sshMetrics,
        },
        details: {
          message: `SSH session health: Score ${healthScore.toFixed(0)}/100, Risk ${(predictiveScores.overallFailureRisk * 100).toFixed(0)}%`,
          diagnosis:
            status !== 'healthy'
              ? `SSH session health degraded. Score: ${healthScore.toFixed(0)}/100, Failure risk: ${(predictiveScores.overallFailureRisk * 100).toFixed(0)}%`
              : 'SSH session operating normally',
          recommendations: this.generateSSHRecommendations(
            status,
            predictiveScores,
            sshHealth
          ),
          recoverable: status !== 'critical' || connectionTest.success,
        },
        duration: Date.now() - startTime,
        checks: {
          connection_test: {
            checkStatus: connectionTest.success ? 'pass' : 'fail',
            value: connectionTest.success,
            message: `Connection test: ${connectionTest.success ? 'SUCCESS' : 'FAILED'}`,
            duration: connectionTest.duration || 0,
          },
          health_score: {
            checkStatus:
              healthScore < 50 ? 'fail' : healthScore < 80 ? 'warn' : 'pass',
            value: healthScore,
            message: `Health score: ${healthScore.toFixed(0)}/100`,
            duration: Date.now() - startTime,
          },
          failure_risk: {
            checkStatus:
              predictiveScores.overallFailureRisk > 0.7
                ? 'fail'
                : predictiveScores.overallFailureRisk > 0.5
                  ? 'warn'
                  : 'pass',
            value: predictiveScores.overallFailureRisk,
            message: `Failure risk: ${(predictiveScores.overallFailureRisk * 100).toFixed(0)}%`,
            duration: Date.now() - startTime,
          },
        },
        overallScore:
          status === 'healthy'
            ? 100
            : status === 'warning'
              ? 75
              : status === 'unhealthy'
                ? 50
                : 0,
        sshMetrics: sshMetrics as any,
        connectionId: sshHealth.connectionId,
        hostInfo: {
          hostname: sshHealth.hostname,
          port: sshHealth.port,
          username: sshHealth.username,
        },
        predictiveScores,
      };
    } catch (error) {
      this.logger.error(
        `SSH health check failed for session ${sessionId}:`,
        error
      );

      return {
        checkId,
        checkType: 'session',
        sessionId,
        timestamp: new Date(),
        status: 'critical',
        metrics: {},
        details: {
          message: `SSH health check failed: ${error instanceof Error ? error.message : String(error)}`,
          diagnosis: 'Unable to assess SSH session health',
          recommendations: [
            'Check SSH connection',
            'Verify network connectivity',
            'Consider session restart',
          ],
          recoverable: true,
        },
        duration: Date.now() - startTime,
        checks: {
          ssh_health: {
            checkStatus: 'fail',
            message: `SSH health check failed: ${error instanceof Error ? error.message : String(error)}`,
          },
        },
        overallScore: 0,
        connectionId: sshHealth.connectionId,
        hostInfo: {
          hostname: sshHealth.hostname,
          port: sshHealth.port,
          username: sshHealth.username,
        },
      };
    }
  }

  /**
   * Test SSH connection health
   */
  private async testSSHConnection(
    sessionId: string,
    sshHealth: SSHSessionHealth
  ): Promise<{
    success: boolean;
    latency: number;
    duration?: number;
    error?: string;
  }> {
    const startTime = Date.now();

    return new Promise((resolve) => {
      // Emit SSH connection test request
      this.emit('ssh-connection-test-request', {
        sessionId,
        timeout: this.config.alertThresholds.ssh_connection_timeout,
        callback: (result: {
          success: boolean;
          latency?: number;
          error?: string;
        }) => {
          resolve({
            success: result.success,
            latency: result.latency || Date.now() - startTime,
            duration: Date.now() - startTime,
            error: result.error,
          });
        },
      });

      // Timeout mechanism
      setTimeout(() => {
        resolve({
          success: false,
          latency: Date.now() - startTime,
          duration: Date.now() - startTime,
          error: `SSH connection test timeout after ${this.config.alertThresholds.ssh_connection_timeout}ms`,
        });
      }, this.config.alertThresholds.ssh_connection_timeout);
    });
  }

  /**
   * Calculate SSH predictive scores
   */
  private calculateSSHPredictiveScores(
    sessionId: string,
    sshHealth: SSHSessionHealth
  ): {
    connectionStability: number;
    performanceDegradation: number;
    authenticationRisk: number;
    networkQuality: number;
    overallFailureRisk: number;
  } {
    const predictionModel = this.sshPredictionModels.get(sessionId);
    if (!predictionModel) {
      return {
        connectionStability: 1.0,
        performanceDegradation: 0,
        authenticationRisk: 0,
        networkQuality: 1.0,
        overallFailureRisk: 0,
      };
    }

    // Calculate connection stability based on historical data
    let connectionStability = 1.0;
    if (predictionModel.connectionStabilityTrend.length > 5) {
      const recentStability =
        predictionModel.connectionStabilityTrend.slice(-5);
      const avgStability =
        recentStability.reduce((a, b) => a + b, 0) / recentStability.length;
      connectionStability = Math.max(0, avgStability);
    }

    // Calculate performance degradation
    let performanceDegradation = 0;
    if (predictionModel.latencyTrend.length > 10) {
      const recent = predictionModel.latencyTrend.slice(-5);
      const older = predictionModel.latencyTrend.slice(-10, -5);

      if (older.length > 0) {
        const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
        const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;

        if (recentAvg > olderAvg * 1.5) {
          performanceDegradation = Math.min(
            1.0,
            (recentAvg - olderAvg) / olderAvg
          );
        }
      }
    }

    // Calculate authentication risk based on error history
    let authenticationRisk = 0;
    const authErrors = sshHealth.errorHistory.filter(
      (e) =>
        e.error.toLowerCase().includes('auth') ||
        e.error.toLowerCase().includes('permission') ||
        e.error.toLowerCase().includes('denied')
    );
    if (authErrors.length > 0) {
      authenticationRisk = Math.min(1.0, authErrors.length / 10);
    }

    // Calculate network quality based on latency and error patterns
    let networkQuality = 1.0;
    if (sshHealth.connectionLatencyHistory.length > 5) {
      const avgLatency = sshHealth.performanceMetrics.averageLatency;
      const maxLatency = sshHealth.performanceMetrics.maxLatency;

      if (avgLatency > this.config.thresholds.sshConnectionLatency) {
        networkQuality *= 0.7;
      }

      if (maxLatency > this.config.thresholds.sshConnectionLatency * 2) {
        networkQuality *= 0.5;
      }

      // Factor in latency variance
      const variance =
        sshHealth.connectionLatencyHistory
          .map((l) => Math.pow(l - avgLatency, 2))
          .reduce((a, b) => a + b, 0) /
        sshHealth.connectionLatencyHistory.length;

      if (variance > avgLatency) {
        networkQuality *= 0.8; // High variance indicates unstable network
      }
    }

    // Calculate overall failure risk
    const weights = {
      connectionStability: 0.3,
      performanceDegradation: 0.25,
      authenticationRisk: 0.2,
      networkQuality: 0.25,
    };

    const overallFailureRisk =
      (1 - connectionStability) * weights.connectionStability +
      performanceDegradation * weights.performanceDegradation +
      authenticationRisk * weights.authenticationRisk +
      (1 - networkQuality) * weights.networkQuality;

    return {
      connectionStability,
      performanceDegradation,
      authenticationRisk,
      networkQuality,
      overallFailureRisk: Math.min(1.0, overallFailureRisk),
    };
  }

  /**
   * Update SSH health score
   */
  private updateSSHHealthScore(sessionId: string): void {
    const sshHealth = this.sshSessions.get(sessionId);
    if (!sshHealth) {
      return;
    }

    let healthScore = 100;

    // Factor in recent errors
    const recentErrors = sshHealth.errorHistory.filter(
      (e) => Date.now() - e.timestamp.getTime() < 300000 // Last 5 minutes
    );
    healthScore -= recentErrors.length * 5;

    // Factor in connection stability
    healthScore *= sshHealth.connectionStability;

    // Factor in performance
    if (
      sshHealth.performanceMetrics.averageLatency >
      this.config.thresholds.sshConnectionLatency
    ) {
      const latencyPenalty = Math.min(
        20,
        (sshHealth.performanceMetrics.averageLatency /
          this.config.thresholds.sshConnectionLatency -
          1) *
          20
      );
      healthScore -= latencyPenalty;
    }

    // Factor in keep-alive status
    if (sshHealth.keepAliveStatus === 'failed') {
      healthScore -= 30;
    } else if (sshHealth.keepAliveStatus === 'degraded') {
      healthScore -= 15;
    }

    sshHealth.healthScore = Math.max(0, Math.min(100, healthScore));
  }

  /**
   * Update SSH prediction model
   */
  private updateSSHPredictionModel(sessionId: string): void {
    const sshHealth = this.sshSessions.get(sessionId);
    const predictionModel = this.sshPredictionModels.get(sessionId);

    if (!sshHealth || !predictionModel) {
      return;
    }

    // Update trends
    predictionModel.connectionStabilityTrend.push(
      sshHealth.connectionStability
    );
    if (predictionModel.connectionStabilityTrend.length > 50) {
      predictionModel.connectionStabilityTrend.shift();
    }

    if (sshHealth.connectionLatencyHistory.length > 0) {
      const latestLatency =
        sshHealth.connectionLatencyHistory[
          sshHealth.connectionLatencyHistory.length - 1
        ];
      predictionModel.latencyTrend.push(latestLatency);
      if (predictionModel.latencyTrend.length > 50) {
        predictionModel.latencyTrend.shift();
      }
    }

    if (sshHealth.throughputHistory.length > 0) {
      const latestThroughput =
        sshHealth.throughputHistory[sshHealth.throughputHistory.length - 1];
      predictionModel.throughputTrend.push(latestThroughput);
      if (predictionModel.throughputTrend.length > 50) {
        predictionModel.throughputTrend.shift();
      }
    }

    // Update error rate
    const errorRate = this.calculateSSHErrorRate(sshHealth);
    predictionModel.errorRateTrend.push(errorRate);
    if (predictionModel.errorRateTrend.length > 50) {
      predictionModel.errorRateTrend.shift();
    }

    // Update risk factors
    predictionModel.riskFactors.networkInstability =
      this.calculateNetworkInstability(sshHealth);
    predictionModel.riskFactors.performanceDegradation =
      this.calculatePerformanceDegradation(predictionModel);
    predictionModel.riskFactors.authenticationIssues =
      this.calculateAuthenticationRisk(sshHealth);
    predictionModel.riskFactors.connectionAging =
      this.calculateConnectionAging(sshHealth);

    // Update confidence score based on data availability
    const dataPoints =
      predictionModel.connectionStabilityTrend.length +
      predictionModel.latencyTrend.length +
      predictionModel.throughputTrend.length;
    predictionModel.confidenceScore = Math.min(1.0, dataPoints / 100);

    predictionModel.lastUpdated = new Date();
  }

  /**
   * Calculate SSH error rate
   */
  private calculateSSHErrorRate(sshHealth: SSHSessionHealth): number {
    const recentErrors = sshHealth.errorHistory.filter(
      (e) => Date.now() - e.timestamp.getTime() < 3600000 // Last hour
    );

    const connectionAge = Date.now() - sshHealth.connectedAt.getTime();
    const hoursConnected = Math.max(1, connectionAge / 3600000);

    return recentErrors.length / hoursConnected;
  }

  /**
   * Calculate network instability score
   */
  private calculateNetworkInstability(sshHealth: SSHSessionHealth): number {
    if (sshHealth.connectionLatencyHistory.length < 10) {
      return 0;
    }

    const latencies = sshHealth.connectionLatencyHistory;
    const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const variance =
      latencies.map((l) => Math.pow(l - avg, 2)).reduce((a, b) => a + b, 0) /
      latencies.length;
    const coefficient = Math.sqrt(variance) / avg;

    return Math.min(1.0, coefficient);
  }

  /**
   * Calculate performance degradation
   */
  private calculatePerformanceDegradation(
    predictionModel: SSHPredictionModel
  ): number {
    if (predictionModel.latencyTrend.length < 20) {
      return 0;
    }

    const recent = predictionModel.latencyTrend.slice(-10);
    const older = predictionModel.latencyTrend.slice(-20, -10);

    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;

    if (recentAvg > olderAvg) {
      return Math.min(1.0, (recentAvg - olderAvg) / olderAvg);
    }

    return 0;
  }

  /**
   * Calculate authentication risk
   */
  private calculateAuthenticationRisk(sshHealth: SSHSessionHealth): number {
    const authErrors = sshHealth.errorHistory.filter(
      (e) =>
        e.error.toLowerCase().includes('auth') ||
        e.error.toLowerCase().includes('permission') ||
        e.error.toLowerCase().includes('denied')
    );

    return Math.min(1.0, authErrors.length / 5);
  }

  /**
   * Calculate connection aging factor
   */
  private calculateConnectionAging(sshHealth: SSHSessionHealth): number {
    const connectionAge = Date.now() - sshHealth.connectedAt.getTime();
    const hoursConnected = connectionAge / 3600000;

    // Connections become more fragile after 24 hours
    if (hoursConnected > 24) {
      return Math.min(1.0, (hoursConnected - 24) / 48);
    }

    return 0;
  }

  /**
   * Generate SSH-specific recommendations
   */
  private generateSSHRecommendations(
    status: HealthCheckResult['status'],
    predictiveScores: any,
    sshHealth: SSHSessionHealth
  ): string[] {
    const recommendations: string[] = [];

    if (status === 'critical' || predictiveScores.overallFailureRisk > 0.8) {
      recommendations.push('URGENT: Consider immediate SSH session restart');
      recommendations.push(
        'Verify network connectivity and SSH server availability'
      );
    }

    if (predictiveScores.networkQuality < 0.5) {
      recommendations.push(
        'Network quality degraded - check network stability'
      );
      recommendations.push(
        'Consider using compression or connection multiplexing'
      );
    }

    if (predictiveScores.performanceDegradation > 0.3) {
      recommendations.push(
        'Performance degradation detected - investigate server load'
      );
      recommendations.push('Monitor SSH server resource utilization');
    }

    if (predictiveScores.authenticationRisk > 0.2) {
      recommendations.push(
        'Authentication issues detected - verify credentials'
      );
      recommendations.push(
        'Check SSH key validity and server authentication settings'
      );
    }

    if (
      sshHealth.performanceMetrics.averageLatency >
      this.config.thresholds.sshConnectionLatency
    ) {
      recommendations.push(
        `High latency detected (${sshHealth.performanceMetrics.averageLatency.toFixed(0)}ms)`
      );
      recommendations.push(
        'Consider using SSH connection multiplexing or keep-alive'
      );
    }

    if (sshHealth.errorHistory.length > 10) {
      recommendations.push(
        'Frequent errors detected - review connection stability'
      );
      recommendations.push(
        'Enable SSH debug logging for detailed troubleshooting'
      );
    }

    return recommendations;
  }

  /**
   * Handle critical SSH issues
   */
  private async handleCriticalSSHIssue(
    sessionId: string,
    healthResult: SSHHealthResult
  ): Promise<void> {
    this.logger.warn(`Handling critical SSH issue for session ${sessionId}`);

    // Emit critical SSH issue event
    this.emit('critical-ssh-issue', {
      sessionId,
      healthResult,
      timestamp: new Date(),
      autoRecoveryAttempted: false,
    });

    // Attempt automatic recovery if enabled
    if (this.config.recovery.enabled && healthResult.details.recoverable) {
      await this.attemptSSHAutoRecovery(sessionId, healthResult);
    }
  }

  /**
   * Attempt SSH automatic recovery
   */
  private async attemptSSHAutoRecovery(
    sessionId: string,
    healthResult: SSHHealthResult
  ): Promise<void> {
    const recoveryKey = `ssh-${sessionId}`;
    let attempts = this.stats.consecutiveFailures.get(recoveryKey) || 0;

    if (attempts >= this.config.recovery.maxAttempts) {
      this.logger.warn(`Max SSH recovery attempts reached for ${sessionId}`);
      return;
    }

    attempts++;
    this.stats.consecutiveFailures.set(recoveryKey, attempts);

    const delay =
      this.config.recovery.baseDelay *
      Math.pow(this.config.recovery.backoffMultiplier, attempts - 1);

    this.logger.info(
      `Attempting SSH auto-recovery for ${sessionId} (attempt ${attempts}/${this.config.recovery.maxAttempts}) in ${delay}ms`
    );

    setTimeout(async () => {
      try {
        // Emit SSH recovery attempt event
        this.emit('ssh-auto-recovery-attempt', {
          sessionId,
          healthResult,
          attempt: attempts,
          maxAttempts: this.config.recovery.maxAttempts,
          timestamp: new Date(),
        });

        // Request SSH session recovery
        let recoverySuccessful = false;

        // Emit SSH recovery request
        this.emit('ssh-recovery-request', {
          sessionId,
          healthResult,
          strategy: 'proactive-reconnect',
          timestamp: new Date(),
          callback: (success: boolean) => {
            recoverySuccessful = success;
          },
        });

        // Wait a moment for recovery to be attempted
        await new Promise((resolve) => setTimeout(resolve, 2000));

        if (recoverySuccessful) {
          this.stats.consecutiveFailures.delete(recoveryKey);
          this.emit('ssh-auto-recovery-success', {
            sessionId,
            attempt: attempts,
            timestamp: new Date(),
          });
          this.logger.info(`SSH auto-recovery successful for ${sessionId}`);
        } else {
          this.emit('ssh-auto-recovery-failed', {
            sessionId,
            attempt: attempts,
            timestamp: new Date(),
          });
          this.logger.warn(
            `SSH auto-recovery failed for ${sessionId} (attempt ${attempts})`
          );
        }
      } catch (error) {
        this.logger.error(`SSH auto-recovery error for ${sessionId}:`, error);
        this.emit('ssh-auto-recovery-error', {
          sessionId,
          attempt: attempts,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date(),
        });
      }
    }, delay);
  }

  /**
   * Generate comprehensive health report
   */
  private async generateHealthReport(
    checks: HealthCheckResult[]
  ): Promise<HealthReport> {
    const healthyCount = checks.filter((c) => c.status === 'healthy').length;
    const warningCount = checks.filter((c) => c.status === 'warning').length;
    const unhealthyCount = checks.filter(
      (c) => c.status === 'unhealthy'
    ).length;
    const criticalCount = checks.filter((c) => c.status === 'critical').length;

    // Calculate overall health status
    const overall: HealthReport['overall'] =
      criticalCount > 0
        ? 'critical'
        : unhealthyCount > 0
          ? 'unhealthy'
          : warningCount > 0
            ? 'warning'
            : 'healthy';

    // Calculate health score (0-100)
    const healthScore = Math.max(
      0,
      100 - warningCount * 10 - unhealthyCount * 25 - criticalCount * 50
    );
    this.healthScoreHistory.push(healthScore);

    // Keep only last 100 scores for trend analysis
    if (this.healthScoreHistory.length > 100) {
      this.healthScoreHistory.shift();
    }

    // Calculate trend
    const trend = this.calculateHealthTrend();

    // Calculate average response time
    const avgResponseTime =
      checks.length > 0
        ? checks.reduce((sum, check) => sum + check.duration, 0) / checks.length
        : 0;

    // Generate action items
    const actionItems = this.generateActionItems(checks);

    return {
      overall,
      timestamp: new Date(),
      checks,
      metrics: {
        totalChecks: checks.length,
        healthyChecks: healthyCount,
        warningChecks: warningCount,
        unhealthyChecks: unhealthyCount,
        criticalChecks: criticalCount,
        averageResponseTime: avgResponseTime,
      },
      trends: {
        healthScore,
        healthScoreTrend: trend,
        predictionNextHour: this.config.monitoring.enablePredictiveAnalysis
          ? this.predictHealthStatus()
          : undefined,
      },
      actionItems,
      sshHealthSummary: this.generateSSHHealthSummary(),
    };
  }

  /**
   * Generate SSH health summary
   */
  private generateSSHHealthSummary(): {
    totalSSHSessions: number;
    healthySSHSessions: number;
    unhealthySSHSessions: number;
    averageSSHLatency: number;
    predictedFailures: number;
    proactiveReconnections: number;
  } {
    const sshSessions = Array.from(this.sshSessions.values());
    const healthySessions = sshSessions.filter(
      (s) => s.healthScore >= 80
    ).length;
    const unhealthySessions = sshSessions.filter(
      (s) => s.healthScore < 50
    ).length;

    const avgLatency =
      sshSessions.length > 0
        ? sshSessions.reduce(
            (sum, s) => sum + s.performanceMetrics.averageLatency,
            0
          ) / sshSessions.length
        : 0;

    const predictedFailures = sshSessions.filter(
      (s) => s.predictiveFailureScore > 0.7
    ).length;

    // Count proactive reconnections from stats (would be tracked elsewhere)
    const proactiveReconnections = 0; // This would be tracked in a separate counter

    return {
      totalSSHSessions: sshSessions.length,
      healthySSHSessions: healthySessions,
      unhealthySSHSessions: unhealthySessions,
      averageSSHLatency: avgLatency,
      predictedFailures,
      proactiveReconnections,
    };
  }

  /**
   * Calculate health trend based on historical data
   */
  private calculateHealthTrend(): 'improving' | 'stable' | 'degrading' {
    if (this.healthScoreHistory.length < 5) {
      return 'stable';
    }

    const recent = this.healthScoreHistory.slice(-5);
    const older = this.healthScoreHistory.slice(-10, -5);

    if (older.length === 0) return 'stable';

    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;

    const difference = recentAvg - olderAvg;

    if (difference > 5) return 'improving';
    if (difference < -5) return 'degrading';
    return 'stable';
  }

  /**
   * Predict health status for the next hour using simple trend analysis
   */
  private predictHealthStatus():
    | 'healthy'
    | 'warning'
    | 'unhealthy'
    | 'critical' {
    if (this.healthScoreHistory.length < 10) {
      return 'healthy';
    }

    // Simple linear regression on recent health scores
    const recentScores = this.healthScoreHistory.slice(-10);
    const x = Array.from({ length: recentScores.length }, (_, i) => i);
    const y = recentScores;

    const n = recentScores.length;
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((acc, xi, i) => acc + xi * y[i], 0);
    const sumXX = x.reduce((acc, xi) => acc + xi * xi, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const predictedScore = recentScores[recentScores.length - 1] + slope * 12; // 12 intervals ahead (assuming 5min intervals)

    if (predictedScore < 30) return 'critical';
    if (predictedScore < 60) return 'unhealthy';
    if (predictedScore < 80) return 'warning';
    return 'healthy';
  }

  /**
   * Generate actionable recommendations based on health checks
   */
  private generateActionItems(checks: HealthCheckResult[]): string[] {
    const actionItems: string[] = [];
    const criticalChecks = checks.filter((c) => c.status === 'critical');
    const unhealthyChecks = checks.filter((c) => c.status === 'unhealthy');

    if (criticalChecks.length > 0) {
      actionItems.push(
        `CRITICAL: ${criticalChecks.length} critical issues require immediate attention`
      );
      criticalChecks.forEach((check) => {
        if (check.details.recommendations) {
          actionItems.push(
            ...check.details.recommendations.map((r) => `- ${r}`)
          );
        }
      });
    }

    if (unhealthyChecks.length > 0) {
      actionItems.push(
        `WARNING: ${unhealthyChecks.length} unhealthy components need attention`
      );
    }

    // Add general maintenance recommendations
    if (this.healthScoreHistory.length > 0) {
      const avgScore =
        this.healthScoreHistory.reduce((a, b) => a + b, 0) /
        this.healthScoreHistory.length;
      if (avgScore < 80) {
        actionItems.push('Consider system optimization and maintenance');
      }
    }

    return actionItems;
  }

  /**
   * Handle critical health issues that require immediate action
   */
  private async handleCriticalIssues(report: HealthReport): Promise<void> {
    const criticalChecks = report.checks.filter((c) => c.status === 'critical');

    if (criticalChecks.length === 0) return;

    this.logger.warn(
      `Handling ${criticalChecks.length} critical health issues`
    );

    for (const check of criticalChecks) {
      // Emit critical health event
      this.emit('critical-health-issue', {
        check,
        timestamp: new Date(),
        autoRecoveryAttempted: false,
      });

      // Attempt automatic recovery if enabled and issue is recoverable
      if (this.config.recovery.enabled && check.details.recoverable) {
        await this.attemptAutoRecovery(check);
      }
    }

    // If overall health is critical, emit system-wide alert
    if (report.overall === 'critical') {
      this.emit('system-critical', {
        report,
        timestamp: new Date(),
        actionRequired: true,
      });
    }
  }

  /**
   * Attempt automatic recovery for critical issues
   */
  private async attemptAutoRecovery(check: HealthCheckResult): Promise<void> {
    const recoveryKey = `${check.checkType}-${check.sessionId || 'system'}`;
    let attempts = this.stats.consecutiveFailures.get(recoveryKey) || 0;

    if (attempts >= this.config.recovery.maxAttempts) {
      this.logger.warn(`Max recovery attempts reached for ${recoveryKey}`);
      return;
    }

    attempts++;
    this.stats.consecutiveFailures.set(recoveryKey, attempts);

    const delay =
      this.config.recovery.baseDelay *
      Math.pow(this.config.recovery.backoffMultiplier, attempts - 1);

    this.logger.info(
      `Attempting auto-recovery for ${recoveryKey} (attempt ${attempts}/${this.config.recovery.maxAttempts}) in ${delay}ms`
    );

    setTimeout(async () => {
      try {
        // Emit recovery attempt event
        this.emit('auto-recovery-attempt', {
          check,
          attempt: attempts,
          maxAttempts: this.config.recovery.maxAttempts,
          timestamp: new Date(),
        });

        // Recovery logic based on check type
        let recoverySuccessful = false;

        switch (check.checkType) {
          case 'system':
            recoverySuccessful = await this.recoverSystemIssue(check);
            break;
          case 'network':
            recoverySuccessful = await this.recoverNetworkIssue(check);
            break;
          case 'session':
            recoverySuccessful = await this.recoverSessionIssue(check);
            break;
          default:
            this.logger.warn(
              `No recovery strategy for check type: ${check.checkType}`
            );
        }

        if (recoverySuccessful) {
          this.stats.consecutiveFailures.delete(recoveryKey);
          this.emit('auto-recovery-success', {
            check,
            attempt: attempts,
            timestamp: new Date(),
          });
          this.logger.info(`Auto-recovery successful for ${recoveryKey}`);
        } else {
          this.emit('auto-recovery-failed', {
            check,
            attempt: attempts,
            timestamp: new Date(),
          });
          this.logger.warn(
            `Auto-recovery failed for ${recoveryKey} (attempt ${attempts})`
          );
        }
      } catch (error) {
        this.logger.error(`Auto-recovery error for ${recoveryKey}:`, error);
        this.emit('auto-recovery-error', {
          check,
          attempt: attempts,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date(),
        });
      }
    }, delay);
  }

  /**
   * Attempt to recover from system issues
   */
  private async recoverSystemIssue(check: HealthCheckResult): Promise<boolean> {
    try {
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
        this.logger.info('Forced garbage collection for memory recovery');
        return true;
      }

      // Clear caches, clean up temporary data, etc.
      // This is a placeholder for system recovery actions
      this.logger.info('Attempting system recovery actions');
      return true;
    } catch (error) {
      this.logger.error('System recovery failed:', error);
      return false;
    }
  }

  /**
   * Attempt to recover from network issues
   */
  private async recoverNetworkIssue(
    check: HealthCheckResult
  ): Promise<boolean> {
    try {
      // Flush DNS cache, reset network connections, etc.
      // This is a placeholder for network recovery actions
      this.logger.info('Attempting network recovery actions');
      return true;
    } catch (error) {
      this.logger.error('Network recovery failed:', error);
      return false;
    }
  }

  /**
   * Attempt to recover from session issues
   */
  private async recoverSessionIssue(
    check: HealthCheckResult
  ): Promise<boolean> {
    try {
      if (!check.sessionId) return false;

      // Emit session recovery request
      this.emit('session-recovery-request', {
        sessionId: check.sessionId,
        check,
        timestamp: new Date(),
      });

      this.logger.info(`Requested session recovery for ${check.sessionId}`);
      return true;
    } catch (error) {
      this.logger.error('Session recovery failed:', error);
      return false;
    }
  }

  /**
   * Update health statistics
   */
  private updateHealthStatistics(checks: HealthCheckResult[]): void {
    this.stats.totalChecks += checks.length;
    const successfulChecks = checks.filter(
      (c) => c.status === 'healthy' || c.status === 'warning'
    ).length;
    this.stats.successfulChecks += successfulChecks;
    this.stats.failedChecks += checks.length - successfulChecks;

    // Update average response time
    const totalResponseTime = checks.reduce(
      (sum, check) => sum + check.duration,
      0
    );
    this.stats.averageResponseTime =
      (this.stats.averageResponseTime *
        (this.stats.totalChecks - checks.length) +
        totalResponseTime) /
      this.stats.totalChecks;

    // Update consecutive failure counts
    for (const check of checks) {
      const key = `${check.checkType}-${check.sessionId || 'system'}`;
      if (check.status === 'healthy' || check.status === 'warning') {
        this.stats.consecutiveFailures.delete(key);
      } else {
        const current = this.stats.consecutiveFailures.get(key) || 0;
        this.stats.consecutiveFailures.set(key, current + 1);
      }
      this.stats.lastCheckTimes.set(key, new Date());
    }
  }

  /**
   * Update health trends
   */
  private updateHealthTrends(report: HealthReport): void {
    // Store health reports for trend analysis
    const key = `health-${report.timestamp.toISOString().split('T')[0]}`; // Daily key
    if (!this.healthHistory.has(key)) {
      this.healthHistory.set(key, []);
    }

    // Convert report to a check result for storage
    const overallCheck: HealthCheckResult = {
      checkId: `overall-${Date.now()}`,
      checkType: 'system',
      timestamp: report.timestamp,
      status: report.overall,
      metrics: {
        healthScore: report.trends.healthScore,
        totalChecks: report.metrics.totalChecks,
        healthyChecks: report.metrics.healthyChecks,
        averageResponseTime: report.metrics.averageResponseTime,
      },
      details: {
        message: `Overall health: ${report.overall}`,
        recoverable: true,
      },
      duration: 0,
      checks: {
        overall_health: {
          checkStatus:
            report.overall === 'healthy'
              ? 'pass'
              : report.overall === 'warning'
                ? 'warn'
                : 'fail',
          value: report.trends.healthScore,
          message: `Overall health: ${report.overall}`,
          duration: 0,
        },
      },
      overallScore:
        report.overall === 'healthy'
          ? 100
          : report.overall === 'warning'
            ? 75
            : report.overall === 'unhealthy'
              ? 50
              : 0,
    };

    this.healthHistory.get(key)!.push(overallCheck);

    // Clean up old history (keep last 30 days)
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 30);

    this.healthHistory.forEach((history, historyKey) => {
      if (new Date(historyKey.replace('health-', '')) < cutoffDate) {
        this.healthHistory.delete(historyKey);
      }
    });
  }

  /**
   * Get current health statistics
   */
  getHealthStatistics() {
    return {
      ...this.stats,
      isRunning: this.isRunning,
      healthScoreHistory: [...this.healthScoreHistory],
      consecutiveFailures: Object.fromEntries(this.stats.consecutiveFailures),
      lastCheckTimes: Object.fromEntries(
        Array.from(this.stats.lastCheckTimes.entries()).map(([k, v]) => [
          k,
          v.toISOString(),
        ])
      ),
      errorRates: Object.fromEntries(this.stats.errorRates),
    };
  }

  /**
   * Get historical health data
   */
  getHealthHistory(days = 7): Record<string, HealthCheckResult[]> {
    const result: Record<string, HealthCheckResult[]> = {};
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    this.healthHistory.forEach((checks, key) => {
      const date = new Date(key.replace('health-', ''));
      if (date >= cutoffDate) {
        result[key] = checks;
      }
    });

    return result;
  }

  // Utility methods for system metrics

  private async getCPUUsage(): Promise<number> {
    return new Promise((resolve) => {
      const startUsage = process.cpuUsage();
      setTimeout(() => {
        const endUsage = process.cpuUsage(startUsage);
        const totalUsage = endUsage.user + endUsage.system;
        const percentage = totalUsage / 10000 / os.cpus().length; // Convert to percentage
        resolve(Math.min(100, percentage));
      }, 100);
    });
  }

  private async getMemoryInfo(): Promise<{
    total: number;
    free: number;
    used: number;
  }> {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    return {
      total: totalMem,
      free: freeMem,
      used: totalMem - freeMem,
    };
  }

  private async getDiskInfo(): Promise<{
    total: number;
    used: number;
    free: number;
  }> {
    try {
      // For cross-platform compatibility, we'll use a simple approach
      if (process.platform === 'win32') {
        const { stdout } = await execAsync(
          'wmic logicaldisk where "Caption=\'C:\'" get Size,FreeSpace /value'
        );
        const lines = stdout.split('\n').filter((line) => line.includes('='));
        const freeSpace = parseInt(
          lines.find((line) => line.startsWith('FreeSpace='))?.split('=')[1] ||
            '0'
        );
        const totalSpace = parseInt(
          lines.find((line) => line.startsWith('Size='))?.split('=')[1] || '0'
        );
        return {
          total: totalSpace,
          free: freeSpace,
          used: totalSpace - freeSpace,
        };
      } else {
        const { stdout } = await execAsync('df -k . | tail -1');
        const fields = stdout.trim().split(/\s+/);
        const total = parseInt(fields[1]) * 1024;
        const used = parseInt(fields[2]) * 1024;
        const free = parseInt(fields[3]) * 1024;
        return { total, used, free };
      }
    } catch (error) {
      this.logger.error('Error getting disk info:', error);
      return { total: 0, used: 0, free: 0 };
    }
  }

  private async pingHost(host: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const command =
        process.platform === 'win32'
          ? `ping -n 1 ${host}`
          : `ping -c 1 ${host}`;

      exec(command, (error, stdout) => {
        if (error) {
          reject(error);
        } else {
          const latency = Date.now() - startTime;
          resolve(latency);
        }
      });
    });
  }

  /**
   * Clean up resources
   */
  async destroy(): Promise<void> {
    await this.stop();
    this.healthHistory.clear();
    this.healthScoreHistory.length = 0;

    // Clean up SSH-specific resources
    this.sshSessions.clear();
    this.sshHealthHistory.clear();
    this.sshPredictionModels.clear();

    this.removeAllListeners();
    this.logger.info('HealthMonitor destroyed');
  }
}
