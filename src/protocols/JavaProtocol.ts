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

// Java Protocol connection options
interface JavaConnectionOptions extends SessionOptions {
  javaHome?: string;
  classPath?: string;
  mainClass?: string;
  jarFile?: string;
  vmOptions?: string[];
  jvmFlags?: string[];
  heapSize?: string;
  systemProperties?: Record<string, string>;
  workingDirectory?: string;
  enableJMX?: boolean;
  jmxPort?: number;
  debugPort?: number;
  enableDebug?: boolean;
  springProfile?: string;
  springConfigLocation?: string;
}

/**
 * Java Protocol Implementation
 *
 * Provides Java application console access through java command
 * Supports JAR files, main classes, JVM options, debugging, and Spring Boot applications
 */
export class JavaProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'java';
  public readonly capabilities: ProtocolCapabilities;

  private javaProcesses = new Map<string, ChildProcess>();

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
    super('java');

    this.capabilities = {
      supportsStreaming: true,
      supportsFileTransfer: false,
      supportsX11Forwarding: false,
      supportsPortForwarding: false,
      supportsAuthentication: false,
      supportsEncryption: false,
      supportsCompression: false,
      supportsMultiplexing: false,
      supportsKeepAlive: true,
      supportsReconnection: true,
      supportsBinaryData: false,
      supportsCustomEnvironment: true,
      supportsWorkingDirectory: true,
      supportsSignals: true,
      supportsResizing: false,
      supportsPTY: false,
      maxConcurrentSessions: 25,
      defaultTimeout: 30000,
      supportedEncodings: ['utf-8'],
      supportedAuthMethods: [],
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
      // Check if Java is available
      await this.checkJavaAvailability();
      this.isInitialized = true;
      this.logger.info('Java protocol initialized with production features');
    } catch (error: any) {
      this.logger.error('Failed to initialize Java protocol', error);
      throw error;
    }
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const sessionId = `java-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
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
    const javaProcess = this.javaProcesses.get(sessionId);
    const session = this.sessions.get(sessionId);

    if (!javaProcess || !javaProcess.stdin || !session) {
      throw new Error(`No active Java session: ${sessionId}`);
    }

    javaProcess.stdin.write(input);
    session.lastActivity = new Date();

    this.emit('input-sent', {
      sessionId,
      input,
      timestamp: new Date(),
    });

    this.logger.debug(`Sent input to Java session ${sessionId}: ${input.substring(0, 100)}`);
  }

  async closeSession(sessionId: string): Promise<void> {
    try {
      const javaProcess = this.javaProcesses.get(sessionId);
      if (javaProcess) {
        // Try graceful shutdown first
        javaProcess.kill('SIGTERM');

        // Force kill after timeout
        setTimeout(() => {
          if (javaProcess && !javaProcess.killed) {
            javaProcess.kill('SIGKILL');
          }
        }, 5000);

        this.javaProcesses.delete(sessionId);
      }

      // Clean up base protocol session
      this.sessions.delete(sessionId);

      this.logger.info(`Java session ${sessionId} closed`);
      this.emit('session-closed', sessionId);
    } catch (error) {
      this.logger.error(`Error closing Java session ${sessionId}:`, error);
      throw error;
    }
  }

  async doCreateSession(sessionId: string, options: SessionOptions, sessionState: SessionState): Promise<ConsoleSession> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const javaOptions = options as JavaConnectionOptions;

    // Build Java command
    const javaCommand = this.buildJavaCommand(javaOptions);

    // Spawn Java process
    const javaProcess = spawn(javaCommand[0], javaCommand.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: javaOptions.workingDirectory || options.cwd || process.cwd(),
      env: { ...process.env, ...this.buildEnvironment(javaOptions), ...options.env }
    });

    // Set up output handling
    javaProcess.stdout?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stdout',
        data: data.toString(),
        timestamp: new Date()
      };
      this.addToOutputBuffer(sessionId, output);
    });

    javaProcess.stderr?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stderr',
        data: data.toString(),
        timestamp: new Date()
      };
      this.addToOutputBuffer(sessionId, output);
    });

    javaProcess.on('error', (error) => {
      this.logger.error(`Java process error for session ${sessionId}:`, error);
      this.emit('session-error', { sessionId, error });
    });

    javaProcess.on('close', (code) => {
      this.logger.info(`Java process closed for session ${sessionId} with code ${code}`);
      this.markSessionComplete(sessionId, code || 0);
    });

    // Store the process
    this.javaProcesses.set(sessionId, javaProcess);

    // Create session object
    const session: ConsoleSession = {
      id: sessionId,
      command: javaCommand[0],
      args: javaCommand.slice(1),
      cwd: javaOptions.workingDirectory || options.cwd || process.cwd(),
      env: { ...process.env, ...this.buildEnvironment(javaOptions), ...options.env },
      createdAt: new Date(),
      lastActivity: new Date(),
      status: 'running',
      type: this.type,
      streaming: options.streaming,
      executionState: 'idle',
      activeCommands: new Map(),
      pid: javaProcess.pid
    };

    this.sessions.set(sessionId, session);

    this.logger.info(`Java session ${sessionId} created for ${javaOptions.jarFile || javaOptions.mainClass || 'Java application'}`);
    this.emit('session-created', { sessionId, type: 'java', session });

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
      isOneShot: false, // Java applications are persistent by default
      isPersistent: true,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      pid: session.pid,
      metadata: {}
    };
  }

  async handleError(error: Error, context: ErrorContext): Promise<ErrorRecoveryResult> {
    this.logger.error(`Error in Java session ${context.sessionId}: ${error.message}`);

    return {
      recovered: false,
      strategy: 'none',
      attempts: 0,
      duration: 0,
      error: error.message
    };
  }

  async recoverSession(sessionId: string): Promise<boolean> {
    const javaProcess = this.javaProcesses.get(sessionId);
    return javaProcess && !javaProcess.killed || false;
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
        connectionsActive: this.javaProcesses.size
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
      await this.checkJavaAvailability();
      return {
        ...baseStatus,
        dependencies: {
          java: { available: true }
        }
      };
    } catch (error) {
      return {
        ...baseStatus,
        isHealthy: false,
        errors: [...baseStatus.errors, `Java not available: ${error}`],
        dependencies: {
          java: { available: false }
        }
      };
    }
  }

  private async checkJavaAvailability(): Promise<void> {
    return new Promise((resolve, reject) => {
      const testProcess = spawn('java', ['-version'], { stdio: 'pipe' });

      testProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error('Java runtime not found. Please install Java.'));
        }
      });

      testProcess.on('error', () => {
        reject(new Error('Java runtime not found. Please install Java.'));
      });
    });
  }

  private buildJavaCommand(options: JavaConnectionOptions): string[] {
    const command = [];

    // Java executable
    const javaHome = options.javaHome || process.env.JAVA_HOME;
    if (javaHome) {
      command.push(`${javaHome}/bin/java`);
    } else {
      command.push('java');
    }

    // JVM flags and options
    if (options.jvmFlags) {
      command.push(...options.jvmFlags);
    }

    if (options.vmOptions) {
      command.push(...options.vmOptions);
    }

    // Heap size
    if (options.heapSize) {
      command.push(`-Xmx${options.heapSize}`);
    }

    // System properties
    if (options.systemProperties) {
      for (const [key, value] of Object.entries(options.systemProperties)) {
        command.push(`-D${key}=${value}`);
      }
    }

    // Spring Boot properties
    if (options.springProfile) {
      command.push(`-Dspring.profiles.active=${options.springProfile}`);
    }

    if (options.springConfigLocation) {
      command.push(`-Dspring.config.location=${options.springConfigLocation}`);
    }

    // Debug options
    if (options.enableDebug && options.debugPort) {
      command.push(`-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=${options.debugPort}`);
    }

    // JMX options
    if (options.enableJMX && options.jmxPort) {
      command.push(`-Dcom.sun.management.jmxremote`);
      command.push(`-Dcom.sun.management.jmxremote.port=${options.jmxPort}`);
      command.push(`-Dcom.sun.management.jmxremote.authenticate=false`);
      command.push(`-Dcom.sun.management.jmxremote.ssl=false`);
    }

    // Classpath
    if (options.classPath) {
      command.push('-cp', options.classPath);
    }

    // JAR file or main class
    if (options.jarFile) {
      command.push('-jar', options.jarFile);
    } else if (options.mainClass) {
      command.push(options.mainClass);
    } else {
      // Default to version if no jar or main class specified
      command.push('-version');
    }

    // Application arguments
    if (options.args) {
      command.push(...options.args);
    }

    return command;
  }

  private buildEnvironment(options: JavaConnectionOptions): Record<string, string> {
    const env: Record<string, string> = {};

    if (options.javaHome) {
      env.JAVA_HOME = options.javaHome;
    }

    if (options.classPath) {
      env.CLASSPATH = options.classPath;
    }

    return env;
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up Java protocol');

    // Close all Java processes
    for (const [sessionId, process] of Array.from(this.javaProcesses)) {
      try {
        process.kill();
      } catch (error) {
        this.logger.error(`Error killing Java process for session ${sessionId}:`, error);
      }
    }

    // Clear all data
    this.javaProcesses.clear();

    // Call parent cleanup
    await super.cleanup();
  }
}

export default JavaProtocol;