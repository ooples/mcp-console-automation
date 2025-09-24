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

// PowerShell Remoting Protocol connection options
interface PSRemotingConnectionOptions extends SessionOptions {
  computerName: string;
  port?: number;
  useSSL?: boolean;
  applicationName?: string;
  configurationName?: string;
  sessionOption?: Record<string, any>;
  authentication?: 'Default' | 'Basic' | 'Negotiate' | 'NegotiateWithImplicitCredential' | 'Credssp' | 'Digest' | 'Kerberos';
  certificateThumbprint?: string;
  credential?: {
    username: string;
    password?: string;
    domain?: string;
    useSecureString?: boolean;
  };
  sessionType?: 'Interactive' | 'RemoteSession' | 'InvokeBatch' | 'RunAsJob';
  connectionUri?: string;
  allowRedirection?: boolean;
  sessionName?: string;
  idleTimeout?: number;
  maxIdleTimeout?: number;
  outputBufferingMode?: 'None' | 'Block' | 'Drop';
  inputFormat?: 'Text' | 'XML';
  outputFormat?: 'Text' | 'XML';
  culture?: string;
  uiCulture?: string;
  sessionTimeout?: number;
  operationTimeout?: number;
  cancelTimeout?: number;
  enableNetworkAccess?: boolean;
  includePortInSPN?: boolean;
  skipCACheck?: boolean;
  skipCNCheck?: boolean;
  skipRevocationCheck?: boolean;
  noEncryption?: boolean;
  useUtf16?: boolean;
  maxConcurrentCommandsPerSession?: number;
  maxSessions?: number;
  maxSessionsPerShell?: number;
  maxMemoryPerShellMB?: number;
  maxProcessesPerShell?: number;
  maxShells?: number;
  maxShellsPerUser?: number;
  shellTimeoutMs?: number;
  executionPolicy?: 'Restricted' | 'AllSigned' | 'RemoteSigned' | 'Unrestricted' | 'Bypass' | 'Undefined';
  psVersion?: string;
  enableClr?: boolean;
  clrVersion?: string;
  apartmentState?: 'STA' | 'MTA' | 'Unknown';
  threadOptions?: 'Default' | 'UseNewThread' | 'ReuseThread';
  workingDirectory?: string;
  initialScript?: string;
  modulesToImport?: string[];
  snapinsToAdd?: string[];
  functionsToDefine?: Record<string, string>;
  variablesToDefine?: Record<string, any>;
  aliasesToDefine?: Record<string, string>;
  drivesToMap?: Record<string, string>;
  enableHistory?: boolean;
  historySize?: number;
  saveHistoryPath?: string;
  enableVerboseRecord?: boolean;
  enableErrorRecord?: boolean;
  enableProgressRecord?: boolean;
  enableDebugRecord?: boolean;
  enableInformationRecord?: boolean;
  enableWarningRecord?: boolean;
  jobName?: string;
  asJob?: boolean;
  throttleLimit?: number;
  hVArgs?: string[];
  vmName?: string;
  vmId?: string;
  containerName?: string;
  containerId?: string;
  enableVMIntegration?: boolean;
  enableContainerIntegration?: boolean;
  runAsAdministrator?: boolean;
  windowStyle?: 'Normal' | 'Hidden' | 'Minimized' | 'Maximized';
  verb?: 'runas' | 'open';
  argumentList?: string[];
  filePath?: string;
  scriptBlock?: string;
  loadProfile?: boolean;
  noProfile?: boolean;
  nonInteractive?: boolean;
  mta?: boolean;
  sta?: boolean;
  inputObject?: any;
  enableCustomPSHost?: boolean;
  customPSHostSettings?: Record<string, any>;
  remoteDebug?: boolean;
  stepInto?: boolean;
  breakAll?: boolean;
  enablePSReadLine?: boolean;
  psReadLineOptions?: Record<string, any>;
  enableLogging?: boolean;
  logLevel?: 'Critical' | 'Error' | 'Warning' | 'Informational' | 'Verbose';
  logPath?: string;
  enableScriptBlockLogging?: boolean;
  enableModuleLogging?: boolean;
  enableTranscription?: boolean;
  transcriptionDirectory?: string;
  enablePowerShellDetection?: boolean;
  environment?: Record<string, string>;
  customPowerShellPath?: string;
  customFlags?: string[];
}

/**
 * PowerShell Remoting Protocol Implementation
 *
 * Provides PowerShell Remoting capabilities for Windows and cross-platform systems
 * Supports comprehensive PowerShell Remoting functionality including Enter-PSSession,
 * New-PSSession, Invoke-Command, PowerShell jobs, WS-Management, SSH remoting,
 * and enterprise PowerShell administration features
 */
export class PSRemotingProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'psremoting';
  public readonly capabilities: ProtocolCapabilities;

  private psremotingProcesses = new Map<string, ChildProcess>();

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
    super('psremoting');

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
      supportsSignals: true,
      supportsResizing: false,
      supportsPTY: false,
      maxConcurrentSessions: 32, // PowerShell Remoting can handle many concurrent sessions
      defaultTimeout: 300000, // PowerShell operations can take longer
      supportedEncodings: ['utf-8', 'utf-16le', 'ascii'],
      supportedAuthMethods: ['basic', 'negotiate', 'kerberos', 'credssp', 'digest'],
      platformSupport: {
        windows: true, // Primary PowerShell Remoting platform
        linux: true, // PowerShell Core with SSH remoting
        macos: true, // PowerShell Core with SSH remoting
        freebsd: true
      }
    };
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Check if PowerShell is available
      await this.checkPowerShellAvailability();
      this.isInitialized = true;
      this.logger.info('PowerShell Remoting protocol initialized with enterprise features');
    } catch (error: any) {
      this.logger.error('Failed to initialize PowerShell Remoting protocol', error);
      throw error;
    }
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const sessionId = `psremoting-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
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
    const psremotingProcess = this.psremotingProcesses.get(sessionId);
    const session = this.sessions.get(sessionId);

    if (!psremotingProcess || !psremotingProcess.stdin || !session) {
      throw new Error(`No active PowerShell Remoting session: ${sessionId}`);
    }

    psremotingProcess.stdin.write(input);
    session.lastActivity = new Date();

    this.emit('input-sent', {
      sessionId,
      input,
      timestamp: new Date(),
    });

    this.logger.debug(`Sent input to PowerShell Remoting session ${sessionId}: ${input.substring(0, 100)}`);
  }

  async closeSession(sessionId: string): Promise<void> {
    try {
      const psremotingProcess = this.psremotingProcesses.get(sessionId);
      if (psremotingProcess) {
        // Try graceful shutdown first
        psremotingProcess.kill('SIGTERM');

        // Force kill after timeout
        setTimeout(() => {
          if (psremotingProcess && !psremotingProcess.killed) {
            psremotingProcess.kill('SIGKILL');
          }
        }, 15000);

        this.psremotingProcesses.delete(sessionId);
      }

      // Clean up base protocol session
      this.sessions.delete(sessionId);

      this.logger.info(`PowerShell Remoting session ${sessionId} closed`);
      this.emit('session-closed', sessionId);
    } catch (error) {
      this.logger.error(`Error closing PowerShell Remoting session ${sessionId}:`, error);
      throw error;
    }
  }

  async doCreateSession(sessionId: string, options: SessionOptions, sessionState: SessionState): Promise<ConsoleSession> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const psremotingOptions = options as PSRemotingConnectionOptions;

    // Validate required PowerShell Remoting parameters
    if (!psremotingOptions.computerName) {
      throw new Error('Computer name is required for PowerShell Remoting protocol');
    }

    // Build PowerShell Remoting command
    const psremotingCommand = this.buildPSRemotingCommand(psremotingOptions);

    // Spawn PowerShell Remoting process
    const psremotingProcess = spawn(psremotingCommand[0], psremotingCommand.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...this.buildEnvironment(psremotingOptions), ...options.env }
    });

    // Set up output handling
    psremotingProcess.stdout?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stdout',
        data: data.toString(),
        timestamp: new Date()
      };
      this.addToOutputBuffer(sessionId, output);
    });

    psremotingProcess.stderr?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stderr',
        data: data.toString(),
        timestamp: new Date()
      };
      this.addToOutputBuffer(sessionId, output);
    });

    psremotingProcess.on('error', (error) => {
      this.logger.error(`PowerShell Remoting process error for session ${sessionId}:`, error);
      this.emit('session-error', { sessionId, error });
    });

    psremotingProcess.on('close', (code) => {
      this.logger.info(`PowerShell Remoting process closed for session ${sessionId} with code ${code}`);
      this.markSessionComplete(sessionId, code || 0);
    });

    // Store the process
    this.psremotingProcesses.set(sessionId, psremotingProcess);

    // Create session object
    const session: ConsoleSession = {
      id: sessionId,
      command: psremotingCommand[0],
      args: psremotingCommand.slice(1),
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...this.buildEnvironment(psremotingOptions), ...options.env },
      createdAt: new Date(),
      lastActivity: new Date(),
      status: 'running',
      type: this.type,
      streaming: options.streaming,
      executionState: 'idle',
      activeCommands: new Map(),
      pid: psremotingProcess.pid
    };

    this.sessions.set(sessionId, session);

    this.logger.info(`PowerShell Remoting session ${sessionId} created for computer ${psremotingOptions.computerName}`);
    this.emit('session-created', { sessionId, type: 'psremoting', session });

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
      isOneShot: false, // PowerShell Remoting sessions are typically persistent
      isPersistent: true,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      pid: session.pid,
      metadata: {}
    };
  }

  async handleError(error: Error, context: ErrorContext): Promise<ErrorRecoveryResult> {
    this.logger.error(`Error in PowerShell Remoting session ${context.sessionId}: ${error.message}`);

    return {
      recovered: false,
      strategy: 'none',
      attempts: 0,
      duration: 0,
      error: error.message
    };
  }

  async recoverSession(sessionId: string): Promise<boolean> {
    const psremotingProcess = this.psremotingProcesses.get(sessionId);
    return psremotingProcess && !psremotingProcess.killed || false;
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
        connectionsActive: this.psremotingProcesses.size
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
      await this.checkPowerShellAvailability();
      return {
        ...baseStatus,
        dependencies: {
          powershell: { available: true }
        }
      };
    } catch (error) {
      return {
        ...baseStatus,
        isHealthy: false,
        errors: [...baseStatus.errors, `PowerShell not available: ${error}`],
        dependencies: {
          powershell: { available: false }
        }
      };
    }
  }

  private async checkPowerShellAvailability(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Try PowerShell Core first, then Windows PowerShell
      const testProcess = spawn('pwsh', ['-Command', 'Get-Host'], { stdio: 'pipe' });

      testProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          // Try Windows PowerShell
          const fallbackProcess = spawn('powershell', ['-Command', 'Get-Host'], { stdio: 'pipe' });

          fallbackProcess.on('close', (fallbackCode) => {
            if (fallbackCode === 0) {
              resolve();
            } else {
              reject(new Error('PowerShell not found. Please install PowerShell Core or Windows PowerShell.'));
            }
          });

          fallbackProcess.on('error', () => {
            reject(new Error('PowerShell not found. Please install PowerShell Core or Windows PowerShell.'));
          });
        }
      });

      testProcess.on('error', () => {
        // Try Windows PowerShell
        const fallbackProcess = spawn('powershell', ['-Command', 'Get-Host'], { stdio: 'pipe' });

        fallbackProcess.on('close', (fallbackCode) => {
          if (fallbackCode === 0) {
            resolve();
          } else {
            reject(new Error('PowerShell not found. Please install PowerShell Core or Windows PowerShell.'));
          }
        });

        fallbackProcess.on('error', () => {
          reject(new Error('PowerShell not found. Please install PowerShell Core or Windows PowerShell.'));
        });
      });
    });
  }

  private buildPSRemotingCommand(options: PSRemotingConnectionOptions): string[] {
    const command = [];

    // PowerShell executable
    if (options.customPowerShellPath) {
      command.push(options.customPowerShellPath);
    } else {
      // Try PowerShell Core first, fallback to Windows PowerShell
      command.push(process.platform === 'win32' ? 'pwsh' : 'pwsh');
    }

    // PowerShell execution policy
    if (options.executionPolicy) {
      command.push('-ExecutionPolicy', options.executionPolicy);
    } else {
      command.push('-ExecutionPolicy', 'Bypass');
    }

    // Profile loading
    if (options.noProfile) {
      command.push('-NoProfile');
    }

    if (options.loadProfile) {
      command.push('-LoadProfile');
    }

    // Interactive mode
    if (options.nonInteractive) {
      command.push('-NonInteractive');
    }

    // Apartment state
    if (options.mta) {
      command.push('-MTA');
    }

    if (options.sta) {
      command.push('-STA');
    }

    // PowerShell version
    if (options.psVersion) {
      command.push('-Version', options.psVersion);
    }

    // Working directory
    if (options.workingDirectory) {
      command.push('-WorkingDirectory', options.workingDirectory);
    }

    // Window style
    if (options.windowStyle) {
      command.push('-WindowStyle', options.windowStyle);
    }

    // Build PowerShell remoting command based on session type
    let psCommand = '';

    if (options.sessionType === 'Interactive' || !options.sessionType) {
      // Enter-PSSession for interactive remoting
      psCommand = this.buildEnterPSSessionCommand(options);
    } else if (options.sessionType === 'RemoteSession') {
      // New-PSSession for persistent sessions
      psCommand = this.buildNewPSSessionCommand(options);
    } else if (options.sessionType === 'InvokeBatch') {
      // Invoke-Command for batch execution
      psCommand = this.buildInvokeCommand(options);
    } else if (options.sessionType === 'RunAsJob') {
      // Start-Job with Invoke-Command for background jobs
      psCommand = this.buildJobCommand(options);
    }

    command.push('-Command', psCommand);

    return command;
  }

  private buildEnterPSSessionCommand(options: PSRemotingConnectionOptions): string {
    let cmd = 'Enter-PSSession';

    // Computer name
    cmd += ` -ComputerName '${options.computerName}'`;

    // Connection settings
    if (options.port) {
      cmd += ` -Port ${options.port}`;
    }

    if (options.useSSL) {
      cmd += ' -UseSSL';
    }

    if (options.applicationName) {
      cmd += ` -ApplicationName '${options.applicationName}'`;
    }

    if (options.configurationName) {
      cmd += ` -ConfigurationName '${options.configurationName}'`;
    }

    if (options.connectionUri) {
      cmd += ` -ConnectionUri '${options.connectionUri}'`;
    }

    // Authentication
    if (options.authentication) {
      cmd += ` -Authentication ${options.authentication}`;
    }

    if (options.certificateThumbprint) {
      cmd += ` -CertificateThumbprint '${options.certificateThumbprint}'`;
    }

    if (options.credential) {
      if (options.credential.useSecureString) {
        cmd += ` -Credential (Get-Credential -UserName '${options.credential.username}' -Message 'Enter credentials')`;
      } else {
        cmd += ` -Credential (New-Object System.Management.Automation.PSCredential('${options.credential.username}', (ConvertTo-SecureString '${options.credential.password}' -AsPlainText -Force)))`;
      }
    }

    // Session options
    if (options.sessionName) {
      cmd += ` -Name '${options.sessionName}'`;
    }

    if (options.enableNetworkAccess) {
      cmd += ' -EnableNetworkAccess';
    }

    // SSL options
    if (options.skipCACheck) {
      cmd += ' -SessionOption (New-PSSessionOption -SkipCACheck)';
    }

    if (options.skipCNCheck) {
      cmd += ' -SessionOption (New-PSSessionOption -SkipCNCheck)';
    }

    if (options.skipRevocationCheck) {
      cmd += ' -SessionOption (New-PSSessionOption -SkipRevocationCheck)';
    }

    if (options.noEncryption) {
      cmd += ' -SessionOption (New-PSSessionOption -NoEncryption)';
    }

    return cmd;
  }

  private buildNewPSSessionCommand(options: PSRemotingConnectionOptions): string {
    let cmd = '$session = New-PSSession';

    // Computer name
    cmd += ` -ComputerName '${options.computerName}'`;

    // Add all the same parameters as Enter-PSSession
    if (options.port) {
      cmd += ` -Port ${options.port}`;
    }

    if (options.useSSL) {
      cmd += ' -UseSSL';
    }

    if (options.applicationName) {
      cmd += ` -ApplicationName '${options.applicationName}'`;
    }

    if (options.configurationName) {
      cmd += ` -ConfigurationName '${options.configurationName}'`;
    }

    if (options.authentication) {
      cmd += ` -Authentication ${options.authentication}`;
    }

    if (options.credential) {
      if (options.credential.useSecureString) {
        cmd += ` -Credential (Get-Credential -UserName '${options.credential.username}' -Message 'Enter credentials')`;
      } else {
        cmd += ` -Credential (New-Object System.Management.Automation.PSCredential('${options.credential.username}', (ConvertTo-SecureString '${options.credential.password}' -AsPlainText -Force)))`;
      }
    }

    if (options.sessionName) {
      cmd += ` -Name '${options.sessionName}'`;
    }

    if (options.throttleLimit) {
      cmd += ` -ThrottleLimit ${options.throttleLimit}`;
    }

    // Add session to variable and then enter it
    cmd += '; Enter-PSSession -Session $session';

    return cmd;
  }

  private buildInvokeCommand(options: PSRemotingConnectionOptions): string {
    let cmd = 'Invoke-Command';

    // Computer name
    cmd += ` -ComputerName '${options.computerName}'`;

    // Script block or file
    if (options.scriptBlock) {
      cmd += ` -ScriptBlock { ${options.scriptBlock} }`;
    } else if (options.filePath) {
      cmd += ` -FilePath '${options.filePath}'`;
    } else if (options.command) {
      cmd += ` -ScriptBlock { ${options.command} }`;
    }

    // Authentication and connection parameters
    if (options.credential) {
      if (options.credential.useSecureString) {
        cmd += ` -Credential (Get-Credential -UserName '${options.credential.username}' -Message 'Enter credentials')`;
      } else {
        cmd += ` -Credential (New-Object System.Management.Automation.PSCredential('${options.credential.username}', (ConvertTo-SecureString '${options.credential.password}' -AsPlainText -Force)))`;
      }
    }

    if (options.authentication) {
      cmd += ` -Authentication ${options.authentication}`;
    }

    if (options.port) {
      cmd += ` -Port ${options.port}`;
    }

    if (options.useSSL) {
      cmd += ' -UseSSL';
    }

    if (options.configurationName) {
      cmd += ` -ConfigurationName '${options.configurationName}'`;
    }

    if (options.inputObject) {
      cmd += ` -InputObject $inputObject`;
    }

    if (options.argumentList && options.argumentList.length > 0) {
      cmd += ` -ArgumentList ${options.argumentList.map(arg => `'${arg}'`).join(', ')}`;
    }

    if (options.enableNetworkAccess) {
      cmd += ' -EnableNetworkAccess';
    }

    if (options.asJob) {
      cmd += ' -AsJob';
      if (options.jobName) {
        cmd += ` -JobName '${options.jobName}'`;
      }
    }

    if (options.throttleLimit) {
      cmd += ` -ThrottleLimit ${options.throttleLimit}`;
    }

    return cmd;
  }

  private buildJobCommand(options: PSRemotingConnectionOptions): string {
    let cmd = 'Start-Job -ScriptBlock {';

    // Add Invoke-Command inside the job
    cmd += ` Invoke-Command -ComputerName '${options.computerName}'`;

    if (options.scriptBlock) {
      cmd += ` -ScriptBlock { ${options.scriptBlock} }`;
    } else if (options.filePath) {
      cmd += ` -FilePath '${options.filePath}'`;
    } else if (options.command) {
      cmd += ` -ScriptBlock { ${options.command} }`;
    }

    if (options.credential) {
      if (options.credential.useSecureString) {
        cmd += ` -Credential (Get-Credential -UserName '${options.credential.username}' -Message 'Enter credentials')`;
      } else {
        cmd += ` -Credential (New-Object System.Management.Automation.PSCredential('${options.credential.username}', (ConvertTo-SecureString '${options.credential.password}' -AsPlainText -Force)))`;
      }
    }

    cmd += ' }';

    if (options.jobName) {
      cmd += ` -Name '${options.jobName}'`;
    }

    return cmd;
  }

  private buildEnvironment(options: PSRemotingConnectionOptions): Record<string, string> {
    const env: Record<string, string> = {};

    // PowerShell environment variables
    if (options.psVersion) {
      env.POWERSHELL_VERSION = options.psVersion;
    }

    if (options.executionPolicy) {
      env.POWERSHELL_EXECUTION_POLICY = options.executionPolicy;
    }

    // Remoting settings
    if (options.sessionTimeout) {
      env.PSREMOTING_SESSION_TIMEOUT = options.sessionTimeout.toString();
    }

    if (options.operationTimeout) {
      env.PSREMOTING_OPERATION_TIMEOUT = options.operationTimeout.toString();
    }

    if (options.maxSessions) {
      env.PSREMOTING_MAX_SESSIONS = options.maxSessions.toString();
    }

    if (options.maxMemoryPerShellMB) {
      env.PSREMOTING_MAX_MEMORY_PER_SHELL = options.maxMemoryPerShellMB.toString();
    }

    // Culture settings
    if (options.culture) {
      env.LC_ALL = options.culture;
    }

    if (options.uiCulture) {
      env.POWERSHELL_UI_CULTURE = options.uiCulture;
    }

    // Logging settings
    if (options.enableLogging) {
      env.PSREMOTING_ENABLE_LOGGING = '1';
      if (options.logLevel) {
        env.PSREMOTING_LOG_LEVEL = options.logLevel;
      }
      if (options.logPath) {
        env.PSREMOTING_LOG_PATH = options.logPath;
      }
    }

    if (options.enableScriptBlockLogging) {
      env.PSREMOTING_SCRIPT_BLOCK_LOGGING = '1';
    }

    if (options.enableTranscription) {
      env.PSREMOTING_TRANSCRIPTION = '1';
      if (options.transcriptionDirectory) {
        env.PSREMOTING_TRANSCRIPTION_DIR = options.transcriptionDirectory;
      }
    }

    // History settings
    if (options.enableHistory) {
      env.PSREMOTING_ENABLE_HISTORY = '1';
      if (options.historySize) {
        env.PSREMOTING_HISTORY_SIZE = options.historySize.toString();
      }
      if (options.saveHistoryPath) {
        env.PSREMOTING_HISTORY_PATH = options.saveHistoryPath;
      }
    }

    // Module and snapin settings
    if (options.modulesToImport && options.modulesToImport.length > 0) {
      env.PSREMOTING_MODULES = options.modulesToImport.join(';');
    }

    if (options.snapinsToAdd && options.snapinsToAdd.length > 0) {
      env.PSREMOTING_SNAPINS = options.snapinsToAdd.join(';');
    }

    // CLR settings
    if (options.enableClr) {
      env.PSREMOTING_CLR_ENABLED = '1';
      if (options.clrVersion) {
        env.PSREMOTING_CLR_VERSION = options.clrVersion;
      }
    }

    // Debug and development settings
    if (options.remoteDebug) {
      env.PSREMOTING_REMOTE_DEBUG = '1';
    }

    if (options.enablePSReadLine) {
      env.PSREMOTING_PSREADLINE = '1';
    }

    if (options.enableVerboseRecord) {
      env.PSREMOTING_VERBOSE_RECORD = '1';
    }

    if (options.enableErrorRecord) {
      env.PSREMOTING_ERROR_RECORD = '1';
    }

    if (options.enableProgressRecord) {
      env.PSREMOTING_PROGRESS_RECORD = '1';
    }

    if (options.enableDebugRecord) {
      env.PSREMOTING_DEBUG_RECORD = '1';
    }

    if (options.enableInformationRecord) {
      env.PSREMOTING_INFORMATION_RECORD = '1';
    }

    if (options.enableWarningRecord) {
      env.PSREMOTING_WARNING_RECORD = '1';
    }

    // Hyper-V and Container integration
    if (options.enableVMIntegration && options.vmName) {
      env.PSREMOTING_VM_NAME = options.vmName;
    }

    if (options.enableVMIntegration && options.vmId) {
      env.PSREMOTING_VM_ID = options.vmId;
    }

    if (options.enableContainerIntegration && options.containerName) {
      env.PSREMOTING_CONTAINER_NAME = options.containerName;
    }

    if (options.enableContainerIntegration && options.containerId) {
      env.PSREMOTING_CONTAINER_ID = options.containerId;
    }

    // Custom environment variables
    if (options.environment) {
      Object.assign(env, options.environment);
    }

    return env;
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up PowerShell Remoting protocol');

    // Close all PowerShell Remoting processes
    for (const [sessionId, process] of Array.from(this.psremotingProcesses)) {
      try {
        process.kill();
      } catch (error) {
        this.logger.error(`Error killing PowerShell Remoting process for session ${sessionId}:`, error);
      }
    }

    // Clear all data
    this.psremotingProcesses.clear();

    // Call parent cleanup
    await super.cleanup();
  }
}

export default PSRemotingProtocol;