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

// PowerShell Direct Protocol connection options
interface PowerShellDirectConnectionOptions extends SessionOptions {
  vmName?: string;
  vmId?: string;
  containerName?: string;
  containerId?: string;
  credential?: {
    username: string;
    password?: string;
    domain?: string;
    useSecureString?: boolean;
  };
  sessionType?: 'vm' | 'container' | 'local';
  configurationName?: string;
  applicationName?: string;
  connectionUri?: string;
  enableNetworkAccess?: boolean;
  sessionOption?: {
    culture?: string;
    uiCulture?: string;
    maximumRedirection?: number;
    noCompression?: boolean;
    noEncryption?: boolean;
    operationTimeout?: number;
    outputBufferingMode?: 'none' | 'block' | 'drop';
    proxyAccessType?: 'none' | 'default' | 'proxy' | 'direct';
    proxyAuthentication?: string;
    proxyCredential?: any;
    skipCACheck?: boolean;
    skipCNCheck?: boolean;
    skipRevocationCheck?: boolean;
    useUTF16?: boolean;
  };
  executionPolicy?: 'restricted' | 'allsigned' | 'remotesigned' | 'unrestricted' | 'bypass' | 'undefined';
  psVersion?: string;
  useProfile?: boolean;
  noLogo?: boolean;
  noExit?: boolean;
  sta?: boolean;
  mta?: boolean;
  inputFormat?: 'text' | 'xml';
  outputFormat?: 'text' | 'xml';
  windowStyle?: 'normal' | 'minimized' | 'maximized' | 'hidden';
  encodedCommand?: boolean;
  file?: string;
  psConsoleFile?: string;
  version?: string;
  workingDirectory?: string;
  nonInteractive?: boolean;
  runAs32?: boolean;
  enableRemoting?: boolean;
  trustedHosts?: string[];
  enableCredSSP?: boolean;
  maxConcurrentOps?: number;
  maxConnections?: number;
  maxIdleTimeout?: number;
  maxMemory?: number;
  maxProcesses?: number;
  maxShells?: number;
  maxShellsPerUser?: number;
  shellTimeout?: number;
  idleTimeout?: number;
  allowRedirection?: boolean;
  enableCredentialDelegation?: boolean;
  enableNetCredential?: boolean;
  certificateThumbprint?: string;
  port?: number;
  useSSL?: boolean;
  sessionName?: string;
  computerName?: string;
  enableExitCode?: boolean;
  logLevel?: 'error' | 'warning' | 'information' | 'verbose' | 'debug';
  transcriptPath?: string;
  enableTranscription?: boolean;
  enableLogging?: boolean;
  enableScriptBlockLogging?: boolean;
  enableModuleLogging?: string[];
  enableConstrainedLanguage?: boolean;
  enableRemoteSignedPolicy?: boolean;
  enableDeepRemoting?: boolean;
  enableJEA?: boolean; // Just Enough Administration
  jeaConfigurationName?: string;
  runspacePool?: boolean;
  enableRunspaceDebug?: boolean;
  enableSteppablePipeline?: boolean;
  enableJobTracking?: boolean;
  enableEventLog?: boolean;
  eventLogSource?: string;
  enablePSReadLine?: boolean;
  psReadLineOptions?: any;
  enableHistory?: boolean;
  historyPath?: string;
  enableModuleAutoLoad?: boolean;
  enableStrictMode?: boolean;
  strictModeVersion?: string;
  enableVerbosePreference?: boolean;
  enableDebugPreference?: boolean;
  enableProgressPreference?: boolean;
  enableWarningPreference?: boolean;
  enableErrorActionPreference?: string;
  enableInformationPreference?: boolean;
  psModulePath?: string[];
  psScriptRoot?: string;
  psCommandPath?: string;
  enableAliases?: boolean;
  enableFunctions?: boolean;
  enableVariables?: boolean;
  enableCmdletBinding?: boolean;
  enableAdvancedFunctions?: boolean;
  enableWMI?: boolean;
  enableCIM?: boolean;
  enableDSC?: boolean; // Desired State Configuration
  dscConfiguration?: string;
  enableRemoteRegistry?: boolean;
  enableEventViewer?: boolean;
  enablePerformanceCounters?: boolean;
  enableServicesAccess?: boolean;
  enableProcessAccess?: boolean;
  enableFileSystemAccess?: boolean;
  enableRegistryAccess?: boolean;
  environment?: Record<string, string>;
}

/**
 * PowerShell Direct Protocol Implementation
 *
 * Provides PowerShell Direct access for Hyper-V VMs and Windows containers through Enter-PSSession
 * Supports VM/container sessions, credential management, remoting configuration, and enterprise PowerShell features
 */
export class PowerShellDirectProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'powershelldirect';
  public readonly capabilities: ProtocolCapabilities;

  private powerShellProcesses = new Map<string, ChildProcess>();
  private psDSessionStates = new Map<string, any>();

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
    super('powershelldirect');

    this.capabilities = {
      supportsStreaming: true,
      supportsFileTransfer: true,
      supportsX11Forwarding: false,
      supportsPortForwarding: false,
      supportsAuthentication: true,
      supportsEncryption: true,
      supportsCompression: true,
      supportsMultiplexing: true,
      supportsKeepAlive: true,
      supportsReconnection: true,
      supportsBinaryData: true,
      supportsCustomEnvironment: true,
      supportsWorkingDirectory: true,
      supportsSignals: false,
      supportsResizing: false,
      supportsPTY: false,
      maxConcurrentSessions: 32, // PowerShell Direct session limit
      defaultTimeout: 60000, // Remote operations can take time
      supportedEncodings: ['utf-8', 'utf-16'],
      supportedAuthMethods: ['password', 'certificate', 'kerberos', 'credential'],
      platformSupport: {
        windows: true, // PowerShell Direct is Windows-specific
        linux: false,
        macos: false,
        freebsd: false
      }
    };
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Check if PowerShell and Hyper-V are available
      await this.checkPowerShellDirectAvailability();
      this.isInitialized = true;
      this.logger.info('PowerShell Direct protocol initialized with production features');
    } catch (error: any) {
      this.logger.error('Failed to initialize PowerShell Direct protocol', error);
      throw error;
    }
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const sessionId = `psdirect-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
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
    const powerShellProcess = this.powerShellProcesses.get(sessionId);
    const session = this.sessions.get(sessionId);

    if (!powerShellProcess || !powerShellProcess.stdin || !session) {
      throw new Error(`No active PowerShell Direct session: ${sessionId}`);
    }

    powerShellProcess.stdin.write(input);
    session.lastActivity = new Date();

    this.emit('input-sent', {
      sessionId,
      input,
      timestamp: new Date(),
    });

    this.logger.debug(`Sent input to PowerShell Direct session ${sessionId}: ${input.substring(0, 100)}`);
  }

  async closeSession(sessionId: string): Promise<void> {
    try {
      const powerShellProcess = this.powerShellProcesses.get(sessionId);
      if (powerShellProcess) {
        // Send exit command first for graceful shutdown
        if (powerShellProcess.stdin && !powerShellProcess.stdin.destroyed) {
          powerShellProcess.stdin.write('exit\n');
        }

        // Wait a bit then force close
        setTimeout(() => {
          if (powerShellProcess && !powerShellProcess.killed) {
            powerShellProcess.kill('SIGTERM');
          }
        }, 3000);

        this.powerShellProcesses.delete(sessionId);
      }

      // Clean up session state if exists
      const sessionState = this.psDSessionStates.get(sessionId);
      if (sessionState) {
        this.psDSessionStates.delete(sessionId);
      }

      // Clean up base protocol session
      this.sessions.delete(sessionId);

      this.logger.info(`PowerShell Direct session ${sessionId} closed`);
      this.emit('session-closed', sessionId);
    } catch (error) {
      this.logger.error(`Error closing PowerShell Direct session ${sessionId}:`, error);
      throw error;
    }
  }

  async doCreateSession(sessionId: string, options: SessionOptions, sessionState: SessionState): Promise<ConsoleSession> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const psDirectOptions = options as PowerShellDirectConnectionOptions;

    // Validate required parameters based on session type
    if (psDirectOptions.sessionType === 'vm' && !psDirectOptions.vmName && !psDirectOptions.vmId) {
      throw new Error('VM name or ID is required for PowerShell Direct VM sessions');
    }
    if (psDirectOptions.sessionType === 'container' && !psDirectOptions.containerName && !psDirectOptions.containerId) {
      throw new Error('Container name or ID is required for PowerShell Direct container sessions');
    }

    // Build PowerShell Direct command
    const psDirectCommand = this.buildPowerShellDirectCommand(psDirectOptions);

    // Spawn PowerShell Direct process
    const powerShellProcess = spawn(psDirectCommand[0], psDirectCommand.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...this.buildEnvironment(psDirectOptions), ...options.env }
    });

    // Set up output handling
    powerShellProcess.stdout?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stdout',
        data: data.toString(),
        timestamp: new Date()
      };
      this.addToOutputBuffer(sessionId, output);
    });

    powerShellProcess.stderr?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stderr',
        data: data.toString(),
        timestamp: new Date()
      };
      this.addToOutputBuffer(sessionId, output);
    });

    powerShellProcess.on('error', (error) => {
      this.logger.error(`PowerShell Direct process error for session ${sessionId}:`, error);
      this.emit('session-error', { sessionId, error });
    });

    powerShellProcess.on('close', (code) => {
      this.logger.info(`PowerShell Direct process closed for session ${sessionId} with code ${code}`);
      this.markSessionComplete(sessionId, code || 0);
    });

    // Store the process
    this.powerShellProcesses.set(sessionId, powerShellProcess);

    // Create session object
    const session: ConsoleSession = {
      id: sessionId,
      command: psDirectCommand[0],
      args: psDirectCommand.slice(1),
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...this.buildEnvironment(psDirectOptions), ...options.env },
      createdAt: new Date(),
      lastActivity: new Date(),
      status: 'running',
      type: this.type,
      streaming: options.streaming,
      executionState: 'idle',
      activeCommands: new Map(),
      pid: powerShellProcess.pid
    };

    this.sessions.set(sessionId, session);

    const target = psDirectOptions.vmName || psDirectOptions.containerName || 'local';
    this.logger.info(`PowerShell Direct session ${sessionId} created for ${target}`);
    this.emit('session-created', { sessionId, type: 'powershelldirect', session });

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
      isOneShot: false, // PowerShell Direct sessions are typically persistent
      isPersistent: true,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      pid: session.pid,
      metadata: {}
    };
  }

  async handleError(error: Error, context: ErrorContext): Promise<ErrorRecoveryResult> {
    this.logger.error(`Error in PowerShell Direct session ${context.sessionId}: ${error.message}`);

    return {
      recovered: false,
      strategy: 'none',
      attempts: 0,
      duration: 0,
      error: error.message
    };
  }

  async recoverSession(sessionId: string): Promise<boolean> {
    const powerShellProcess = this.powerShellProcesses.get(sessionId);
    return powerShellProcess && !powerShellProcess.killed || false;
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
        connectionsActive: this.powerShellProcesses.size
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
      await this.checkPowerShellDirectAvailability();
      return {
        ...baseStatus,
        dependencies: {
          powershell: { available: true },
          hyperv: { available: true }
        }
      };
    } catch (error) {
      return {
        ...baseStatus,
        isHealthy: false,
        errors: [...baseStatus.errors, `PowerShell Direct not available: ${error}`],
        dependencies: {
          powershell: { available: false },
          hyperv: { available: false }
        }
      };
    }
  }

  private async checkPowerShellDirectAvailability(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Check PowerShell availability first
      const testProcess = spawn('powershell', ['-Command', 'Get-Command Enter-PSSession'], { stdio: 'pipe' });

      testProcess.on('close', (code) => {
        if (code === 0) {
          // Check Hyper-V availability
          const hvProcess = spawn('powershell', ['-Command', 'Get-WindowsFeature -Name Hyper-V'], { stdio: 'pipe' });

          hvProcess.on('close', (hvCode) => {
            if (hvCode === 0) {
              resolve();
            } else {
              reject(new Error('Hyper-V feature not available. PowerShell Direct requires Hyper-V.'));
            }
          });

          hvProcess.on('error', () => {
            reject(new Error('Unable to check Hyper-V availability.'));
          });
        } else {
          reject(new Error('PowerShell not found. Please install PowerShell.'));
        }
      });

      testProcess.on('error', () => {
        reject(new Error('PowerShell not found. Please install PowerShell.'));
      });
    });
  }

  private buildPowerShellDirectCommand(options: PowerShellDirectConnectionOptions): string[] {
    const command = [];

    // PowerShell executable
    command.push('powershell');

    // PowerShell execution policy
    if (options.executionPolicy) {
      command.push('-ExecutionPolicy', options.executionPolicy);
    }

    // Version
    if (options.psVersion) {
      command.push('-Version', options.psVersion);
    }

    // Profile settings
    if (options.useProfile === false) {
      command.push('-NoProfile');
    }

    // Logo settings
    if (options.noLogo) {
      command.push('-NoLogo');
    }

    // Exit settings
    if (options.noExit) {
      command.push('-NoExit');
    }

    // Threading model
    if (options.sta) {
      command.push('-Sta');
    } else if (options.mta) {
      command.push('-Mta');
    }

    // Input/Output format
    if (options.inputFormat) {
      command.push('-InputFormat', options.inputFormat);
    }

    if (options.outputFormat) {
      command.push('-OutputFormat', options.outputFormat);
    }

    // Window style
    if (options.windowStyle) {
      command.push('-WindowStyle', options.windowStyle);
    }

    // Non-interactive mode
    if (options.nonInteractive) {
      command.push('-NonInteractive');
    }

    // Working directory
    if (options.workingDirectory) {
      command.push('-WorkingDirectory', options.workingDirectory);
    }

    // Build the PowerShell Direct connection command
    command.push('-Command');

    let psCommand = '';

    // Session options
    if (options.sessionOption) {
      psCommand += `$sessionOption = New-PSSessionOption`;
      const sessionOpts = [];

      if (options.sessionOption.culture) {
        sessionOpts.push(`-Culture '${options.sessionOption.culture}'`);
      }
      if (options.sessionOption.uiCulture) {
        sessionOpts.push(`-UICulture '${options.sessionOption.uiCulture}'`);
      }
      if (options.sessionOption.maximumRedirection) {
        sessionOpts.push(`-MaximumRedirection ${options.sessionOption.maximumRedirection}`);
      }
      if (options.sessionOption.noCompression) {
        sessionOpts.push(`-NoCompression`);
      }
      if (options.sessionOption.noEncryption) {
        sessionOpts.push(`-NoEncryption`);
      }
      if (options.sessionOption.operationTimeout) {
        sessionOpts.push(`-OperationTimeout ${options.sessionOption.operationTimeout}`);
      }
      if (options.sessionOption.outputBufferingMode) {
        sessionOpts.push(`-OutputBufferingMode '${options.sessionOption.outputBufferingMode}'`);
      }
      if (options.sessionOption.skipCACheck) {
        sessionOpts.push(`-SkipCACheck`);
      }
      if (options.sessionOption.skipCNCheck) {
        sessionOpts.push(`-SkipCNCheck`);
      }
      if (options.sessionOption.skipRevocationCheck) {
        sessionOpts.push(`-SkipRevocationCheck`);
      }
      if (options.sessionOption.useUTF16) {
        sessionOpts.push(`-UseUTF16`);
      }

      if (sessionOpts.length > 0) {
        psCommand += ` ${sessionOpts.join(' ')};`;
      } else {
        psCommand += `;`;
      }
    }

    // Credential setup
    if (options.credential) {
      if (options.credential.useSecureString) {
        psCommand += `$securePassword = ConvertTo-SecureString '${options.credential.password}' -AsPlainText -Force;`;
        psCommand += `$credential = New-Object System.Management.Automation.PSCredential('${options.credential.username}', $securePassword);`;
      } else {
        psCommand += `$credential = Get-Credential;`;
      }
    }

    // Build Enter-PSSession command based on session type
    if (options.sessionType === 'vm') {
      psCommand += 'Enter-PSSession';

      if (options.vmName) {
        psCommand += ` -VMName '${options.vmName}'`;
      } else if (options.vmId) {
        psCommand += ` -VMId '${options.vmId}'`;
      }

      if (options.credential) {
        psCommand += ` -Credential $credential`;
      }

    } else if (options.sessionType === 'container') {
      psCommand += 'Enter-PSSession';

      if (options.containerName) {
        psCommand += ` -ContainerName '${options.containerName}'`;
      } else if (options.containerId) {
        psCommand += ` -ContainerId '${options.containerId}'`;
      }

      if (options.credential) {
        psCommand += ` -Credential $credential`;
      }

    } else {
      // Local session or remote session
      psCommand += 'Enter-PSSession';

      if (options.computerName) {
        psCommand += ` -ComputerName '${options.computerName}'`;
      }

      if (options.configurationName) {
        psCommand += ` -ConfigurationName '${options.configurationName}'`;
      }

      if (options.applicationName) {
        psCommand += ` -ApplicationName '${options.applicationName}'`;
      }

      if (options.connectionUri) {
        psCommand += ` -ConnectionUri '${options.connectionUri}'`;
      }

      if (options.credential) {
        psCommand += ` -Credential $credential`;
      }

      if (options.certificateThumbprint) {
        psCommand += ` -CertificateThumbprint '${options.certificateThumbprint}'`;
      }

      if (options.port) {
        psCommand += ` -Port ${options.port}`;
      }

      if (options.useSSL) {
        psCommand += ` -UseSSL`;
      }

      if (options.sessionName) {
        psCommand += ` -Name '${options.sessionName}'`;
      }

      if (options.enableNetworkAccess) {
        psCommand += ` -EnableNetworkAccess`;
      }
    }

    // Session options
    if (options.sessionOption) {
      psCommand += ` -SessionOption $sessionOption`;
    }

    // Add the PowerShell command
    command.push(psCommand);

    return command;
  }

  private buildEnvironment(options: PowerShellDirectConnectionOptions): Record<string, string> {
    const env: Record<string, string> = {};

    // PowerShell environment variables
    if (options.psModulePath) {
      env.PSModulePath = options.psModulePath.join(';');
    }

    if (options.psScriptRoot) {
      env.PSScriptRoot = options.psScriptRoot;
    }

    if (options.psCommandPath) {
      env.PSCommandPath = options.psCommandPath;
    }

    // Execution policy
    if (options.executionPolicy) {
      env.PSExecutionPolicyPreference = options.executionPolicy;
    }

    // Logging settings
    if (options.enableLogging && options.logLevel) {
      env.PS_LOG_LEVEL = options.logLevel;
    }

    if (options.transcriptPath) {
      env.PS_TRANSCRIPT_PATH = options.transcriptPath;
    }

    if (options.enableScriptBlockLogging) {
      env.PS_SCRIPT_BLOCK_LOGGING = '1';
    }

    if (options.enableModuleLogging && options.enableModuleLogging.length > 0) {
      env.PS_MODULE_LOGGING = options.enableModuleLogging.join(',');
    }

    // JEA (Just Enough Administration)
    if (options.enableJEA && options.jeaConfigurationName) {
      env.PS_JEA_CONFIG = options.jeaConfigurationName;
    }

    // Remoting settings
    if (options.enableRemoting) {
      env.PS_REMOTING_ENABLED = '1';
    }

    if (options.trustedHosts && options.trustedHosts.length > 0) {
      env.PS_TRUSTED_HOSTS = options.trustedHosts.join(',');
    }

    if (options.enableCredSSP) {
      env.PS_CREDSSP_ENABLED = '1';
    }

    // Session limits
    if (options.maxConcurrentOps) {
      env.PS_MAX_CONCURRENT_OPS = options.maxConcurrentOps.toString();
    }

    if (options.maxConnections) {
      env.PS_MAX_CONNECTIONS = options.maxConnections.toString();
    }

    if (options.maxMemory) {
      env.PS_MAX_MEMORY = options.maxMemory.toString();
    }

    // History settings
    if (options.enableHistory && options.historyPath) {
      env.PS_HISTORY_PATH = options.historyPath;
    }

    // PSReadLine settings
    if (options.enablePSReadLine === false) {
      env.PS_DISABLE_READLINE = '1';
    }

    // Preference variables
    if (options.enableVerbosePreference) {
      env.VerbosePreference = 'Continue';
    }

    if (options.enableDebugPreference) {
      env.DebugPreference = 'Continue';
    }

    if (options.enableProgressPreference) {
      env.ProgressPreference = 'Continue';
    }

    if (options.enableWarningPreference) {
      env.WarningPreference = 'Continue';
    }

    if (options.enableErrorActionPreference) {
      env.ErrorActionPreference = options.enableErrorActionPreference;
    }

    if (options.enableInformationPreference) {
      env.InformationPreference = 'Continue';
    }

    // Strict mode
    if (options.enableStrictMode && options.strictModeVersion) {
      env.PS_STRICT_MODE = options.strictModeVersion;
    }

    // Language mode
    if (options.enableConstrainedLanguage) {
      env.PS_LANGUAGE_MODE = 'ConstrainedLanguage';
    }

    // DSC (Desired State Configuration)
    if (options.enableDSC && options.dscConfiguration) {
      env.PS_DSC_CONFIG = options.dscConfiguration;
    }

    // Custom environment variables
    if (options.environment) {
      Object.assign(env, options.environment);
    }

    return env;
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up PowerShell Direct protocol');

    // Close all PowerShell Direct processes
    for (const [sessionId, process] of Array.from(this.powerShellProcesses)) {
      try {
        // Send exit command first
        if (process.stdin && !process.stdin.destroyed) {
          process.stdin.write('exit\n');
        }

        // Then force kill
        setTimeout(() => {
          if (!process.killed) {
            process.kill();
          }
        }, 2000);
      } catch (error) {
        this.logger.error(`Error killing PowerShell Direct process for session ${sessionId}:`, error);
      }
    }

    // Clear all data
    this.powerShellProcesses.clear();
    this.psDSessionStates.clear();

    // Call parent cleanup
    await super.cleanup();
  }
}

export default PowerShellDirectProtocol;