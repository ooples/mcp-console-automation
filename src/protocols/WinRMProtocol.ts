import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import * as https from 'https';
import * as http from 'http';
import { Logger } from '../utils/logger.js';
import { 
  ConsoleSession, 
  SessionOptions, 
  ConsoleOutput,
  ConsoleType,
  WinRMConnectionOptions,
  WinRMSessionState
} from '../types/index.js';
import { IProtocol, ProtocolCapabilities, ProtocolHealthStatus } from '../core/ProtocolFactory.js';

interface WinRMSession {
  id: string;
  sessionId: string;
  state: WinRMSessionState;
  options: WinRMConnectionOptions;
  activeCommands: Map<string, {
    command: string;
    startTime: Date;
    status: 'running' | 'completed' | 'failed';
  }>;
}

export class WinRMProtocol extends EventEmitter implements IProtocol {
  readonly type: ConsoleType = 'winrm';
  readonly capabilities: ProtocolCapabilities = {
    supportsStreaming: true,
    supportsFileTransfer: true,
    supportsX11Forwarding: false,
    supportsPortForwarding: false,
    supportsAuthentication: true,
    supportsEncryption: true,
    supportsCompression: false,
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
    supportedEncodings: ['utf-8'],
    supportedAuthMethods: ['basic', 'negotiate', 'ntlm', 'kerberos'],
    platformSupport: {
      windows: true,
      linux: false,
      macos: false,
      freebsd: false
    }
  };
  readonly healthStatus: ProtocolHealthStatus = {
    isHealthy: true,
    lastChecked: new Date(),
    errors: [],
    warnings: [],
    metrics: {
      activeSessions: 0,
      totalSessions: 0,
      averageLatency: 0,
      successRate: 100,
      uptime: 0
    },
    dependencies: {
      winrm: {
        available: true,
        version: 'unknown'
      }
    }
  };
  private logger: Logger;
  private sessions: Map<string, WinRMSession> = new Map();
  private isInitialized = false;

  constructor() {
    super();
    this.logger = new Logger('WinRMProtocol');
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    
    this.logger.info('Initializing WinRM protocol');
    
    // Check if winrm command is available
    try {
      await this.executeWinRMCommand(['get', 'winrm/config'], {
        host: 'localhost',
        username: '',
        password: '',
        port: 5985,
        useSSL: false
      });
    } catch (error) {
      this.logger.warn('WinRM service may not be available:', error);
    }
    
    this.isInitialized = true;
    this.emit('initialized');
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const winrmOptions = options.winrmOptions;
    if (!winrmOptions) {
      throw new Error('WinRM options are required');
    }

    const sessionId = `winrm-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const session: WinRMSession = {
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
      activeCommands: new Map()
    };

    this.sessions.set(sessionId, session);

    try {
      await this.establishConnection(session);
      
      const consoleSession: ConsoleSession = {
        id: sessionId,
        type: 'winrm',
        status: 'running',
        createdAt: new Date(),
        lastActivity: new Date(),
        executionState: 'idle',
        command: options.command || '',
        args: options.args || [],
        cwd: 'C:\\', // Default working directory for WinRM
        env: options.environment || {},
        environment: options.environment || {},
        activeCommands: new Map(),
        winrmOptions
      };

      this.emit('sessionCreated', consoleSession);
      return consoleSession;
    } catch (error) {
      this.sessions.delete(sessionId);
      throw error;
    }
  }

  private async establishConnection(session: WinRMSession): Promise<void> {
    try {
      // Test connection with a simple command
      await this.executeWinRMCommand(['identify'], session.options);
      
      // Create a shell session
      const shellResponse = await this.createShell(session);
      session.state.shellId = this.extractShellId(shellResponse);
      session.state.isConnected = true;
      session.state.lastActivity = new Date();
      
      this.logger.info(`WinRM session established: ${session.id}`);
    } catch (error) {
      throw new Error(`Failed to establish WinRM connection: ${error}`);
    }
  }

  private async executeWinRMCommand(args: string[], options: WinRMConnectionOptions): Promise<string> {
    return new Promise((resolve, reject) => {
      const port = options.port || (options.useSSL ? 5986 : 5985);
      const winrmArgs = [
        '-r', `http${options.useSSL ? 's' : ''}://${options.host}:${port}/wsman`,
        '-u', options.username,
        ...(options.password ? ['-p', options.password] : []),
        ...args
      ];

      const process = spawn('winrm', winrmArgs);

      let stdout = '';
      let stderr = '';

      if (process.stdout) {
        process.stdout.on('data', (data: Buffer) => {
          stdout += data.toString();
        });
      }

      if (process.stderr) {
        process.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });
      }

      process.on('close', (code: number | null) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`WinRM command failed (exit code: ${code}): ${stderr || stdout}`));
        }
      });

      process.on('error', (error: Error) => {
        reject(error);
      });
    });
  }

  private async createShell(session: WinRMSession): Promise<string> {
    // Create shell using PowerShell if available, otherwise cmd
    const command = session.options.shell === 'powershell' ? 'powershell.exe' : 'cmd.exe';
    
    try {
      return await this.executeWinRMCommand([
        'invoke',
        'Create',
        'http://schemas.microsoft.com/wbem/wsman/1/windows/shell',
        '@{InputStreams="stdin";OutputStreams="stdout,stderr"}'
      ], session.options);
    } catch (error) {
      throw new Error(`Failed to create WinRM shell: ${error}`);
    }
  }

  private extractShellId(response: string): string {
    // Extract shell ID from WinRM response
    const match = response.match(/ShellId\s*:\s*([A-F0-9-]+)/i);
    return match ? match[1] : '';
  }

  async executeCommand(sessionId: string, command: string, args?: string[]): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (!session.state.isConnected) {
      throw new Error(`Session ${sessionId} is not connected`);
    }

    const commandId = `cmd-${Date.now()}`;
    session.activeCommands.set(commandId, {
      command,
      startTime: new Date(),
      status: 'running'
    });

    try {
      const result = await this.executeWinRMCommand([
        'invoke',
        'Command',
        `http://schemas.microsoft.com/wbem/wsman/1/windows/shell/ShellId/${session.state.shellId}`,
        `@{Command="${command}"}`
      ], session.options);

      session.state.lastActivity = new Date();
      session.activeCommands.delete(commandId);
      
      // Store result in session buffer for getOutput to retrieve
      session.state.outputBuffer.push({
        data: result,
        timestamp: new Date(),
        stream: 'stdout'
      });
    } catch (error) {
      session.activeCommands.delete(commandId);
      throw error;
    }
  }

  async sendInput(sessionId: string, input: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (!session.state.isConnected) {
      throw new Error(`Session ${sessionId} is not connected`);
    }

    // For WinRM, sending input is equivalent to executing a command
    await this.executeCommand(sessionId, input);
  }

  async getOutput(sessionId: string, since?: Date): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Return buffered output as string
    if (session.state.outputBuffer) {
      const output = session.state.outputBuffer
        .filter(item => !since || item.timestamp > since)
        .map(item => item.data)
        .join('\n');
      return output;
    }
    return '';
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.logger.warn(`Attempted to close non-existent session: ${sessionId}`);
      return;
    }

    try {
      if (session.state.shellId) {
        // Delete the shell
        await this.executeWinRMCommand([
          'invoke',
          'Delete',
          `http://schemas.microsoft.com/wbem/wsman/1/windows/shell/ShellId/${session.state.shellId}`
        ], session.options);
      }
    } catch (error) {
      this.logger.warn(`Error closing WinRM shell: ${error}`);
    }

    this.sessions.delete(sessionId);
    this.emit('sessionClosed', sessionId);
    this.logger.info(`Closed WinRM session: ${sessionId}`);
  }

  async listSessions(): Promise<string[]> {
    return Array.from(this.sessions.keys());
  }

  async getSessionStatus(sessionId: string): Promise<'running' | 'stopped' | 'error'> {
    const session = this.sessions.get(sessionId);
    if (!session) return 'stopped';
    return session.state.isConnected ? 'running' : 'stopped';
  }

  async getHealthStatus(): Promise<ProtocolHealthStatus> {
    const errors: string[] = [];
    let isHealthy = true;

    // Check if WinRM service is available
    try {
      await this.executeWinRMCommand(['get', 'winrm/config'], {
        host: 'localhost',
        username: 'test',
        password: 'test',
        port: 5985,
        useSSL: false
      });
    } catch (error) {
      isHealthy = false;
      errors.push('WinRM service is not accessible');
    }

    return {
      isHealthy,
      lastChecked: new Date(),
      errors,
      warnings: [],
      metrics: {
        activeSessions: this.sessions.size,
        totalSessions: this.sessions.size,
        averageLatency: 0,
        successRate: isHealthy ? 100 : 0,
        uptime: Date.now() - (this.healthStatus.lastChecked?.getTime() || Date.now())
      },
      dependencies: {
        winrm: {
          available: isHealthy,
          version: 'unknown'
        }
      }
    };
  }

  async dispose(): Promise<void> {
    this.logger.info('Disposing WinRM protocol');
    
    // Close all sessions
    const sessionIds = Array.from(this.sessions.keys());
    await Promise.all(sessionIds.map(id => this.closeSession(id)));
    
    this.isInitialized = false;
    this.removeAllListeners();
  }

  // Additional WinRM-specific methods

  async executeScript(sessionId: string, script: string, scriptType: 'powershell' | 'batch' = 'powershell'): Promise<ConsoleOutput> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const command = scriptType === 'powershell' 
      ? `powershell.exe -Command "${script.replace(/"/g, '\\"')}"` 
      : script;

    await this.executeCommand(sessionId, command);
    
    // Return the latest output
    const output = await this.getOutput(sessionId);
    return {
      sessionId,
      type: 'stdout',
      data: output,
      timestamp: new Date(),
      stream: 'stdout'
    };
  }

  async copyFile(sessionId: string, localPath: string, remotePath: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Use PowerShell Copy-Item for file transfer
    const command = `powershell.exe -Command "Copy-Item '${localPath}' '${remotePath}' -Force"`;
    await this.executeCommand(sessionId, command);
  }

  async getSystemInfo(sessionId: string): Promise<any> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    await this.executeCommand(sessionId, 'systeminfo');
    const output = await this.getOutput(sessionId);
    return this.parseSystemInfo(output);
  }

  private parseSystemInfo(output: any): any {
    if (typeof output !== 'string') {
      return {};
    }
    
    const lines = output.split('\n');
    const info: any = {};
    
    for (const line of lines) {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.substring(0, colonIndex).trim();
        const value = line.substring(colonIndex + 1).trim();
        if (key && value) {
          info[key] = value;
        }
      }
    }
    
    return info;
  }
}

export default WinRMProtocol;