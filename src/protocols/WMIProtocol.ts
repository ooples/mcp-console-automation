import { spawn, ChildProcess } from 'child_process';
import * as os from 'os';
import { BaseProtocol } from '../core/BaseProtocol.js';
import {
  ConsoleSession,
  SessionOptions,
  ConsoleType,
  ConsoleOutput
} from '../types/index.js';
import {
  SessionState,
  ProtocolCapabilities,
  ProtocolHealthStatus
} from '../core/IProtocol.js';
import { Logger } from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * WMI connection options
 */
export interface WMIConnectionOptions {
  host?: string;
  namespace?: string;
  username?: string;
  password?: string;
  domain?: string;
  authLevel?: 'default' | 'none' | 'connect' | 'call' | 'pkt' | 'pktIntegrity' | 'pktPrivacy';
  impersonationLevel?: 'anonymous' | 'identify' | 'impersonate' | 'delegate';
  timeout?: number;
  locale?: string;
  authority?: string;
  enablePrivileges?: boolean;
  useKerberos?: boolean;
  useNTLMv2?: boolean;
}

/**
 * WMI query options
 */
export interface WMIQueryOptions {
  query: string;
  namespace?: string;
  timeout?: number;
  format?: 'list' | 'table' | 'mof' | 'xml' | 'csv' | 'json';
}

/**
 * WMI method invocation options
 */
export interface WMIMethodOptions {
  className: string;
  methodName: string;
  parameters?: Record<string, any>;
  instance?: string;
  namespace?: string;
}

/**
 * WMI session state
 */
interface WMISession {
  id: string;
  connectionOptions: WMIConnectionOptions;
  process?: ChildProcess;
  isConnected: boolean;
  lastActivity: Date;
  queryHistory: Array<{
    query: string;
    timestamp: Date;
    result?: any;
    error?: string;
  }>;
  monitoringIntervals: Map<string, NodeJS.Timeout>;
}

/**
 * WMI Protocol implementation extending BaseProtocol
 * Provides Windows Management Instrumentation capabilities
 */
export class WMIProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'wmi';
  public readonly capabilities: ProtocolCapabilities;

  private wmiSessions: Map<string, WMISession> = new Map();
  private wmiProcesses: Map<string, ChildProcess> = new Map();
  private healthStatus: ProtocolHealthStatus;
  private isWindows: boolean;

  constructor() {
    super('WMIProtocol');

    this.isWindows = os.platform() === 'win32';

    this.capabilities = {
      supportsStreaming: true,
      supportsFileTransfer: false,
      supportsX11Forwarding: false,
      supportsPortForwarding: false,
      supportsAuthentication: true,
      supportsEncryption: true,
      supportsCompression: false,
      supportsMultiplexing: true,
      supportsKeepAlive: true,
      supportsReconnection: true,
      supportsBinaryData: false,
      supportsCustomEnvironment: false,
      supportsWorkingDirectory: false,
      supportsSignals: false,
      supportsResizing: false,
      supportsPTY: false,
      maxConcurrentSessions: 10,
      defaultTimeout: 30000,
      supportedEncodings: ['utf-8', 'utf-16'],
      supportedAuthMethods: ['ntlm', 'kerberos', 'basic'],
      platformSupport: {
        windows: true,
        linux: true, // via wmic or PowerShell Core
        macos: false,
        freebsd: false
      }
    };

    this.healthStatus = {
      isHealthy: true,
      lastChecked: new Date(),
      errors: [],
      warnings: [],
      metrics: {
        activeSessions: 0,
        totalSessions: 0,
        averageLatency: 0,
        successRate: 1.0,
        uptime: 0
      },
      dependencies: {
        wmic: {
          available: false,
          version: 'checking...'
        },
        powershell: {
          available: false,
          version: 'checking...'
        }
      }
    };

    this.isInitialized = true;
  }

  /**
   * Initialize WMI Protocol
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    this.logger.info('Initializing WMI Protocol');

    // Check for WMIC availability
    if (this.isWindows) {
      try {
        const wmicCheck = spawn('wmic', ['/?'], { shell: true });
        await new Promise((resolve, reject) => {
          wmicCheck.on('exit', (code) => {
            if (code === 0) {
              this.healthStatus.dependencies.wmic = { available: true, version: 'system' };
              resolve(undefined);
            } else {
              reject(new Error('WMIC not found'));
            }
          });
          wmicCheck.on('error', reject);
        });
      } catch {
        this.logger.warn('WMIC not available');
        this.healthStatus.dependencies.wmic = { available: false, version: 'not installed' };
      }
    }

    // Check for PowerShell with WMI cmdlets
    try {
      const psCheck = spawn('powershell', ['-Command', 'Get-WmiObject -List | Select-Object -First 1'], { shell: true });
      await new Promise((resolve, reject) => {
        psCheck.on('exit', (code) => {
          if (code === 0) {
            this.healthStatus.dependencies.powershell = { available: true, version: 'system' };
            resolve(undefined);
          } else {
            reject(new Error('PowerShell WMI not available'));
          }
        });
        psCheck.on('error', reject);
      });
    } catch {
      this.healthStatus.dependencies.powershell = { available: false, version: 'not installed' };
    }

    this.isInitialized = true;
  }

  /**
   * Create session with BaseProtocol integration
   */
  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const sessionId = `wmi-${Date.now()}-${uuidv4().substring(0, 8)}`;
    const sessionState = await this.createSessionWithTypeDetection(sessionId, options);
    return sessionState;
  }

  /**
   * Implementation of BaseProtocol's doCreateSession
   */
  protected async doCreateSession(
    sessionId: string,
    options: SessionOptions,
    sessionState: SessionState
  ): Promise<ConsoleSession> {
    const wmiOptions: WMIConnectionOptions = {
      host: options.wmiHost || 'localhost',
      namespace: options.wmiNamespace || 'root\\CIMV2',
      username: options.wmiUsername,
      password: options.wmiPassword,
      domain: options.wmiDomain,
      authLevel: (options.wmiAuthLevel as any) || 'pktPrivacy',
      impersonationLevel: (options.wmiImpersonationLevel as any) || 'impersonate',
      timeout: options.wmiTimeout || 30000,
      locale: options.wmiLocale || 'MS_409',
      enablePrivileges: options.wmiEnablePrivileges !== false,
      useKerberos: options.wmiUseKerberos || false,
      useNTLMv2: options.wmiUseNTLMv2 !== false
    };

    const wmiSession: WMISession = {
      id: sessionId,
      connectionOptions: wmiOptions,
      isConnected: false,
      lastActivity: new Date(),
      queryHistory: [],
      monitoringIntervals: new Map()
    };

    this.wmiSessions.set(sessionId, wmiSession);

    try {
      // Test WMI connection
      await this.testConnection(wmiSession);
      wmiSession.isConnected = true;

      const session: ConsoleSession = {
        id: sessionId,
        type: 'wmi',
        status: 'running',
        createdAt: new Date(),
        lastActivity: new Date(),
        executionState: 'idle',
        command: options.command || 'wmi',
        args: options.args || [],
        cwd: process.cwd(),
        env: options.environment || {},
        environment: options.environment || {},
        activeCommands: new Map(),
        streaming: options.streaming ?? true,
        metadata: {
          wmiOptions,
          namespace: wmiOptions.namespace,
          host: wmiOptions.host
        }
      };

      this.sessions.set(sessionId, session);
      this.emit('sessionCreated', session);

      // Add initial output
      this.addToOutputBuffer(sessionId, {
        sessionId,
        type: 'stdout',
        data: `WMI session established to ${wmiOptions.host}\\${wmiOptions.namespace}\n`,
        timestamp: new Date(),
        raw: ''
      });

      return session;
    } catch (error) {
      this.wmiSessions.delete(sessionId);
      throw error;
    }
  }

  /**
   * Test WMI connection
   */
  private async testConnection(session: WMISession): Promise<void> {
    try {
      // Simple query to test connection
      await this.executeWMIQuery(session, {
        query: 'SELECT Name FROM Win32_ComputerSystem',
        namespace: session.connectionOptions.namespace
      });
    } catch (error) {
      throw new Error(`Failed to connect to WMI: ${error}`);
    }
  }

  /**
   * Execute WMI query
   */
  async executeWMIQuery(session: WMISession, options: WMIQueryOptions): Promise<any> {
    const { query, namespace, format = 'json', timeout } = options;

    // Record query in history
    const historyEntry = {
      query,
      timestamp: new Date(),
      result: undefined as any,
      error: undefined as string | undefined
    };
    session.queryHistory.push(historyEntry);

    try {
      let result: string;

      if (this.healthStatus.dependencies.wmic?.available && this.isWindows) {
        // Use WMIC
        result = await this.executeWMIC(session, query, namespace, format);
      } else if (this.healthStatus.dependencies.powershell?.available) {
        // Use PowerShell
        result = await this.executePowerShellWMI(session, query, namespace, format);
      } else {
        throw new Error('No WMI provider available');
      }

      const parsed = this.parseWMIResult(result, format);
      historyEntry.result = parsed;
      session.lastActivity = new Date();

      return parsed;
    } catch (error) {
      historyEntry.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  /**
   * Execute WMIC command
   */
  private async executeWMIC(
    session: WMISession,
    query: string,
    namespace?: string,
    format?: string
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const args: string[] = [];

      // Add connection parameters
      if (session.connectionOptions.host && session.connectionOptions.host !== 'localhost') {
        args.push('/node:' + session.connectionOptions.host);
      }

      if (session.connectionOptions.username) {
        args.push('/user:' + session.connectionOptions.username);
      }

      if (session.connectionOptions.password) {
        args.push('/password:' + session.connectionOptions.password);
      }

      if (namespace && namespace !== 'root\\CIMV2') {
        args.push('/namespace:' + namespace);
      }

      // Add query
      if (query.toUpperCase().startsWith('SELECT')) {
        // WQL query
        args.push('path', 'Win32_ComputerSystem', 'where', this.extractWhereClause(query), 'get', this.extractSelectFields(query));
      } else {
        // Direct class/method call
        args.push(...query.split(' '));
      }

      // Add format
      if (format === 'csv') {
        args.push('/format:csv');
      } else if (format === 'xml') {
        args.push('/format:rawxml');
      } else {
        args.push('/format:list');
      }

      const wmicProcess = spawn('wmic', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env }
      });

      let stdout = '';
      let stderr = '';

      wmicProcess.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      wmicProcess.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      wmicProcess.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`WMIC failed with code ${code}: ${stderr}`));
        }
      });

      wmicProcess.on('error', reject);
    });
  }

  /**
   * Execute PowerShell WMI command
   */
  private async executePowerShellWMI(
    session: WMISession,
    query: string,
    namespace?: string,
    format?: string
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      let psCommand: string;

      if (query.toUpperCase().startsWith('SELECT')) {
        // WQL query via Get-WmiObject
        psCommand = `Get-WmiObject -Query "${query}"`;

        if (namespace && namespace !== 'root\\CIMV2') {
          psCommand += ` -Namespace "${namespace}"`;
        }

        if (session.connectionOptions.host && session.connectionOptions.host !== 'localhost') {
          psCommand += ` -ComputerName "${session.connectionOptions.host}"`;
        }

        if (session.connectionOptions.username) {
          // Create credential object
          psCommand = `$cred = New-Object System.Management.Automation.PSCredential("${session.connectionOptions.username}", (ConvertTo-SecureString "${session.connectionOptions.password}" -AsPlainText -Force)); ` + psCommand + ' -Credential $cred';
        }

        // Format output
        if (format === 'json') {
          psCommand += ' | ConvertTo-Json -Depth 10';
        } else if (format === 'csv') {
          psCommand += ' | ConvertTo-Csv -NoTypeInformation';
        } else if (format === 'xml') {
          psCommand += ' | ConvertTo-Xml -As String';
        } else {
          psCommand += ' | Format-List *';
        }
      } else {
        // Direct command
        psCommand = query;
      }

      const psProcess = spawn('powershell', ['-Command', psCommand], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env }
      });

      let stdout = '';
      let stderr = '';

      psProcess.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      psProcess.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      psProcess.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`PowerShell WMI failed with code ${code}: ${stderr}`));
        }
      });

      psProcess.on('error', reject);
    });
  }

  /**
   * Parse WMI result based on format
   */
  private parseWMIResult(result: string, format?: string): any {
    switch (format) {
      case 'json':
        try {
          return JSON.parse(result);
        } catch {
          return { raw: result };
        }

      case 'csv':
        return this.parseCSV(result);

      case 'xml':
        return { xml: result };

      default:
        return this.parseListFormat(result);
    }
  }

  /**
   * Parse CSV format
   */
  private parseCSV(csv: string): any[] {
    const lines = csv.split('\n').filter(line => line.trim());
    if (lines.length < 2) return [];

    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const results: any[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
      const obj: any = {};
      headers.forEach((header, index) => {
        obj[header] = values[index];
      });
      results.push(obj);
    }

    return results;
  }

  /**
   * Parse list format
   */
  private parseListFormat(text: string): any {
    const result: any = {};
    const lines = text.split('\n');

    for (const line of lines) {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        const value = match[2].trim();
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Extract WHERE clause from WQL
   */
  private extractWhereClause(query: string): string {
    const whereMatch = query.match(/WHERE\s+(.+)$/i);
    return whereMatch ? whereMatch[1] : '*';
  }

  /**
   * Extract SELECT fields from WQL
   */
  private extractSelectFields(query: string): string {
    const selectMatch = query.match(/SELECT\s+(.+?)\s+FROM/i);
    if (selectMatch) {
      const fields = selectMatch[1];
      if (fields === '*') {
        return '/all';
      }
      return fields.replace(/,/g, ',');
    }
    return '/all';
  }

  /**
   * Execute command in session
   */
  async executeCommand(sessionId: string, command: string, args?: string[]): Promise<void> {
    const session = this.wmiSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Parse command as WMI query or method call
    let result: any;

    if (command.toUpperCase().startsWith('SELECT') || command.toUpperCase().startsWith('ASSOCIATORS') || command.toUpperCase().startsWith('REFERENCES')) {
      // WQL query
      result = await this.executeWMIQuery(session, {
        query: command,
        format: 'json'
      });
    } else if (command.includes('.')) {
      // Method invocation (e.g., Win32_Process.Create)
      const [className, methodName] = command.split('.');
      result = await this.invokeWMIMethod(session, {
        className,
        methodName,
        parameters: args ? this.parseMethodArgs(args) : undefined
      });
    } else {
      // Class enumeration
      result = await this.executeWMIQuery(session, {
        query: `SELECT * FROM ${command}`,
        format: 'json'
      });
    }

    // Add output
    this.addToOutputBuffer(sessionId, {
      sessionId,
      type: 'stdout',
      data: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
      timestamp: new Date(),
      raw: result
    });
  }

  /**
   * Parse method arguments
   */
  private parseMethodArgs(args: string[]): Record<string, any> {
    const params: Record<string, any> = {};

    for (const arg of args) {
      const match = arg.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1];
        const value = match[2];

        // Try to parse as JSON
        try {
          params[key] = JSON.parse(value);
        } catch {
          params[key] = value;
        }
      }
    }

    return params;
  }

  /**
   * Invoke WMI method
   */
  async invokeWMIMethod(session: WMISession, options: WMIMethodOptions): Promise<any> {
    const { className, methodName, parameters, instance, namespace } = options;

    let command: string;

    if (this.healthStatus.dependencies.powershell?.available) {
      // Use PowerShell
      command = `Invoke-WmiMethod -Class ${className} -Name ${methodName}`;

      if (namespace) {
        command += ` -Namespace "${namespace}"`;
      }

      if (parameters && Object.keys(parameters).length > 0) {
        const paramStr = Object.entries(parameters)
          .map(([key, value]) => `${key}="${value}"`)
          .join(',');
        command += ` -ArgumentList @{${paramStr}}`;
      }

      if (instance) {
        command += ` -InputObject (Get-WmiObject -Query "SELECT * FROM ${className} WHERE ${instance}")`;
      }

      command += ' | ConvertTo-Json';

      return this.executePowerShellWMI(session, command, namespace, 'json');
    } else if (this.healthStatus.dependencies.wmic?.available && this.isWindows) {
      // Use WMIC
      const args = [className];

      if (instance) {
        args.push('where', instance);
      }

      args.push('call', methodName);

      if (parameters) {
        Object.entries(parameters).forEach(([key, value]) => {
          args.push(`${key}="${value}"`);
        });
      }

      return this.executeWMIC(session, args.join(' '), namespace, 'list');
    } else {
      throw new Error('No WMI provider available for method invocation');
    }
  }

  /**
   * Send input to session
   */
  async sendInput(sessionId: string, input: string): Promise<void> {
    // WMI doesn't have traditional input, treat as command
    await this.executeCommand(sessionId, input);
  }

  /**
   * Close session
   */
  async closeSession(sessionId: string): Promise<void> {
    const session = this.wmiSessions.get(sessionId);
    if (!session) return;

    this.logger.info(`Closing WMI session ${sessionId}`);

    // Stop all monitoring intervals
    session.monitoringIntervals.forEach(interval => clearInterval(interval));
    session.monitoringIntervals.clear();

    // Kill any running processes
    const process = this.wmiProcesses.get(sessionId);
    if (process) {
      process.kill('SIGTERM');
      this.wmiProcesses.delete(sessionId);
    }

    // Clean up session
    this.wmiSessions.delete(sessionId);
    this.sessions.delete(sessionId);
    this.markSessionComplete(sessionId);

    this.emit('sessionClosed', sessionId);
  }

  /**
   * Get health status
   */
  async getHealthStatus(): Promise<ProtocolHealthStatus> {
    const baseHealth = await super.getHealthStatus();

    this.healthStatus.metrics.activeSessions = this.wmiSessions.size;
    this.healthStatus.lastChecked = new Date();

    return {
      ...baseHealth,
      ...this.healthStatus,
      metrics: {
        ...baseHealth.metrics,
        activeSessions: this.wmiSessions.size
      }
    };
  }

  /**
   * Dispose of protocol resources
   */
  async dispose(): Promise<void> {
    this.logger.info('Disposing WMI Protocol');

    // Close all sessions
    const sessionIds = Array.from(this.wmiSessions.keys());
    await Promise.all(sessionIds.map(id => this.closeSession(id)));

    // Clean up
    await super.cleanup();
  }

  // WMI-specific helper methods

  /**
   * Query system information
   */
  async querySystemInfo(sessionId: string): Promise<any> {
    const session = this.wmiSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const queries = {
      computer: 'SELECT * FROM Win32_ComputerSystem',
      os: 'SELECT * FROM Win32_OperatingSystem',
      cpu: 'SELECT * FROM Win32_Processor',
      memory: 'SELECT * FROM Win32_PhysicalMemory',
      disk: 'SELECT * FROM Win32_DiskDrive',
      network: 'SELECT * FROM Win32_NetworkAdapterConfiguration WHERE IPEnabled=TRUE'
    };

    const results: any = {};

    for (const [key, query] of Object.entries(queries)) {
      try {
        results[key] = await this.executeWMIQuery(session, { query, format: 'json' });
      } catch (error) {
        results[key] = { error: error instanceof Error ? error.message : String(error) };
      }
    }

    return results;
  }

  /**
   * Monitor performance counters
   */
  async startPerformanceMonitoring(
    sessionId: string,
    counters: string[],
    intervalMs: number = 5000
  ): Promise<string> {
    const session = this.wmiSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const monitorId = uuidv4();

    const interval = setInterval(async () => {
      try {
        const results: any = {};

        for (const counter of counters) {
          const query = this.buildPerformanceQuery(counter);
          results[counter] = await this.executeWMIQuery(session, { query, format: 'json' });
        }

        this.addToOutputBuffer(sessionId, {
          sessionId,
          type: 'stdout',
          data: JSON.stringify({ monitorId, timestamp: new Date(), counters: results }, null, 2),
          timestamp: new Date(),
          raw: results
        });
      } catch (error) {
        this.logger.error(`Performance monitoring error:`, error);
      }
    }, intervalMs);

    session.monitoringIntervals.set(monitorId, interval);
    return monitorId;
  }

  /**
   * Stop performance monitoring
   */
  async stopPerformanceMonitoring(sessionId: string, monitorId: string): Promise<void> {
    const session = this.wmiSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const interval = session.monitoringIntervals.get(monitorId);
    if (interval) {
      clearInterval(interval);
      session.monitoringIntervals.delete(monitorId);
    }
  }

  /**
   * Build performance counter query
   */
  private buildPerformanceQuery(counter: string): string {
    const counterMap: Record<string, string> = {
      'cpu': 'SELECT PercentProcessorTime FROM Win32_PerfFormattedData_PerfOS_Processor WHERE Name="_Total"',
      'memory': 'SELECT AvailableMBytes, PercentCommittedBytesInUse FROM Win32_PerfFormattedData_PerfOS_Memory',
      'disk': 'SELECT DiskReadBytesPerSec, DiskWriteBytesPerSec, PercentDiskTime FROM Win32_PerfFormattedData_PerfDisk_PhysicalDisk WHERE Name="_Total"',
      'network': 'SELECT BytesReceivedPerSec, BytesSentPerSec FROM Win32_PerfFormattedData_Tcpip_NetworkInterface'
    };

    return counterMap[counter] || `SELECT * FROM Win32_PerfFormattedData_${counter}`;
  }

  /**
   * Query installed software
   */
  async queryInstalledSoftware(sessionId: string): Promise<any> {
    const session = this.wmiSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    return this.executeWMIQuery(session, {
      query: 'SELECT Name, Version, Vendor, InstallDate FROM Win32_Product',
      format: 'json'
    });
  }

  /**
   * Query running processes
   */
  async queryProcesses(sessionId: string, filter?: string): Promise<any> {
    const session = this.wmiSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    let query = 'SELECT ProcessId, Name, ExecutablePath, CommandLine, WorkingSetSize, PageFileUsage, ThreadCount FROM Win32_Process';
    if (filter) {
      query += ` WHERE ${filter}`;
    }

    return this.executeWMIQuery(session, { query, format: 'json' });
  }

  /**
   * Query services
   */
  async queryServices(sessionId: string, filter?: string): Promise<any> {
    const session = this.wmiSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    let query = 'SELECT Name, DisplayName, State, Status, StartMode, PathName FROM Win32_Service';
    if (filter) {
      query += ` WHERE ${filter}`;
    }

    return this.executeWMIQuery(session, { query, format: 'json' });
  }

  /**
   * Query event logs
   */
  async queryEventLogs(sessionId: string, logName: string, maxRecords: number = 100): Promise<any> {
    const session = this.wmiSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const query = `SELECT TOP ${maxRecords} TimeGenerated, EventCode, SourceName, EventType, Message FROM Win32_NTLogEvent WHERE Logfile="${logName}" ORDER BY TimeGenerated DESC`;

    return this.executeWMIQuery(session, { query, format: 'json' });
  }

  /**
   * Start process via WMI
   */
  async startProcess(sessionId: string, commandLine: string, workingDirectory?: string): Promise<any> {
    const session = this.wmiSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    return this.invokeWMIMethod(session, {
      className: 'Win32_Process',
      methodName: 'Create',
      parameters: {
        CommandLine: commandLine,
        CurrentDirectory: workingDirectory || 'C:\\'
      }
    });
  }

  /**
   * Terminate process via WMI
   */
  async terminateProcess(sessionId: string, processId: number): Promise<any> {
    const session = this.wmiSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    return this.invokeWMIMethod(session, {
      className: 'Win32_Process',
      methodName: 'Terminate',
      instance: `ProcessId=${processId}`
    });
  }
}

export default WMIProtocol;