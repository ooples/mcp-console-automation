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

// Terraform Protocol connection options
interface TerraformConnectionOptions extends SessionOptions {
  terraformPath?: string;
  terraformVersion?: string;
  workingDir?: string;
  configFile?: string;
  varFile?: string[];
  variables?: Record<string, string>;
  backend?: 'local' | 's3' | 'azurerm' | 'gcs' | 'consul' | 'etcd';
  backendConfig?: Record<string, string>;
  stateFile?: string;
  workspace?: string;
  parallelism?: number;
  enableLogging?: boolean;
  logLevel?: 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  enableValidation?: boolean;
  enableRefresh?: boolean;
  autoApprove?: boolean;
  target?: string[];
  replace?: string[];
  environment?: Record<string, string>;
  cloudProvider?: 'aws' | 'azure' | 'gcp' | 'digitalocean' | 'cloudflare';
  credentialsFile?: string;
  enableRemoteState?: boolean;
  enableModules?: boolean;
  moduleSource?: string[];
  enableProviders?: boolean;
  providerSource?: string[];
  dryRun?: boolean;
  destroyMode?: boolean;
  importMode?: boolean;
  importAddress?: string;
  importId?: string;
  enableGraph?: boolean;
  graphType?: 'plan' | 'apply' | 'validate' | 'plan-destroy';
}

/**
 * Terraform Protocol Implementation
 *
 * Provides Terraform Infrastructure as Code console access through terraform command
 * Supports planning, applying, destroying, state management, workspaces, modules, and providers
 */
export class TerraformProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'terraform';
  public readonly capabilities: ProtocolCapabilities;

  private terraformProcesses = new Map<string, ChildProcess>();

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
    super('terraform');

    this.capabilities = {
      supportsStreaming: true,
      supportsFileTransfer: false,
      supportsX11Forwarding: false,
      supportsPortForwarding: false,
      supportsAuthentication: true,
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
      maxConcurrentSessions: 10,
      defaultTimeout: 300000, // Terraform operations can take very long
      supportedEncodings: ['utf-8'],
      supportedAuthMethods: ['api-key', 'service-account'],
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
      // Check if Terraform is available
      await this.checkTerraformAvailability();
      this.isInitialized = true;
      this.logger.info('Terraform protocol initialized with production features');
    } catch (error: any) {
      this.logger.error('Failed to initialize Terraform protocol', error);
      throw error;
    }
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const sessionId = `terraform-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
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
    const terraformProcess = this.terraformProcesses.get(sessionId);
    const session = this.sessions.get(sessionId);

    if (!terraformProcess || !terraformProcess.stdin || !session) {
      throw new Error(`No active Terraform session: ${sessionId}`);
    }

    terraformProcess.stdin.write(input);
    session.lastActivity = new Date();

    this.emit('input-sent', {
      sessionId,
      input,
      timestamp: new Date(),
    });

    this.logger.debug(`Sent input to Terraform session ${sessionId}: ${input.substring(0, 100)}`);
  }

  async closeSession(sessionId: string): Promise<void> {
    try {
      const terraformProcess = this.terraformProcesses.get(sessionId);
      if (terraformProcess) {
        // Try graceful shutdown first
        terraformProcess.kill('SIGTERM');

        // Force kill after timeout (longer for Terraform operations)
        setTimeout(() => {
          if (terraformProcess && !terraformProcess.killed) {
            terraformProcess.kill('SIGKILL');
          }
        }, 15000);

        this.terraformProcesses.delete(sessionId);
      }

      // Clean up base protocol session
      this.sessions.delete(sessionId);

      this.logger.info(`Terraform session ${sessionId} closed`);
      this.emit('session-closed', sessionId);
    } catch (error) {
      this.logger.error(`Error closing Terraform session ${sessionId}:`, error);
      throw error;
    }
  }

  async doCreateSession(sessionId: string, options: SessionOptions, sessionState: SessionState): Promise<ConsoleSession> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const terraformOptions = options as TerraformConnectionOptions;

    // Build Terraform command
    const terraformCommand = this.buildTerraformCommand(terraformOptions);

    // Spawn Terraform process
    const terraformProcess = spawn(terraformCommand[0], terraformCommand.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: options.cwd || terraformOptions.workingDir || process.cwd(),
      env: { ...process.env, ...this.buildEnvironment(terraformOptions), ...options.env }
    });

    // Set up output handling
    terraformProcess.stdout?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stdout',
        data: data.toString(),
        timestamp: new Date()
      };
      this.addToOutputBuffer(sessionId, output);
    });

    terraformProcess.stderr?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stderr',
        data: data.toString(),
        timestamp: new Date()
      };
      this.addToOutputBuffer(sessionId, output);
    });

    terraformProcess.on('error', (error) => {
      this.logger.error(`Terraform process error for session ${sessionId}:`, error);
      this.emit('session-error', { sessionId, error });
    });

    terraformProcess.on('close', (code) => {
      this.logger.info(`Terraform process closed for session ${sessionId} with code ${code}`);
      this.markSessionComplete(sessionId, code || 0);
    });

    // Store the process
    this.terraformProcesses.set(sessionId, terraformProcess);

    // Create session object
    const session: ConsoleSession = {
      id: sessionId,
      command: terraformCommand[0],
      args: terraformCommand.slice(1),
      cwd: options.cwd || terraformOptions.workingDir || process.cwd(),
      env: { ...process.env, ...this.buildEnvironment(terraformOptions), ...options.env },
      createdAt: new Date(),
      lastActivity: new Date(),
      status: 'running',
      type: this.type,
      streaming: options.streaming,
      executionState: 'idle',
      activeCommands: new Map(),
      pid: terraformProcess.pid
    };

    this.sessions.set(sessionId, session);

    this.logger.info(`Terraform session ${sessionId} created for ${terraformOptions.configFile || terraformOptions.workingDir || 'Terraform project'}`);
    this.emit('session-created', { sessionId, type: 'terraform', session });

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
      isOneShot: true, // Terraform commands are typically one-shot
      isPersistent: false,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      pid: session.pid,
      metadata: {}
    };
  }

  async handleError(error: Error, context: ErrorContext): Promise<ErrorRecoveryResult> {
    this.logger.error(`Error in Terraform session ${context.sessionId}: ${error.message}`);

    return {
      recovered: false,
      strategy: 'none',
      attempts: 0,
      duration: 0,
      error: error.message
    };
  }

  async recoverSession(sessionId: string): Promise<boolean> {
    const terraformProcess = this.terraformProcesses.get(sessionId);
    return terraformProcess && !terraformProcess.killed || false;
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
        connectionsActive: this.terraformProcesses.size
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
      await this.checkTerraformAvailability();
      return {
        ...baseStatus,
        dependencies: {
          terraform: { available: true }
        }
      };
    } catch (error) {
      return {
        ...baseStatus,
        isHealthy: false,
        errors: [...baseStatus.errors, `Terraform not available: ${error}`],
        dependencies: {
          terraform: { available: false }
        }
      };
    }
  }

  private async checkTerraformAvailability(): Promise<void> {
    return new Promise((resolve, reject) => {
      const testProcess = spawn('terraform', ['version'], { stdio: 'pipe' });

      testProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error('Terraform CLI not found. Please install Terraform.'));
        }
      });

      testProcess.on('error', () => {
        reject(new Error('Terraform CLI not found. Please install Terraform.'));
      });
    });
  }

  private buildTerraformCommand(options: TerraformConnectionOptions): string[] {
    const command = [];

    // Terraform executable
    if (options.terraformPath) {
      command.push(options.terraformPath);
    } else {
      command.push('terraform');
    }

    // Determine Terraform subcommand based on options
    if (options.destroyMode) {
      command.push('destroy');
    } else if (options.importMode && options.importAddress && options.importId) {
      command.push('import');
      command.push(options.importAddress);
      command.push(options.importId);
      return command;
    } else if (options.enableGraph) {
      command.push('graph');
      if (options.graphType) {
        command.push('-type', options.graphType);
      }
    } else if (options.dryRun) {
      command.push('plan');
    } else {
      // Default to plan for safety
      command.push('plan');
    }

    // Configuration file
    if (options.configFile) {
      command.push('-chdir', options.configFile);
    }

    // Variable files
    if (options.varFile) {
      for (const varFile of options.varFile) {
        command.push('-var-file', varFile);
      }
    }

    // Variables
    if (options.variables) {
      for (const [key, value] of Object.entries(options.variables)) {
        command.push('-var', `${key}=${value}`);
      }
    }

    // State file
    if (options.stateFile) {
      command.push('-state', options.stateFile);
    }

    // Backend configuration
    if (options.backendConfig) {
      for (const [key, value] of Object.entries(options.backendConfig)) {
        command.push('-backend-config', `${key}=${value}`);
      }
    }

    // Parallelism
    if (options.parallelism) {
      command.push('-parallelism', options.parallelism.toString());
    }

    // Auto approve for apply/destroy
    if (options.autoApprove && (command.includes('apply') || command.includes('destroy'))) {
      command.push('-auto-approve');
    }

    // Target resources
    if (options.target) {
      for (const target of options.target) {
        command.push('-target', target);
      }
    }

    // Replace resources
    if (options.replace) {
      for (const replace of options.replace) {
        command.push('-replace', replace);
      }
    }

    // Refresh option
    if (options.enableRefresh === false) {
      command.push('-refresh=false');
    }

    // Application arguments
    if (options.args) {
      command.push(...options.args);
    }

    return command;
  }

  private buildEnvironment(options: TerraformConnectionOptions): Record<string, string> {
    const env: Record<string, string> = {};

    // Terraform logging
    if (options.enableLogging) {
      env.TF_LOG = options.logLevel || 'INFO';
      env.TF_LOG_PATH = './terraform.log';
    }

    // Workspace
    if (options.workspace) {
      env.TF_WORKSPACE = options.workspace;
    }

    // Cloud provider credentials
    if (options.cloudProvider === 'aws') {
      if (options.credentialsFile) {
        env.AWS_SHARED_CREDENTIALS_FILE = options.credentialsFile;
      }
    } else if (options.cloudProvider === 'azure') {
      if (options.credentialsFile) {
        env.AZURE_CLIENT_CERTIFICATE_PATH = options.credentialsFile;
      }
    } else if (options.cloudProvider === 'gcp') {
      if (options.credentialsFile) {
        env.GOOGLE_APPLICATION_CREDENTIALS = options.credentialsFile;
      }
    }

    // Plugin cache
    env.TF_PLUGIN_CACHE_DIR = process.env.TF_PLUGIN_CACHE_DIR || '~/.terraform.d/plugin-cache';

    // Disable telemetry for CI environments
    env.CHECKPOINT_DISABLE = '1';

    // Enable CLI UI
    env.TF_CLI_ARGS = '-no-color';

    // Input handling
    env.TF_INPUT = '0';

    // Custom environment variables
    if (options.environment) {
      Object.assign(env, options.environment);
    }

    return env;
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up Terraform protocol');

    // Close all Terraform processes
    for (const [sessionId, process] of Array.from(this.terraformProcesses)) {
      try {
        process.kill();
      } catch (error) {
        this.logger.error(`Error killing Terraform process for session ${sessionId}:`, error);
      }
    }

    // Clear all data
    this.terraformProcesses.clear();

    // Call parent cleanup
    await super.cleanup();
  }
}

export default TerraformProtocol;