import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import { PythonShell } from 'python-shell';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import { v4 as uuidv4 } from 'uuid';
import stripAnsi from 'strip-ansi';

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

import { Logger } from '../utils/logger.js';
import { MonitoringSystem } from '../monitoring/MonitoringSystem.js';
import { IProtocol, ProtocolCapabilities, ProtocolHealthStatus } from '../core/ProtocolFactory.js';

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

export class AnsibleProtocol extends EventEmitter implements IProtocol {
  public readonly type: ConsoleType = 'ansible';
  public readonly capabilities: ProtocolCapabilities;
  public readonly healthStatus: ProtocolHealthStatus;
  
  private logger: Logger;
  private monitoring?: MonitoringSystem;
  private sessions: Map<string, AnsibleSession> = new Map();
  private activeProcesses: Map<string, ChildProcess> = new Map();
  private factCache: Map<string, any> = new Map();
  private callbackBuffer: Map<string, AnsibleCallbackEvent[]> = new Map();
  private vaultPasswords: Map<string, string> = new Map();
  private config: AnsibleProtocolConfig;
  private _healthStatus: ProtocolHealthStatus;

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
    super();
    this.logger = new Logger('AnsibleProtocol');
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
    
    // Initialize health status
    this._healthStatus = {
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
        ansible: { available: false },
        python: { available: false }
      }
    };
    
    this.healthStatus = this._healthStatus;
    
    this.initializeCallbacks();
  }

  public setMonitoring(monitoring: MonitoringSystem): void {
    this.monitoring = monitoring;
  }

  private initializeCallbacks(): void {
    // Register default callback plugins
    this.on('callback', this.handleCallbackEvent.bind(this));
    this.on('vault_needed', this.handleVaultRequest.bind(this));
    this.on('fact_gathered', this.handleFactGathered.bind(this));
  }

  /**
   * Initialize the protocol
   */
  public async initialize(): Promise<void> {
    try {
      // Check if ansible is available
      const ansibleCheck = spawn('ansible', ['--version'], { stdio: 'pipe' });
      await new Promise<void>((resolve, reject) => {
        ansibleCheck.on('close', (code) => {
          if (code === 0) {
            this._healthStatus.dependencies.ansible = { available: true };
            resolve();
          } else {
            this._healthStatus.dependencies.ansible = { 
              available: false, 
              error: 'Ansible not found in PATH' 
            };
            reject(new Error('Ansible not available'));
          }
        });
        ansibleCheck.on('error', () => {
          this._healthStatus.dependencies.ansible = { 
            available: false, 
            error: 'Ansible not found' 
          };
          reject(new Error('Ansible not available'));
        });
      });
      
      // Check Python availability
      const pythonCheck = spawn('python3', ['--version'], { stdio: 'pipe' });
      await new Promise<void>((resolve) => {
        pythonCheck.on('close', (code) => {
          this._healthStatus.dependencies.python = { 
            available: code === 0 
          };
          resolve();
        });
        pythonCheck.on('error', () => {
          this._healthStatus.dependencies.python = { 
            available: false, 
            error: 'Python not found' 
          };
          resolve();
        });
      });
      
      this._healthStatus.isHealthy = this._healthStatus.dependencies.ansible.available;
      this.logger.info('AnsibleProtocol initialized successfully');
    } catch (error) {
      this._healthStatus.isHealthy = false;
      this._healthStatus.errors.push(`Initialization failed: ${error}`);
      throw error;
    }
  }

  /**
   * Create a new console session
   */
  public async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const ansibleOptions = options as AnsibleConnectionOptions;
    const sessionId = uuidv4();
    
    const session: ConsoleSession = {
      id: sessionId,
      command: ansibleOptions.playbookPath || ansibleOptions.inventory || 'ansible-playbook',
      args: [],
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
      createdAt: new Date(),
      type: 'ansible' as ConsoleType,
      status: 'initializing',
      pid: 0,
      executionState: 'idle',
      activeCommands: new Map()
    };

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

    this.sessions.set(sessionId, ansibleSession);
    this.callbackBuffer.set(sessionId, []);

    this.logger.info(`Created Ansible session ${sessionId}`);
    return session;
  }

  /**
   * Create a new Ansible session (legacy method)
   */
  private async createAnsibleSession(options: AnsibleConnectionOptions): Promise<AnsibleSession> {
    const sessionId = uuidv4();
    const session: AnsibleSession = {
      id: sessionId,
      type: 'playbook',
      status: 'running',
      startedAt: new Date(),
      options,
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

    this.sessions.set(sessionId, session);
    this.callbackBuffer.set(sessionId, []);

    this.logger.info(`Created Ansible session ${sessionId}`);
    return session;
  }

  /**
   * Execute Ansible playbook
   */
  public async executePlaybook(
    sessionId: string,
    playbookOptions: AnsiblePlaybookOptions
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
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
    const session = this.sessions.get(sessionId);
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
    const session = this.sessions.get(sessionId);
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
    const session = this.sessions.get(sessionId);
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

  /**
   * Execute command in session
   */
  public async executeCommand(sessionId: string, command: string, args?: string[]): Promise<void> {
    const session = this.sessions.get(sessionId);
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

  /**
   * Send input to session
   */
  public async sendInput(sessionId: string, input: string): Promise<void> {
    const process = this.activeProcesses.get(sessionId);
    if (process && process.stdin) {
      process.stdin.write(input);
    }
  }

  /**
   * Get output from session
   */
  public async getOutput(sessionId: string, since?: Date): Promise<string> {
    const events = this.callbackBuffer.get(sessionId) || [];
    
    let output = '';
    for (const event of events) {
      if (!since || event.timestamp >= since) {
        output += `[${event.timestamp.toISOString()}] ${event.eventType}: ${JSON.stringify(event.result || event)}
`;
      }
    }
    
    return output;
  }

  /**
   * Close session
   */
  public async closeSession(sessionId: string): Promise<void> {
    await this.cancelSession(sessionId);
  }

  /**
   * Get health status
   */
  public async getHealthStatus(): Promise<ProtocolHealthStatus> {
    this._healthStatus.lastChecked = new Date();
    this._healthStatus.metrics.activeSessions = this.activeProcesses.size;
    this._healthStatus.metrics.totalSessions = this.sessions.size;
    return { ...this._healthStatus };
  }

  /**
   * Dispose of protocol resources
   */
  public async dispose(): Promise<void> {
    await this.shutdown();
  }

  /**
   * Get session status and results
   */
  public getSession(sessionId: string): AnsibleSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * List all active sessions
   */
  public listSessions(): AnsibleSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Clean up completed sessions
   */
  public cleanup(): void {
    Array.from(this.sessions.entries()).forEach(([sessionId, session]) => {
      if (session.status === 'completed' || session.status === 'failed' || session.status === 'cancelled') {
        const process = this.activeProcesses.get(sessionId);
        if (process && !process.killed) {
          process.kill();
        }
        this.sessions.delete(sessionId);
        this.activeProcesses.delete(sessionId);
        this.callbackBuffer.delete(sessionId);
      }
    });
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
    const session = this.sessions.get(sessionId);
    if (!session) return;

    let outputBuffer = '';

    process.stdout?.on('data', (data) => {
      const output = data.toString();
      outputBuffer += output;

      // Parse JSON callback output
      this.parseCallbackOutput(sessionId, output);

      this.emit('output', {
        sessionId,
        type: 'stdout',
        data: output,
        timestamp: new Date()
      } as ConsoleOutput);
    });

    process.stderr?.on('data', (data) => {
      const output = data.toString();
      
      this.emit('output', {
        sessionId,
        type: 'stderr',
        data: output,
        timestamp: new Date()
      } as ConsoleOutput);
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

      this.emit('session_completed', {
        sessionId,
        exitCode: code,
        signal,
        status: session.status
      });

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

  // Cleanup and shutdown
  public async shutdown(): Promise<void> {
    this.logger.info('Shutting down Ansible protocol...');
    
    // Cancel all active sessions
    const activeSessions = Array.from(this.sessions.keys());
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

    this.logger.info('Ansible protocol shutdown complete');
  }
}

export default AnsibleProtocol;