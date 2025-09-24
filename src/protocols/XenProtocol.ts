import { ChildProcess, spawn } from 'child_process';
import * as https from 'https';
import * as http from 'http';
import * as fs from 'fs/promises';
import * as path from 'path';
import { BaseProtocol } from '../core/BaseProtocol.js';
import {
  ProtocolCapabilities,
  ProtocolHealthStatus,
  SessionState
} from '../core/IProtocol.js';
import {
  ConsoleSession,
  SessionOptions,
  ConsoleType,
  ConsoleOutput
} from '../types/index.js';

/**
 * Xen connection configuration
 */
interface XenConfig {
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  sessionId?: string;
  poolMaster?: string;
  useSSL?: boolean;
  apiVersion?: string;
  xenToolsPath?: string;
  connectionType?: 'xe' | 'xapi' | 'xl' | 'ssh';
  sshKeyFile?: string;
  timeout?: number;
}

/**
 * VM (Virtual Machine) information
 */
interface XenVM {
  uuid: string;
  name: string;
  powerState: 'Running' | 'Halted' | 'Paused' | 'Suspended';
  cpus: number;
  memory: number;
  disks: XenVDI[];
  networks: XenVIF[];
  host?: string;
  osVersion?: string;
  pvDriversVersion?: string;
  metrics?: XenVMMetrics;
}

/**
 * Virtual Disk Image
 */
interface XenVDI {
  uuid: string;
  name?: string;
  size: number;
  type: 'system' | 'user' | 'ephemeral' | 'suspend' | 'crashdump';
  sr: string; // Storage Repository
}

/**
 * Virtual Interface
 */
interface XenVIF {
  uuid: string;
  device: string;
  mac: string;
  network: string;
  ipv4?: string[];
  ipv6?: string[];
}

/**
 * VM metrics
 */
interface XenVMMetrics {
  cpuUsage: number;
  memoryUsage: number;
  diskRead: number;
  diskWrite: number;
  networkRead: number;
  networkWrite: number;
  uptime: number;
}

/**
 * Host information
 */
interface XenHost {
  uuid: string;
  name: string;
  address: string;
  cpuInfo: {
    count: number;
    speed: number;
    model: string;
  };
  memory: {
    total: number;
    free: number;
  };
  software: {
    version: string;
    build: string;
  };
}

/**
 * Xen session state
 */
interface XenSession extends ConsoleSession {
  config: XenConfig;
  process?: ChildProcess;
  apiSession?: string;
  isConnected: boolean;
  lastCommand?: string;
  vmConsoles: Map<string, ChildProcess>; // VM UUID -> console process
  cachedHosts?: XenHost[];
  cachedVMs?: XenVM[];
  commandQueue: string[];
  interactive: boolean;
}

/**
 * Xen Hypervisor Protocol Implementation
 * Supports XenServer, Xen Cloud Platform (XCP), and Xen open source hypervisor
 */
export class XenProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'xen';
  public readonly capabilities: ProtocolCapabilities = {
    supportsStreaming: true,
    supportsFileTransfer: true,
    supportsX11Forwarding: false,
    supportsPortForwarding: true,
    supportsAuthentication: true,
    supportsEncryption: true,
    supportsCompression: true,
    supportsMultiplexing: true,
    supportsKeepAlive: true,
    supportsReconnection: true,
    supportsBinaryData: false,
    supportsCustomEnvironment: true,
    supportsWorkingDirectory: true,
    supportsSignals: true,
    supportsResizing: false,
    supportsPTY: true,
    maxConcurrentSessions: 20,
    defaultTimeout: 30000,
    supportedEncodings: ['utf-8'],
    supportedAuthMethods: ['password', 'session', 'key'],
    platformSupport: {
      windows: false,
      linux: true,
      macos: false,
      freebsd: true,
    },
  };

  private xenSessions: Map<string, XenSession> = new Map();
  private defaultConfig: Partial<XenConfig> = {
    port: 443,
    useSSL: true,
    apiVersion: '2.0',
    connectionType: 'xe',
    timeout: 30000
  };

  constructor() {
    super('XenProtocol');
  }

  async initialize(): Promise<void> {
    this.logger.info('Initializing Xen protocol');

    try {
      await this.checkDependencies();
      this.isInitialized = true;
      this.logger.info('Xen protocol initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Xen protocol:', error);
      throw error;
    }
  }

  private async checkDependencies(): Promise<void> {
    const dependencies: Record<string, boolean> = {};

    // Check for xe CLI tool
    try {
      await this.executeSystemCommand('xe', ['--version']);
      dependencies.xe = true;
    } catch {
      dependencies.xe = false;
      this.logger.debug('xe CLI not found');
    }

    // Check for xl tool (Xen management tool)
    try {
      await this.executeSystemCommand('xl', ['info']);
      dependencies.xl = true;
    } catch {
      dependencies.xl = false;
      this.logger.debug('xl tool not found');
    }

    // Check for xm tool (legacy)
    try {
      await this.executeSystemCommand('xm', ['info']);
      dependencies.xm = true;
    } catch {
      dependencies.xm = false;
    }

    // Check for virsh with Xen support
    try {
      const result = await this.executeSystemCommand('virsh', ['--version']);
      if (result.includes('Xen')) {
        dependencies.virsh = true;
      }
    } catch {
      dependencies.virsh = false;
    }

    // Store dependencies for later use
    (this as any)._dependencies = dependencies;
  }

  /**
   * Create a new session
   */
  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const sessionId = this.generateSessionId();
    const sessionState: SessionState = {
      sessionId: sessionId,
      status: 'initializing',
      isOneShot: this.isOneShotCommand(options),
      isPersistent: !this.isOneShotCommand(options),
      createdAt: new Date(),
      lastActivity: new Date()
    };
    return this.doCreateSession(sessionId, options, sessionState);
  }

  private generateSessionId(): string {
    return `xen-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }

  protected async doCreateSession(
    sessionId: string,
    options: SessionOptions,
    sessionState: SessionState
  ): Promise<ConsoleSession> {
    const config = this.parseXenOptions(options);

    const session: XenSession = {
      id: sessionId,
      type: 'xen',
      status: 'initializing',
      command: options.command || 'xe',
      args: options.args || [],
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...options.env },
      createdAt: new Date(),
      streaming: options.streaming ?? true,
      config,
      isConnected: false,
      vmConsoles: new Map(),
      commandQueue: [],
      interactive: !sessionState.isOneShot,
      executionState: 'idle' as const,
      activeCommands: new Map()
    };

    this.xenSessions.set(sessionId, session);
    this.sessions.set(sessionId, session);

    try {
      // Connect to Xen based on connection type
      await this.connectToXen(sessionId, session);

      session.status = 'running';
      sessionState.status = 'running';

      return session;
    } catch (error) {
      session.status = 'stopped';
      session.exitCode = 1;
      sessionState.status = 'stopped';
      throw error;
    }
  }

  private parseXenOptions(options: SessionOptions): XenConfig {
    const config: XenConfig = { ...this.defaultConfig };

    // Parse from args if provided
    if (options.args) {
      const args = options.args;
      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        const nextArg = args[i + 1];

        switch (arg) {
          case '-s':
          case '--server':
          case '--host':
            config.host = nextArg;
            i++;
            break;
          case '-p':
          case '--port':
            config.port = parseInt(nextArg);
            i++;
            break;
          case '-u':
          case '--username':
            config.username = nextArg;
            i++;
            break;
          case '--password':
          case '-pw':
            config.password = nextArg;
            i++;
            break;
          case '--session':
            config.sessionId = nextArg;
            i++;
            break;
          case '--nossl':
            config.useSSL = false;
            break;
          case '--key':
            config.sshKeyFile = nextArg;
            i++;
            break;
        }
      }
    }

    // Parse from environment variables
    if (options.env) {
      if (options.env.XEN_HOST) config.host = options.env.XEN_HOST;
      if (options.env.XEN_USER) config.username = options.env.XEN_USER;
      if (options.env.XEN_PASSWORD) config.password = options.env.XEN_PASSWORD;
      if (options.env.XEN_PORT) config.port = parseInt(options.env.XEN_PORT);
    }

    // Determine connection type based on available tools
    const deps = (this as any)._dependencies || {};
    if (!config.connectionType) {
      if (deps.xe) {
        config.connectionType = 'xe';
      } else if (deps.xl) {
        config.connectionType = 'xl';
      } else {
        config.connectionType = 'xapi'; // Try XAPI
      }
    }

    return config;
  }

  private async connectToXen(sessionId: string, session: XenSession): Promise<void> {
    const config = session.config;

    switch (config.connectionType) {
      case 'xe':
        await this.connectWithXE(sessionId, session);
        break;
      case 'xl':
        await this.connectWithXL(sessionId, session);
        break;
      case 'xapi':
        await this.connectWithXAPI(sessionId, session);
        break;
      case 'ssh':
        await this.connectWithSSH(sessionId, session);
        break;
      default:
        throw new Error(`Unknown connection type: ${config.connectionType}`);
    }
  }

  private async connectWithXE(sessionId: string, session: XenSession): Promise<void> {
    const config = session.config;

    if (session.interactive) {
      // Interactive xe shell
      const args: string[] = [];

      // Add server connection if remote
      if (config.host) {
        args.push('-s', config.host);
        if (config.port && config.port !== 443) {
          args.push('-p', config.port.toString());
        }
      }

      // Add credentials
      if (config.username) {
        args.push('-u', config.username);
      }
      if (config.password) {
        args.push('-pw', config.password);
      }

      // Start xe process
      session.process = spawn('xe', args, {
        cwd: session.cwd,
        env: session.env
      });

      session.isConnected = true;

      // Handle process output
      session.process.stdout?.on('data', (data: Buffer) => {
        this.handleXEOutput(sessionId, data.toString());
      });

      session.process.stderr?.on('data', (data: Buffer) => {
        this.addToOutputBuffer(sessionId, {
          sessionId,
          type: 'stderr',
          data: data.toString(),
          timestamp: new Date()
        });
      });

      session.process.on('exit', (code, signal) => {
        session.isConnected = false;
        session.exitCode = code ?? undefined;
        session.status = 'stopped';
        this.markSessionComplete(sessionId, code ?? 0);
      });

      // Verify connection
      await this.executeXECommand(sessionId, 'host-list', ['params=uuid,name-label']);
    } else {
      // One-shot xe command
      const command = session.args[0] || 'host-list';
      const cmdArgs = session.args.slice(1);

      const args: string[] = [];

      // Add server connection
      if (config.host) {
        args.push('-s', config.host);
      }
      if (config.username) {
        args.push('-u', config.username);
      }
      if (config.password) {
        args.push('-pw', config.password);
      }

      // Add the actual command
      args.push(command, ...cmdArgs);

      // Execute command
      const result = await this.executeSystemCommand('xe', args);

      this.addToOutputBuffer(sessionId, {
        sessionId,
        type: 'stdout',
        data: result,
        timestamp: new Date()
      });

      session.isConnected = false;
      session.status = 'stopped';
      this.markSessionComplete(sessionId, 0);
    }
  }

  private async connectWithXL(sessionId: string, session: XenSession): Promise<void> {
    // xl is typically used for local Xen management
    if (session.config.host && session.config.host !== 'localhost') {
      throw new Error('xl tool only supports local Xen management. Use SSH for remote.');
    }

    if (session.interactive) {
      // Start xl shell
      session.process = spawn('xl', ['shell'], {
        cwd: session.cwd,
        env: session.env
      });

      session.isConnected = true;

      session.process.stdout?.on('data', (data: Buffer) => {
        this.addToOutputBuffer(sessionId, {
          sessionId,
          type: 'stdout',
          data: data.toString(),
          timestamp: new Date()
        });
      });

      session.process.stderr?.on('data', (data: Buffer) => {
        this.addToOutputBuffer(sessionId, {
          sessionId,
          type: 'stderr',
          data: data.toString(),
          timestamp: new Date()
        });
      });

      session.process.on('exit', (code, signal) => {
        session.isConnected = false;
        session.exitCode = code ?? undefined;
        session.status = 'stopped';
      });
    } else {
      // One-shot xl command
      const command = session.args[0] || 'list';
      const cmdArgs = session.args.slice(1);

      const result = await this.executeSystemCommand('xl', [command, ...cmdArgs]);

      this.addToOutputBuffer(sessionId, {
        sessionId,
        type: 'stdout',
        data: result,
        timestamp: new Date()
      });

      session.status = 'stopped';
      this.markSessionComplete(sessionId, 0);
    }
  }

  private async connectWithXAPI(sessionId: string, session: XenSession): Promise<void> {
    const config = session.config;

    if (!config.host) {
      throw new Error('XAPI connection requires a host');
    }

    // Login to XAPI
    const apiSession = await this.xapiLogin(config);
    session.apiSession = apiSession;
    session.isConnected = true;

    this.addToOutputBuffer(sessionId, {
      sessionId,
      type: 'stdout',
      data: `Connected to Xen API at ${config.host}\nSession: ${apiSession}\n`,
      timestamp: new Date()
    });

    // If one-shot, mark as complete
    if (!session.interactive) {
      session.status = 'stopped';
      this.markSessionComplete(sessionId, 0);
    }
  }

  private async connectWithSSH(sessionId: string, session: XenSession): Promise<void> {
    const config = session.config;

    if (!config.host) {
      throw new Error('SSH connection requires a host');
    }

    const args: string[] = [];

    // SSH options
    if (config.sshKeyFile) {
      args.push('-i', config.sshKeyFile);
    }
    if (config.port && config.port !== 22) {
      args.push('-p', config.port.toString());
    }

    // User@host
    const target = config.username ? `${config.username}@${config.host}` : config.host;
    args.push(target);

    // If one-shot, add the command
    if (!session.interactive && session.args.length > 0) {
      args.push('xe', ...session.args);
    }

    // Start SSH process
    session.process = spawn('ssh', args, {
      cwd: session.cwd,
      env: session.env
    });

    session.isConnected = true;

    session.process.stdout?.on('data', (data: Buffer) => {
      this.addToOutputBuffer(sessionId, {
        sessionId,
        type: 'stdout',
        data: data.toString(),
        timestamp: new Date()
      });
    });

    session.process.stderr?.on('data', (data: Buffer) => {
      this.addToOutputBuffer(sessionId, {
        sessionId,
        type: 'stderr',
        data: data.toString(),
        timestamp: new Date()
      });
    });

    session.process.on('exit', (code, signal) => {
      session.isConnected = false;
      session.exitCode = code ?? undefined;
      session.status = 'stopped';
      this.markSessionComplete(sessionId, code ?? 0);
    });
  }

  private async xapiLogin(config: XenConfig): Promise<string> {
    return new Promise((resolve, reject) => {
      const protocol = config.useSSL ? https : http;
      const postData = JSON.stringify({
        jsonrpc: '2.0',
        method: 'session.login_with_password',
        params: [config.username || 'root', config.password || ''],
        id: 1
      });

      const options = {
        hostname: config.host,
        port: config.port || 443,
        path: '/jsonrpc',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        },
        rejectUnauthorized: false // Allow self-signed certificates
      };

      const req = protocol.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            if (response.result && response.result.Status === 'Success') {
              resolve(response.result.Value);
            } else {
              reject(new Error(response.error?.message || 'Login failed'));
            }
          } catch (error) {
            reject(error);
          }
        });
      });

      req.on('error', reject);
      req.write(postData);
      req.end();
    });
  }

  private async executeXECommand(sessionId: string, command: string, args: string[]): Promise<string> {
    const session = this.xenSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (session.process && session.process.stdin) {
      // Send command to xe process
      const fullCommand = `${command} ${args.join(' ')}\n`;
      session.process.stdin.write(fullCommand);
      session.lastCommand = command;
      return '';
    } else {
      // Execute as separate command
      const config = session.config;
      const xeArgs: string[] = [];

      if (config.host) {
        xeArgs.push('-s', config.host);
      }
      if (config.username) {
        xeArgs.push('-u', config.username);
      }
      if (config.password) {
        xeArgs.push('-pw', config.password);
      }

      xeArgs.push(command, ...args);

      return await this.executeSystemCommand('xe', xeArgs);
    }
  }

  private handleXEOutput(sessionId: string, output: string): void {
    const session = this.xenSessions.get(sessionId);
    if (!session) return;

    // Parse xe output for special cases
    if (output.includes('uuid')) {
      // Parse VM or host information
      this.parseXenObjects(sessionId, output);
    }

    this.addToOutputBuffer(sessionId, {
      sessionId,
      type: 'stdout',
      data: output,
      timestamp: new Date()
    });
  }

  private parseXenObjects(sessionId: string, output: string): void {
    const session = this.xenSessions.get(sessionId);
    if (!session) return;

    // Simple parsing of xe output format
    const lines = output.split('\n');
    let currentObject: any = {};

    for (const line of lines) {
      if (line.trim() === '') {
        // End of object
        if (currentObject.uuid) {
          this.emit('xen-object', { sessionId, object: currentObject });
        }
        currentObject = {};
      } else {
        const match = line.match(/^\s*([^:]+)\s*:\s*(.*)$/);
        if (match) {
          const [, key, value] = match;
          currentObject[key.trim().replace(/-/g, '_')] = value.trim();
        }
      }
    }
  }

  async executeCommand(sessionId: string, command: string, args?: string[]): Promise<void> {
    const session = this.xenSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Handle Xen-specific commands
    switch (command) {
      case 'vm-list':
        await this.executeXECommand(sessionId, 'vm-list', args || []);
        break;

      case 'vm-start':
        if (!args || args.length === 0) {
          throw new Error('vm-start requires VM UUID or name');
        }
        await this.executeXECommand(sessionId, 'vm-start', [`uuid=${args[0]}`]);
        break;

      case 'vm-shutdown':
        if (!args || args.length === 0) {
          throw new Error('vm-shutdown requires VM UUID or name');
        }
        await this.executeXECommand(sessionId, 'vm-shutdown', [`uuid=${args[0]}`]);
        break;

      case 'vm-reboot':
        if (!args || args.length === 0) {
          throw new Error('vm-reboot requires VM UUID or name');
        }
        await this.executeXECommand(sessionId, 'vm-reboot', [`uuid=${args[0]}`]);
        break;

      case 'vm-console':
        if (!args || args.length === 0) {
          throw new Error('vm-console requires VM UUID or name');
        }
        await this.attachVMConsole(sessionId, args[0]);
        break;

      case 'host-list':
        await this.executeXECommand(sessionId, 'host-list', args || []);
        break;

      case 'sr-list': // Storage repositories
        await this.executeXECommand(sessionId, 'sr-list', args || []);
        break;

      case 'network-list':
        await this.executeXECommand(sessionId, 'network-list', args || []);
        break;

      case 'task-list':
        await this.executeXECommand(sessionId, 'task-list', args || []);
        break;

      default:
        // Pass through to xe
        await this.executeXECommand(sessionId, command, args || []);
    }
  }

  private async attachVMConsole(sessionId: string, vmId: string): Promise<void> {
    const session = this.xenSessions.get(sessionId);
    if (!session) return;

    // Get VM console using xe
    const consoleProcess = spawn('xe', [
      'console',
      `uuid=${vmId}`,
      ...(session.config.host ? ['-s', session.config.host] : []),
      ...(session.config.username ? ['-u', session.config.username] : []),
      ...(session.config.password ? ['-pw', session.config.password] : [])
    ], {
      cwd: session.cwd,
      env: session.env
    });

    session.vmConsoles.set(vmId, consoleProcess);

    consoleProcess.stdout?.on('data', (data: Buffer) => {
      this.addToOutputBuffer(sessionId, {
        sessionId,
        type: 'stdout',
        data: `[VM ${vmId}] ${data.toString()}`,
        timestamp: new Date()
      });
    });

    consoleProcess.stderr?.on('data', (data: Buffer) => {
      this.addToOutputBuffer(sessionId, {
        sessionId,
        type: 'stderr',
        data: `[VM ${vmId}] ${data.toString()}`,
        timestamp: new Date()
      });
    });

    consoleProcess.on('exit', () => {
      session.vmConsoles.delete(vmId);
      this.addToOutputBuffer(sessionId, {
        sessionId,
        type: 'stdout',
        data: `Console disconnected from VM ${vmId}\n`,
        timestamp: new Date()
      });
    });
  }

  async sendInput(sessionId: string, input: string): Promise<void> {
    const session = this.xenSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Check if input is for a VM console
    if (input.startsWith('vm:')) {
      const match = input.match(/^vm:([^:]+):(.*)$/);
      if (match) {
        const [, vmId, vmInput] = match;
        const consoleProcess = session.vmConsoles.get(vmId);
        if (consoleProcess && consoleProcess.stdin) {
          consoleProcess.stdin.write(vmInput + '\n');
          return;
        }
      }
    }

    // Send to main process
    if (session.process && session.process.stdin) {
      session.process.stdin.write(input);
      if (!input.endsWith('\n')) {
        session.process.stdin.write('\n');
      }
    } else {
      // Queue command for XAPI
      session.commandQueue.push(input);
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.xenSessions.get(sessionId);
    if (!session) {
      return;
    }

    // Close all VM consoles
    for (const [vmId, process] of session.vmConsoles) {
      if (!process.killed) {
        process.kill('SIGTERM');
      }
    }
    session.vmConsoles.clear();

    // Logout from XAPI if connected
    if (session.apiSession && session.config.host) {
      try {
        await this.xapiLogout(session.config, session.apiSession);
      } catch (error) {
        this.logger.debug('Failed to logout from XAPI:', error);
      }
    }

    // Kill main process
    if (session.process && !session.process.killed) {
      session.process.kill('SIGTERM');

      // Wait a bit, then force kill if needed
      setTimeout(() => {
        if (session.process && !session.process.killed) {
          session.process.kill('SIGKILL');
        }
      }, 2000);
    }

    session.status = 'stopped';
    this.xenSessions.delete(sessionId);
    this.sessions.delete(sessionId);
  }

  private async xapiLogout(config: XenConfig, sessionId: string): Promise<void> {
    return new Promise((resolve) => {
      const protocol = config.useSSL ? https : http;
      const postData = JSON.stringify({
        jsonrpc: '2.0',
        method: 'session.logout',
        params: [sessionId],
        id: 1
      });

      const options = {
        hostname: config.host,
        port: config.port || 443,
        path: '/jsonrpc',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        },
        rejectUnauthorized: false
      };

      const req = protocol.request(options, (res) => {
        res.on('data', () => {}); // Drain response
        res.on('end', resolve);
      });

      req.on('error', () => resolve()); // Ignore errors
      req.write(postData);
      req.end();
    });
  }

  private async executeSystemCommand(command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const process = spawn(command, args);
      let output = '';
      let error = '';

      process.stdout?.on('data', data => {
        output += data.toString();
      });

      process.stderr?.on('data', data => {
        error += data.toString();
      });

      process.on('exit', code => {
        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error(error || `Command failed with code ${code}`));
        }
      });
    });
  }

  async dispose(): Promise<void> {
    this.logger.info('Disposing Xen protocol');

    // Close all sessions
    const sessionIds = Array.from(this.xenSessions.keys());
    await Promise.all(sessionIds.map(id => this.closeSession(id)));

    await this.cleanup();
  }

  async getHealthStatus(): Promise<ProtocolHealthStatus> {
    const baseStatus = await super.getHealthStatus();
    const deps = (this as any)._dependencies || {};

    // Check if any Xen tool is available
    const hasXenTool = deps.xe || deps.xl || deps.xm || deps.virsh;

    return {
      ...baseStatus,
      isHealthy: this.isInitialized && hasXenTool,
      warnings: [
        ...baseStatus.warnings,
        !hasXenTool ? 'No Xen management tools available' : null,
        !deps.xe ? 'xe CLI not available (required for XenServer/XCP)' : null
      ].filter(Boolean) as string[]
    };
  }
}

export default XenProtocol;