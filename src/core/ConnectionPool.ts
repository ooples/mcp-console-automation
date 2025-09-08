import { EventEmitter } from 'events';
import { Client as SSHClient, ConnectConfig } from 'ssh2';
import { v4 as uuidv4 } from 'uuid';
import { readFileSync } from 'fs';
import { Logger } from '../utils/logger.js';
import {
  PooledConnection,
  ConnectionPoolConfig,
  ConnectionPoolStats,
  SSHConnectionOptions
} from '../types/index.js';

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
  private circuitBreakers: Map<string, { failures: number; lastFailure: Date; isOpen: boolean }> = new Map();
  private metrics: {
    totalConnections: number;
    connectionsCreated: number;
    connectionsDestroyed: number;
    healthChecksPerformed: number;
    reconnectionAttempts: number;
    circuitBreakerTrips: number;
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
      circuitBreakerTrips: 0
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
      const timeSinceFailure = Date.now() - breaker.lastFailure.getTime();
      if (timeSinceFailure < 60000) { // 1 minute circuit breaker timeout
        throw new Error(`Circuit breaker is open for ${hostKey}. Too many recent failures.`);
      } else {
        // Reset circuit breaker
        breaker.isOpen = false;
        breaker.failures = 0;
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
    let breaker = this.circuitBreakers.get(hostKey);
    if (!breaker) {
      breaker = { failures: 0, lastFailure: new Date(), isOpen: false };
      this.circuitBreakers.set(hostKey, breaker);
    }

    breaker.failures++;
    breaker.lastFailure = new Date();

    if (breaker.failures >= this.config.circuitBreakerThreshold) {
      breaker.isOpen = true;
      this.metrics.circuitBreakerTrips++;
      
      if (this.config.enableLogging) {
        this.logger.warn(`Circuit breaker opened for ${hostKey} after ${breaker.failures} failures`);
      }
      
      this.emit('circuitBreakerTripped', { hostKey, failures: breaker.failures });
    }

    if (this.config.enableLogging) {
      this.logger.error(`Connection failure for ${hostKey}:`, error);
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
   * Perform health checks on all connections
   */
  private async performHealthChecks(): Promise<void> {
    const connections = Array.from(this.connections.values());
    
    if (this.config.enableLogging && connections.length > 0) {
      this.logger.debug(`Performing health checks on ${connections.length} connections`);
    }

    const healthCheckPromises = connections.map(async (connection) => {
      try {
        // Simple ping command to test connection health
        const sshClient = connection.connection;
        if (!sshClient || sshClient.destroyed) {
          connection.isHealthy = false;
          return;
        }

        // Update health check timestamp
        connection.healthCheckAt = new Date();
        this.metrics.healthChecksPerformed++;

        // Connection is considered healthy if SSH client is ready
        connection.isHealthy = !sshClient.destroyed;

      } catch (error) {
        connection.isHealthy = false;
        
        if (this.config.enableLogging) {
          this.logger.warn(`Health check failed for connection ${connection.id}:`, error);
        }
      }
    });

    await Promise.allSettled(healthCheckPromises);
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