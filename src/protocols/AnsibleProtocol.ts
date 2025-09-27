import { spawn, ChildProcess } from 'child_process';
import { PythonShell } from 'python-shell';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import { v4 as uuidv4 } from 'uuid';
import stripAnsi from 'strip-ansi';
import { BaseProtocol } from '../core/BaseProtocol.js';

import {
  AnsibleConnectionOptions,
  AnsiblePlaybookOptions,
  AnsibleVaultConfig,
  AnsibleInventory,
  AnsibleFactCache,
  AnsibleCallbackPlugin,
  AnsibleCollection,
  AnsibleRole,
  AnsibleTask,
  AnsiblePlay,
  AnsiblePlaybook,
  AnsibleSession,
  AnsibleExecutionResult,
  AnsibleStats,
  AnsibleTowerJob,
  AnsibleTowerConfig,
  AnsibleProtocolConfig,
  ConsoleSession,
  ConsoleOutput,
  ConsoleEvent,
  SessionOptions,
  ConsoleType
} from '../types/index.js';

import {
  ProtocolCapabilities,
  SessionState,
  ErrorContext,
  ProtocolHealthStatus,
  ErrorRecoveryResult,
  ResourceUsage
} from '../core/IProtocol.js';

export interface AnsibleExecutionContext {
  sessionId: string;
  workingDirectory: string;
  environment: Record<string, string>;
  pythonPath?: string;
  virtualEnv?: string;
  configFile?: string;
  inventorySource?: string;
}

export interface AnsibleCallbackEvent {
  eventType: 'task_start' | 'task_ok' | 'task_failed' | 'task_changed' | 'task_skipped' | 'task_unreachable' | 'playbook_start' | 'playbook_stats';
  host?: string;
  task?: string;
  play?: string;
  playbook?: string;
  result?: any;
  timestamp: Date;
  sessionId: string;
}

export interface AnsibleValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  syntax?: {
    valid: boolean;
    errors: string[];
  };
  inventory?: {
    valid: boolean;
    hosts: string[];
    groups: string[];
  };
  vault?: {
    encrypted: boolean;
    accessible: boolean;
  };
}

export interface AnsibleGalaxyOptions {
  operation: 'install' | 'remove' | 'list' | 'search' | 'info';
  target?: string;
  source?: string;
  requirements?: string;
  force?: boolean;
  noDeps?: boolean;
  roleFile?: string;
  collectionsPath?: string;
  rolesPath?: string;
}

export class AnsibleProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'ansible';
  public readonly capabilities: ProtocolCapabilities;

  private ansibleSessions: Map<string, AnsibleSession> = new Map();
  private activeProcesses: Map<string, ChildProcess> = new Map();
  private factCache: Map<string, any> = new Map();
  private callbackBuffer: Map<string, AnsibleCallbackEvent[]> = new Map();
  private vaultPasswords: Map<string, string> = new Map();
  private monitoring: boolean = true;
  private config: AnsibleProtocolConfig;

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

  // Default configuration
  private static readonly DEFAULT_CONFIG: AnsibleProtocolConfig = {
    defaultConnectionType: 'ssh',
    defaultUser: 'ansible',
    defaultTimeout: 300,
    defaultForks: 5,
    pythonPath: '/usr/bin/python3',
    playbookDir: '/etc/ansible/playbooks',
    rolesPath: ['/etc/ansible/roles', '~/.ansible/roles'],
    collectionsPath: ['~/.ansible/collections', '/usr/share/ansible/collections'],
    callbackPlugins: ['json', 'timer', 'profile_tasks'],
    stdoutCallback: 'json',
    logLevel: 'INFO',
    gatheringPolicy: 'smart',
    factCaching: 'memory',
    factCachingTimeout: 3600,
    pipelining: true,
    hostKeyChecking: false,
    requireTty: false,
    enableFactGathering: true,
    enableCallbacks: true,
    enableVault: true,
    enableCollections: true,
    enableDryRun: true
  };

  constructor(config?: Partial<AnsibleProtocolConfig>) {
    super('ansible');
    this.config = { ...AnsibleProtocol.DEFAULT_CONFIG, ...config };
    
    // Initialize capabilities
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
      supportsReconnection: false,
      supportsBinaryData: false,
      supportsCustomEnvironment: true,
      supportsWorkingDirectory: true,
      supportsSignals: true,
      supportsResizing: false,
      supportsPTY: false,
      maxConcurrentSessions: 50,
      defaultTimeout: 300000,
      supportedEncodings: ['utf-8'],
      supportedAuthMethods: ['ssh-key', 'password'],
      platformSupport: {
        windows: true,
        linux: true,
        macos: true,
        freebsd: true
      }
    };

    this.initializeCallbacks();
  }

  private initializeCallbacks(): void {
    // Register default callback plugins
    this.on('callback', this.handleCallbackEvent.bind(this));
    this.on('vault_needed', this.handleVaultRequest.bind(this));
    this.on('fact_gathered', this.handleFactGathered.bind(this));
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Check if Ansible is available
      await this.checkAnsibleAvailability();
      this.isInitialized = true;
      this.logger.info('Ansible protocol initialized with production features');
    } catch (error: any) {
      this.logger.error('Failed to initialize Ansible protocol', error);
      throw error;
    }
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const sessionId = `ansible-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    return await this.createSessionWithTypeDetection(sessionId, options);
  }

  async dispose(): Promise<void> {
    await this.cleanup();
  }

  async doCreateSession(sessionId: string, options: SessionOptions, sessionState: SessionState): Promise<ConsoleSession> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const ansibleOptions = options as AnsibleConnectionOptions;

    // Create internal Ansible session for protocol-specific data
    const ansibleSession: AnsibleSession = {
      id: sessionId,
      type: 'playbook',
      status: 'running',
      startedAt: new Date(),
      options: ansibleOptions,
      results: [],
      stats: {
        processed: {},
        failures: {},
        ok: {},
        dark: {},
        changed: {},
        skipped: {}
      },
      callbacks: this.config.callbackPlugins.map(name => ({
        name,
        type: 'stdout' as const,
        enabled: true
      }))
    };

    this.ansibleSessions.set(sessionId, ansibleSession);
    this.callbackBuffer.set(sessionId, []);

    // Create session object
    const session: ConsoleSession = {
      id: sessionId,
      command: ansibleOptions.playbookPath || ansibleOptions.inventory || 'ansible-playbook',
      args: [],
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...options.env },
      createdAt: new Date(),
      lastActivity: new Date(),
      status: 'running',
      type: this.type,
      streaming: options.streaming,
      executionState: 'idle',
      activeCommands: new Map(),
      pid: 0
    };

    this.sessions.set(sessionId, session);

    this.logger.info(`Ansible session ${sessionId} created for ${ansibleOptions.playbookPath || ansibleOptions.inventory || 'Ansible automation'}`);
    this.emit('session-created', { sessionId, type: 'ansible', session });

    return session;
  }

  /**
   * Execute Ansible playbook
   */
  public async executePlaybook(
    sessionId: string,
    playbookOptions: AnsiblePlaybookOptions
  ): Promise<void> {
    const session = this.ansibleSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    try {
      // Validate playbook before execution
      const validation = await this.validatePlaybook(playbookOptions.playbook);
      if (!validation.valid) {
        throw new Error(`Playbook validation failed: ${validation.errors.join(', ')}`);
      }

      // Setup execution environment
      const context = await this.setupExecutionContext(sessionId, session.options);
      
      // Prepare command arguments
      const args = await this.buildPlaybookCommand(playbookOptions, context);

      // Execute playbook
      const process = await this.executeAnsibleCommand('ansible-playbook', args, context);
      this.activeProcesses.set(sessionId, process);

      // Handle process output and events
      this.setupProcessHandlers(sessionId, process);

      session.status = 'running';
      this.emit('session_started', { sessionId, type: 'playbook' });

    } catch (error) {
      session.status = 'failed';
      this.logger.error(`Playbook execution failed for session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Execute ad-hoc Ansible command
   */
  public async executeAdhoc(
    sessionId: string,
    inventory: string,
    module: string,
    moduleArgs?: string,
    pattern: string = 'all',
    options?: Partial<AnsibleConnectionOptions>
  ): Promise<void> {
    const session = this.ansibleSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    try {
      const context = await this.setupExecutionContext(sessionId, { ...session.options, ...options });
      
      const args = [
        pattern,
        '-i', inventory,
        '-m', module
      ];

      if (moduleArgs) {
        args.push('-a', moduleArgs);
      }

      // Add connection options
      if (session.options.connectionType) {
        args.push('-c', session.options.connectionType);
      }

      if (session.options.user) {
        args.push('-u', session.options.user);
      }

      if (session.options.privateKey) {
        args.push('--private-key', session.options.privateKey);
      }

      const process = await this.executeAnsibleCommand('ansible', args, context);
      this.activeProcesses.set(sessionId, process);
      this.setupProcessHandlers(sessionId, process);

      session.type = 'adhoc';
      session.status = 'running';
      this.emit('session_started', { sessionId, type: 'adhoc' });

    } catch (error) {
      session.status = 'failed';
      this.logger.error(`Ad-hoc execution failed for session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Gather facts from hosts
   */
  public async gatherFacts(
    sessionId: string,
    inventory: string,
    pattern: string = 'all',
    options?: Partial<AnsibleConnectionOptions>
  ): Promise<Record<string, any>> {
    const session = this.ansibleSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const context = await this.setupExecutionContext(sessionId, { ...session.options, ...options });
    
    const args = [
      pattern,
      '-i', inventory,
      '-m', 'setup'
    ];

    // Add connection options
    this.addConnectionArgs(args, session.options);

    const process = await this.executeAnsibleCommand('ansible', args, context);
    
    return new Promise((resolve, reject) => {
      let output = '';
      let errorOutput = '';

      process.stdout?.on('data', (data) => {
        output += data.toString();
      });

      process.stderr?.on('data', (data) => {
        errorOutput += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          try {
            const facts = this.parseFactsOutput(output);
            this.factCache.set(`${sessionId}:${pattern}`, facts);
            session.facts = facts;
            resolve(facts);
          } catch (error) {
            reject(new Error(`Failed to parse facts: ${error}`));
          }
        } else {
          reject(new Error(`Fact gathering failed: ${errorOutput}`));
        }
      });
    });
  }

  /**
   * Validate playbook syntax and structure
   */
  public async validatePlaybook(playbookPath: string): Promise<AnsibleValidationResult> {
    const result: AnsibleValidationResult = {
      valid: true,
      errors: [],
      warnings: []
    };

    try {
      // Check if playbook file exists
      if (!fs.existsSync(playbookPath)) {
        result.valid = false;
        result.errors.push(`Playbook file not found: ${playbookPath}`);
        return result;
      }

      // Validate YAML syntax
      try {
        const content = fs.readFileSync(playbookPath, 'utf8');
        yaml.load(content);
        result.syntax = { valid: true, errors: [] };
      } catch (yamlError) {
        result.valid = false;
        result.syntax = { 
          valid: false, 
          errors: [`YAML syntax error: ${yamlError}`]
        };
        result.errors.push(`Invalid YAML syntax: ${yamlError}`);
      }

      // Run ansible-playbook --syntax-check
      const args = ['--syntax-check', playbookPath];
      
      try {
        const context = await this.setupExecutionContext('validation', {});
        const process = await this.executeAnsibleCommand('ansible-playbook', args, context);
        
        await new Promise<void>((resolve, reject) => {
          let errorOutput = '';
          
          process.stderr?.on('data', (data) => {
            errorOutput += data.toString();
          });

          process.on('close', (code) => {
            if (code !== 0) {
              result.valid = false;
              result.errors.push(`Syntax validation failed: ${errorOutput}`);
            }
            resolve();
          });

          process.on('error', reject);
        });
      } catch (syntaxError) {
        result.valid = false;
        result.errors.push(`Syntax check failed: ${syntaxError}`);
      }

    } catch (error) {
      result.valid = false;
      result.errors.push(`Validation error: ${error}`);
    }

    return result;
  }

  /**
   * Encrypt/decrypt vault files
   */
  public async vaultOperation(
    operation: 'encrypt' | 'decrypt' | 'view' | 'edit',
    filePath: string,
    vaultId?: string,
    password?: string
  ): Promise<string | void> {
    const args = [operation, filePath];

    if (vaultId) {
      args.unshift('--vault-id', vaultId);
    } else if (password) {
      // Use temporary password file
      const tempPasswordFile = path.join(os.tmpdir(), `vault-${uuidv4()}.txt`);
      fs.writeFileSync(tempPasswordFile, password);
      args.unshift('--vault-password-file', tempPasswordFile);
      
      // Clean up temp file after use
      setTimeout(() => {
        try {
          fs.unlinkSync(tempPasswordFile);
        } catch (error) {
          this.logger.warn(`Failed to clean up temp password file: ${error}`);
        }
      }, 1000);
    }

    const context = await this.setupExecutionContext('vault', {});
    const process = await this.executeAnsibleCommand('ansible-vault', args, context);

    return new Promise((resolve, reject) => {
      let output = '';
      let errorOutput = '';

      process.stdout?.on('data', (data) => {
        output += data.toString();
      });

      process.stderr?.on('data', (data) => {
        errorOutput += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve(operation === 'view' ? output : undefined);
        } else {
          reject(new Error(`Vault operation failed: ${errorOutput}`));
        }
      });
    });
  }

  /**
   * Manage Ansible Galaxy collections and roles
   */
  public async galaxyOperation(options: AnsibleGalaxyOptions): Promise<string> {
    const args: string[] = [options.operation];

    switch (options.operation) {
      case 'install':
        if (options.target) args.push(options.target);
        if (options.requirements) args.push('-r', options.requirements);
        if (options.force) args.push('--force');
        if (options.noDeps) args.push('--no-deps');
        break;
      case 'remove':
        if (options.target) args.push(options.target);
        break;
      case 'list':
        // No additional args needed
        break;
      case 'search':
        if (options.target) args.push(options.target);
        break;
      case 'info':
        if (options.target) args.push(options.target);
        break;
    }

    const context = await this.setupExecutionContext('galaxy', {});
    const process = await this.executeAnsibleCommand('ansible-galaxy', args, context);

    return new Promise((resolve, reject) => {
      let output = '';
      let errorOutput = '';

      process.stdout?.on('data', (data) => {
        output += data.toString();
      });

      process.stderr?.on('data', (data) => {
        errorOutput += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error(`Galaxy operation failed: ${errorOutput}`));
        }
      });
    });
  }

  /**
   * Dynamic inventory management
   */
  public async loadInventory(source: string, type: 'static' | 'dynamic' | 'plugin' = 'static'): Promise<AnsibleInventory> {
    let inventory: AnsibleInventory = {
      type,
      source,
      groups: {},
      hosts: {},
      vars: {}
    };

    try {
      if (type === 'static') {
        if (fs.existsSync(source)) {
          const content = fs.readFileSync(source, 'utf8');
          
          if (source.endsWith('.yml') || source.endsWith('.yaml')) {
            inventory = { ...inventory, ...yaml.load(content) as any };
            inventory.format = 'yaml';
          } else if (source.endsWith('.json')) {
            inventory = { ...inventory, ...JSON.parse(content) };
            inventory.format = 'json';
          } else {
            // INI format
            inventory = this.parseIniInventory(content);
            inventory.format = 'ini';
          }
        }
      } else if (type === 'dynamic') {
        // Execute dynamic inventory script
        const context = await this.setupExecutionContext('inventory', {});
        const process = spawn(source, ['--list'], {
          cwd: context.workingDirectory,
          env: context.environment
        });

        const output = await new Promise<string>((resolve, reject) => {
          let stdout = '';
          let stderr = '';

          process.stdout.on('data', (data) => stdout += data.toString());
          process.stderr.on('data', (data) => stderr += data.toString());

          process.on('close', (code) => {
            if (code === 0) {
              resolve(stdout);
            } else {
              reject(new Error(`Dynamic inventory failed: ${stderr}`));
            }
          });
        });

        inventory = { ...inventory, ...JSON.parse(output) };
      }
    } catch (error) {
      this.logger.error(`Failed to load inventory from ${source}:`, error);
      throw error;
    }

    return inventory;
  }

  /**
   * AWX/Tower integration
   */
  public async launchTowerJob(
    towerConfig: AnsibleTowerConfig,
    jobTemplateId: number,
    extraVars?: Record<string, any>
  ): Promise<AnsibleTowerJob> {
    // This would integrate with AWX/Tower REST API
    // Implementation would depend on specific Tower version and setup
    throw new Error('AWX/Tower integration not yet implemented');
  }

  /**
   * Cancel running session
   */
  public async cancelSession(sessionId: string): Promise<void> {
    const session = this.ansibleSessions.get(sessionId);
    const process = this.activeProcesses.get(sessionId);

    if (process && !process.killed) {
      process.kill('SIGTERM');

      // Force kill after timeout
      setTimeout(() => {
        if (!process.killed) {
          process.kill('SIGKILL');
        }
      }, 5000);
    }

    if (session) {
      session.status = 'cancelled';
      session.completedAt = new Date();
    }

    this.activeProcesses.delete(sessionId);
    this.logger.info(`Cancelled Ansible session ${sessionId}`);
  }

  async executeCommand(sessionId: string, command: string, args?: string[]): Promise<void> {
    const session = this.ansibleSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Parse command as playbook or adhoc command
    if (command === 'playbook' || command.endsWith('.yml') || command.endsWith('.yaml')) {
      const playbookOptions: AnsiblePlaybookOptions = {
        playbook: args?.[0] || command,
        inventory: args?.[1] || session.options.inventory || 'localhost,',
        extraVars: args?.[2] ? JSON.parse(args[2]) : undefined
      };
      await this.executePlaybook(sessionId, playbookOptions);
    } else {
      // Execute as adhoc command
      await this.executeAdhoc(
        sessionId,
        session.options.inventory || 'localhost,',
        command,
        args?.join(' ')
      );
    }
  }

  async sendInput(sessionId: string, input: string): Promise<void> {
    const process = this.activeProcesses.get(sessionId);
    const session = this.sessions.get(sessionId);

    if (!process || !process.stdin || !session) {
      throw new Error(`No active Ansible session: ${sessionId}`);
    }

    process.stdin.write(input);
    session.lastActivity = new Date();

    this.emit('input-sent', {
      sessionId,
      input,
      timestamp: new Date(),
    });

    this.logger.debug(`Sent input to Ansible session ${sessionId}: ${input.substring(0, 100)}`);
  }

  // Override getOutput to satisfy old ProtocolFactory interface (returns string)
  async getOutput(sessionId: string, since?: Date): Promise<any> {
    const outputs = await super.getOutput(sessionId, since);
    const events = this.callbackBuffer.get(sessionId) || [];

    let output = outputs.map((out: any) => out.data).join('');
    for (const event of events) {
      if (!since || event.timestamp >= since) {
        output += `[${event.timestamp.toISOString()}] ${event.eventType}: ${JSON.stringify(event.result || event)}
`;
      }
    }

    return output;
  }

  async closeSession(sessionId: string): Promise<void> {
    try {
      const process = this.activeProcesses.get(sessionId);
      if (process) {
        // Try graceful shutdown first
        process.kill('SIGTERM');

        // Force kill after timeout
        setTimeout(() => {
          if (process && !process.killed) {
            process.kill('SIGKILL');
          }
        }, 10000);

        this.activeProcesses.delete(sessionId);
      }

      // Clean up base protocol session
      this.sessions.delete(sessionId);
      this.ansibleSessions.delete(sessionId);
      this.callbackBuffer.delete(sessionId);

      this.logger.info(`Ansible session ${sessionId} closed`);
      this.emit('session-closed', sessionId);
    } catch (error) {
      this.logger.error(`Error closing Ansible session ${sessionId}:`, error);
      throw error;
    }
  }

  async getHealthStatus(): Promise<ProtocolHealthStatus> {
    const baseStatus = await super.getHealthStatus();

    try {
      await this.checkAnsibleAvailability();
      return {
        ...baseStatus,
        dependencies: {
          ansible: { available: true },
          python: { available: true }
        }
      };
    } catch (error) {
      return {
        ...baseStatus,
        isHealthy: false,
        errors: [...baseStatus.errors, `Ansible not available: ${error}`],
        dependencies: {
          ansible: { available: false },
          python: { available: false }
        }
      };
    }
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
      isOneShot: false, // Ansible sessions can be long-running
      isPersistent: true,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      pid: session.pid,
      metadata: {}
    };
  }

  async handleError(error: Error, context: ErrorContext): Promise<ErrorRecoveryResult> {
    this.logger.error(`Error in Ansible session ${context.sessionId}: ${error.message}`);

    return {
      recovered: false,
      strategy: 'none',
      attempts: 0,
      duration: 0,
      error: error.message
    };
  }

  async recoverSession(sessionId: string): Promise<boolean> {
    const process = this.activeProcesses.get(sessionId);
    return process && !process.killed || false;
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
        connectionsActive: this.activeProcesses.size
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

  /**
   * Get session status and results
   */
  public getSession(sessionId: string): AnsibleSession | undefined {
    return this.ansibleSessions.get(sessionId);
  }

  /**
   * List all active sessions
   */
  public listSessions(): AnsibleSession[] {
    return Array.from(this.ansibleSessions.values());
  }


  // Private helper methods

  private async setupExecutionContext(
    sessionId: string,
    options: AnsibleConnectionOptions
  ): Promise<AnsibleExecutionContext> {
    const context: AnsibleExecutionContext = {
      sessionId,
      workingDirectory: options.playbookPath ? path.dirname(options.playbookPath) : this.config.playbookDir,
      environment: Object.fromEntries(
        Object.entries(process.env).filter(([_, value]) => value !== undefined)
      ) as Record<string, string>
    };

    // Setup Python environment
    if (options.pythonPath || this.config.pythonPath) {
      context.pythonPath = options.pythonPath || this.config.pythonPath;
      if (context.pythonPath) {
        context.environment.PYTHON_PATH = context.pythonPath;
      }
    }

    if (options.virtualEnv || this.config.virtualEnvPath) {
      context.virtualEnv = options.virtualEnv || this.config.virtualEnvPath;
      if (context.virtualEnv) {
        context.environment.VIRTUAL_ENV = context.virtualEnv;
        context.environment.PATH = `${context.virtualEnv}/bin:${context.environment.PATH}`;
      }
    }

    // Setup Ansible configuration
    if (options.ansibleConfig || this.config.configFile) {
      context.configFile = options.ansibleConfig || this.config.configFile;
      if (context.configFile) {
        context.environment.ANSIBLE_CONFIG = context.configFile;
      }
    }

    // Setup inventory
    if (options.inventory || options.inventoryFile || this.config.inventoryFile) {
      context.inventorySource = options.inventory || options.inventoryFile || this.config.inventoryFile;
    }

    // Setup additional paths
    context.environment.ANSIBLE_ROLES_PATH = (options.rolesPath || this.config.rolesPath).join(':');
    context.environment.ANSIBLE_COLLECTIONS_PATH = (options.collectionsPath || this.config.collectionsPath).join(':');

    // Setup callback plugins
    context.environment.ANSIBLE_STDOUT_CALLBACK = this.config.stdoutCallback;
    context.environment.ANSIBLE_CALLBACK_PLUGINS = this.config.callbackPlugins.join(',');

    // Setup logging
    if (this.config.logPath) {
      context.environment.ANSIBLE_LOG_PATH = this.config.logPath;
    }

    return context;
  }

  private async buildPlaybookCommand(
    options: AnsiblePlaybookOptions,
    context: AnsibleExecutionContext
  ): Promise<string[]> {
    const args: string[] = [];

    // Basic playbook options
    if (options.inventory || context.inventorySource) {
      args.push('-i', options.inventory || context.inventorySource!);
    }

    if (options.limit) {
      args.push('--limit', options.limit);
    }

    if (options.tags && options.tags.length > 0) {
      args.push('--tags', options.tags.join(','));
    }

    if (options.skipTags && options.skipTags.length > 0) {
      args.push('--skip-tags', options.skipTags.join(','));
    }

    if (options.startAtTask) {
      args.push('--start-at-task', options.startAtTask);
    }

    // Execution control
    if (options.check) {
      args.push('--check');
    }

    if (options.diff) {
      args.push('--diff');
    }

    if (options.syntax) {
      args.push('--syntax-check');
    }

    if (options.listTasks) {
      args.push('--list-tasks');
    }

    if (options.listTags) {
      args.push('--list-tags');
    }

    if (options.listHosts) {
      args.push('--list-hosts', options.listHosts);
    }

    // Variables
    if (options.extraVars) {
      args.push('--extra-vars', JSON.stringify(options.extraVars));
    }

    if (options.extraVarsFile) {
      for (const file of options.extraVarsFile) {
        args.push('--extra-vars', `@${file}`);
      }
    }

    // Connection options
    this.addConnectionArgs(args, options);

    // Execution control
    if (options.forks) {
      args.push('--forks', options.forks.toString());
    }

    // Vault options
    if (options.vault) {
      if (options.vault.passwordFile) {
        args.push('--vault-password-file', options.vault.passwordFile);
      }
      if (options.vault.ids) {
        for (const id of options.vault.ids) {
          args.push('--vault-id', id);
        }
      }
      if (options.vault.askPass) {
        args.push('--ask-vault-pass');
      }
    }

    // Output control
    if (options.verbosity) {
      args.push('-' + 'v'.repeat(Math.min(options.verbosity, 5)));
    }

    // Add the playbook file
    args.push(options.playbook);

    return args;
  }

  private addConnectionArgs(args: string[], options: any): void {
    if (options.connection || options.connectionType) {
      args.push('-c', options.connection || options.connectionType);
    }

    if (options.user) {
      args.push('-u', options.user);
    }

    if (options.privateKey) {
      args.push('--private-key', options.privateKey);
    }

    if (options.sshCommonArgs) {
      args.push('--ssh-common-args', options.sshCommonArgs.join(' '));
    }

    if (options.sshExtraArgs) {
      args.push('--ssh-extra-args', options.sshExtraArgs.join(' '));
    }

    if (options.timeout) {
      args.push('-T', options.timeout.toString());
    }
  }

  private async executeAnsibleCommand(
    command: string,
    args: string[],
    context: AnsibleExecutionContext
  ): Promise<ChildProcess> {
    this.logger.debug(`Executing: ${command} ${args.join(' ')}`);

    const process = spawn(command, args, {
      cwd: context.workingDirectory,
      env: context.environment,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    if (!process.pid) {
      throw new Error(`Failed to spawn ${command} process`);
    }

    return process;
  }

  private setupProcessHandlers(sessionId: string, process: ChildProcess): void {
    const session = this.ansibleSessions.get(sessionId);
    if (!session) return;

    let outputBuffer = '';

    process.stdout?.on('data', (data) => {
      const output = data.toString();
      outputBuffer += output;

      // Parse JSON callback output
      this.parseCallbackOutput(sessionId, output);

      const consoleOutput: ConsoleOutput = {
        sessionId,
        type: 'stdout',
        data: output,
        timestamp: new Date()
      };
      this.addToOutputBuffer(sessionId, consoleOutput);
    });

    process.stderr?.on('data', (data) => {
      const output = data.toString();
      
      const consoleOutput: ConsoleOutput = {
        sessionId,
        type: 'stderr',
        data: output,
        timestamp: new Date()
      };
      this.addToOutputBuffer(sessionId, consoleOutput);
    });

    process.on('close', (code, signal) => {
      session.status = code === 0 ? 'completed' : 'failed';
      session.completedAt = new Date();

      // Parse final stats from output buffer
      try {
        session.stats = this.parseStatsFromOutput(outputBuffer);
      } catch (error) {
        this.logger.warn(`Failed to parse final stats: ${error}`);
      }

      this.markSessionComplete(sessionId, code || 0);
      this.activeProcesses.delete(sessionId);
    });

    process.on('error', (error) => {
      session.status = 'failed';
      session.completedAt = new Date();

      this.logger.error(`Process error for session ${sessionId}:`, error);
      this.emit('session_error', { sessionId, error: error.message });
    });
  }

  private parseCallbackOutput(sessionId: string, output: string): void {
    const lines = output.split('\n');
    const events = this.callbackBuffer.get(sessionId) || [];

    for (const line of lines) {
      if (line.trim()) {
        try {
          // Try to parse as JSON callback
          const data = JSON.parse(line);
          
          if (data.event) {
            const event: AnsibleCallbackEvent = {
              eventType: data.event,
              host: data.host,
              task: data.task,
              play: data.play,
              playbook: data.playbook,
              result: data.result,
              timestamp: new Date(),
              sessionId
            };

            events.push(event);
            this.emit('callback', event);
          }
        } catch (parseError) {
          // Not JSON, might be regular output
          continue;
        }
      }
    }

    this.callbackBuffer.set(sessionId, events);
  }

  private parseStatsFromOutput(output: string): AnsibleStats {
    const stats: AnsibleStats = {
      processed: {},
      failures: {},
      ok: {},
      dark: {},
      changed: {},
      skipped: {}
    };

    // Parse PLAY RECAP section
    const recapMatch = output.match(/PLAY RECAP \*+([\s\S]*?)(?=\n\n|\nTASK|\n$|$)/);
    if (recapMatch) {
      const recapSection = recapMatch[1];
      const lines = recapSection.split('\n').filter(line => line.trim());

      for (const line of lines) {
        const hostMatch = line.match(/^(\S+)\s+:\s+ok=(\d+)\s+changed=(\d+)\s+unreachable=(\d+)\s+failed=(\d+)\s+skipped=(\d+)/);
        if (hostMatch) {
          const [, host, ok, changed, unreachable, failed, skipped] = hostMatch;
          stats.ok[host] = parseInt(ok);
          stats.changed[host] = parseInt(changed);
          stats.dark[host] = parseInt(unreachable);
          stats.failures[host] = parseInt(failed);
          stats.skipped[host] = parseInt(skipped);
          stats.processed[host] = parseInt(ok) + parseInt(changed) + parseInt(unreachable) + parseInt(failed) + parseInt(skipped);
        }
      }
    }

    return stats;
  }

  private parseFactsOutput(output: string): Record<string, any> {
    const facts: Record<string, any> = {};
    const lines = output.split('\n');

    for (const line of lines) {
      if (line.includes(' | SUCCESS =>')) {
        const hostMatch = line.match(/^(\S+) \| SUCCESS =>/);
        if (hostMatch) {
          const host = hostMatch[1];
          // Find the JSON part after SUCCESS =>
          const jsonStart = line.indexOf('{');
          if (jsonStart !== -1) {
            try {
              const jsonData = line.substring(jsonStart);
              facts[host] = JSON.parse(jsonData);
            } catch (error) {
              this.logger.warn(`Failed to parse facts for host ${host}: ${error}`);
            }
          }
        }
      }
    }

    return facts;
  }

  private parseIniInventory(content: string): AnsibleInventory {
    const inventory: AnsibleInventory = {
      type: 'static',
      source: 'ini',
      format: 'ini',
      groups: {},
      hosts: {},
      vars: {}
    };

    const lines = content.split('\n');
    let currentGroup = '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      // Group header
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        currentGroup = trimmed.slice(1, -1);
        if (!inventory.groups![currentGroup]) {
          inventory.groups![currentGroup] = { hosts: [], vars: {} };
        }
        continue;
      }

      // Host or variable
      if (currentGroup) {
        if (trimmed.includes('=')) {
          // Variable
          const [key, value] = trimmed.split('=', 2);
          inventory.groups![currentGroup].vars![key.trim()] = value.trim();
        } else {
          // Host
          inventory.groups![currentGroup].hosts!.push(trimmed);
          if (!inventory.hosts![trimmed]) {
            inventory.hosts![trimmed] = { vars: {}, groups: [currentGroup] };
          } else {
            inventory.hosts![trimmed].groups!.push(currentGroup);
          }
        }
      } else {
        // Ungrouped host
        if (!inventory.groups!['ungrouped']) {
          inventory.groups!['ungrouped'] = { hosts: [], vars: {} };
        }
        inventory.groups!['ungrouped'].hosts!.push(trimmed);
        inventory.hosts![trimmed] = { vars: {}, groups: ['ungrouped'] };
      }
    }

    return inventory;
  }

  // Event handlers
  private handleCallbackEvent(event: AnsibleCallbackEvent): void {
    this.logger.debug(`Callback event: ${event.eventType} for session ${event.sessionId}`);
    
    if (this.monitoring) {
      // Log the callback event for monitoring purposes
      this.logger.info('Ansible callback event received', {
        sessionId: event.sessionId,
        eventType: event.eventType,
        host: event.host || 'unknown'
      });
    }
  }

  private handleVaultRequest(event: { sessionId: string; vaultId: string }): void {
    // Handle vault password requests
    const password = this.vaultPasswords.get(event.vaultId);
    if (password) {
      this.emit('vault_password', { sessionId: event.sessionId, password });
    } else {
      this.emit('vault_password_needed', event);
    }
  }

  private handleFactGathered(event: { sessionId: string; host: string; facts: any }): void {
    const cacheKey = `${event.sessionId}:${event.host}`;
    this.factCache.set(cacheKey, event.facts);
    
    this.logger.debug(`Facts gathered for ${event.host} in session ${event.sessionId}`);
  }

  // Public API for vault password management
  public setVaultPassword(vaultId: string, password: string): void {
    this.vaultPasswords.set(vaultId, password);
  }

  public removeVaultPassword(vaultId: string): void {
    this.vaultPasswords.delete(vaultId);
  }

  // Public API for fact cache
  public getCachedFacts(sessionId: string, host?: string): any {
    if (host) {
      return this.factCache.get(`${sessionId}:${host}`);
    }
    
    const facts: Record<string, any> = {};
    Array.from(this.factCache.entries()).forEach(([key, value]) => {
      if (key.startsWith(`${sessionId}:`)) {
        const hostName = key.substring(`${sessionId}:`.length);
        facts[hostName] = value;
      }
    });
    return facts;
  }

  private async checkAnsibleAvailability(): Promise<void> {
    return new Promise((resolve, reject) => {
      const testProcess = spawn('ansible', ['--version'], { stdio: 'pipe' });

      testProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error('Ansible not found. Please install Ansible.'));
        }
      });

      testProcess.on('error', () => {
        reject(new Error('Ansible not found. Please install Ansible.'));
      });
    });
  }

  // Cleanup and shutdown
  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up Ansible protocol');

    // Cancel all active sessions
    const activeSessions = Array.from(this.ansibleSessions.keys());
    for (const sessionId of activeSessions) {
      try {
        await this.cancelSession(sessionId);
      } catch (error) {
        this.logger.error(`Error cancelling session ${sessionId}:`, error);
      }
    }

    // Clear caches
    this.factCache.clear();
    this.vaultPasswords.clear();
    this.callbackBuffer.clear();
    this.activeProcesses.clear();
    this.ansibleSessions.clear();

    // Call parent cleanup
    await super.cleanup();
  }
}

export default AnsibleProtocol;