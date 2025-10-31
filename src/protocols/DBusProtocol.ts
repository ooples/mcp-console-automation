import { spawn, ChildProcess } from 'child_process';
import { BaseProtocol } from '../core/BaseProtocol.js';
import {
  ConsoleSession,
  SessionOptions,
  ConsoleType,
  ConsoleOutput,
} from '../types/index.js';
import {
  ProtocolCapabilities,
  SessionState,
  ErrorContext,
  ProtocolHealthStatus,
  ErrorRecoveryResult,
  ResourceUsage,
} from '../core/IProtocol.js';

// D-Bus Protocol connection options
interface DBusConnectionOptions extends SessionOptions {
  busType?: 'system' | 'session';
  busAddress?: string;
  serviceName?: string;
  objectPath?: string;
  interfaceName?: string;
  methodName?: string;
  methodArgs?: string[];
  propertyName?: string;
  signalName?: string;
  enableMonitoring?: boolean;
  monitorRules?: string[];
  enableIntrospection?: boolean;
  timeout?: number;
  destinationFilter?: string;
  senderFilter?: string;
  pathFilter?: string;
  interfaceFilter?: string;
  memberFilter?: string;
  enableAuth?: boolean;
  authMechanism?: 'EXTERNAL' | 'DBUS_COOKIE_SHA1' | 'ANONYMOUS';
  enableProxy?: boolean;
  proxyService?: string;
  enableActivation?: boolean;
  activationService?: string;
  enablePolicy?: boolean;
  policyConfig?: string;
  enableLogging?: boolean;
  logLevel?: 'debug' | 'info' | 'warning' | 'error';
  environment?: Record<string, string>;
}

/**
 * D-Bus Protocol Implementation
 *
 * Provides D-Bus message bus system console access through dbus-send, dbus-monitor commands
 * Supports inter-process communication, service discovery, method calls, signal monitoring, and system integration
 */
export class DBusProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'dbus';
  public readonly capabilities: ProtocolCapabilities;

  private dbusProcesses = new Map<string, ChildProcess>();

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
        uptime: 0,
      },
      dependencies: {},
    };
  }

  constructor() {
    super('dbus');

    this.capabilities = {
      supportsStreaming: true,
      supportsFileTransfer: false,
      supportsX11Forwarding: false,
      supportsPortForwarding: false,
      supportsAuthentication: true,
      supportsEncryption: false,
      supportsCompression: false,
      supportsMultiplexing: true,
      supportsKeepAlive: true,
      supportsReconnection: true,
      supportsBinaryData: true,
      supportsCustomEnvironment: true,
      supportsWorkingDirectory: true,
      supportsSignals: true,
      supportsResizing: false,
      supportsPTY: false,
      maxConcurrentSessions: 10,
      defaultTimeout: 30000, // D-Bus operations are usually fast
      supportedEncodings: ['utf-8'],
      supportedAuthMethods: ['external', 'cookie'],
      platformSupport: {
        windows: false, // D-Bus is primarily Linux/Unix
        linux: true,
        macos: true,
        freebsd: true,
      },
    };
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Check if D-Bus is available
      await this.checkDBusAvailability();
      this.isInitialized = true;
      this.logger.info('D-Bus protocol initialized with production features');
    } catch (error: any) {
      this.logger.error('Failed to initialize D-Bus protocol', error);
      throw error;
    }
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const sessionId = `dbus-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    return await this.createSessionWithTypeDetection(sessionId, options);
  }

  async dispose(): Promise<void> {
    await this.cleanup();
  }

  async executeCommand(
    sessionId: string,
    command: string,
    args?: string[]
  ): Promise<void> {
    const fullCommand =
      args && args.length > 0 ? `${command} ${args.join(' ')}` : command;
    await this.sendInput(sessionId, fullCommand + '\n');
  }

  async sendInput(sessionId: string, input: string): Promise<void> {
    const dbusProcess = this.dbusProcesses.get(sessionId);
    const session = this.sessions.get(sessionId);

    if (!dbusProcess || !dbusProcess.stdin || !session) {
      throw new Error(`No active D-Bus session: ${sessionId}`);
    }

    dbusProcess.stdin.write(input);
    session.lastActivity = new Date();

    this.emit('input-sent', {
      sessionId,
      input,
      timestamp: new Date(),
    });

    this.logger.debug(
      `Sent input to D-Bus session ${sessionId}: ${input.substring(0, 100)}`
    );
  }

  async closeSession(sessionId: string): Promise<void> {
    try {
      const dbusProcess = this.dbusProcesses.get(sessionId);
      if (dbusProcess) {
        // Try graceful shutdown first
        dbusProcess.kill('SIGTERM');

        // Force kill after timeout
        setTimeout(() => {
          if (dbusProcess && !dbusProcess.killed) {
            dbusProcess.kill('SIGKILL');
          }
        }, 5000);

        this.dbusProcesses.delete(sessionId);
      }

      // Clean up base protocol session
      this.sessions.delete(sessionId);

      this.logger.info(`D-Bus session ${sessionId} closed`);
      this.emit('session-closed', sessionId);
    } catch (error) {
      this.logger.error(`Error closing D-Bus session ${sessionId}:`, error);
      throw error;
    }
  }

  async doCreateSession(
    sessionId: string,
    options: SessionOptions,
    sessionState: SessionState
  ): Promise<ConsoleSession> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const dbusOptions = options as DBusConnectionOptions;

    // Build D-Bus command
    const dbusCommand = this.buildDBusCommand(dbusOptions);

    // Spawn D-Bus process
    const dbusProcess = spawn(dbusCommand[0], dbusCommand.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: options.cwd || process.cwd(),
      env: {
        ...process.env,
        ...this.buildEnvironment(dbusOptions),
        ...options.env,
      },
    });

    // Set up output handling
    dbusProcess.stdout?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stdout',
        data: data.toString(),
        timestamp: new Date(),
      };
      this.addToOutputBuffer(sessionId, output);
    });

    dbusProcess.stderr?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stderr',
        data: data.toString(),
        timestamp: new Date(),
      };
      this.addToOutputBuffer(sessionId, output);
    });

    dbusProcess.on('error', (error) => {
      this.logger.error(`D-Bus process error for session ${sessionId}:`, error);
      this.emit('session-error', { sessionId, error });
    });

    dbusProcess.on('close', (code) => {
      this.logger.info(
        `D-Bus process closed for session ${sessionId} with code ${code}`
      );
      this.markSessionComplete(sessionId, code || 0);
    });

    // Store the process
    this.dbusProcesses.set(sessionId, dbusProcess);

    // Create session object
    const session: ConsoleSession = {
      id: sessionId,
      command: dbusCommand[0],
      args: dbusCommand.slice(1),
      cwd: options.cwd || process.cwd(),
      env: {
        ...process.env,
        ...this.buildEnvironment(dbusOptions),
        ...options.env,
      },
      createdAt: new Date(),
      lastActivity: new Date(),
      status: 'running',
      type: this.type,
      streaming: options.streaming,
      executionState: 'idle',
      activeCommands: new Map(),
      pid: dbusProcess.pid,
    };

    this.sessions.set(sessionId, session);

    this.logger.info(
      `D-Bus session ${sessionId} created for ${dbusOptions.serviceName || dbusOptions.busType || 'D-Bus communication'}`
    );
    this.emit('session-created', { sessionId, type: 'dbus', session });

    return session;
  }

  // Override getOutput to satisfy old ProtocolFactory interface (returns string)
  async getOutput(sessionId: string, since?: Date): Promise<any> {
    const outputs = await super.getOutput(sessionId, since);
    return outputs.map((output) => output.data).join('');
  }

  // Missing IProtocol methods for compatibility
  getAllSessions(): ConsoleSession[] {
    return Array.from(this.sessions.values());
  }

  getActiveSessions(): ConsoleSession[] {
    return Array.from(this.sessions.values()).filter(
      (session) => session.status === 'running'
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
      isOneShot: true, // D-Bus commands are typically one-shot
      isPersistent: false,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      pid: session.pid,
      metadata: {},
    };
  }

  async handleError(
    error: Error,
    context: ErrorContext
  ): Promise<ErrorRecoveryResult> {
    this.logger.error(
      `Error in D-Bus session ${context.sessionId}: ${error.message}`
    );

    return {
      recovered: false,
      strategy: 'none',
      attempts: 0,
      duration: 0,
      error: error.message,
    };
  }

  async recoverSession(sessionId: string): Promise<boolean> {
    const dbusProcess = this.dbusProcesses.get(sessionId);
    return (dbusProcess && !dbusProcess.killed) || false;
  }

  getResourceUsage(): ResourceUsage {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    return {
      memory: {
        used: memUsage.heapUsed,
        available: memUsage.heapTotal,
        peak: memUsage.heapTotal,
      },
      cpu: {
        usage: cpuUsage.user + cpuUsage.system,
        load: [0, 0, 0],
      },
      network: {
        bytesIn: 0,
        bytesOut: 0,
        connectionsActive: this.dbusProcesses.size,
      },
      storage: {
        bytesRead: 0,
        bytesWritten: 0,
      },
      sessions: {
        active: this.sessions.size,
        total: this.sessions.size,
        peak: this.sessions.size,
      },
    };
  }

  async getHealthStatus(): Promise<ProtocolHealthStatus> {
    const baseStatus = await super.getHealthStatus();

    try {
      await this.checkDBusAvailability();
      return {
        ...baseStatus,
        dependencies: {
          dbus: { available: true },
        },
      };
    } catch (error) {
      return {
        ...baseStatus,
        isHealthy: false,
        errors: [...baseStatus.errors, `D-Bus not available: ${error}`],
        dependencies: {
          dbus: { available: false },
        },
      };
    }
  }

  private async checkDBusAvailability(): Promise<void> {
    return new Promise((resolve, reject) => {
      const testProcess = spawn('dbus-send', ['--version'], { stdio: 'pipe' });

      testProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new Error('D-Bus tools not found. Please install dbus package.')
          );
        }
      });

      testProcess.on('error', () => {
        reject(
          new Error('D-Bus tools not found. Please install dbus package.')
        );
      });
    });
  }

  private buildDBusCommand(options: DBusConnectionOptions): string[] {
    const command = [];

    // Determine D-Bus command based on operation type
    if (options.enableMonitoring) {
      // Use dbus-monitor for signal monitoring
      command.push('dbus-monitor');

      // Bus type
      if (options.busType) {
        command.push(`--${options.busType}`);
      }

      // Monitor rules
      if (options.monitorRules && options.monitorRules.length > 0) {
        command.push(...options.monitorRules);
      } else {
        // Default monitoring rules based on filters
        if (options.destinationFilter) {
          command.push(`destination='${options.destinationFilter}'`);
        }
        if (options.senderFilter) {
          command.push(`sender='${options.senderFilter}'`);
        }
        if (options.pathFilter) {
          command.push(`path='${options.pathFilter}'`);
        }
        if (options.interfaceFilter) {
          command.push(`interface='${options.interfaceFilter}'`);
        }
        if (options.memberFilter) {
          command.push(`member='${options.memberFilter}'`);
        }
      }
    } else if (options.enableIntrospection) {
      // Use dbus-send for introspection
      command.push('dbus-send');

      // Bus type
      if (options.busType) {
        command.push(`--${options.busType}`);
      }

      command.push('--print-reply');
      command.push('--dest=' + (options.serviceName || 'org.freedesktop.DBus'));
      command.push(options.objectPath || '/');
      command.push('org.freedesktop.DBus.Introspectable.Introspect');
    } else {
      // Use dbus-send for method calls, property access, etc.
      command.push('dbus-send');

      // Bus type
      if (options.busType) {
        command.push(`--${options.busType}`);
      }

      command.push('--print-reply');

      // Timeout
      if (options.timeout) {
        command.push('--reply-timeout=' + options.timeout);
      }

      // Destination service
      if (options.serviceName) {
        command.push('--dest=' + options.serviceName);
      }

      // Object path
      if (options.objectPath) {
        command.push(options.objectPath);
      }

      // Interface and method/property
      if (options.interfaceName && options.methodName) {
        command.push(`${options.interfaceName}.${options.methodName}`);

        // Method arguments
        if (options.methodArgs && options.methodArgs.length > 0) {
          command.push(...options.methodArgs);
        }
      } else if (options.interfaceName && options.propertyName) {
        // Property access
        command.push('org.freedesktop.DBus.Properties.Get');
        command.push(`string:${options.interfaceName}`);
        command.push(`string:${options.propertyName}`);
      }
    }

    // Application arguments
    if (options.args) {
      command.push(...options.args);
    }

    return command;
  }

  private buildEnvironment(
    options: DBusConnectionOptions
  ): Record<string, string> {
    const env: Record<string, string> = {};

    // D-Bus environment variables
    if (options.busAddress) {
      env.DBUS_BUS_ADDRESS = options.busAddress;
    }

    if (options.busType === 'session') {
      env.DBUS_SESSION_BUS_ADDRESS =
        options.busAddress ||
        env.DBUS_SESSION_BUS_ADDRESS ||
        'unix:path=/run/user/1000/bus';
    } else if (options.busType === 'system') {
      env.DBUS_SYSTEM_BUS_ADDRESS =
        options.busAddress || 'unix:path=/var/run/dbus/system_bus_socket';
    }

    // Authentication
    if (options.enableAuth && options.authMechanism) {
      env.DBUS_AUTH_MECHANISM = options.authMechanism;
    }

    // Logging
    if (options.enableLogging && options.logLevel) {
      env.DBUS_VERBOSE = '1';
      env.DBUS_LOG_LEVEL = options.logLevel;
    }

    // Proxy settings
    if (options.enableProxy && options.proxyService) {
      env.DBUS_PROXY_SERVICE = options.proxyService;
    }

    // Activation settings
    if (options.enableActivation && options.activationService) {
      env.DBUS_ACTIVATION_SERVICE = options.activationService;
    }

    // Policy configuration
    if (options.enablePolicy && options.policyConfig) {
      env.DBUS_POLICY_CONFIG = options.policyConfig;
    }

    // Custom environment variables
    if (options.environment) {
      Object.assign(env, options.environment);
    }

    return env;
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up D-Bus protocol');

    // Close all D-Bus processes
    for (const [sessionId, process] of Array.from(this.dbusProcesses)) {
      try {
        process.kill();
      } catch (error) {
        this.logger.error(
          `Error killing D-Bus process for session ${sessionId}:`,
          error
        );
      }
    }

    // Clear all data
    this.dbusProcesses.clear();

    // Call parent cleanup
    await super.cleanup();
  }
}

export default DBusProtocol;
