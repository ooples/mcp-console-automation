import { EventEmitter } from 'events';
import { Client as SSHClient, ConnectConfig } from 'ssh2';
import { v4 as uuidv4 } from 'uuid';
import { readFileSync } from 'fs';
import { Logger } from '../utils/logger.js';
import {
  PooledConnection,
  ConnectionPoolConfig,
  ConnectionPoolStats,
  SSHConnectionOptions,
  HealthCheckResult
} from '../types/index.js';

export interface CircuitBreakerState {
  state: 'closed' | 'open' | 'half-open';
  failures: number;
  lastFailure: Date;
  isOpen: boolean;
  successCount: number;
  nextAttemptTime: number;
  responseTimeHistory: number[];
  healthScore: number;
}

/**
 * Production-ready SSH Connection Pool
 * Manages reusable SSH connections with health checks, load balancing, and automatic cleanup
 */
export class ConnectionPool extends EventEmitter {
  private connections: Map<string, PooledConnection> = new Map();
  private connectionsByHost: Map<string, Set<string>> = new Map();
  private roundRobinIndex: Map<string, number> = new Map();
  private config: ConnectionPoolConfig;
  private logger: Logger;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map();
  private connectionHealthHistory: Map<string, HealthCheckResult[]> = new Map();
  private metrics: {
    totalConnections: number;
    connectionsCreated: number;
    connectionsDestroyed: number;
    healthChecksPerformed: number;
    reconnectionAttempts: number;
    circuitBreakerTrips: number;
    successfulHealthChecks: number;
    failedHealthChecks: number;
    averageResponseTime: number;
    predictiveFailuresPrevented: number;
  };

  constructor(config: Partial<ConnectionPoolConfig> = {}) {
    super();
    
    this.config = {
      maxConnectionsPerHost: config.maxConnectionsPerHost ?? 5,
      connectionIdleTimeout: config.connectionIdleTimeout ?? 5 * 60 * 1000, // 5 minutes
      keepAliveInterval: config.keepAliveInterval ?? 30 * 1000, // 30 seconds
      connectionRetryAttempts: config.connectionRetryAttempts ?? 3,
      healthCheckInterval: config.healthCheckInterval ?? 60 * 1000, // 1 minute
      cleanupInterval: config.cleanupInterval ?? 2 * 60 * 1000, // 2 minutes
      enableMetrics: config.enableMetrics ?? true,
      enableLogging: config.enableLogging ?? true,
      poolingStrategy: config.poolingStrategy ?? 'least-connections',
      connectionTimeout: config.connectionTimeout ?? 30 * 1000, // 30 seconds
      maxReconnectAttempts: config.maxReconnectAttempts ?? 5,
      circuitBreakerThreshold: config.circuitBreakerThreshold ?? 3
    };

    this.logger = new Logger('ConnectionPool');
    this.metrics = {
      totalConnections: 0,
      connectionsCreated: 0,
      connectionsDestroyed: 0,
      healthChecksPerformed: 0,
      reconnectionAttempts: 0,
      circuitBreakerTrips: 0,
      successfulHealthChecks: 0,
      failedHealthChecks: 0,
      averageResponseTime: 0,
      predictiveFailuresPrevented: 0
    };

    this.startHealthChecks();
    this.startCleanupProcess();

    if (this.config.enableLogging) {
      this.logger.info('ConnectionPool initialized with config:', this.config);
    }
  }

  /**
   * Get or create a connection to the specified host
   */
  async getConnection(options: SSHConnectionOptions): Promise<PooledConnection> {
    const hostKey = `${options.host}:${options.port || 22}:${options.username}`;
    
    // Check circuit breaker
    const breaker = this.circuitBreakers.get(hostKey);
    if (breaker?.isOpen) {
      if (Date.now() < breaker.nextAttemptTime) {
        const waitTime = Math.ceil((breaker.nextAttemptTime - Date.now()) / 1000);
        throw new Error(
          `Circuit breaker is OPEN for ${hostKey}. ` +
          `Too many recent failures (${breaker.failures}). ` +
          `Wait ${waitTime}s before retry. ` +
          `Health score: ${breaker.healthScore}/100`
        );
      } else {
        // Transition to half-open
        breaker.state = 'half-open';
        breaker.isOpen = false;
        breaker.successCount = 0;
        
        if (this.config.enableLogging) {
          this.logger.info(`Circuit breaker ${hostKey} transitioning to half-open state`);
        }
      }
    }

    // Try to get existing healthy connection
    const existingConnection = await this.getExistingConnection(hostKey, options);
    if (existingConnection) {
      existingConnection.lastUsed = new Date();
      existingConnection.activeSessionCount++;
      
      if (this.config.enableLogging) {
        this.logger.debug(`Reusing existing connection ${existingConnection.id} for ${hostKey}`);
      }
      
      return existingConnection;
    }

    // Check if we can create a new connection
    const hostConnections = this.connectionsByHost.get(hostKey);
    if (hostConnections && hostConnections.size >= this.config.maxConnectionsPerHost) {
      // Try to find a less busy connection
      const connections = Array.from(hostConnections)
        .map(id => this.connections.get(id)!)
        .filter(conn => conn.isHealthy)
        .sort((a, b) => a.activeSessionCount - b.activeSessionCount);
      
      if (connections.length > 0) {
        const connection = connections[0];
        connection.lastUsed = new Date();
        connection.activeSessionCount++;
        
        if (this.config.enableLogging) {
          this.logger.debug(`Using least busy connection ${connection.id} for ${hostKey}`);
        }
        
        return connection;
      }
      
      throw new Error(`Maximum connections (${this.config.maxConnectionsPerHost}) reached for host ${hostKey}`);
    }

    // Create new connection
    return await this.createConnection(options);
  }

  /**
   * Release a connection back to the pool
   */
  async releaseConnection(connectionId: string): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      if (this.config.enableLogging) {
        this.logger.warn(`Attempted to release unknown connection ${connectionId}`);
      }
      return;
    }

    connection.activeSessionCount = Math.max(0, connection.activeSessionCount - 1);
    connection.lastUsed = new Date();

    if (this.config.enableLogging) {
      this.logger.debug(`Released connection ${connectionId}, active sessions: ${connection.activeSessionCount}`);
    }

    this.emit('connectionReleased', { connectionId, activeSessionCount: connection.activeSessionCount });
  }

  /**
   * Close a specific connection
   */
  async closeConnection(connectionId: string): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      return;
    }

    const hostKey = `${connection.host}:${connection.port}:${connection.username}`;
    
    try {
      if (connection.connection && typeof connection.connection.end === 'function') {
        connection.connection.end();
      }
    } catch (error) {
      if (this.config.enableLogging) {
        this.logger.error(`Error closing connection ${connectionId}:`, error);
      }
    }

    // Remove from tracking
    this.connections.delete(connectionId);
    const hostConnections = this.connectionsByHost.get(hostKey);
    if (hostConnections) {
      hostConnections.delete(connectionId);
      if (hostConnections.size === 0) {
        this.connectionsByHost.delete(hostKey);
        this.roundRobinIndex.delete(hostKey);
      }
    }

    this.metrics.connectionsDestroyed++;

    if (this.config.enableLogging) {
      this.logger.info(`Closed connection ${connectionId} to ${hostKey}`);
    }

    this.emit('connectionClosed', { connectionId, hostKey });
  }

  /**
   * Close all connections
   */
  async closeAllConnections(): Promise<void> {
    const connectionIds = Array.from(this.connections.keys());
    
    if (this.config.enableLogging) {
      this.logger.info(`Closing ${connectionIds.length} connections`);
    }

    await Promise.all(connectionIds.map(id => this.closeConnection(id)));
  }

  /**
   * Get connection statistics
   */
  getStats(): ConnectionPoolStats {
    const connections = Array.from(this.connections.values());
    const now = Date.now();
    
    const connectionsByHost: Record<string, number> = {};
    this.connectionsByHost.forEach((connections, hostKey) => {
      connectionsByHost[hostKey] = connections.size;
    });

    const averageConnectionAge = connections.length > 0 
      ? connections.reduce((sum, conn) => sum + (now - conn.createdAt.getTime()), 0) / connections.length
      : 0;

    return {
      totalConnections: connections.length,
      activeConnections: connections.filter(c => c.activeSessionCount > 0).length,
      idleConnections: connections.filter(c => c.activeSessionCount === 0).length,
      healthyConnections: connections.filter(c => c.isHealthy).length,
      unhealthyConnections: connections.filter(c => !c.isHealthy).length,
      connectionsByHost,
      averageConnectionAge,
      totalReconnectAttempts: this.metrics.reconnectionAttempts,
      lastHealthCheckAt: new Date()
    };
  }

  /**
   * Get detailed metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      circuitBreakerStates: Object.fromEntries(this.circuitBreakers.entries()),
      poolStats: this.getStats()
    };
  }

  /**
   * Shutdown the connection pool
   */
  async shutdown(): Promise<void> {
    if (this.config.enableLogging) {
      this.logger.info('Shutting down connection pool');
    }

    // Clear intervals
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Close all connections
    await this.closeAllConnections();

    this.removeAllListeners();
  }

  /**
   * Create a new SSH connection
   */
  private async createConnection(options: SSHConnectionOptions): Promise<PooledConnection> {
    const connectionId = uuidv4();
    const hostKey = `${options.host}:${options.port || 22}:${options.username}`;
    
    if (this.config.enableLogging) {
      this.logger.info(`Creating new connection ${connectionId} to ${hostKey}`);
    }

    const sshClient = new SSHClient();
    const connectConfig: ConnectConfig = {
      host: options.host,
      port: options.port || 22,
      username: options.username,
      password: options.password,
      privateKey: options.privateKey || (options.privateKeyPath ? readFileSync(options.privateKeyPath) : undefined),
      passphrase: options.passphrase,
      readyTimeout: options.readyTimeout || this.config.connectionTimeout,
      keepaliveInterval: options.keepAliveInterval || this.config.keepAliveInterval,
      keepaliveCountMax: options.keepAliveCountMax || 3,
      algorithms: {
        serverHostKey: ['rsa-sha2-512', 'rsa-sha2-256', 'ssh-rsa', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521', 'ssh-ed25519'],
        cipher: ['aes128-gcm', 'aes256-gcm', 'aes128-ctr', 'aes256-ctr'],
        hmac: ['hmac-sha2-256', 'hmac-sha2-512', 'hmac-sha1'],
        compress: ['none'],
        kex: ['ecdh-sha2-nistp256', 'ecdh-sha2-nistp384', 'ecdh-sha2-nistp521', 'diffie-hellman-group14-sha256']
      }
    };

    const connection: PooledConnection = {
      id: connectionId,
      host: options.host,
      port: options.port || 22,
      username: options.username,
      connection: sshClient,
      createdAt: new Date(),
      lastUsed: new Date(),
      activeSessionCount: 1,
      isHealthy: false,
      reconnectAttempts: 0,
      maxReconnectAttempts: this.config.maxReconnectAttempts,
      metadata: {
        hostKey,
        connectConfig
      }
    };

    try {
      await this.connectSSH(sshClient, connectConfig);
      
      connection.isHealthy = true;
      this.connections.set(connectionId, connection);
      
      // Track by host
      if (!this.connectionsByHost.has(hostKey)) {
        this.connectionsByHost.set(hostKey, new Set());
      }
      this.connectionsByHost.get(hostKey)!.add(connectionId);

      // Setup event handlers
      this.setupConnectionHandlers(connection);

      this.metrics.connectionsCreated++;
      this.metrics.totalConnections++;

      if (this.config.enableLogging) {
        this.logger.info(`Successfully created connection ${connectionId} to ${hostKey}`);
      }

      this.emit('connectionCreated', { connectionId, hostKey });

      return connection;

    } catch (error) {
      // Handle connection failure
      this.handleConnectionFailure(hostKey, error);
      throw error;
    }
  }

  /**
   * Connect SSH client with timeout handling
   */
  private async connectSSH(client: SSHClient, config: ConnectConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        client.destroy();
        reject(new Error(`Connection timeout after ${this.config.connectionTimeout}ms`));
      }, this.config.connectionTimeout);

      client.on('ready', () => {
        clearTimeout(timeout);
        resolve();
      });

      client.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      client.connect(config);
    });
  }

  /**
   * Setup event handlers for a connection
   */
  private setupConnectionHandlers(connection: PooledConnection): void {
    const sshClient = connection.connection;
    
    sshClient.on('error', (error: Error) => {
      connection.isHealthy = false;
      
      if (this.config.enableLogging) {
        this.logger.error(`Connection ${connection.id} error:`, error);
      }
      
      this.emit('connectionError', { connectionId: connection.id, error });
    });

    sshClient.on('close', () => {
      connection.isHealthy = false;
      
      if (this.config.enableLogging) {
        this.logger.info(`Connection ${connection.id} closed`);
      }
      
      this.emit('connectionClosed', { connectionId: connection.id });
      
      // Attempt reconnection if there are active sessions
      if (connection.activeSessionCount > 0 && connection.reconnectAttempts < connection.maxReconnectAttempts) {
        this.attemptReconnection(connection);
      }
    });

    sshClient.on('end', () => {
      connection.isHealthy = false;
      
      if (this.config.enableLogging) {
        this.logger.info(`Connection ${connection.id} ended`);
      }
    });
  }

  /**
   * Get existing healthy connection using load balancing strategy
   */
  private async getExistingConnection(hostKey: string, options: SSHConnectionOptions): Promise<PooledConnection | null> {
    const hostConnections = this.connectionsByHost.get(hostKey);
    if (!hostConnections || hostConnections.size === 0) {
      return null;
    }

    const healthyConnections = Array.from(hostConnections)
      .map(id => this.connections.get(id)!)
      .filter(conn => conn && conn.isHealthy);

    if (healthyConnections.length === 0) {
      return null;
    }

    // Apply load balancing strategy
    switch (this.config.poolingStrategy) {
      case 'round-robin':
        return this.getRoundRobinConnection(hostKey, healthyConnections);
      
      case 'least-connections':
        return healthyConnections.sort((a, b) => a.activeSessionCount - b.activeSessionCount)[0];
      
      case 'random':
        return healthyConnections[Math.floor(Math.random() * healthyConnections.length)];
      
      default:
        return healthyConnections[0];
    }
  }

  /**
   * Get connection using round-robin strategy
   */
  private getRoundRobinConnection(hostKey: string, connections: PooledConnection[]): PooledConnection {
    const currentIndex = this.roundRobinIndex.get(hostKey) || 0;
    const connection = connections[currentIndex % connections.length];
    this.roundRobinIndex.set(hostKey, (currentIndex + 1) % connections.length);
    return connection;
  }

  /**
   * Handle connection failure and update circuit breaker
   */
  private handleConnectionFailure(hostKey: string, error: any): void {
    this.recordCircuitBreakerFailure(hostKey, error);
  }

  /**
   * Record circuit breaker failure with enhanced state management
   */
  private recordCircuitBreakerFailure(hostKey: string, error: any): void {
    let breaker = this.circuitBreakers.get(hostKey);
    if (!breaker) {
      breaker = {
        state: 'closed',
        failures: 0,
        lastFailure: new Date(),
        isOpen: false,
        successCount: 0,
        nextAttemptTime: 0,
        responseTimeHistory: [],
        healthScore: 100
      };
      this.circuitBreakers.set(hostKey, breaker);
    }

    breaker.failures++;
    breaker.lastFailure = new Date();
    breaker.healthScore = Math.max(0, breaker.healthScore - 20);

    // Transition to open state if threshold exceeded
    if (breaker.state === 'closed' && breaker.failures >= this.config.circuitBreakerThreshold) {
      breaker.state = 'open';
      breaker.isOpen = true;
      breaker.nextAttemptTime = Date.now() + 60000; // 1 minute window
      this.metrics.circuitBreakerTrips++;
      
      if (this.config.enableLogging) {
        this.logger.warn(`Circuit breaker opened for ${hostKey} after ${breaker.failures} failures`);
      }
      
      this.emit('circuitBreakerTripped', { 
        hostKey, 
        failures: breaker.failures,
        state: breaker.state,
        healthScore: breaker.healthScore
      });
    } else if (breaker.state === 'half-open') {
      // Return to open state from half-open on failure
      breaker.state = 'open';
      breaker.isOpen = true;
      breaker.nextAttemptTime = Date.now() + 60000;
      
      if (this.config.enableLogging) {
        this.logger.warn(`Circuit breaker returned to open state for ${hostKey}`);
      }
    }

    if (this.config.enableLogging) {
      this.logger.error(`Connection failure for ${hostKey} (failure #${breaker.failures}):`, error);
    }
  }

  /**
   * Attempt to reconnect a failed connection
   */
  private async attemptReconnection(connection: PooledConnection): Promise<void> {
    if (connection.reconnectAttempts >= connection.maxReconnectAttempts) {
      if (this.config.enableLogging) {
        this.logger.warn(`Max reconnection attempts reached for connection ${connection.id}`);
      }
      return;
    }

    connection.reconnectAttempts++;
    this.metrics.reconnectionAttempts++;

    const delay = Math.min(1000 * Math.pow(2, connection.reconnectAttempts - 1), 30000); // Exponential backoff, max 30s
    
    if (this.config.enableLogging) {
      this.logger.info(`Attempting reconnection ${connection.reconnectAttempts}/${connection.maxReconnectAttempts} for ${connection.id} in ${delay}ms`);
    }

    setTimeout(async () => {
      try {
        const newSSHClient = new SSHClient();
        const connectConfig = connection.metadata?.connectConfig as ConnectConfig;
        
        await this.connectSSH(newSSHClient, connectConfig);
        
        // Replace the old connection
        connection.connection.destroy();
        connection.connection = newSSHClient;
        connection.isHealthy = true;
        connection.reconnectAttempts = 0;
        
        this.setupConnectionHandlers(connection);
        
        if (this.config.enableLogging) {
          this.logger.info(`Successfully reconnected connection ${connection.id}`);
        }
        
        this.emit('connectionReconnected', { connectionId: connection.id });
        
      } catch (error) {
        if (this.config.enableLogging) {
          this.logger.error(`Reconnection failed for connection ${connection.id}:`, error);
        }
        
        // Try again if we haven't exceeded max attempts
        if (connection.reconnectAttempts < connection.maxReconnectAttempts) {
          await this.attemptReconnection(connection);
        } else {
          // Give up and close the connection
          await this.closeConnection(connection.id);
        }
      }
    }, delay);
  }

  /**
   * Start periodic health checks
   */
  private startHealthChecks(): void {
    if (!this.config.healthCheckInterval || this.config.healthCheckInterval <= 0) {
      return;
    }

    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthChecks();
    }, this.config.healthCheckInterval);
  }

  /**
   * Perform comprehensive health checks on all connections
   */
  private async performHealthChecks(): Promise<void> {
    const connections = Array.from(this.connections.values());
    
    if (this.config.enableLogging && connections.length > 0) {
      this.logger.debug(`Performing health checks on ${connections.length} connections`);
    }

    const healthCheckPromises = connections.map(async (connection) => {
      const startTime = Date.now();
      const checkId = `health-${connection.id}-${Date.now()}`;
      
      try {
        const healthResult = await this.performConnectionHealthCheck(connection);
        
        // Update connection health
        connection.isHealthy = healthResult.status === 'healthy' || healthResult.status === 'warning';
        connection.healthCheckAt = new Date();
        
        // Store health history
        this.storeConnectionHealthHistory(connection.id, healthResult);
        
        // Update metrics
        this.metrics.healthChecksPerformed++;
        if (healthResult.success) {
          this.metrics.successfulHealthChecks++;
        } else {
          this.metrics.failedHealthChecks++;
        }
        
        // Update average response time
        this.updateAverageResponseTime(healthResult.responseTime);
        
        // Update circuit breaker state
        this.updateCircuitBreakerHealth(connection, healthResult);
        
        // Predictive failure analysis
        const failureRisk = this.analyzeFailureRisk(connection.id, healthResult);
        if (failureRisk > 0.7) {
          this.emit('predictive-failure-warning', {
            connectionId: connection.id,
            risk: failureRisk,
            recommendations: this.generateConnectionRecommendations(connection, healthResult)
          });
        }
        
        // Emit health check result
        this.emit('connection-health-check', {
          connectionId: connection.id,
          result: healthResult
        });

      } catch (error) {
        connection.isHealthy = false;
        this.metrics.failedHealthChecks++;
        
        if (this.config.enableLogging) {
          this.logger.warn(`Health check failed for connection ${connection.id}:`, error);
        }

        // Create failed health result
        const failedResult: HealthCheckResult = {
          checkId,
          checkType: 'network',
          timestamp: new Date(),
          status: 'critical',
          metrics: {},
          details: {
            message: `Health check failed: ${error instanceof Error ? error.message : String(error)}`,
            recoverable: true
          },
          duration: Date.now() - startTime,
          checks: {
            'connection': {
              checkStatus: 'fail',
              message: `Health check failed: ${error instanceof Error ? error.message : String(error)}`
            }
          },
          overallScore: 0
        };

        this.storeConnectionHealthHistory(connection.id, failedResult);
      }
    });

    await Promise.allSettled(healthCheckPromises);
  }

  /**
   * Perform detailed health check on a single connection
   */
  private async performConnectionHealthCheck(connection: PooledConnection): Promise<HealthCheckResult & { success: boolean; responseTime: number }> {
    const startTime = Date.now();
    const checkId = `health-${connection.id}-${Date.now()}`;

    try {
      const sshClient = connection.connection;
      
      if (!sshClient || sshClient.destroyed) {
        return {
          checkId,
          checkType: 'network',
          timestamp: new Date(),
          status: 'critical',
          metrics: { destroyed: 1 },
          details: {
            message: 'SSH client is destroyed or unavailable',
            diagnosis: 'Connection has been terminated',
            recommendations: ['Reconnect to restore functionality'],
            recoverable: true
          },
          duration: Date.now() - startTime,
          checks: {
            'connection': {
              checkStatus: 'fail',
              message: 'SSH client is destroyed or unavailable'
            }
          },
          overallScore: 0,
          success: false,
          responseTime: Date.now() - startTime
        };
      }

      // Perform actual connectivity test
      const testResult = await this.testConnectionConnectivity(sshClient);
      const responseTime = Date.now() - startTime;

      // Calculate health metrics
      const metrics = {
        responseTime,
        activeSessionCount: connection.activeSessionCount,
        connectionAge: Date.now() - connection.createdAt.getTime(),
        reconnectAttempts: connection.reconnectAttempts
      };

      // Determine status based on response time and connectivity
      let status: HealthCheckResult['status'] = 'healthy';
      const recommendations: string[] = [];

      if (!testResult.success) {
        status = 'critical';
        recommendations.push('Connection failed connectivity test');
        recommendations.push('Consider reconnecting or replacing connection');
      } else if (responseTime > 10000) {
        status = 'unhealthy';
        recommendations.push('Very slow response time detected');
        recommendations.push('Monitor network conditions');
      } else if (responseTime > 5000) {
        status = 'warning';
        recommendations.push('Slow response time detected');
      } else if (connection.reconnectAttempts > 0) {
        status = 'warning';
        recommendations.push('Connection has recent reconnection history');
      }

      return {
        checkId,
        checkType: 'network',
        timestamp: new Date(),
        status,
        metrics,
        details: {
          message: `Connection health: ${status} (${responseTime}ms response time)`,
          diagnosis: testResult.success ? 
            'Connection is responsive' : 
            `Connection failed: ${testResult.error}`,
          recommendations,
          recoverable: status !== 'critical'
        },
        duration: responseTime,
        checks: {
          'connectivity': {
            checkStatus: status === 'healthy' ? 'pass' : status === 'warning' ? 'warn' : 'fail',
            message: `Connection health: ${status}`,
            value: responseTime,
            duration: responseTime
          }
        },
        overallScore: status === 'healthy' ? 100 : status === 'warning' ? 75 : status === 'unhealthy' ? 50 : 0,
        success: testResult.success,
        responseTime
      };

    } catch (error) {
      return {
        checkId,
        checkType: 'network',
        timestamp: new Date(),
        status: 'critical',
        metrics: {},
        details: {
          message: `Health check error: ${error instanceof Error ? error.message : String(error)}`,
          diagnosis: 'Unable to assess connection health',
          recommendations: ['Check connection stability', 'Consider reconnection'],
          recoverable: true
        },
        duration: Date.now() - startTime,
        checks: {
          'connectivity': {
            checkStatus: 'fail',
            message: `Health check error: ${error instanceof Error ? error.message : String(error)}`
          }
        },
        overallScore: 0,
        success: false,
        responseTime: Date.now() - startTime
      };
    }
  }

  /**
   * Test actual connectivity of SSH connection
   */
  private async testConnectionConnectivity(sshClient: SSHClient): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      try {
        // Simple connectivity test - attempt to create a shell
        sshClient.shell({ term: 'xterm-256color' }, (err, stream) => {
          if (err) {
            resolve({ success: false, error: err.message });
            return;
          }

          // Immediately close the test shell
          stream.close();
          resolve({ success: true });
        });

        // Timeout for the test
        setTimeout(() => {
          resolve({ success: false, error: 'Connectivity test timeout' });
        }, 5000);

      } catch (error) {
        resolve({ 
          success: false, 
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });
  }

  /**
   * Store connection health history for trend analysis
   */
  private storeConnectionHealthHistory(connectionId: string, result: HealthCheckResult): void {
    if (!this.connectionHealthHistory.has(connectionId)) {
      this.connectionHealthHistory.set(connectionId, []);
    }

    const history = this.connectionHealthHistory.get(connectionId)!;
    history.push(result);

    // Keep only last 100 results per connection
    if (history.length > 100) {
      history.shift();
    }
  }

  /**
   * Update circuit breaker with health information
   */
  private updateCircuitBreakerHealth(connection: PooledConnection, healthResult: HealthCheckResult): void {
    const hostKey = `${connection.host}:${connection.port}:${connection.username}`;
    let breaker = this.circuitBreakers.get(hostKey);

    if (!breaker) {
      breaker = {
        state: 'closed',
        failures: 0,
        lastFailure: new Date(),
        isOpen: false,
        successCount: 0,
        nextAttemptTime: 0,
        responseTimeHistory: [],
        healthScore: 100
      };
      this.circuitBreakers.set(hostKey, breaker);
    }

    // Update response time history
    if ('responseTime' in healthResult && typeof healthResult.responseTime === 'number') {
      breaker.responseTimeHistory.push(healthResult.responseTime);
      if (breaker.responseTimeHistory.length > 50) {
        breaker.responseTimeHistory.shift();
      }
    }

    // Calculate health score (0-100)
    let healthScore = 100;
    if (healthResult.status === 'critical') healthScore = 0;
    else if (healthResult.status === 'unhealthy') healthScore = 25;
    else if (healthResult.status === 'warning') healthScore = 70;

    // Factor in response time performance
    if (breaker.responseTimeHistory.length > 0) {
      const avgResponseTime = breaker.responseTimeHistory.reduce((a, b) => a + b, 0) / breaker.responseTimeHistory.length;
      if (avgResponseTime > 5000) healthScore *= 0.8;
      else if (avgResponseTime > 2000) healthScore *= 0.9;
    }

    breaker.healthScore = healthScore;

    // Update circuit breaker state based on health
    if (healthResult.status === 'healthy') {
      if (breaker.state === 'half-open') {
        breaker.successCount++;
        if (breaker.successCount >= 3) {
          breaker.state = 'closed';
          breaker.failures = 0;
          breaker.isOpen = false;
        }
      } else if (breaker.state === 'closed') {
        breaker.failures = Math.max(0, breaker.failures - 1);
      }
    } else {
      this.recordCircuitBreakerFailure(hostKey, new Error(healthResult.details.message));
    }
  }

  /**
   * Analyze failure risk based on connection history
   */
  private analyzeFailureRisk(connectionId: string, currentResult: HealthCheckResult): number {
    const history = this.connectionHealthHistory.get(connectionId) || [];
    if (history.length < 5) return 0;

    let riskScore = 0;

    // Recent failures increase risk
    const recentResults = history.slice(-10);
    const recentFailures = recentResults.filter(r => r.status === 'unhealthy' || r.status === 'critical').length;
    riskScore += (recentFailures / recentResults.length) * 0.4;

    // Degrading response times
    if (recentResults.length >= 5) {
      const responseTimes = recentResults
        .map(r => r.metrics.responseTime)
        .filter(rt => typeof rt === 'number') as number[];
      
      if (responseTimes.length >= 5) {
        const recent = responseTimes.slice(-3);
        const older = responseTimes.slice(-6, -3);
        
        const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
        const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
        
        if (recentAvg > olderAvg * 1.5) {
          riskScore += 0.3;
        }
      }
    }

    // Current status contributes to risk
    if (currentResult.status === 'critical') riskScore += 0.3;
    else if (currentResult.status === 'unhealthy') riskScore += 0.2;
    else if (currentResult.status === 'warning') riskScore += 0.1;

    return Math.min(1.0, riskScore);
  }

  /**
   * Generate recommendations for connection health
   */
  private generateConnectionRecommendations(connection: PooledConnection, healthResult: HealthCheckResult): string[] {
    const recommendations: string[] = [];

    if (healthResult.status === 'critical' || healthResult.status === 'unhealthy') {
      recommendations.push('Connection requires immediate attention');
      recommendations.push('Consider reconnecting or replacing connection');
    }

    if (connection.reconnectAttempts > 0) {
      recommendations.push('Monitor connection stability');
      recommendations.push('Investigate underlying network issues');
    }

    if (healthResult.metrics.responseTime && healthResult.metrics.responseTime > 5000) {
      recommendations.push('Slow response times detected - check network conditions');
      recommendations.push('Consider connection pooling optimization');
    }

    if (connection.activeSessionCount > 10) {
      recommendations.push('High session load - consider load balancing');
    }

    return recommendations;
  }

  /**
   * Update average response time metric
   */
  private updateAverageResponseTime(newResponseTime: number): void {
    if (this.metrics.successfulHealthChecks === 1) {
      this.metrics.averageResponseTime = newResponseTime;
    } else {
      this.metrics.averageResponseTime = 
        ((this.metrics.averageResponseTime * (this.metrics.successfulHealthChecks - 1)) + newResponseTime) / 
        this.metrics.successfulHealthChecks;
    }
  }

  /**
   * Start cleanup process for idle connections
   */
  private startCleanupProcess(): void {
    if (!this.config.cleanupInterval || this.config.cleanupInterval <= 0) {
      return;
    }

    this.cleanupInterval = setInterval(async () => {
      await this.cleanupIdleConnections();
    }, this.config.cleanupInterval);
  }

  /**
   * Clean up idle connections
   */
  private async cleanupIdleConnections(): Promise<void> {
    const now = Date.now();
    const connectionsToClose: string[] = [];

    this.connections.forEach((connection, connectionId) => {
      const idleTime = now - connection.lastUsed.getTime();
      
      // Only clean up idle connections with no active sessions
      if (connection.activeSessionCount === 0 && idleTime > this.config.connectionIdleTimeout) {
        connectionsToClose.push(connectionId);
      }
    });

    if (connectionsToClose.length > 0) {
      if (this.config.enableLogging) {
        this.logger.info(`Cleaning up ${connectionsToClose.length} idle connections`);
      }

      await Promise.all(connectionsToClose.map(id => this.closeConnection(id)));
      
      this.emit('connectionsCleanedUp', { count: connectionsToClose.length });
    }
  }
}