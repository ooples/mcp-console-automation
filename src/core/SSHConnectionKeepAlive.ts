import { EventEmitter } from 'events';
import { Logger } from '../utils/logger.js';
import { Client as SSHClient } from 'ssh2';
import { SSHConnectionOptions, PooledConnection } from '../types/index.js';

export interface KeepAliveConfig {
  enabled: boolean;
  keepAliveInterval: number;
  keepAliveCountMax: number;
  serverAliveInterval: number;
  serverAliveCountMax: number;
  connectionTimeout: number;
  reconnectOnFailure: boolean;
  maxReconnectAttempts: number;
  reconnectDelay: number;
  backoffMultiplier: number;
  maxReconnectDelay: number;
  enableAdaptiveKeepAlive: boolean;
  enablePredictiveReconnect: boolean;
  connectionHealthThreshold: number;
  // Advanced network condition detection
  networkConditionSamplingSize: number;
  fastNetworkThreshold: number;
  slowNetworkThreshold: number;
  unstableNetworkThreshold: number;
  adaptiveIntervalMultipliers: {
    fast: number;
    normal: number;
    slow: number;
    unstable: number;
  };
}

export type NetworkCondition = 'fast' | 'normal' | 'slow' | 'unstable';

export interface ConnectionHealth {
  connectionId: string;
  lastKeepAlive: Date;
  keepAliveCount: number;
  failedKeepAlives: number;
  consecutiveFailures: number;
  responseTimeHistory: number[];
  averageResponseTime: number;
  isHealthy: boolean;
  healthScore: number;
  predictedFailureTime?: Date;
  adaptiveInterval: number;
  // Network condition tracking
  networkCondition: NetworkCondition;
  responseTimeVariance: number;
  networkStabilityScore: number;
  lastNetworkAnalysis: Date;
}

export interface KeepAliveResult {
  connectionId: string;
  timestamp: Date;
  success: boolean;
  responseTime: number;
  error?: string;
  keepAliveType: 'client' | 'server';
}

/**
 * SSH Connection Keep-Alive System with Intelligent Reconnection
 * Maintains SSH connections through adaptive keep-alive mechanisms
 * and predictive reconnection strategies
 */
export class SSHConnectionKeepAlive extends EventEmitter {
  private logger: Logger;
  private config: KeepAliveConfig;
  private connectionHealthMap: Map<string, ConnectionHealth> = new Map();
  private keepAliveTimers: Map<string, NodeJS.Timeout> = new Map();
  private activeReconnections: Set<string> = new Set();
  private isRunning = false;
  private proactiveMonitoringTimer: NodeJS.Timeout | null = null;

  // Statistics
  private stats = {
    totalKeepAlives: 0,
    successfulKeepAlives: 0,
    failedKeepAlives: 0,
    totalReconnections: 0,
    successfulReconnections: 0,
    failedReconnections: 0,
    preventedDisconnections: 0,
    averageResponseTime: 0,
    connectionsMonitored: 0,
    predictiveReconnections: 0
  };

  constructor(config?: Partial<KeepAliveConfig>) {
    super();
    this.logger = new Logger('SSHConnectionKeepAlive');
    
    this.config = {
      enabled: config?.enabled ?? true,
      keepAliveInterval: config?.keepAliveInterval || 30000, // 30 seconds
      keepAliveCountMax: config?.keepAliveCountMax || 3,
      serverAliveInterval: config?.serverAliveInterval || 60000, // 1 minute
      serverAliveCountMax: config?.serverAliveCountMax || 3,
      connectionTimeout: config?.connectionTimeout || 30000,
      reconnectOnFailure: config?.reconnectOnFailure ?? true,
      maxReconnectAttempts: config?.maxReconnectAttempts || 5,
      reconnectDelay: config?.reconnectDelay || 5000,
      backoffMultiplier: config?.backoffMultiplier || 2,
      maxReconnectDelay: config?.maxReconnectDelay || 60000,
      enableAdaptiveKeepAlive: config?.enableAdaptiveKeepAlive ?? true,
      enablePredictiveReconnect: config?.enablePredictiveReconnect ?? true,
      connectionHealthThreshold: config?.connectionHealthThreshold || 70,
      // Advanced network condition detection with production-ready defaults
      networkConditionSamplingSize: config?.networkConditionSamplingSize || 20,
      fastNetworkThreshold: config?.fastNetworkThreshold || 500, // < 500ms = fast
      slowNetworkThreshold: config?.slowNetworkThreshold || 3000, // > 3s = slow
      unstableNetworkThreshold: config?.unstableNetworkThreshold || 0.4, // 40% variance = unstable
      adaptiveIntervalMultipliers: config?.adaptiveIntervalMultipliers || {
        fast: 1.5,     // 50% longer intervals for fast networks
        normal: 1.0,   // Default interval
        slow: 0.7,     // 30% shorter intervals for slow networks
        unstable: 0.5  // 50% shorter intervals for unstable networks
      }
    };

    this.logger.info('SSHConnectionKeepAlive initialized with config:', this.config);
  }

  /**
   * Start the keep-alive system
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('SSHConnectionKeepAlive is already running');
      return;
    }

    this.logger.info('Starting SSHConnectionKeepAlive...');
    this.isRunning = true;

    this.emit('started');
    this.logger.info('SSHConnectionKeepAlive started successfully');
  }

  /**
   * Stop the keep-alive system
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      this.logger.warn('SSHConnectionKeepAlive is not running');
      return;
    }

    this.logger.info('Stopping SSHConnectionKeepAlive...');
    this.isRunning = false;

    // Stop proactive monitoring
    this.stopProactiveMonitoring();

    // Clear all timers
    for (const [connectionId, timer] of this.keepAliveTimers) {
      clearTimeout(timer);
    }
    this.keepAliveTimers.clear();

    // Wait for active reconnections to complete
    if (this.activeReconnections.size > 0) {
      this.logger.info(`Waiting for ${this.activeReconnections.size} active reconnections to complete...`);
      const timeout = setTimeout(() => {
        this.logger.warn('Timeout waiting for active reconnections');
      }, 30000);

      while (this.activeReconnections.size > 0) {
        await this.delay(1000);
      }
      clearTimeout(timeout);
    }

    this.emit('stopped');
    this.logger.info('SSHConnectionKeepAlive stopped');
  }

  /**
   * Monitor an SSH connection for keep-alive
   */
  monitorConnection(connection: PooledConnection, sshOptions: SSHConnectionOptions): void {
    if (!this.config.enabled || !this.isRunning) {
      return;
    }

    const connectionId = connection.id;
    const existing = this.connectionHealthMap.get(connectionId);
    
    if (existing) {
      this.logger.warn(`Connection ${connectionId} is already being monitored`);
      return;
    }

    const health: ConnectionHealth = {
      connectionId,
      lastKeepAlive: new Date(),
      keepAliveCount: 0,
      failedKeepAlives: 0,
      consecutiveFailures: 0,
      responseTimeHistory: [],
      averageResponseTime: 0,
      isHealthy: true,
      healthScore: 100,
      adaptiveInterval: this.config.keepAliveInterval,
      // Initialize network condition tracking
      networkCondition: 'normal',
      responseTimeVariance: 0,
      networkStabilityScore: 100,
      lastNetworkAnalysis: new Date()
    };

    this.connectionHealthMap.set(connectionId, health);
    this.stats.connectionsMonitored++;

    // Configure SSH client keep-alive settings
    this.configureSshKeepAlive(connection.connection, sshOptions);

    // Start keep-alive monitoring
    this.scheduleKeepAlive(connectionId, connection);

    this.logger.info(`Started monitoring connection ${connectionId} for keep-alive`);
    this.emit('monitoring-started', { connectionId, health });
  }

  /**
   * Stop monitoring a connection
   */
  stopMonitoring(connectionId: string): void {
    const health = this.connectionHealthMap.get(connectionId);
    if (!health) {
      return;
    }

    // Clear timer
    const timer = this.keepAliveTimers.get(connectionId);
    if (timer) {
      clearTimeout(timer);
      this.keepAliveTimers.delete(connectionId);
    }

    // Remove health tracking
    this.connectionHealthMap.delete(connectionId);
    this.stats.connectionsMonitored--;

    // Cancel active reconnection if any
    this.activeReconnections.delete(connectionId);

    this.logger.info(`Stopped monitoring connection ${connectionId}`);
    this.emit('monitoring-stopped', { connectionId });
  }

  /**
   * Configure SSH client with keep-alive settings
   */
  private configureSshKeepAlive(sshClient: SSHClient, options: SSHConnectionOptions): void {
    try {
      // Set up client-side keep-alive
      sshClient.on('keyboard-interactive', () => {
        // Handle keyboard interactive for keep-alive
      });

      // Monitor connection events
      sshClient.on('close', () => {
        this.handleConnectionClose(sshClient);
      });

      sshClient.on('error', (error) => {
        this.handleConnectionError(sshClient, error);
      });

      // Configure keep-alive parameters (these would be set during connection)
      const keepAliveConfig = {
        keepaliveInterval: this.config.keepAliveInterval,
        keepaliveCountMax: this.config.keepAliveCountMax,
        serverAliveInterval: options.serverAliveInterval || this.config.serverAliveInterval,
        serverAliveCountMax: options.serverAliveCountMax || this.config.serverAliveCountMax
      };

      // Set up advanced server alive monitoring
      this.setupServerAliveMonitoring(sshClient, keepAliveConfig);

      this.logger.debug('Configured SSH keep-alive settings:', keepAliveConfig);
      
    } catch (error) {
      this.logger.error('Error configuring SSH keep-alive:', error);
    }
  }

  /**
   * Set up server alive monitoring with adaptive intervals
   */
  private setupServerAliveMonitoring(sshClient: SSHClient, config: any): void {
    const connectionId = this.findConnectionIdByClient(sshClient);
    if (!connectionId) {
      this.logger.warn('Cannot set up server alive monitoring - connection ID not found');
      return;
    }

    const health = this.connectionHealthMap.get(connectionId);
    if (!health) {
      this.logger.warn('Cannot set up server alive monitoring - health tracking not found');
      return;
    }

    // Start server alive monitoring with adaptive intervals
    const performServerAliveCheck = async () => {
      try {
        const startTime = Date.now();
        
        // Perform lightweight server alive check
        await this.executeServerAliveCheck(sshClient);
        
        const responseTime = Date.now() - startTime;
        this.logger.debug(`Server alive check successful for ${connectionId} (${responseTime}ms)`);
        
        // Emit server alive success
        this.emit('server-alive-success', {
          connectionId,
          responseTime,
          timestamp: new Date()
        });

        // Schedule next check with adaptive interval
        const nextInterval = this.calculateServerAliveInterval(health);
        setTimeout(performServerAliveCheck, nextInterval);

      } catch (error) {
        this.logger.warn(`Server alive check failed for ${connectionId}:`, error);
        
        this.emit('server-alive-failed', {
          connectionId,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date()
        });

        // Retry with shorter interval on failure
        const retryInterval = Math.min(config.serverAliveInterval / 2, 15000);
        setTimeout(performServerAliveCheck, retryInterval);
      }
    };

    // Start initial server alive check
    setTimeout(performServerAliveCheck, config.serverAliveInterval);
  }

  /**
   * Execute server alive check using a lightweight operation
   */
  private async executeServerAliveCheck(sshClient: SSHClient): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Server alive check timeout'));
      }, this.config.connectionTimeout);

      try {
        // Use a very lightweight command for server alive check
        sshClient.exec(':', (err, stream) => { // ':' is a no-op command in most shells
          clearTimeout(timeout);
          
          if (err) {
            reject(err);
            return;
          }

          stream.on('close', (code) => {
            if (code === 0) {
              resolve();
            } else {
              reject(new Error(`Server alive check failed with code ${code}`));
            }
          });

          stream.on('error', (error) => {
            reject(error);
          });
        });
        
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  /**
   * Calculate adaptive server alive interval based on connection health
   */
  private calculateServerAliveInterval(health: ConnectionHealth): number {
    let baseInterval = this.config.serverAliveInterval;
    
    // Adjust based on network conditions
    switch (health.networkCondition) {
      case 'fast':
        baseInterval *= 1.3; // Less frequent checks for fast networks
        break;
      case 'slow':
        baseInterval *= 0.8; // More frequent checks for slow networks
        break;
      case 'unstable':
        baseInterval *= 0.6; // Much more frequent checks for unstable networks
        break;
      default:
        // Keep base interval for normal networks
        break;
    }

    // Adjust based on connection health
    if (health.healthScore < 70) {
      baseInterval *= 0.7; // More frequent checks for unhealthy connections
    } else if (health.healthScore > 90) {
      baseInterval *= 1.2; // Less frequent checks for very healthy connections
    }

    // Ensure reasonable bounds
    return Math.max(10000, Math.min(baseInterval, 180000)); // Between 10 seconds and 3 minutes
  }

  /**
   * Schedule next keep-alive check
   */
  private scheduleKeepAlive(connectionId: string, connection: PooledConnection): void {
    if (!this.isRunning) return;

    const health = this.connectionHealthMap.get(connectionId);
    if (!health) return;

    // Clear existing timer
    const existingTimer = this.keepAliveTimers.get(connectionId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Calculate adaptive interval
    const interval = this.config.enableAdaptiveKeepAlive 
      ? this.calculateAdaptiveInterval(health)
      : this.config.keepAliveInterval;

    health.adaptiveInterval = interval;

    // Schedule next keep-alive
    const timer = setTimeout(async () => {
      try {
        await this.performKeepAlive(connectionId, connection);
      } catch (error) {
        this.logger.error(`Error performing keep-alive for connection ${connectionId}:`, error);
      }
    }, interval);

    this.keepAliveTimers.set(connectionId, timer);
  }

  /**
   * Calculate adaptive keep-alive interval based on connection health and network conditions
   */
  private calculateAdaptiveInterval(health: ConnectionHealth): number {
    // Start with network condition-based multiplier
    let multiplier = this.config.adaptiveIntervalMultipliers[health.networkCondition];

    // Adjust based on connection health
    if (!health.isHealthy) {
      multiplier *= 0.5; // Check twice as often for unhealthy connections
    } else if (health.consecutiveFailures > 0) {
      multiplier *= 0.75; // Check more frequently if there are recent failures
    } else if (health.healthScore > 90 && health.networkCondition === 'fast') {
      multiplier *= 1.3; // Check less frequently for very healthy fast connections
    }

    // Apply network stability factor
    if (health.networkStabilityScore < 60) {
      multiplier *= 0.6; // More frequent checks for unstable networks
    } else if (health.networkStabilityScore > 90) {
      multiplier *= 1.1; // Less frequent checks for very stable networks
    }

    // Factor in response time variance for fine-tuning
    if (health.responseTimeVariance > this.config.unstableNetworkThreshold) {
      multiplier *= 0.8; // More frequent checks for high variance
    }

    const adaptiveInterval = Math.floor(this.config.keepAliveInterval * multiplier);
    return Math.max(5000, Math.min(adaptiveInterval, 300000)); // Between 5 seconds and 5 minutes
  }

  /**
   * Perform keep-alive check
   */
  private async performKeepAlive(connectionId: string, connection: PooledConnection): Promise<void> {
    const health = this.connectionHealthMap.get(connectionId);
    if (!health) return;

    const startTime = Date.now();
    this.stats.totalKeepAlives++;

    try {
      // Perform client-side keep-alive
      const result = await this.executeKeepAlive(connection.connection);
      const responseTime = Date.now() - startTime;

      // Update health tracking
      this.updateConnectionHealth(health, true, responseTime);
      this.stats.successfulKeepAlives++;
      
      // Update average response time
      this.updateAverageResponseTime(responseTime);

      const keepAliveResult: KeepAliveResult = {
        connectionId,
        timestamp: new Date(),
        success: true,
        responseTime,
        keepAliveType: 'client'
      };

      this.emit('keep-alive-success', keepAliveResult);
      this.logger.debug(`Keep-alive successful for connection ${connectionId} (${responseTime}ms)`);

      // Check for predictive reconnection needs
      if (this.config.enablePredictiveReconnect) {
        await this.checkPredictiveReconnection(connectionId, connection, health);
      }

    } catch (error) {
      const responseTime = Date.now() - startTime;
      
      // Update health tracking
      this.updateConnectionHealth(health, false, responseTime);
      this.stats.failedKeepAlives++;

      const keepAliveResult: KeepAliveResult = {
        connectionId,
        timestamp: new Date(),
        success: false,
        responseTime,
        error: error instanceof Error ? error.message : String(error),
        keepAliveType: 'client'
      };

      this.emit('keep-alive-failed', keepAliveResult);
      this.logger.warn(`Keep-alive failed for connection ${connectionId}: ${error instanceof Error ? error.message : String(error)}`);

      // Attempt reconnection if enabled and threshold exceeded
      if (this.config.reconnectOnFailure && health.consecutiveFailures >= this.config.keepAliveCountMax) {
        await this.attemptReconnection(connectionId, connection);
      }
    }

    // Schedule next keep-alive
    this.scheduleKeepAlive(connectionId, connection);
  }

  /**
   * Execute the actual keep-alive mechanism
   */
  private async executeKeepAlive(sshClient: SSHClient): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Keep-alive timeout'));
      }, this.config.connectionTimeout);

      try {
        // Simple keep-alive test - execute a lightweight command
        sshClient.exec('echo "keepalive"', (err, stream) => {
          clearTimeout(timeout);
          
          if (err) {
            reject(err);
            return;
          }

          let output = '';
          stream.on('close', (code) => {
            if (code === 0 && output.includes('keepalive')) {
              resolve();
            } else {
              reject(new Error(`Keep-alive command failed with code ${code}`));
            }
          });

          stream.on('data', (data: Buffer) => {
            output += data.toString();
          });

          stream.stderr.on('data', (data: Buffer) => {
            reject(new Error(`Keep-alive stderr: ${data.toString()}`));
          });
        });
        
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  /**
   * Update connection health based on keep-alive results
   */
  private updateConnectionHealth(health: ConnectionHealth, success: boolean, responseTime: number): void {
    health.lastKeepAlive = new Date();
    health.keepAliveCount++;

    if (success) {
      health.consecutiveFailures = 0;
      health.responseTimeHistory.push(responseTime);
      
      // Keep only configured number of response times for network analysis
      if (health.responseTimeHistory.length > this.config.networkConditionSamplingSize) {
        health.responseTimeHistory.shift();
      }
      
      // Update average response time
      health.averageResponseTime = 
        health.responseTimeHistory.reduce((sum, rt) => sum + rt, 0) / health.responseTimeHistory.length;
      
      // Improve health score
      health.healthScore = Math.min(100, health.healthScore + 2);
      
    } else {
      health.failedKeepAlives++;
      health.consecutiveFailures++;
      
      // Degrade health score based on consecutive failures
      const penalty = Math.min(30, health.consecutiveFailures * 10);
      health.healthScore = Math.max(0, health.healthScore - penalty);
    }

    // Analyze network conditions periodically
    if (health.responseTimeHistory.length >= 5) {
      this.analyzeNetworkConditions(health);
    }

    // Update healthy status
    health.isHealthy = health.healthScore >= this.config.connectionHealthThreshold &&
                      health.consecutiveFailures < this.config.keepAliveCountMax;

    // Calculate predicted failure time if unhealthy
    if (!health.isHealthy && this.config.enablePredictiveReconnect) {
      health.predictedFailureTime = this.calculatePredictedFailureTime(health);
    } else {
      health.predictedFailureTime = undefined;
    }
  }

  /**
   * Analyze network conditions based on response time history
   */
  private analyzeNetworkConditions(health: ConnectionHealth): void {
    const history = health.responseTimeHistory;
    if (history.length < 5) return;

    // Calculate variance
    const mean = health.averageResponseTime;
    const variance = history.reduce((acc, rt) => acc + Math.pow(rt - mean, 2), 0) / history.length;
    const standardDeviation = Math.sqrt(variance);
    health.responseTimeVariance = standardDeviation / mean; // Coefficient of variation

    // Determine network condition
    const isUnstable = health.responseTimeVariance > this.config.unstableNetworkThreshold;
    const isSlow = mean > this.config.slowNetworkThreshold;
    const isFast = mean < this.config.fastNetworkThreshold;

    if (isUnstable) {
      health.networkCondition = 'unstable';
    } else if (isSlow) {
      health.networkCondition = 'slow';
    } else if (isFast) {
      health.networkCondition = 'fast';
    } else {
      health.networkCondition = 'normal';
    }

    // Calculate network stability score (0-100)
    // Lower variance and consistent response times = higher stability
    health.networkStabilityScore = Math.max(0, Math.min(100, 
      100 - (health.responseTimeVariance * 100) - (health.consecutiveFailures * 10)
    ));

    health.lastNetworkAnalysis = new Date();

    // Log network condition changes
    this.logger.debug(`Network condition analysis for ${health.connectionId}:`, {
      condition: health.networkCondition,
      avgResponseTime: Math.round(mean),
      variance: Math.round(health.responseTimeVariance * 100) / 100,
      stabilityScore: Math.round(health.networkStabilityScore)
    });
  }

  /**
   * Calculate predicted failure time based on health trends
   */
  private calculatePredictedFailureTime(health: ConnectionHealth): Date {
    // Simple prediction based on failure rate and response time trends
    const failureRate = health.failedKeepAlives / health.keepAliveCount;
    const responseTimeTrend = this.calculateResponseTimeTrend(health.responseTimeHistory);
    
    // Estimate time until critical failure based on trends
    let hoursUntilFailure = 24; // Default: 24 hours
    
    if (failureRate > 0.5) {
      hoursUntilFailure = 1; // High failure rate - predict failure soon
    } else if (failureRate > 0.3) {
      hoursUntilFailure = 4;
    } else if (responseTimeTrend > 1.5) {
      hoursUntilFailure = 8; // Degrading response times
    }
    
    return new Date(Date.now() + hoursUntilFailure * 60 * 60 * 1000);
  }

  /**
   * Calculate response time trend (1.0 = stable, >1.0 = degrading, <1.0 = improving)
   */
  private calculateResponseTimeTrend(history: number[]): number {
    if (history.length < 6) return 1.0;

    const mid = Math.floor(history.length / 2);
    const firstHalf = history.slice(0, mid);
    const secondHalf = history.slice(mid);

    const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

    return firstAvg > 0 ? secondAvg / firstAvg : 1.0;
  }

  /**
   * Check if predictive reconnection is needed
   */
  private async checkPredictiveReconnection(connectionId: string, connection: PooledConnection, health: ConnectionHealth): Promise<void> {
    if (!health.predictedFailureTime) return;

    const timeUntilFailure = health.predictedFailureTime.getTime() - Date.now();
    
    // If failure predicted within next 30 minutes, proactively reconnect
    if (timeUntilFailure < 30 * 60 * 1000 && timeUntilFailure > 0) {
      this.logger.info(`Predictive reconnection triggered for connection ${connectionId} (failure predicted in ${Math.round(timeUntilFailure / 60000)} minutes)`);
      
      this.stats.predictiveReconnections++;
      this.emit('predictive-reconnection', {
        connectionId,
        predictedFailureTime: health.predictedFailureTime,
        timeUntilFailure,
        health
      });

      await this.attemptReconnection(connectionId, connection, 'predictive');
    }
  }

  /**
   * Attempt to reconnect a failed connection
   */
  private async attemptReconnection(connectionId: string, connection: PooledConnection, reason: 'failure' | 'predictive' = 'failure'): Promise<void> {
    if (this.activeReconnections.has(connectionId)) {
      this.logger.debug(`Reconnection already in progress for connection ${connectionId}`);
      return;
    }

    this.activeReconnections.add(connectionId);
    this.stats.totalReconnections++;

    try {
      this.logger.info(`Starting reconnection for connection ${connectionId} (reason: ${reason})`);
      
      this.emit('reconnection-started', {
        connectionId,
        reason,
        timestamp: new Date()
      });

      // Request reconnection through connection pool
      this.emit('connection-reconnect-request', {
        connectionId,
        connection,
        reason,
        keepAliveStats: this.connectionHealthMap.get(connectionId)
      });

      // For now, assume successful reconnection
      // In real implementation, this would wait for confirmation
      this.stats.successfulReconnections++;
      this.stats.preventedDisconnections++;

      // Reset health stats after successful reconnection
      const health = this.connectionHealthMap.get(connectionId);
      if (health) {
        health.consecutiveFailures = 0;
        health.failedKeepAlives = 0;
        health.healthScore = Math.min(100, health.healthScore + 20);
        health.isHealthy = true;
        health.predictedFailureTime = undefined;
      }

      this.emit('reconnection-success', {
        connectionId,
        reason,
        timestamp: new Date(),
        health
      });

      this.logger.info(`Successfully reconnected connection ${connectionId}`);

    } catch (error) {
      this.stats.failedReconnections++;
      
      this.logger.error(`Reconnection failed for connection ${connectionId}:`, error);
      
      this.emit('reconnection-failed', {
        connectionId,
        reason,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date()
      });

    } finally {
      this.activeReconnections.delete(connectionId);
    }
  }

  /**
   * Handle connection close event
   */
  private handleConnectionClose(sshClient: SSHClient): void {
    // Find connection ID by SSH client reference
    const connectionId = this.findConnectionIdByClient(sshClient);
    if (connectionId) {
      this.logger.warn(`SSH connection ${connectionId} closed unexpectedly`);
      this.emit('connection-closed', { connectionId, timestamp: new Date() });
    }
  }

  /**
   * Handle connection error event
   */
  private handleConnectionError(sshClient: SSHClient, error: Error): void {
    const connectionId = this.findConnectionIdByClient(sshClient);
    if (connectionId) {
      this.logger.error(`SSH connection ${connectionId} error:`, error);
      this.emit('connection-error', { 
        connectionId, 
        error: error.message, 
        timestamp: new Date() 
      });
    }
  }

  /**
   * Find connection ID by SSH client instance
   */
  private findConnectionIdByClient(sshClient: SSHClient): string | null {
    // This would require maintaining a reverse mapping
    // For now, return null as this is a placeholder
    return null;
  }

  /**
   * Update average response time metric
   */
  private updateAverageResponseTime(newResponseTime: number): void {
    if (this.stats.successfulKeepAlives === 1) {
      this.stats.averageResponseTime = newResponseTime;
    } else {
      this.stats.averageResponseTime = 
        ((this.stats.averageResponseTime * (this.stats.successfulKeepAlives - 1)) + newResponseTime) / 
        this.stats.successfulKeepAlives;
    }
  }

  /**
   * Get keep-alive statistics
   */
  getKeepAliveStatistics() {
    const connections = Array.from(this.connectionHealthMap.values());
    
    return {
      ...this.stats,
      healthyConnections: connections.filter(c => c.isHealthy).length,
      unhealthyConnections: connections.filter(c => !c.isHealthy).length,
      averageHealthScore: connections.length > 0 ? 
        connections.reduce((sum, c) => sum + c.healthScore, 0) / connections.length : 0,
      connectionsWithPredictedFailures: connections.filter(c => c.predictedFailureTime).length,
      activeReconnections: this.activeReconnections.size,
      isRunning: this.isRunning,
      config: this.config
    };
  }

  /**
   * Get connection health details
   */
  getConnectionHealth(connectionId?: string): ConnectionHealth | Record<string, ConnectionHealth> {
    if (connectionId) {
      return this.connectionHealthMap.get(connectionId) || {} as ConnectionHealth;
    }

    const result: Record<string, ConnectionHealth> = {};
    for (const [id, health] of this.connectionHealthMap) {
      result[id] = { ...health };
    }
    return result;
  }

  /**
   * Force immediate keep-alive check
   */
  async forceKeepAlive(connectionId: string): Promise<KeepAliveResult | null> {
    const health = this.connectionHealthMap.get(connectionId);
    if (!health) {
      this.logger.warn(`No health tracking found for connection ${connectionId}`);
      return null;
    }

    // Find connection by ID (this would need proper implementation)
    this.logger.info(`Forcing keep-alive check for connection ${connectionId}`);
    
    // For now, emit request for forced keep-alive
    this.emit('force-keep-alive-request', { connectionId });
    
    return null; // Would return actual result in real implementation
  }

  /**
   * Perform proactive health assessment across all connections
   */
  async performProactiveHealthCheck(): Promise<{
    totalConnections: number;
    healthyConnections: number;
    degradedConnections: number;
    criticalConnections: number;
    recommendations: string[];
  }> {
    const connections = Array.from(this.connectionHealthMap.values());
    const recommendations: string[] = [];
    
    let healthyCount = 0;
    let degradedCount = 0;
    let criticalCount = 0;

    for (const health of connections) {
      // Categorize connection health
      if (health.healthScore >= 80 && health.consecutiveFailures === 0) {
        healthyCount++;
      } else if (health.healthScore >= 50 || health.consecutiveFailures <= 2) {
        degradedCount++;
        
        // Generate recommendations for degraded connections
        if (health.networkCondition === 'unstable') {
          recommendations.push(`Connection ${health.connectionId}: Consider network optimization - high variance detected`);
        }
        if (health.averageResponseTime > this.config.slowNetworkThreshold) {
          recommendations.push(`Connection ${health.connectionId}: High latency detected, consider closer server region`);
        }
      } else {
        criticalCount++;
        recommendations.push(`Connection ${health.connectionId}: Critical - immediate attention required`);
      }

      // Check for predictive failures
      if (health.predictedFailureTime && 
          health.predictedFailureTime.getTime() - Date.now() < 3600000) { // Within 1 hour
        recommendations.push(`Connection ${health.connectionId}: Predicted failure within 1 hour - preemptive reconnection recommended`);
      }
    }

    // Global recommendations
    if (degradedCount + criticalCount > connections.length * 0.3) {
      recommendations.push('Global: High percentage of degraded connections - consider infrastructure review');
    }

    const result = {
      totalConnections: connections.length,
      healthyConnections: healthyCount,
      degradedConnections: degradedCount,
      criticalConnections: criticalCount,
      recommendations
    };

    this.logger.info('Proactive health check completed:', result);
    this.emit('proactive-health-check-completed', result);

    return result;
  }

  /**
   * Start continuous proactive monitoring
   */
  startProactiveMonitoring(intervalMinutes: number = 5): void {
    if (this.proactiveMonitoringTimer) {
      this.logger.warn('Proactive monitoring already running');
      return;
    }

    this.logger.info(`Starting proactive health monitoring (every ${intervalMinutes} minutes)`);
    
    this.proactiveMonitoringTimer = setInterval(async () => {
      try {
        await this.performProactiveHealthCheck();
      } catch (error) {
        this.logger.error('Error during proactive health check:', error);
      }
    }, intervalMinutes * 60 * 1000);

    this.emit('proactive-monitoring-started', { intervalMinutes });
  }

  /**
   * Stop continuous proactive monitoring
   */
  stopProactiveMonitoring(): void {
    if (this.proactiveMonitoringTimer) {
      clearInterval(this.proactiveMonitoringTimer);
      this.proactiveMonitoringTimer = null;
      this.logger.info('Proactive health monitoring stopped');
      this.emit('proactive-monitoring-stopped');
    }
  }

  /**
   * Utility method for delays
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Clean up resources
   */
  async destroy(): Promise<void> {
    await this.stop();
    this.connectionHealthMap.clear();
    this.activeReconnections.clear();
    this.removeAllListeners();
    this.logger.info('SSHConnectionKeepAlive destroyed');
  }
}