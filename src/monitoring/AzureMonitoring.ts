import { EventEmitter } from 'eventemitter3';
import { Logger } from 'winston';
import {
  AzureCloudShellSession,
  AzureBastionSession,
  AzureArcSession,
  AzureTokenInfo,
  AzureResourceInfo
} from '../types/index.js';

export interface AzureMonitoringMetrics {
  sessionCount: {
    total: number;
    byType: Record<string, number>;
    byRegion: Record<string, number>;
    byStatus: Record<string, number>;
  };
  authentication: {
    tokenRefreshCount: number;
    tokenExpirySoon: number;
    authFailures: number;
    lastTokenRefresh: Date | null;
  };
  performance: {
    averageConnectionTime: number;
    averageLatency: number;
    connectionSuccess: number;
    connectionFailures: number;
    reconnectAttempts: number;
  };
  resources: {
    activeSubscriptions: Set<string>;
    activeResourceGroups: Set<string>;
    activeRegions: Set<string>;
    quotaUtilization: Record<string, number>;
  };
  errors: {
    azureApiErrors: number;
    networkErrors: number;
    authenticationErrors: number;
    configurationErrors: number;
  };
  costs: {
    estimatedSessionCosts: Record<string, number>;
    totalEstimatedCost: number;
    costOptimizationSuggestions: string[];
  };
}

export interface AzureHealthCheck {
  timestamp: Date;
  overall: 'healthy' | 'warning' | 'critical';
  checks: {
    authentication: {
      status: 'pass' | 'warn' | 'fail';
      message: string;
      tokensExpiringSoon?: number;
      lastRefresh?: Date;
    };
    connectivity: {
      status: 'pass' | 'warn' | 'fail';
      message: string;
      activeConnections: number;
      failureRate: number;
    };
    resources: {
      status: 'pass' | 'warn' | 'fail';
      message: string;
      quotaUtilization: Record<string, number>;
      recommendations?: string[];
    };
    performance: {
      status: 'pass' | 'warn' | 'fail';
      message: string;
      averageLatency: number;
      connectionSuccessRate: number;
    };
  };
  recommendations: string[];
}

export interface AzureAlertConfig {
  tokenExpiryWarningHours: number;
  maxConnectionFailureRate: number;
  maxLatencyMs: number;
  quotaUtilizationThreshold: number;
  costThresholdDaily: number;
}

interface AzureMonitoringEvents {
  'token-expiry-warning': (sessionId: string, expiresIn: number) => void;
  'connection-failure-threshold': (failureRate: number) => void;
  'performance-degradation': (latency: number) => void;
  'quota-warning': (resource: string, utilization: number) => void;
  'cost-alert': (dailyCost: number) => void;
  'health-check-completed': (result: AzureHealthCheck) => void;
}

export class AzureMonitoring extends EventEmitter<AzureMonitoringEvents> {
  private metrics: AzureMonitoringMetrics;
  private alertConfig: AzureAlertConfig;
  private sessions: Map<string, AzureCloudShellSession | AzureBastionSession | AzureArcSession> = new Map();
  private connectionStats: Map<string, { startTime: Date; endTime?: Date; success: boolean; latency?: number }> = new Map();
  private monitoringInterval: NodeJS.Timeout | null = null;
  private logger: Logger;

  constructor(logger: Logger, config?: Partial<AzureAlertConfig>) {
    super();
    this.logger = logger;
    
    this.alertConfig = {
      tokenExpiryWarningHours: 2, // Warn 2 hours before token expires
      maxConnectionFailureRate: 0.15, // 15% failure rate
      maxLatencyMs: 5000, // 5 seconds
      quotaUtilizationThreshold: 0.8, // 80% quota utilization
      costThresholdDaily: 100, // $100 per day
      ...config
    };

    this.metrics = {
      sessionCount: {
        total: 0,
        byType: {},
        byRegion: {},
        byStatus: {}
      },
      authentication: {
        tokenRefreshCount: 0,
        tokenExpirySoon: 0,
        authFailures: 0,
        lastTokenRefresh: null
      },
      performance: {
        averageConnectionTime: 0,
        averageLatency: 0,
        connectionSuccess: 0,
        connectionFailures: 0,
        reconnectAttempts: 0
      },
      resources: {
        activeSubscriptions: new Set(),
        activeResourceGroups: new Set(),
        activeRegions: new Set(),
        quotaUtilization: {}
      },
      errors: {
        azureApiErrors: 0,
        networkErrors: 0,
        authenticationErrors: 0,
        configurationErrors: 0
      },
      costs: {
        estimatedSessionCosts: {},
        totalEstimatedCost: 0,
        costOptimizationSuggestions: []
      }
    };

    this.startMonitoring();
  }

  /**
   * Register a new Azure session for monitoring
   */
  registerSession(session: AzureCloudShellSession | AzureBastionSession | AzureArcSession): void {
    this.sessions.set(session.sessionId, session);
    
    // Update metrics
    this.metrics.sessionCount.total++;
    
    // Determine session type
    let sessionType: string;
    if ('webSocketUrl' in session) {
      sessionType = 'cloud-shell';
    } else if ('bastionResourceId' in session) {
      sessionType = 'bastion';
    } else {
      sessionType = 'arc';
    }
    
    this.metrics.sessionCount.byType[sessionType] = (this.metrics.sessionCount.byType[sessionType] || 0) + 1;
    
    // Track resources
    if ('subscription' in session) {
      this.metrics.resources.activeSubscriptions.add(session.subscription);
    }
    if ('resourceGroup' in session) {
      this.metrics.resources.activeResourceGroups.add(session.resourceGroup);
    }
    if ('location' in session) {
      this.metrics.resources.activeRegions.add(session.location);
    }

    this.logger.debug(`Registered Azure ${sessionType} session for monitoring: ${session.sessionId}`);
  }

  /**
   * Unregister an Azure session from monitoring
   */
  unregisterSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    this.sessions.delete(sessionId);
    this.connectionStats.delete(sessionId);
    
    this.metrics.sessionCount.total--;
    
    // Update session type count
    let sessionType: string;
    if ('webSocketUrl' in session) {
      sessionType = 'cloud-shell';
    } else if ('bastionResourceId' in session) {
      sessionType = 'bastion';
    } else {
      sessionType = 'arc';
    }
    
    if (this.metrics.sessionCount.byType[sessionType] > 0) {
      this.metrics.sessionCount.byType[sessionType]--;
    }

    this.logger.debug(`Unregistered Azure session from monitoring: ${sessionId}`);
  }

  /**
   * Record authentication event
   */
  recordAuthenticationEvent(eventType: 'token-refresh' | 'auth-failure', tokenInfo?: AzureTokenInfo): void {
    switch (eventType) {
      case 'token-refresh':
        this.metrics.authentication.tokenRefreshCount++;
        this.metrics.authentication.lastTokenRefresh = new Date();
        if (tokenInfo) {
          this.checkTokenExpiry(tokenInfo);
        }
        break;
      case 'auth-failure':
        this.metrics.authentication.authFailures++;
        this.metrics.errors.authenticationErrors++;
        break;
    }
  }

  /**
   * Record connection event
   */
  recordConnectionEvent(sessionId: string, eventType: 'start' | 'success' | 'failure', latency?: number): void {
    switch (eventType) {
      case 'start':
        this.connectionStats.set(sessionId, { startTime: new Date(), success: false });
        break;
      case 'success':
        const successStat = this.connectionStats.get(sessionId);
        if (successStat) {
          successStat.success = true;
          successStat.endTime = new Date();
          successStat.latency = latency || (successStat.endTime.getTime() - successStat.startTime.getTime());
          this.metrics.performance.connectionSuccess++;
          this.updatePerformanceMetrics();
        }
        break;
      case 'failure':
        const failureStat = this.connectionStats.get(sessionId);
        if (failureStat) {
          failureStat.success = false;
          failureStat.endTime = new Date();
          this.metrics.performance.connectionFailures++;
          this.checkConnectionFailureRate();
        }
        break;
    }
  }

  /**
   * Record error event
   */
  recordErrorEvent(errorType: 'api' | 'network' | 'authentication' | 'configuration', error: Error): void {
    switch (errorType) {
      case 'api':
        this.metrics.errors.azureApiErrors++;
        break;
      case 'network':
        this.metrics.errors.networkErrors++;
        break;
      case 'authentication':
        this.metrics.errors.authenticationErrors++;
        break;
      case 'configuration':
        this.metrics.errors.configurationErrors++;
        break;
    }

    this.logger.warn(`Azure ${errorType} error recorded:`, error.message);
  }

  /**
   * Update estimated costs
   */
  updateCostEstimates(sessionId: string, costEstimate: number): void {
    this.metrics.costs.estimatedSessionCosts[sessionId] = costEstimate;
    this.metrics.costs.totalEstimatedCost = Object.values(this.metrics.costs.estimatedSessionCosts)
      .reduce((sum, cost) => sum + cost, 0);

    if (this.metrics.costs.totalEstimatedCost > this.alertConfig.costThresholdDaily) {
      this.emit('cost-alert', this.metrics.costs.totalEstimatedCost);
    }
  }

  /**
   * Get current metrics
   */
  getMetrics(): AzureMonitoringMetrics {
    return {
      ...this.metrics,
      // Convert Sets to arrays for serialization
      resources: {
        ...this.metrics.resources,
        activeSubscriptions: new Set(Array.from(this.metrics.resources.activeSubscriptions)),
        activeResourceGroups: new Set(Array.from(this.metrics.resources.activeResourceGroups)),
        activeRegions: new Set(Array.from(this.metrics.resources.activeRegions))
      }
    };
  }

  /**
   * Perform comprehensive health check
   */
  async performHealthCheck(): Promise<AzureHealthCheck> {
    const result: AzureHealthCheck = {
      timestamp: new Date(),
      overall: 'healthy',
      checks: {
        authentication: this.checkAuthentication(),
        connectivity: this.checkConnectivity(),
        resources: this.checkResources(),
        performance: this.checkPerformance()
      },
      recommendations: []
    };

    // Determine overall health
    const checks = Object.values(result.checks);
    const failCount = checks.filter(check => check.status === 'fail').length;
    const warnCount = checks.filter(check => check.status === 'warn').length;

    if (failCount > 0) {
      result.overall = 'critical';
    } else if (warnCount > 0) {
      result.overall = 'warning';
    }

    // Generate recommendations
    result.recommendations = this.generateRecommendations(result.checks);

    this.emit('health-check-completed', result);
    return result;
  }

  /**
   * Start monitoring
   */
  private startMonitoring(): void {
    if (this.monitoringInterval) {
      return;
    }

    this.monitoringInterval = setInterval(() => {
      this.performRoutineChecks();
    }, 60000); // Check every minute

    this.logger.info('Azure monitoring started');
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    this.logger.info('Azure monitoring stopped');
  }

  /**
   * Perform routine monitoring checks
   */
  private performRoutineChecks(): void {
    // Check token expiry for all sessions
    this.sessions.forEach((session) => {
      const hoursUntilExpiry = (session.tokenExpiry.getTime() - Date.now()) / (1000 * 60 * 60);
      if (hoursUntilExpiry <= this.alertConfig.tokenExpiryWarningHours) {
        this.emit('token-expiry-warning', session.sessionId, hoursUntilExpiry);
      }
    });

    // Update cost optimization suggestions
    this.updateCostOptimizationSuggestions();
  }

  /**
   * Check token expiry
   */
  private checkTokenExpiry(tokenInfo: AzureTokenInfo): void {
    const hoursUntilExpiry = (tokenInfo.expiresOn.getTime() - Date.now()) / (1000 * 60 * 60);
    if (hoursUntilExpiry <= this.alertConfig.tokenExpiryWarningHours) {
      this.metrics.authentication.tokenExpirySoon++;
    }
  }

  /**
   * Check connection failure rate
   */
  private checkConnectionFailureRate(): void {
    const totalConnections = this.metrics.performance.connectionSuccess + this.metrics.performance.connectionFailures;
    if (totalConnections > 0) {
      const failureRate = this.metrics.performance.connectionFailures / totalConnections;
      if (failureRate > this.alertConfig.maxConnectionFailureRate) {
        this.emit('connection-failure-threshold', failureRate);
      }
    }
  }

  /**
   * Update performance metrics
   */
  private updatePerformanceMetrics(): void {
    const latencies = Array.from(this.connectionStats.values())
      .filter(stat => stat.success && stat.latency)
      .map(stat => stat.latency!);

    if (latencies.length > 0) {
      this.metrics.performance.averageLatency = latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length;
      
      if (this.metrics.performance.averageLatency > this.alertConfig.maxLatencyMs) {
        this.emit('performance-degradation', this.metrics.performance.averageLatency);
      }
    }
  }

  /**
   * Check authentication health
   */
  private checkAuthentication(): AzureHealthCheck['checks']['authentication'] {
    const tokensExpiring = Array.from(this.sessions.values())
      .filter(session => (session.tokenExpiry.getTime() - Date.now()) / (1000 * 60 * 60) <= this.alertConfig.tokenExpiryWarningHours)
      .length;

    if (tokensExpiring > 0) {
      return {
        status: 'warn',
        message: `${tokensExpiring} token(s) expiring soon`,
        tokensExpiringSoon: tokensExpiring,
        lastRefresh: this.metrics.authentication.lastTokenRefresh || undefined
      };
    }

    if (this.metrics.authentication.authFailures > 5) {
      return {
        status: 'fail',
        message: `High number of authentication failures: ${this.metrics.authentication.authFailures}`,
        lastRefresh: this.metrics.authentication.lastTokenRefresh || undefined
      };
    }

    return {
      status: 'pass',
      message: 'Authentication is healthy',
      tokensExpiringSoon: 0,
      lastRefresh: this.metrics.authentication.lastTokenRefresh || undefined
    };
  }

  /**
   * Check connectivity health
   */
  private checkConnectivity(): AzureHealthCheck['checks']['connectivity'] {
    const totalConnections = this.metrics.performance.connectionSuccess + this.metrics.performance.connectionFailures;
    const failureRate = totalConnections > 0 ? this.metrics.performance.connectionFailures / totalConnections : 0;

    if (failureRate > this.alertConfig.maxConnectionFailureRate) {
      return {
        status: 'fail',
        message: `High connection failure rate: ${(failureRate * 100).toFixed(1)}%`,
        activeConnections: this.sessions.size,
        failureRate
      };
    }

    if (failureRate > this.alertConfig.maxConnectionFailureRate * 0.5) {
      return {
        status: 'warn',
        message: `Elevated connection failure rate: ${(failureRate * 100).toFixed(1)}%`,
        activeConnections: this.sessions.size,
        failureRate
      };
    }

    return {
      status: 'pass',
      message: 'Connectivity is healthy',
      activeConnections: this.sessions.size,
      failureRate
    };
  }

  /**
   * Check resources health
   */
  private checkResources(): AzureHealthCheck['checks']['resources'] {
    const highUtilization = Object.entries(this.metrics.resources.quotaUtilization)
      .filter(([_, utilization]) => utilization > this.alertConfig.quotaUtilizationThreshold);

    if (highUtilization.length > 0) {
      return {
        status: 'warn',
        message: `High quota utilization in ${highUtilization.length} resource(s)`,
        quotaUtilization: this.metrics.resources.quotaUtilization,
        recommendations: highUtilization.map(([resource, util]) => 
          `Consider increasing quota or reducing usage for ${resource} (${(util * 100).toFixed(1)}% utilized)`
        )
      };
    }

    return {
      status: 'pass',
      message: 'Resource utilization is healthy',
      quotaUtilization: this.metrics.resources.quotaUtilization
    };
  }

  /**
   * Check performance health
   */
  private checkPerformance(): AzureHealthCheck['checks']['performance'] {
    const totalConnections = this.metrics.performance.connectionSuccess + this.metrics.performance.connectionFailures;
    const successRate = totalConnections > 0 ? this.metrics.performance.connectionSuccess / totalConnections : 1;

    if (this.metrics.performance.averageLatency > this.alertConfig.maxLatencyMs) {
      return {
        status: 'fail',
        message: `High average latency: ${this.metrics.performance.averageLatency}ms`,
        averageLatency: this.metrics.performance.averageLatency,
        connectionSuccessRate: successRate
      };
    }

    if (this.metrics.performance.averageLatency > this.alertConfig.maxLatencyMs * 0.7) {
      return {
        status: 'warn',
        message: `Elevated average latency: ${this.metrics.performance.averageLatency}ms`,
        averageLatency: this.metrics.performance.averageLatency,
        connectionSuccessRate: successRate
      };
    }

    return {
      status: 'pass',
      message: 'Performance is healthy',
      averageLatency: this.metrics.performance.averageLatency,
      connectionSuccessRate: successRate
    };
  }

  /**
   * Generate recommendations based on health check results
   */
  private generateRecommendations(checks: AzureHealthCheck['checks']): string[] {
    const recommendations: string[] = [];

    if (checks.authentication.status !== 'pass') {
      recommendations.push('Consider implementing proactive token refresh before expiry');
    }

    if (checks.connectivity.status !== 'pass') {
      recommendations.push('Review network configuration and Azure service health');
    }

    if (checks.performance.status !== 'pass') {
      recommendations.push('Consider optimizing connection strategies or using regional endpoints');
    }

    if (this.metrics.costs.totalEstimatedCost > this.alertConfig.costThresholdDaily * 0.8) {
      recommendations.push('Review session usage patterns to optimize costs');
    }

    return recommendations;
  }

  /**
   * Update cost optimization suggestions
   */
  private updateCostOptimizationSuggestions(): void {
    const suggestions: string[] = [];

    // Suggest session consolidation if many small sessions
    const activeSessionCount = this.sessions.size;
    if (activeSessionCount > 10) {
      suggestions.push('Consider consolidating multiple short sessions into fewer long-running sessions');
    }

    // Suggest region optimization
    const regions = Array.from(this.metrics.resources.activeRegions);
    if (regions.length > 3) {
      suggestions.push('Consider consolidating resources to fewer regions to reduce data transfer costs');
    }

    // Suggest resource cleanup
    const idleSessions = Array.from(this.sessions.entries())
      .filter(([_, session]) => {
        const lastActivity = session.metadata?.lastActivity as Date;
        return lastActivity && (Date.now() - lastActivity.getTime()) > 30 * 60 * 1000; // 30 minutes idle
      });

    if (idleSessions.length > 0) {
      suggestions.push(`Consider closing ${idleSessions.length} idle session(s) to reduce costs`);
    }

    this.metrics.costs.costOptimizationSuggestions = suggestions;
  }
}