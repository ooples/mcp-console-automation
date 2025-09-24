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

// Node.js Protocol connection options
interface NodeConnectionOptions extends SessionOptions {
  nodePath?: string;
  nodeVersion?: string;
  scriptFile?: string;
  moduleEntry?: string;
  repl?: boolean;
  inspectMode?: boolean;
  inspectPort?: number;
  debugMode?: boolean;
  nodeFlags?: string[];
  npmScript?: string;
  packageJsonPath?: string;
  environment?: Record<string, string>;
  enableCluster?: boolean;
  maxOldSpaceSize?: number;
  maxNewSpaceSize?: number;
  enableExperimentalFeatures?: boolean;
  esModules?: boolean;
  typescript?: boolean;
  tsNodePath?: string;
}

/**
 * Node.js Protocol Implementation
 *
 * Provides Node.js runtime console access through node command
 * Supports REPL, script execution, debugging, inspection, npm scripts, and TypeScript
 */
export class NodeProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'node';
  public readonly capabilities: ProtocolCapabilities;

  private nodeProcesses = new Map<string, ChildProcess>();

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
    super('node');

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
      supportsPTY: true,
      maxConcurrentSessions: 15,
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
      // Check if Node.js is available
      await this.checkNodeAvailability();
      this.isInitialized = true;
      this.logger.info('Node.js protocol initialized with production features');
    } catch (error: any) {
      this.logger.error('Failed to initialize Node.js protocol', error);
      throw error;
    }
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const sessionId = `node-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    return await this.createSessionWithTypeDetection(sessionId, options);
  }

  async executeCommand(sessionId: string, command: string, args?: string[]): Promise<void> {
    const fullCommand = args && args.length > 0 ? `${command} ${args.join(' ')}` : command;
    await this.sendInput(sessionId, fullCommand + '\n');
  }

  async sendInput(sessionId: string, input: string): Promise<void> {
    const nodeProcess = this.nodeProcesses.get(sessionId);
    const session = this.sessions.get(sessionId);

    if (!nodeProcess || !nodeProcess.stdin || !session) {
      throw new Error(`No active Node.js session: ${sessionId}`);
    }

    nodeProcess.stdin.write(input);
    session.lastActivity = new Date();

    this.emit('input-sent', {
      sessionId,
      input,
      timestamp: new Date(),
    });

    this.logger.debug(`Sent input to Node.js session ${sessionId}: ${input.substring(0, 100)}`);
  }

  async getOutput(sessionId: string, since?: Date): Promise<any> {
    const outputs = await super.getOutput(sessionId, since);
    return outputs.map(output => output.data).join('');
  }

  async closeSession(sessionId: string): Promise<void> {
    try {
      const nodeProcess = this.nodeProcesses.get(sessionId);
      if (nodeProcess) {
        // Try graceful shutdown first
        nodeProcess.kill('SIGTERM');

        // Force kill after timeout
        setTimeout(() => {
          if (nodeProcess && !nodeProcess.killed) {
            nodeProcess.kill('SIGKILL');
          }
        }, 5000);

        this.nodeProcesses.delete(sessionId);
      }

      // Clean up base protocol session
      this.sessions.delete(sessionId);

      this.logger.info(`Node.js session ${sessionId} closed`);
      this.emit('session-closed', sessionId);
    } catch (error) {
      this.logger.error(`Error closing Node.js session ${sessionId}:`, error);
      throw error;
    }
  }

  async getHealthStatus(): Promise<ProtocolHealthStatus> {
    const baseStatus = await super.getHealthStatus();

    try {
      await this.checkNodeAvailability();
      return {
        ...baseStatus,
        dependencies: {
          node: { available: true }
        }
      };
    } catch (error) {
      return {
        ...baseStatus,
        isHealthy: false,
        errors: [...baseStatus.errors, `Node.js not available: ${error}`],
        dependencies: {
          node: { available: false }
        }
      };
    }
  }

  async dispose(): Promise<void> {
    await this.cleanup();
  }

  async doCreateSession(sessionId: string, options: SessionOptions, sessionState: SessionState): Promise<ConsoleSession> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const nodeOptions = options as NodeConnectionOptions;

    // Build Node.js command
    const nodeCommand = this.buildNodeCommand(nodeOptions);

    // Spawn Node.js process
    const nodeProcess = spawn(nodeCommand[0], nodeCommand.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...this.buildEnvironment(nodeOptions), ...options.env }
    });

    // Set up output handling
    nodeProcess.stdout?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stdout',
        data: data.toString(),
        timestamp: new Date()
      };
      this.addToOutputBuffer(sessionId, output);
    });

    nodeProcess.stderr?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stderr',
        data: data.toString(),
        timestamp: new Date()
      };
      this.addToOutputBuffer(sessionId, output);
    });

    nodeProcess.on('error', (error) => {
      this.logger.error(`Node.js process error for session ${sessionId}:`, error);
      this.emit('session-error', { sessionId, error });
    });

    nodeProcess.on('close', (code) => {
      this.logger.info(`Node.js process closed for session ${sessionId} with code ${code}`);
      this.markSessionComplete(sessionId, code || 0);
    });

    // Store the process
    this.nodeProcesses.set(sessionId, nodeProcess);

    // Create session object
    const session: ConsoleSession = {
      id: sessionId,
      command: nodeCommand[0],
      args: nodeCommand.slice(1),
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...this.buildEnvironment(nodeOptions), ...options.env },
      createdAt: new Date(),
      lastActivity: new Date(),
      status: 'running',
      type: this.type,
      streaming: options.streaming,
      executionState: 'idle',
      activeCommands: new Map(),
      pid: nodeProcess.pid
    };

    this.sessions.set(sessionId, session);

    this.logger.info(`Node.js session ${sessionId} created for ${nodeOptions.scriptFile || nodeOptions.moduleEntry || nodeOptions.repl ? 'REPL' : 'Node.js application'}`);
    this.emit('session-created', { sessionId, type: 'node', session });

    return session;
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
      isOneShot: false, // Node.js sessions are typically persistent
      isPersistent: true,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      pid: session.pid,
      metadata: {}
    };
  }

  async handleError(error: Error, context: ErrorContext): Promise<ErrorRecoveryResult> {
    this.logger.error(`Error in Node.js session ${context.sessionId}: ${error.message}`);

    return {
      recovered: false,
      strategy: 'none',
      attempts: 0,
      duration: 0,
      error: error.message
    };
  }

  async recoverSession(sessionId: string): Promise<boolean> {
    const nodeProcess = this.nodeProcesses.get(sessionId);
    return nodeProcess && !nodeProcess.killed || false;
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
        connectionsActive: this.nodeProcesses.size
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

  private async checkNodeAvailability(): Promise<void> {
    return new Promise((resolve, reject) => {
      const testProcess = spawn('node', ['--version'], { stdio: 'pipe' });

      testProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error('Node.js runtime not found. Please install Node.js.'));
        }
      });

      testProcess.on('error', () => {
        reject(new Error('Node.js runtime not found. Please install Node.js.'));
      });
    });
  }

  private buildNodeCommand(options: NodeConnectionOptions): string[] {
    const command = [];

    // Node.js executable
    if (options.nodePath) {
      command.push(options.nodePath);
    } else if (options.nodeVersion) {
      command.push(`node${options.nodeVersion}`);
    } else {
      command.push('node');
    }

    // Node.js flags
    if (options.nodeFlags) {
      command.push(...options.nodeFlags);
    }

    // Memory options
    if (options.maxOldSpaceSize) {
      command.push(`--max-old-space-size=${options.maxOldSpaceSize}`);
    }

    if (options.maxNewSpaceSize) {
      command.push(`--max-new-space-size=${options.maxNewSpaceSize}`);
    }

    // Inspection mode
    if (options.inspectMode && options.inspectPort) {
      command.push(`--inspect=${options.inspectPort}`);
    }

    // Debug mode
    if (options.debugMode) {
      command.push('--inspect-brk');
    }

    // Experimental features
    if (options.enableExperimentalFeatures) {
      command.push('--experimental-modules');
    }

    // ES Modules
    if (options.esModules) {
      command.push('--input-type=module');
    }

    // TypeScript support
    if (options.typescript && options.tsNodePath) {
      command.push('-r', options.tsNodePath);
    }

    // REPL mode
    if (options.repl) {
      command.push('-i');
    }

    // Module entry point
    if (options.moduleEntry) {
      command.push('-e', options.moduleEntry);
    } else if (options.scriptFile) {
      command.push(options.scriptFile);
    } else if (options.npmScript && options.packageJsonPath) {
      command.unshift('npm', 'run', options.npmScript);
      return command;
    } else if (!options.repl) {
      // Default to REPL if no script specified
      command.push('-i');
    }

    // Application arguments
    if (options.args) {
      command.push(...options.args);
    }

    return command;
  }

  private buildEnvironment(options: NodeConnectionOptions): Record<string, string> {
    const env: Record<string, string> = {};

    // Custom environment variables
    if (options.environment) {
      Object.assign(env, options.environment);
    }

    // Node.js specific environment
    if (options.nodeVersion) {
      env.NODE_VERSION = options.nodeVersion;
    }

    // Cluster mode
    if (options.enableCluster) {
      env.NODE_ENV = 'cluster';
    }

    return env;
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up Node.js protocol');

    // Close all Node.js processes
    for (const [sessionId, process] of Array.from(this.nodeProcesses)) {
      try {
        process.kill();
      } catch (error) {
        this.logger.error(`Error killing Node.js process for session ${sessionId}:`, error);
      }
    }

    // Clear all data
    this.nodeProcesses.clear();

    // Call parent cleanup
    await super.cleanup();
  }
}

export default NodeProtocol;