import { spawn, ChildProcess } from 'child_process';
import * as https from 'https';
import * as http from 'http';
import * as xml2js from 'xml2js';
import * as crypto from 'crypto';
import { BaseProtocol } from '../core/BaseProtocol.js';
import { Logger } from '../utils/logger.js';
import {
  ConsoleSession,
  SessionOptions,
  ConsoleOutput,
  ConsoleType,
  WinRMConnectionOptions,
  WinRMSessionState
} from '../types/index.js';
import {
  SessionState,
  ProtocolCapabilities,
  ProtocolHealthStatus
} from '../core/IProtocol.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * WinRM session with enhanced state management
 */
interface WinRMSession {
  id: string;
  sessionId: string;
  state: WinRMSessionState;
  options: WinRMConnectionOptions;
  process?: ChildProcess;
  shellId?: string;
  commandId?: string;
  activeCommands: Map<string, {
    command: string;
    startTime: Date;
    status: 'running' | 'completed' | 'failed';
  }>;
  httpAgent?: http.Agent | https.Agent;
  lastSequenceId: number;
}

/**
 * WinRM Protocol implementation extending BaseProtocol
 * Provides Windows Remote Management capabilities with PowerShell and CMD support
 */
export class WinRMProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'winrm';
  public readonly capabilities: ProtocolCapabilities;

  private winrmSessions: Map<string, WinRMSession> = new Map();
  private winrmProcesses: Map<string, ChildProcess> = new Map();
  private healthStatus: ProtocolHealthStatus;
  private xmlBuilder: xml2js.Builder;
  private xmlParser: xml2js.Parser;

  constructor() {
    super('WinRMProtocol');

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
      maxConcurrentSessions: 10,
      defaultTimeout: 30000,
      supportedEncodings: ['utf-8', 'base64'],
      supportedAuthMethods: ['basic', 'negotiate', 'ntlm', 'kerberos', 'credssp'],
      platformSupport: {
        windows: true,
        linux: true,
        macos: true,
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
        winrm: {
          available: false,
          version: 'checking...'
        },
        powershell: {
          available: false,
          version: 'checking...'
        }
      }
    };

    this.xmlBuilder = new xml2js.Builder({
      rootName: 's:Envelope',
      xmldec: { version: '1.0', encoding: 'UTF-8' },
      renderOpts: { pretty: false }
    });

    this.xmlParser = new xml2js.Parser({
      explicitArray: false,
      ignoreAttrs: false
    });

    this.isInitialized = true;
  }

  /**
   * Initialize WinRM Protocol
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    this.logger.info('Initializing WinRM protocol');

    // Check for WinRM availability
    try {
      const winrmCheck = spawn('winrm', ['help'], { shell: true });
      await new Promise((resolve, reject) => {
        winrmCheck.on('exit', (code) => {
          if (code === 0) {
            this.healthStatus.dependencies.winrm = { available: true, version: 'system' };
            resolve(undefined);
          } else {
            reject(new Error('WinRM not found'));
          }
        });
        winrmCheck.on('error', reject);
      });
    } catch {
      this.logger.warn('WinRM command not found, will use HTTP/SOAP implementation');
      this.healthStatus.dependencies.winrm = { available: false, version: 'soap' };
    }

    // Check for PowerShell
    try {
      const psCheck = spawn('powershell', ['-Version'], { shell: true });
      await new Promise((resolve, reject) => {
        psCheck.on('exit', (code) => {
          if (code === 0) {
            this.healthStatus.dependencies.powershell = { available: true, version: 'system' };
            resolve(undefined);
          } else {
            reject(new Error('PowerShell not found'));
          }
        });
        psCheck.on('error', reject);
      });
    } catch {
      this.healthStatus.dependencies.powershell = { available: false, version: 'not installed' };
    }

    this.isInitialized = true;
    this.emit('initialized');
  }

  /**
   * Create session with BaseProtocol integration
   */
  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const sessionId = `winrm-${Date.now()}-${uuidv4().substring(0, 8)}`;
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
    const winrmOptions = options.winrmOptions;
    if (!winrmOptions) {
      throw new Error('WinRM options are required');
    }

    const winrmSession: WinRMSession = {
      id: sessionId,
      sessionId,
      state: {
        sessionId,
        isConnected: false,
        shellId: '',
        lastActivity: new Date(),
        outputBuffer: []
      },
      options: winrmOptions,
      activeCommands: new Map(),
      lastSequenceId: 0
    };

    this.winrmSessions.set(sessionId, winrmSession);

    try {
      await this.establishConnection(winrmSession);

      const session: ConsoleSession = {
        id: sessionId,
        type: 'winrm',
        status: 'running',
        createdAt: new Date(),
        lastActivity: new Date(),
        executionState: 'idle',
        command: options.command || 'powershell.exe',
        args: options.args || [],
        cwd: options.cwd || 'C:\\',
        env: options.environment || {},
        environment: options.environment || {},
        activeCommands: new Map(),
        streaming: options.streaming ?? true,
        winrmOptions
      };

      this.sessions.set(sessionId, session);
      this.emit('sessionCreated', session);

      // Add initial output
      this.addToOutputBuffer(sessionId, {
        sessionId,
        type: 'stdout',
        data: `WinRM session established to ${winrmOptions.host}\n`,
        timestamp: new Date(),
        raw: ''
      });

      return session;
    } catch (error) {
      this.winrmSessions.delete(sessionId);
      throw error;
    }
  }

  /**
   * Establish WinRM connection
   */
  private async establishConnection(session: WinRMSession): Promise<void> {
    try {
      // Create HTTP agent for connection pooling
      const protocol = session.options.useSSL ? 'https:' : 'http:';
      const port = session.options.port || (session.options.useSSL ? 5986 : 5985);

      if (session.options.useSSL) {
        session.httpAgent = new https.Agent({
          rejectUnauthorized: session.options.verifyCertificate !== false,
          keepAlive: true,
          maxSockets: 5
        });
      } else {
        session.httpAgent = new http.Agent({
          keepAlive: true,
          maxSockets: 5
        });
      }

      // Test connection
      if (this.healthStatus.dependencies.winrm?.available) {
        await this.executeWinRMCommand(['identify'], session.options);
      } else {
        // Use SOAP/HTTP implementation
        await this.sendSOAPRequest(session, this.buildIdentifyRequest());
      }

      // Create shell
      const shellResponse = await this.createShell(session);
      session.shellId = await this.extractShellId(shellResponse);
      session.state.shellId = session.shellId;
      session.state.isConnected = true;
      session.state.lastActivity = new Date();

      this.logger.info(`WinRM session established: ${session.id}`);
    } catch (error) {
      throw new Error(`Failed to establish WinRM connection: ${error}`);
    }
  }

  /**
   * Execute WinRM command using CLI tool
   */
  private async executeWinRMCommand(args: string[], options: WinRMConnectionOptions): Promise<string> {
    return new Promise((resolve, reject) => {
      const port = options.port || (options.useSSL ? 5986 : 5985);
      const winrmArgs = [
        '-r', `http${options.useSSL ? 's' : ''}://${options.host}:${port}/wsman`,
        '-u', `${options.domain ? options.domain + '\\' : ''}${options.username}`,
        ...(options.password ? ['-p', options.password] : []),
        ...(options.authMethod ? ['-a', options.authMethod] : []),
        ...(options.timeout ? ['-timeout', options.timeout.toString()] : []),
        ...args
      ];

      const winrmProcess = spawn('winrm', winrmArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env }
      });

      let stdout = '';
      let stderr = '';

      winrmProcess.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      winrmProcess.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      winrmProcess.on('close', (code: number | null) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`WinRM command failed (exit code: ${code}): ${stderr || stdout}`));
        }
      });

      winrmProcess.on('error', (error: Error) => {
        reject(error);
      });
    });
  }

  /**
   * Send SOAP request for HTTP implementation
   */
  private async sendSOAPRequest(session: WinRMSession, soapBody: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const port = session.options.port || (session.options.useSSL ? 5986 : 5985);
      const protocol = session.options.useSSL ? 'https:' : 'http:';

      const authHeader = this.buildAuthHeader(session.options);

      const options = {
        hostname: session.options.host,
        port,
        path: '/wsman',
        method: 'POST',
        headers: {
          'Content-Type': 'application/soap+xml;charset=UTF-8',
          'Authorization': authHeader,
          'Content-Length': Buffer.byteLength(soapBody)
        },
        agent: session.httpAgent
      };

      const request = (session.options.useSSL ? https : http).request(options, (response) => {
        let data = '';

        response.on('data', (chunk) => {
          data += chunk.toString();
        });

        response.on('end', () => {
          if (response.statusCode === 200) {
            resolve(data);
          } else {
            reject(new Error(`SOAP request failed with status ${response.statusCode}: ${data}`));
          }
        });
      });

      request.on('error', reject);
      request.write(soapBody);
      request.end();
    });
  }

  /**
   * Build authentication header
   */
  private buildAuthHeader(options: WinRMConnectionOptions): string {
    const authMethod = options.authMethod || 'basic';

    switch (authMethod.toLowerCase()) {
      case 'basic':
        const credentials = `${options.domain ? options.domain + '\\' : ''}${options.username}:${options.password || ''}`;
        return `Basic ${Buffer.from(credentials).toString('base64')}`;

      case 'ntlm':
        // NTLM would require more complex implementation
        return this.buildNTLMAuth(options);

      case 'kerberos':
        // Kerberos would require GSSAPI
        return this.buildKerberosAuth(options);

      default:
        return `Basic ${Buffer.from(`${options.username}:${options.password || ''}`).toString('base64')}`;
    }
  }

  /**
   * Build NTLM authentication (simplified)
   */
  private buildNTLMAuth(options: WinRMConnectionOptions): string {
    // This is a simplified implementation
    // Real NTLM requires challenge-response
    return `NTLM ${Buffer.from(`${options.domain}\\${options.username}:${options.password}`).toString('base64')}`;
  }

  /**
   * Build Kerberos authentication (simplified)
   */
  private buildKerberosAuth(options: WinRMConnectionOptions): string {
    // This is a simplified implementation
    // Real Kerberos requires ticket granting
    return `Negotiate ${Buffer.from(`${options.username}@${options.domain}`).toString('base64')}`;
  }

  /**
   * Build identify request
   */
  private buildIdentifyRequest(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:wsmid="http://schemas.dmtf.org/wbem/wsman/identity/1/wsmanidentity.xsd">
  <s:Header/>
  <s:Body>
    <wsmid:Identify/>
  </s:Body>
</s:Envelope>`;
  }

  /**
   * Create shell
   */
  private async createShell(session: WinRMSession): Promise<string> {
    const shell = session.options.shell || 'powershell';
    const command = shell === 'cmd' ? 'cmd.exe' : 'powershell.exe';

    try {
      if (this.healthStatus.dependencies.winrm?.available) {
        return await this.executeWinRMCommand([
          'invoke',
          'Create',
          'http://schemas.microsoft.com/wbem/wsman/1/windows/shell',
          `@{InputStreams="stdin";OutputStreams="stdout,stderr";Shell="${command}"}`
        ], session.options);
      } else {
        // Use SOAP implementation
        const soapRequest = this.buildCreateShellRequest(command);
        return await this.sendSOAPRequest(session, soapRequest);
      }
    } catch (error) {
      throw new Error(`Failed to create WinRM shell: ${error}`);
    }
  }

  /**
   * Build create shell SOAP request
   */
  private buildCreateShellRequest(shell: string): string {
    const messageId = uuidv4();
    return `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
            xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing"
            xmlns:wsman="http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd"
            xmlns:rsp="http://schemas.microsoft.com/wbem/wsman/1/windows/shell">
  <s:Header>
    <wsa:To>http://windows-host:5985/wsman</wsa:To>
    <wsa:ResourceURI s:mustUnderstand="true">http://schemas.microsoft.com/wbem/wsman/1/windows/shell/cmd</wsa:ResourceURI>
    <wsa:ReplyTo>
      <wsa:Address s:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</wsa:Address>
    </wsa:ReplyTo>
    <wsa:Action s:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2004/09/transfer/Create</wsa:Action>
    <wsa:MessageID>uuid:${messageId}</wsa:MessageID>
  </s:Header>
  <s:Body>
    <rsp:Shell>
      <rsp:InputStreams>stdin</rsp:InputStreams>
      <rsp:OutputStreams>stdout stderr</rsp:OutputStreams>
      <rsp:Environment>
        <rsp:Variable Name="PATHEXT" Value=".COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC;.CPL"/>
        <rsp:Variable Name="COMSPEC" Value="C:\\Windows\\system32\\cmd.exe"/>
      </rsp:Environment>
      <rsp:WorkingDirectory>C:\\</rsp:WorkingDirectory>
      <rsp:IdleTimeout>PT60S</rsp:IdleTimeout>
    </rsp:Shell>
  </s:Body>
</s:Envelope>`;
  }

  /**
   * Extract shell ID from response
   */
  private async extractShellId(response: string): Promise<string> {
    const match = response.match(/ShellId[>:]?\s*([A-F0-9-]+)/i);
    if (match) return match[1];

    // Try parsing as XML
    try {
      const result = await xml2js.parseStringPromise(response);
      const body = result?.["s:Envelope"]?.["s:Body"]?.[0];
      const shell = body?.["rsp:Shell"]?.[0] || body?.["x:Shell"]?.[0];
      const shellId = shell?.["rsp:ShellId"]?.[0] || shell?.["x:ShellId"]?.[0];
      if (shellId && typeof shellId === "string") return shellId;
    } catch {}
    return uuidv4(); // Fallback to generated ID
  }

  /**
   * Execute command in session
   */
  async executeCommand(sessionId: string, command: string, args?: string[]): Promise<void> {
    const session = this.winrmSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (!session.state.isConnected) {
      throw new Error(`Session ${sessionId} is not connected`);
    }

    const commandId = `cmd-${Date.now()}`;
    const fullCommand = args ? `${command} ${args.join(' ')}` : command;

    session.activeCommands.set(commandId, {
      command: fullCommand,
      startTime: new Date(),
      status: 'running'
    });

    try {
      let result: string;

      if (this.healthStatus.dependencies.winrm?.available) {
        result = await this.executeWinRMCommand([
          'invoke',
          'Command',
          `http://schemas.microsoft.com/wbem/wsman/1/windows/shell/ShellId/${session.state.shellId}`,
          `@{Command="${fullCommand}"}`
        ], session.options);
      } else {
        // Use SOAP implementation
        const soapRequest = this.buildCommandRequest(session.shellId!, fullCommand);
        result = await this.sendSOAPRequest(session, soapRequest);
      }

      session.state.lastActivity = new Date();
      session.activeCommands.get(commandId)!.status = 'completed';

      // Parse and store output
      const output = this.parseCommandOutput(result);
      this.addToOutputBuffer(sessionId, {
        sessionId,
        type: 'stdout',
        data: output,
        timestamp: new Date(),
        raw: result
      });

    } catch (error) {
      const cmd = session.activeCommands.get(commandId);
      if (cmd) cmd.status = 'failed';

      this.addToOutputBuffer(sessionId, {
        sessionId,
        type: 'stderr',
        data: `Error executing command: ${error}`,
        timestamp: new Date(),
        raw: ''
      });

      throw error;
    } finally {
      session.activeCommands.delete(commandId);
    }
  }

  /**
   * Build command SOAP request
   */
  private buildCommandRequest(shellId: string, command: string): string {
    const messageId = uuidv4();
    const commandId = uuidv4();

    return `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
            xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing"
            xmlns:rsp="http://schemas.microsoft.com/wbem/wsman/1/windows/shell">
  <s:Header>
    <wsa:To>http://windows-host:5985/wsman</wsa:To>
    <wsa:ResourceURI s:mustUnderstand="true">http://schemas.microsoft.com/wbem/wsman/1/windows/shell/cmd</wsa:ResourceURI>
    <wsa:ReplyTo>
      <wsa:Address s:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</wsa:Address>
    </wsa:ReplyTo>
    <wsa:Action s:mustUnderstand="true">http://schemas.microsoft.com/wbem/wsman/1/windows/shell/Command</wsa:Action>
    <wsa:MessageID>uuid:${messageId}</wsa:MessageID>
    <wsman:Selector Name="ShellId">${shellId}</wsman:Selector>
  </s:Header>
  <s:Body>
    <rsp:CommandLine CommandId="${commandId}">
      <rsp:Command>${this.escapeXML(command)}</rsp:Command>
    </rsp:CommandLine>
  </s:Body>
</s:Envelope>`;
  }

  /**
   * Escape XML special characters
   */
  private escapeXML(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Parse command output from response
   */
  private parseCommandOutput(response: string): string {
    // Try to extract output from various response formats

    // Try plain text extraction
    const outputMatch = response.match(/(?:stdout|Output)[>:]?\s*([^<\n]+)/i);
    if (outputMatch) return outputMatch[1];

    // Try base64 encoded output
    const base64Match = response.match(/(?:Stream Name="stdout"[^>]*>)([A-Za-z0-9+/=]+)/);
    if (base64Match) {
      try {
        return Buffer.from(base64Match[1], 'base64').toString('utf-8');
      } catch {}
    }

    // Return raw response as fallback
    return response;
  }

  /**
   * Send input to session
   */
  async sendInput(sessionId: string, input: string): Promise<void> {
    const session = this.winrmSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (!session.state.isConnected) {
      throw new Error(`Session ${sessionId} is not connected`);
    }

    // For WinRM, sending input means executing it as a command
    await this.executeCommand(sessionId, input);
  }

  /**
   * Close session
   */
  async closeSession(sessionId: string): Promise<void> {
    const session = this.winrmSessions.get(sessionId);
    if (!session) {
      this.logger.warn(`Attempted to close non-existent session: ${sessionId}`);
      return;
    }

    try {
      if (session.shellId) {
        // Delete the shell
        if (this.healthStatus.dependencies.winrm?.available) {
          await this.executeWinRMCommand([
            'invoke',
            'Delete',
            `http://schemas.microsoft.com/wbem/wsman/1/windows/shell/ShellId/${session.shellId}`
          ], session.options);
        } else {
          // Use SOAP to delete shell
          const soapRequest = this.buildDeleteShellRequest(session.shellId);
          await this.sendSOAPRequest(session, soapRequest);
        }
      }
    } catch (error) {
      this.logger.warn(`Error closing WinRM shell: ${error}`);
    }

    // Clean up session
    this.winrmSessions.delete(sessionId);
    this.sessions.delete(sessionId);
    this.markSessionComplete(sessionId);

    this.emit('sessionClosed', sessionId);
    this.logger.info(`Closed WinRM session: ${sessionId}`);
  }

  /**
   * Build delete shell SOAP request
   */
  private buildDeleteShellRequest(shellId: string): string {
    const messageId = uuidv4();

    return `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
            xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing">
  <s:Header>
    <wsa:To>http://windows-host:5985/wsman</wsa:To>
    <wsa:ResourceURI s:mustUnderstand="true">http://schemas.microsoft.com/wbem/wsman/1/windows/shell/cmd</wsa:ResourceURI>
    <wsa:ReplyTo>
      <wsa:Address s:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</wsa:Address>
    </wsa:ReplyTo>
    <wsa:Action s:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2004/09/transfer/Delete</wsa:Action>
    <wsa:MessageID>uuid:${messageId}</wsa:MessageID>
    <wsman:Selector Name="ShellId">${shellId}</wsman:Selector>
  </s:Header>
  <s:Body/>
</s:Envelope>`;
  }

  /**
   * Get health status
   */
  async getHealthStatus(): Promise<ProtocolHealthStatus> {
    const baseHealth = await super.getHealthStatus();

    this.healthStatus.metrics.activeSessions = this.winrmSessions.size;
    this.healthStatus.lastChecked = new Date();

    return {
      ...baseHealth,
      ...this.healthStatus,
      metrics: {
        ...baseHealth.metrics,
        activeSessions: this.winrmSessions.size
      }
    };
  }

  /**
   * Dispose of protocol resources
   */
  async dispose(): Promise<void> {
    this.logger.info('Disposing WinRM protocol');

    // Close all sessions
    const sessionIds = Array.from(this.winrmSessions.keys());
    await Promise.all(sessionIds.map(id => this.closeSession(id)));

    // Clean up
    await super.cleanup();
  }

  // Additional WinRM-specific methods

  /**
   * Execute PowerShell script
   */
  async executeScript(sessionId: string, script: string, scriptType: 'powershell' | 'batch' = 'powershell'): Promise<ConsoleOutput> {
    const session = this.winrmSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const command = scriptType === 'powershell'
      ? `powershell.exe -EncodedCommand ${Buffer.from(script, 'utf16le').toString('base64')}`
      : script;

    await this.executeCommand(sessionId, command);

    // Return the latest output
    const outputs = await this.getOutput(sessionId);
    const latestOutput = outputs[outputs.length - 1];

    return latestOutput || {
      sessionId,
      type: 'stdout',
      data: '',
      timestamp: new Date(),
      raw: ''
    };
  }

  /**
   * Copy file using WinRM
   */
  async copyFile(sessionId: string, localPath: string, remotePath: string): Promise<void> {
    const session = this.winrmSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Read local file
    const fs = require('fs');
    const fileContent = fs.readFileSync(localPath);
    const base64Content = fileContent.toString('base64');

    // Use PowerShell to write file on remote system
    const script = `
$content = [System.Convert]::FromBase64String('${base64Content}')
[System.IO.File]::WriteAllBytes('${remotePath}', $content)
`;

    await this.executeScript(sessionId, script, 'powershell');
  }

  /**
   * Get system information
   */
  async getSystemInfo(sessionId: string): Promise<any> {
    const session = this.winrmSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const script = `
Get-WmiObject -Class Win32_ComputerSystem | ConvertTo-Json
`;

    const output = await this.executeScript(sessionId, script, 'powershell');

    try {
      return JSON.parse(output.data);
    } catch {
      return { raw: output.data };
    }
  }

  /**
   * Run remote PowerShell command with structured output
   */
  async runPowerShell(sessionId: string, command: string): Promise<any> {
    const script = `
try {
  $result = ${command}
  @{
    Success = $true
    Output = $result
    Error = $null
  } | ConvertTo-Json -Depth 10
} catch {
  @{
    Success = $false
    Output = $null
    Error = $_.Exception.Message
  } | ConvertTo-Json
}
`;

    const output = await this.executeScript(sessionId, script, 'powershell');

    try {
      return JSON.parse(output.data);
    } catch {
      return { Success: false, Output: output.data, Error: 'Failed to parse output' };
    }
  }
}

export default WinRMProtocol;