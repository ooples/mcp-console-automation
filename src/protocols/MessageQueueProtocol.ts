import { spawn, ChildProcess } from 'child_process';
import { BaseProtocol } from '../core/BaseProtocol.js';
import {
  ConsoleSession,
  SessionOptions,
  ConsoleType,
  ConsoleOutput
} from '../types/index.js';
import {
  ProtocolCapabilities,
  SessionState,
  ErrorContext,
  ProtocolHealthStatus,
  ErrorRecoveryResult,
  ResourceUsage
} from '../core/IProtocol.js';

// Message Queue Protocol connection options
interface MessageQueueConnectionOptions extends SessionOptions {
  queueType: 'rabbitmq' | 'kafka' | 'redis' | 'activemq' | 'nats' | 'pulsar' | 'sqs' | 'servicebus' | 'custom';
  brokerUrl?: string;
  username?: string;
  password?: string;
  operation?: 'publish' | 'subscribe' | 'consume' | 'peek' | 'admin' | 'monitor' | 'console';
  queueName?: string;
  topicName?: string;
  exchangeName?: string;
  routingKey?: string;
  consumerGroup?: string;
  partition?: number;
  offset?: 'earliest' | 'latest' | number;
  enableSSL?: boolean;
  sslCert?: string;
  sslKey?: string;
  sslCa?: string;
  enableSASL?: boolean;
  saslMechanism?: 'PLAIN' | 'SCRAM-SHA-256' | 'SCRAM-SHA-512' | 'GSSAPI' | 'OAUTHBEARER';
  enableAdmin?: boolean;
  adminPort?: number;
  enableUI?: boolean;
  uiPort?: number;
  vhost?: string;
  clientId?: string;
  sessionTimeout?: number;
  heartbeatInterval?: number;
  enablePersistence?: boolean;
  durability?: 'durable' | 'transient';
  messageFormat?: 'json' | 'text' | 'avro' | 'protobuf' | 'binary';
  serializer?: string;
  deserializer?: string;
  compression?: 'none' | 'gzip' | 'snappy' | 'lz4' | 'zstd';
  batchSize?: number;
  maxPollRecords?: number;
  autoCommit?: boolean;
  enableDLQ?: boolean;
  dlqName?: string;
  retryPolicy?: {
    maxRetries: number;
    retryDelay: number;
    backoffMultiplier: number;
  };
  enableMetrics?: boolean;
  metricsPort?: number;
  enableTracing?: boolean;
  tracingEndpoint?: string;
  configFile?: string;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  enableCluster?: boolean;
  clusterNodes?: string[];
  replicationFactor?: number;
  enableTransaction?: boolean;
  transactionTimeout?: number;
  environment?: Record<string, string>;
}

/**
 * Message Queue Protocol Implementation
 *
 * Provides message queue system console access through RabbitMQ, Kafka, Redis, ActiveMQ, NATS, and other message brokers
 * Supports message publishing, subscribing, queue management, monitoring, and enterprise messaging patterns
 */
export class MessageQueueProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'messagequeue';
  public readonly capabilities: ProtocolCapabilities;

  private mqProcesses = new Map<string, ChildProcess>();

  // Compatibility property for old ProtocolFactory interface
  public get healthStatus(): ProtocolHealthStatus {
    return {
      isHealthy: this.isInitialized,
      lastChecked: new Date(),
      errors: [],
      warnings: [],
      metrics: {
        activeSessions: this.sessions.size,
        totalSessions: this.sessions.size,
        averageLatency: 0,
        successRate: 100,
        uptime: 0
      },
      dependencies: {}
    };
  }

  constructor() {
    super('messagequeue');

    this.capabilities = {
      supportsStreaming: true,
      supportsFileTransfer: false,
      supportsX11Forwarding: false,
      supportsPortForwarding: true,
      supportsAuthentication: true,
      supportsEncryption: true,
      supportsCompression: true,
      supportsMultiplexing: true,
      supportsKeepAlive: true,
      supportsReconnection: true,
      supportsBinaryData: true,
      supportsCustomEnvironment: true,
      supportsWorkingDirectory: true,
      supportsSignals: true,
      supportsResizing: false,
      supportsPTY: false,
      maxConcurrentSessions: 100, // Message queues can handle many connections
      defaultTimeout: 30000, // Network operations can take time
      supportedEncodings: ['utf-8', 'binary'],
      supportedAuthMethods: ['plain', 'sasl', 'oauth', 'certificate'],
      platformSupport: {
        windows: true,
        linux: true,
        macos: true,
        freebsd: true
      }
    };
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Check if message queue tools are available
      await this.checkMessageQueueAvailability();
      this.isInitialized = true;
      this.logger.info('Message Queue protocol initialized with production features');
    } catch (error: any) {
      this.logger.error('Failed to initialize Message Queue protocol', error);
      throw error;
    }
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const sessionId = `mq-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    return await this.createSessionWithTypeDetection(sessionId, options);
  }

  async dispose(): Promise<void> {
    await this.cleanup();
  }

  async executeCommand(sessionId: string, command: string, args?: string[]): Promise<void> {
    const fullCommand = args && args.length > 0 ? `${command} ${args.join(' ')}` : command;
    await this.sendInput(sessionId, fullCommand + '\n');
  }

  async sendInput(sessionId: string, input: string): Promise<void> {
    const mqProcess = this.mqProcesses.get(sessionId);
    const session = this.sessions.get(sessionId);

    if (!mqProcess || !mqProcess.stdin || !session) {
      throw new Error(`No active Message Queue session: ${sessionId}`);
    }

    mqProcess.stdin.write(input);
    session.lastActivity = new Date();

    this.emit('input-sent', {
      sessionId,
      input,
      timestamp: new Date(),
    });

    this.logger.debug(`Sent input to Message Queue session ${sessionId}: ${input.substring(0, 100)}`);
  }

  async closeSession(sessionId: string): Promise<void> {
    try {
      const mqProcess = this.mqProcesses.get(sessionId);
      if (mqProcess) {
        // Try graceful shutdown first
        mqProcess.kill('SIGTERM');

        // Force kill after timeout
        setTimeout(() => {
          if (mqProcess && !mqProcess.killed) {
            mqProcess.kill('SIGKILL');
          }
        }, 10000);

        this.mqProcesses.delete(sessionId);
      }

      // Clean up base protocol session
      this.sessions.delete(sessionId);

      this.logger.info(`Message Queue session ${sessionId} closed`);
      this.emit('session-closed', sessionId);
    } catch (error) {
      this.logger.error(`Error closing Message Queue session ${sessionId}:`, error);
      throw error;
    }
  }

  async doCreateSession(sessionId: string, options: SessionOptions, sessionState: SessionState): Promise<ConsoleSession> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const mqOptions = options as MessageQueueConnectionOptions;

    // Validate required Message Queue parameters
    if (!mqOptions.queueType) {
      throw new Error('Queue type is required for Message Queue protocol');
    }

    // Build Message Queue command
    const mqCommand = this.buildMessageQueueCommand(mqOptions);

    // Spawn Message Queue process
    const mqProcess = spawn(mqCommand[0], mqCommand.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...this.buildEnvironment(mqOptions), ...options.env }
    });

    // Set up output handling
    mqProcess.stdout?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stdout',
        data: data.toString(),
        timestamp: new Date()
      };
      this.addToOutputBuffer(sessionId, output);
    });

    mqProcess.stderr?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stderr',
        data: data.toString(),
        timestamp: new Date()
      };
      this.addToOutputBuffer(sessionId, output);
    });

    mqProcess.on('error', (error) => {
      this.logger.error(`Message Queue process error for session ${sessionId}:`, error);
      this.emit('session-error', { sessionId, error });
    });

    mqProcess.on('close', (code) => {
      this.logger.info(`Message Queue process closed for session ${sessionId} with code ${code}`);
      this.markSessionComplete(sessionId, code || 0);
    });

    // Store the process
    this.mqProcesses.set(sessionId, mqProcess);

    // Create session object
    const session: ConsoleSession = {
      id: sessionId,
      command: mqCommand[0],
      args: mqCommand.slice(1),
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...this.buildEnvironment(mqOptions), ...options.env },
      createdAt: new Date(),
      lastActivity: new Date(),
      status: 'running',
      type: this.type,
      streaming: options.streaming,
      executionState: 'idle',
      activeCommands: new Map(),
      pid: mqProcess.pid
    };

    this.sessions.set(sessionId, session);

    this.logger.info(`Message Queue session ${sessionId} created for ${mqOptions.queueType} ${mqOptions.operation || 'console'}`);
    this.emit('session-created', { sessionId, type: 'messagequeue', session });

    return session;
  }

  // Override getOutput to satisfy old ProtocolFactory interface (returns string)
  async getOutput(sessionId: string, since?: Date): Promise<any> {
    const outputs = await super.getOutput(sessionId, since);
    return outputs.map(output => output.data).join('');
  }

  // Missing IProtocol methods for compatibility
  getAllSessions(): ConsoleSession[] {
    return Array.from(this.sessions.values());
  }

  getActiveSessions(): ConsoleSession[] {
    return Array.from(this.sessions.values()).filter(session =>
      session.status === 'running'
    );
  }

  getSessionCount(): number {
    return this.sessions.size;
  }

  async getSessionState(sessionId: string): Promise<SessionState> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    return {
      sessionId,
      status: session.status,
      isOneShot: false, // Message queue sessions are typically persistent
      isPersistent: true,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      pid: session.pid,
      metadata: {}
    };
  }

  async handleError(error: Error, context: ErrorContext): Promise<ErrorRecoveryResult> {
    this.logger.error(`Error in Message Queue session ${context.sessionId}: ${error.message}`);

    return {
      recovered: false,
      strategy: 'none',
      attempts: 0,
      duration: 0,
      error: error.message
    };
  }

  async recoverSession(sessionId: string): Promise<boolean> {
    const mqProcess = this.mqProcesses.get(sessionId);
    return mqProcess && !mqProcess.killed || false;
  }

  getResourceUsage(): ResourceUsage {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    return {
      memory: {
        used: memUsage.heapUsed,
        available: memUsage.heapTotal,
        peak: memUsage.heapTotal
      },
      cpu: {
        usage: cpuUsage.user + cpuUsage.system,
        load: [0, 0, 0]
      },
      network: {
        bytesIn: 0,
        bytesOut: 0,
        connectionsActive: this.mqProcesses.size
      },
      storage: {
        bytesRead: 0,
        bytesWritten: 0
      },
      sessions: {
        active: this.sessions.size,
        total: this.sessions.size,
        peak: this.sessions.size
      }
    };
  }

  async getHealthStatus(): Promise<ProtocolHealthStatus> {
    const baseStatus = await super.getHealthStatus();

    try {
      await this.checkMessageQueueAvailability();
      return {
        ...baseStatus,
        dependencies: {
          messagequeue: { available: true }
        }
      };
    } catch (error) {
      return {
        ...baseStatus,
        isHealthy: false,
        errors: [...baseStatus.errors, `Message Queue tools not available: ${error}`],
        dependencies: {
          messagequeue: { available: false }
        }
      };
    }
  }

  private async checkMessageQueueAvailability(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Try to check for common message queue CLI tools
      const testProcess = spawn('which', ['rabbitmqctl'], { stdio: 'pipe' });

      testProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error('Message Queue tools not found. Please install RabbitMQ, Kafka, or other message queue software.'));
        }
      });

      testProcess.on('error', () => {
        reject(new Error('Message Queue tools not found. Please install RabbitMQ, Kafka, or other message queue software.'));
      });
    });
  }

  private buildMessageQueueCommand(options: MessageQueueConnectionOptions): string[] {
    const command = [];

    // Message Queue system specific commands
    switch (options.queueType) {
      case 'rabbitmq':
        if (options.operation === 'admin') {
          command.push('rabbitmqctl');
          if (options.adminPort) {
            command.push('--node', `rabbit@localhost:${options.adminPort}`);
          }
          command.push('status');
        } else {
          command.push('rabbitmq-plugins');
          command.push('enable', 'rabbitmq_management');
        }
        break;

      case 'kafka':
        if (options.operation === 'admin') {
          command.push('kafka-topics.sh');
          if (options.brokerUrl) {
            command.push('--bootstrap-server', options.brokerUrl);
          }
          command.push('--list');
        } else if (options.operation === 'consume') {
          command.push('kafka-console-consumer.sh');
          if (options.brokerUrl) {
            command.push('--bootstrap-server', options.brokerUrl);
          }
          if (options.topicName) {
            command.push('--topic', options.topicName);
          }
          if (options.consumerGroup) {
            command.push('--group', options.consumerGroup);
          }
        } else if (options.operation === 'publish') {
          command.push('kafka-console-producer.sh');
          if (options.brokerUrl) {
            command.push('--bootstrap-server', options.brokerUrl);
          }
          if (options.topicName) {
            command.push('--topic', options.topicName);
          }
        }
        break;

      case 'redis':
        command.push('redis-cli');
        if (options.brokerUrl) {
          const url = new URL(options.brokerUrl);
          command.push('-h', url.hostname);
          if (url.port) command.push('-p', url.port);
        }
        if (options.username) {
          command.push('--user', options.username);
        }
        if (options.password) {
          command.push('--pass', options.password);
        }
        break;

      case 'activemq':
        command.push('activemq');
        if (options.operation === 'admin') {
          command.push('console');
        } else {
          command.push('producer');
          if (options.queueName) {
            command.push('--destination', `queue://${options.queueName}`);
          }
        }
        break;

      case 'nats':
        if (options.operation === 'publish') {
          command.push('nats', 'pub');
          if (options.topicName) {
            command.push(options.topicName);
          }
        } else if (options.operation === 'subscribe') {
          command.push('nats', 'sub');
          if (options.topicName) {
            command.push(options.topicName);
          }
        } else {
          command.push('nats', 'server', 'info');
        }
        break;

      case 'pulsar':
        if (options.operation === 'admin') {
          command.push('pulsar-admin');
          command.push('brokers', 'list', 'public');
        } else if (options.operation === 'consume') {
          command.push('pulsar-client');
          command.push('consume');
          if (options.topicName) {
            command.push(options.topicName);
          }
          command.push('-s', options.consumerGroup || 'default-subscription');
        } else if (options.operation === 'publish') {
          command.push('pulsar-client');
          command.push('produce');
          if (options.topicName) {
            command.push(options.topicName);
          }
        }
        break;

      case 'sqs':
        command.push('aws', 'sqs');
        if (options.operation === 'admin') {
          command.push('list-queues');
        } else if (options.operation === 'consume') {
          command.push('receive-message');
          if (options.queueName) {
            command.push('--queue-url', options.queueName);
          }
        } else if (options.operation === 'publish') {
          command.push('send-message');
          if (options.queueName) {
            command.push('--queue-url', options.queueName);
          }
        }
        break;

      case 'servicebus':
        command.push('az', 'servicebus');
        if (options.operation === 'admin') {
          command.push('namespace', 'list');
        } else {
          command.push('queue', 'list');
          if (options.queueName) {
            command.push('--namespace-name', options.queueName);
          }
        }
        break;

      case 'custom':
        if (options.command) {
          command.push(options.command);
        } else {
          throw new Error('Custom Message Queue requires command to be specified');
        }
        break;

      default:
        throw new Error(`Unsupported message queue type: ${options.queueType}`);
    }

    // Common arguments
    if (options.args) {
      command.push(...options.args);
    }

    return command;
  }

  private buildEnvironment(options: MessageQueueConnectionOptions): Record<string, string> {
    const env: Record<string, string> = {};

    // Message Queue system environment variables
    if (options.brokerUrl) {
      env.MQ_BROKER_URL = options.brokerUrl;
    }

    if (options.username) {
      env.MQ_USERNAME = options.username;
    }

    if (options.password) {
      env.MQ_PASSWORD = options.password;
    }

    // RabbitMQ specific
    if (options.queueType === 'rabbitmq') {
      if (options.vhost) {
        env.RABBITMQ_VHOST = options.vhost;
      }
      if (options.enableSSL) {
        env.RABBITMQ_USE_SSL = 'true';
        if (options.sslCert) env.RABBITMQ_SSL_CERT = options.sslCert;
        if (options.sslKey) env.RABBITMQ_SSL_KEY = options.sslKey;
        if (options.sslCa) env.RABBITMQ_SSL_CA = options.sslCa;
      }
    }

    // Kafka specific
    if (options.queueType === 'kafka') {
      if (options.enableSASL) {
        env.KAFKA_SASL_ENABLED = 'true';
        if (options.saslMechanism) env.KAFKA_SASL_MECHANISM = options.saslMechanism;
      }
      if (options.enableSSL) {
        env.KAFKA_SSL_ENABLED = 'true';
      }
      if (options.clientId) {
        env.KAFKA_CLIENT_ID = options.clientId;
      }
    }

    // Redis specific
    if (options.queueType === 'redis') {
      if (options.enableSSL) {
        env.REDIS_TLS = 'true';
      }
    }

    // General messaging settings
    if (options.messageFormat) {
      env.MQ_MESSAGE_FORMAT = options.messageFormat;
    }

    if (options.compression && options.compression !== 'none') {
      env.MQ_COMPRESSION = options.compression;
    }

    if (options.enableMetrics) {
      env.MQ_METRICS_ENABLED = 'true';
      if (options.metricsPort) env.MQ_METRICS_PORT = options.metricsPort.toString();
    }

    if (options.enableTracing) {
      env.MQ_TRACING_ENABLED = 'true';
      if (options.tracingEndpoint) env.MQ_TRACING_ENDPOINT = options.tracingEndpoint;
    }

    if (options.logLevel) {
      env.MQ_LOG_LEVEL = options.logLevel;
    }

    // Clustering
    if (options.enableCluster && options.clusterNodes) {
      env.MQ_CLUSTER_NODES = options.clusterNodes.join(',');
    }

    // Transactions
    if (options.enableTransaction) {
      env.MQ_TRANSACTION_ENABLED = 'true';
      if (options.transactionTimeout) env.MQ_TRANSACTION_TIMEOUT = options.transactionTimeout.toString();
    }

    // Custom environment variables
    if (options.environment) {
      Object.assign(env, options.environment);
    }

    return env;
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up Message Queue protocol');

    // Close all Message Queue processes
    for (const [sessionId, process] of Array.from(this.mqProcesses)) {
      try {
        process.kill();
      } catch (error) {
        this.logger.error(`Error killing Message Queue process for session ${sessionId}:`, error);
      }
    }

    // Clear all data
    this.mqProcesses.clear();

    // Call parent cleanup
    await super.cleanup();
  }
}

export default MessageQueueProtocol;