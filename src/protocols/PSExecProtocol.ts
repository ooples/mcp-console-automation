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

// PSExec Protocol connection options
interface PSExecConnectionOptions extends SessionOptions {
  hostname: string;
  username?: string;
  password?: string;
  domain?: string;
  acceptEula?: boolean;
  copyToRemote?: boolean;
  runInteractive?: boolean;
  runAsSystem?: boolean;
  runAsCurrentUser?: boolean;
  runWithProfile?: boolean;
  runLowPrivilege?: boolean;
  runElevated?: boolean;
  workingDirectory?: string;
  remoteDirectory?: string;
  priority?: 'low' | 'belownormal' | 'normal' | 'abovenormal' | 'high' | 'realtime';
  affinity?: number;
  timeout?: number;
  waitForExit?: boolean;
  hideWindow?: boolean;
  noLogo?: boolean;
  verbose?: boolean;
  copyExclude?: string[];
  copyInclude?: string[];
  serviceAccount?: string;
  servicePassword?: string;
  sessionId?: number;
  enableSSL?: boolean;
  port?: number;
  ipVersion?: 'v4' | 'v6' | 'auto';
  connectionRetries?: number;
  retryDelay?: number;
  enableDebug?: boolean;
  logLevel?: 'quiet' | 'normal' | 'verbose' | 'debug';
  environment?: Record<string, string>;
  inputFile?: string;
  outputFile?: string;
  errorFile?: string;
  processName?: string;
  killOnTimeout?: boolean;
  forceKill?: boolean;
  createNoWindow?: boolean;
  useCredSSP?: boolean;
  useKerberos?: boolean;
  useNTLM?: boolean;
  encryptionLevel?: 'none' | 'low' | 'high' | 'fips';
  compressionLevel?: number;
  bufferSize?: number;
  enableKeepAlive?: boolean;
  keepAliveInterval?: number;
  maxConnectionAttempts?: number;
  connectionTimeout?: number;
  executionTimeout?: number;
  enableAuditing?: boolean;
  auditLogPath?: string;
  enableEventLog?: boolean;
  eventLogSource?: string;
  enableWMI?: boolean;
  wmiNamespace?: string;
  enablePowerShell?: boolean;
  powerShellVersion?: string;
  runspace?: string;
  enableClr?: boolean;
  clrVersion?: string;
  assemblies?: string[];
  modules?: string[];
  snapins?: string[];
  enableProxy?: boolean;
  proxyServer?: string;
  proxyPort?: number;
  proxyUsername?: string;
  proxyPassword?: string;
  enableFirewall?: boolean;
  firewallProfile?: 'domain' | 'private' | 'public' | 'all';
  customPSExecPath?: string;
  customFlags?: string[];
}

/**
 * PSExec Protocol Implementation
 *
 * Provides PSExec remote execution capabilities for Windows and cross-platform systems
 * Supports comprehensive PSExec functionality including remote command execution,
 * file copying, service management, system administration, and enterprise security features
 */
export class PSExecProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'psexec';
  public readonly capabilities: ProtocolCapabilities;

  private psexecProcesses = new Map<string, ChildProcess>();

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
    super('psexec');

    this.capabilities = {
      supportsStreaming: true,
      supportsFileTransfer: true,
      supportsX11Forwarding: false,
      supportsPortForwarding: false,
      supportsAuthentication: true,
      supportsEncryption: true,
      supportsCompression: true,
      supportsMultiplexing: false,
      supportsKeepAlive: true,
      supportsReconnection: true,
      supportsBinaryData: true,
      supportsCustomEnvironment: true,
      supportsWorkingDirectory: true,
      supportsSignals: true,
      supportsResizing: false,
      supportsPTY: false,
      maxConcurrentSessions: 10, // PSExec can handle multiple remote sessions
      defaultTimeout: 120000, // Remote operations can take longer
      supportedEncodings: ['utf-8', 'utf-16', 'ascii'],
      supportedAuthMethods: ['ntlm', 'kerberos', 'credSSP'],
      platformSupport: {
        windows: true, // Primary PSExec platform
        linux: true, // Via Wine or alternatives
        macos: true, // Via Wine or alternatives
        freebsd: true
      }
    };
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Check if PSExec is available
      await this.checkPSExecAvailability();
      this.isInitialized = true;
      this.logger.info('PSExec protocol initialized with enterprise features');
    } catch (error: any) {
      this.logger.error('Failed to initialize PSExec protocol', error);
      throw error;
    }
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const sessionId = `psexec-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    return await this.createSessionWithTypeDetection(sessionId, options);
  }

  async dispose(): Promise<void> {
    await this.cleanup();
  }

  async executeCommand(sessionId: string, command: string, args?: string[]): Promise<void> {
    const fullCommand = args && args.length > 0 ? `${command} ${args.join(' ')}` : command;
    await this.sendInput(sessionId, fullCommand + '\r\n');
  }

  async sendInput(sessionId: string, input: string): Promise<void> {
    const psexecProcess = this.psexecProcesses.get(sessionId);
    const session = this.sessions.get(sessionId);

    if (!psexecProcess || !psexecProcess.stdin || !session) {
      throw new Error(`No active PSExec session: ${sessionId}`);
    }

    psexecProcess.stdin.write(input);
    session.lastActivity = new Date();

    this.emit('input-sent', {
      sessionId,
      input,
      timestamp: new Date(),
    });

    this.logger.debug(`Sent input to PSExec session ${sessionId}: ${input.substring(0, 100)}`);
  }

  async closeSession(sessionId: string): Promise<void> {
    try {
      const psexecProcess = this.psexecProcesses.get(sessionId);
      if (psexecProcess) {
        // Try graceful shutdown first
        psexecProcess.kill('SIGTERM');

        // Force kill after timeout
        setTimeout(() => {
          if (psexecProcess && !psexecProcess.killed) {
            psexecProcess.kill('SIGKILL');
          }
        }, 10000);

        this.psexecProcesses.delete(sessionId);
      }

      // Clean up base protocol session
      this.sessions.delete(sessionId);

      this.logger.info(`PSExec session ${sessionId} closed`);
      this.emit('session-closed', sessionId);
    } catch (error) {
      this.logger.error(`Error closing PSExec session ${sessionId}:`, error);
      throw error;
    }
  }

  async doCreateSession(sessionId: string, options: SessionOptions, sessionState: SessionState): Promise<ConsoleSession> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const psexecOptions = options as PSExecConnectionOptions;

    // Validate required PSExec parameters
    if (!psexecOptions.hostname) {
      throw new Error('Hostname is required for PSExec protocol');
    }

    // Build PSExec command
    const psexecCommand = this.buildPSExecCommand(psexecOptions);

    // Spawn PSExec process
    const psexecProcess = spawn(psexecCommand[0], psexecCommand.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...this.buildEnvironment(psexecOptions), ...options.env }
    });

    // Set up output handling
    psexecProcess.stdout?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stdout',
        data: data.toString(),
        timestamp: new Date()
      };
      this.addToOutputBuffer(sessionId, output);
    });

    psexecProcess.stderr?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stderr',
        data: data.toString(),
        timestamp: new Date()
      };
      this.addToOutputBuffer(sessionId, output);
    });

    psexecProcess.on('error', (error) => {
      this.logger.error(`PSExec process error for session ${sessionId}:`, error);
      this.emit('session-error', { sessionId, error });
    });

    psexecProcess.on('close', (code) => {
      this.logger.info(`PSExec process closed for session ${sessionId} with code ${code}`);
      this.markSessionComplete(sessionId, code || 0);
    });

    // Store the process
    this.psexecProcesses.set(sessionId, psexecProcess);

    // Create session object
    const session: ConsoleSession = {
      id: sessionId,
      command: psexecCommand[0],
      args: psexecCommand.slice(1),
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...this.buildEnvironment(psexecOptions), ...options.env },
      createdAt: new Date(),
      lastActivity: new Date(),
      status: 'running',
      type: this.type,
      streaming: options.streaming,
      executionState: 'idle',
      activeCommands: new Map(),
      pid: psexecProcess.pid
    };

    this.sessions.set(sessionId, session);

    this.logger.info(`PSExec session ${sessionId} created for host ${psexecOptions.hostname}`);
    this.emit('session-created', { sessionId, type: 'psexec', session });

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
      isOneShot: false, // PSExec sessions can be persistent for interactive use
      isPersistent: true,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      pid: session.pid,
      metadata: {}
    };
  }

  async handleError(error: Error, context: ErrorContext): Promise<ErrorRecoveryResult> {
    this.logger.error(`Error in PSExec session ${context.sessionId}: ${error.message}`);

    return {
      recovered: false,
      strategy: 'none',
      attempts: 0,
      duration: 0,
      error: error.message
    };
  }

  async recoverSession(sessionId: string): Promise<boolean> {
    const psexecProcess = this.psexecProcesses.get(sessionId);
    return psexecProcess && !psexecProcess.killed || false;
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
        connectionsActive: this.psexecProcesses.size
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
      await this.checkPSExecAvailability();
      return {
        ...baseStatus,
        dependencies: {
          psexec: { available: true }
        }
      };
    } catch (error) {
      return {
        ...baseStatus,
        isHealthy: false,
        errors: [...baseStatus.errors, `PSExec not available: ${error}`],
        dependencies: {
          psexec: { available: false }
        }
      };
    }
  }

  private async checkPSExecAvailability(): Promise<void> {
    return new Promise((resolve, reject) => {
      const testProcess = spawn('psexec', ['/accepteula', '-h'], { stdio: 'pipe' });

      testProcess.on('close', (code) => {
        if (code === 0 || code === 1) { // PSExec returns 1 for help
          resolve();
        } else {
          reject(new Error('PSExec tool not found. Please install PsTools from Microsoft Sysinternals.'));
        }
      });

      testProcess.on('error', () => {
        reject(new Error('PSExec tool not found. Please install PsTools from Microsoft Sysinternals.'));
      });
    });
  }

  private buildPSExecCommand(options: PSExecConnectionOptions): string[] {
    const command = [];

    // PSExec executable
    if (options.customPSExecPath) {
      command.push(options.customPSExecPath);
    } else {
      command.push('psexec');
    }

    // Accept EULA automatically
    if (options.acceptEula !== false) {
      command.push('/accepteula');
    }

    // Target hostname
    command.push(`\\\\${options.hostname}`);

    // Authentication
    if (options.username) {
      command.push('-u', options.username);
    }

    if (options.password) {
      command.push('-p', options.password);
    }

    if (options.domain) {
      command.push('-d', options.domain);
    }

    // Execution options
    if (options.runInteractive) {
      command.push('-i');
      if (options.sessionId !== undefined) {
        command.push('-i', options.sessionId.toString());
      }
    }

    if (options.runAsSystem) {
      command.push('-s');
    }

    if (options.runAsCurrentUser) {
      command.push('-e');
    }

    if (options.runWithProfile) {
      command.push('-l');
    }

    if (options.runLowPrivilege) {
      command.push('-x');
    }

    if (options.runElevated) {
      command.push('-h');
    }

    // Working directory
    if (options.workingDirectory) {
      command.push('-w', options.workingDirectory);
    }

    // Process priority
    if (options.priority) {
      const priorityMap = {
        'low': '-low',
        'belownormal': '-belownormal',
        'normal': '-normal',
        'abovenormal': '-abovenormal',
        'high': '-high',
        'realtime': '-realtime'
      };
      command.push(priorityMap[options.priority]);
    }

    // Processor affinity
    if (options.affinity !== undefined) {
      command.push('-a', options.affinity.toString());
    }

    // Copy options
    if (options.copyToRemote) {
      command.push('-c');
    }

    if (options.copyExclude && options.copyExclude.length > 0) {
      command.push('-csrc', options.copyExclude.join(','));
    }

    if (options.copyInclude && options.copyInclude.length > 0) {
      command.push('-clist', options.copyInclude.join(','));
    }

    // File redirection
    if (options.inputFile) {
      command.push('<', options.inputFile);
    }

    if (options.outputFile) {
      command.push('>', options.outputFile);
    }

    if (options.errorFile) {
      command.push('2>', options.errorFile);
    }

    // Timeout
    if (options.timeout) {
      command.push('-n', options.timeout.toString());
    }

    // Service account
    if (options.serviceAccount) {
      command.push('-r', options.serviceAccount);
      if (options.servicePassword) {
        command.push('-rp', options.servicePassword);
      }
    }

    // SSL/TLS
    if (options.enableSSL) {
      command.push('-encrypt');
    }

    // Port
    if (options.port) {
      command.push('-port', options.port.toString());
    }

    // IP version
    if (options.ipVersion === 'v4') {
      command.push('-4');
    } else if (options.ipVersion === 'v6') {
      command.push('-6');
    }

    // Authentication protocols
    if (options.useCredSSP) {
      command.push('-credssp');
    }

    if (options.useKerberos) {
      command.push('-k');
    }

    if (options.useNTLM) {
      command.push('-ntlm');
    }

    // Window options
    if (options.hideWindow) {
      command.push('-b');
    }

    if (options.createNoWindow) {
      command.push('-nowindow');
    }

    // Verbosity
    if (options.verbose) {
      command.push('-v');
    }

    if (options.noLogo) {
      command.push('-nologo');
    }

    // Debug options
    if (options.enableDebug) {
      command.push('-debug');
    }

    // Process management
    if (options.waitForExit) {
      command.push('-w');
    }

    if (options.killOnTimeout) {
      command.push('-k');
    }

    if (options.forceKill) {
      command.push('-f');
    }

    // PowerShell integration
    if (options.enablePowerShell) {
      command.push('-powershell');
      if (options.powerShellVersion) {
        command.push('-psversion', options.powerShellVersion);
      }
    }

    // CLR integration
    if (options.enableClr) {
      command.push('-clr');
      if (options.clrVersion) {
        command.push('-clrversion', options.clrVersion);
      }
    }

    // WMI integration
    if (options.enableWMI) {
      command.push('-wmi');
      if (options.wmiNamespace) {
        command.push('-wminamespace', options.wmiNamespace);
      }
    }

    // Proxy settings
    if (options.enableProxy && options.proxyServer) {
      command.push('-proxy', `${options.proxyServer}:${options.proxyPort || 8080}`);
      if (options.proxyUsername) {
        command.push('-proxyuser', options.proxyUsername);
        if (options.proxyPassword) {
          command.push('-proxypass', options.proxyPassword);
        }
      }
    }

    // Custom flags
    if (options.customFlags && options.customFlags.length > 0) {
      command.push(...options.customFlags);
    }

    // Command and arguments
    if (options.command) {
      command.push(options.command);
    }

    if (options.args) {
      command.push(...options.args);
    }

    return command;
  }

  private buildEnvironment(options: PSExecConnectionOptions): Record<string, string> {
    const env: Record<string, string> = {};

    // PSExec environment variables
    if (options.timeout) {
      env.PSEXEC_TIMEOUT = options.timeout.toString();
    }

    if (options.connectionRetries) {
      env.PSEXEC_RETRIES = options.connectionRetries.toString();
    }

    if (options.retryDelay) {
      env.PSEXEC_RETRY_DELAY = options.retryDelay.toString();
    }

    // Logging and debugging
    if (options.logLevel) {
      env.PSEXEC_LOG_LEVEL = options.logLevel;
    }

    if (options.enableDebug) {
      env.PSEXEC_DEBUG = '1';
    }

    if (options.enableAuditing && options.auditLogPath) {
      env.PSEXEC_AUDIT_LOG = options.auditLogPath;
    }

    if (options.enableEventLog) {
      env.PSEXEC_EVENT_LOG = '1';
      if (options.eventLogSource) {
        env.PSEXEC_EVENT_SOURCE = options.eventLogSource;
      }
    }

    // Security settings
    if (options.encryptionLevel) {
      env.PSEXEC_ENCRYPTION = options.encryptionLevel;
    }

    if (options.compressionLevel !== undefined) {
      env.PSEXEC_COMPRESSION = options.compressionLevel.toString();
    }

    // Network settings
    if (options.bufferSize) {
      env.PSEXEC_BUFFER_SIZE = options.bufferSize.toString();
    }

    if (options.enableKeepAlive) {
      env.PSEXEC_KEEP_ALIVE = '1';
      if (options.keepAliveInterval) {
        env.PSEXEC_KEEP_ALIVE_INTERVAL = options.keepAliveInterval.toString();
      }
    }

    if (options.maxConnectionAttempts) {
      env.PSEXEC_MAX_ATTEMPTS = options.maxConnectionAttempts.toString();
    }

    if (options.connectionTimeout) {
      env.PSEXEC_CONNECT_TIMEOUT = options.connectionTimeout.toString();
    }

    if (options.executionTimeout) {
      env.PSEXEC_EXEC_TIMEOUT = options.executionTimeout.toString();
    }

    // PowerShell settings
    if (options.enablePowerShell) {
      env.PSEXEC_POWERSHELL = '1';
      if (options.runspace) {
        env.PSEXEC_RUNSPACE = options.runspace;
      }
    }

    // Module and assembly loading
    if (options.modules && options.modules.length > 0) {
      env.PSEXEC_MODULES = options.modules.join(';');
    }

    if (options.assemblies && options.assemblies.length > 0) {
      env.PSEXEC_ASSEMBLIES = options.assemblies.join(';');
    }

    if (options.snapins && options.snapins.length > 0) {
      env.PSEXEC_SNAPINS = options.snapins.join(';');
    }

    // Firewall settings
    if (options.enableFirewall) {
      env.PSEXEC_FIREWALL = '1';
      if (options.firewallProfile) {
        env.PSEXEC_FIREWALL_PROFILE = options.firewallProfile;
      }
    }

    // Custom environment variables
    if (options.environment) {
      Object.assign(env, options.environment);
    }

    return env;
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up PSExec protocol');

    // Close all PSExec processes
    for (const [sessionId, process] of Array.from(this.psexecProcesses)) {
      try {
        process.kill();
      } catch (error) {
        this.logger.error(`Error killing PSExec process for session ${sessionId}:`, error);
      }
    }

    // Clear all data
    this.psexecProcesses.clear();

    // Call parent cleanup
    await super.cleanup();
  }
}

export default PSExecProtocol;