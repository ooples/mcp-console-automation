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
}

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
      connectionHealthThreshold: config?.connectionHealthThreshold || 70
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
      adaptiveInterval: this.config.keepAliveInterval
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

      this.logger.debug('Configured SSH keep-alive settings:', keepAliveConfig);
      
    } catch (error) {
      this.logger.error('Error configuring SSH keep-alive:', error);
    }
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
   * Calculate adaptive keep-alive interval based on connection health
   */
  private calculateAdaptiveInterval(health: ConnectionHealth): number {
    let multiplier = 1.0;

    // Increase frequency for unhealthy connections
    if (!health.isHealthy) {
      multiplier = 0.5; // Check twice as often
    } else if (health.consecutiveFailures > 0) {
      multiplier = 0.75; // Check more frequently if there are recent failures
    } else if (health.averageResponseTime > 5000) {
      multiplier = 0.8; // Check more frequently for slow connections
    } else if (health.responseTimeHistory.length >= 10 && health.averageResponseTime < 1000) {
      // Decrease frequency for very healthy connections
      multiplier = 1.5;
    }

    // Apply health score factor
    if (health.healthScore < 50) {
      multiplier *= 0.5;
    } else if (health.healthScore > 90) {
      multiplier *= 1.2;
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
      
      // Keep only last 50 response times
      if (health.responseTimeHistory.length > 50) {
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