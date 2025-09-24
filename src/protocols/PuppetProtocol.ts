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

// Puppet Protocol connection options
interface PuppetConnectionOptions {
  operation?: 'apply' | 'agent' | 'master' | 'cert' | 'module' | 'node' | 'resource' | 'config' | 'device' | 'lookup' | 'facts' | 'filebucket' | 'help' | 'describe' | 'doc' | 'epp' | 'parser';
  manifestFile?: string;
  manifestContent?: string;
  modulePath?: string[];
  configFile?: string;
  environment?: string;
  server?: string;
  port?: number;
  certname?: string;
  ca_server?: string;
  ca_port?: number;
  masterport?: number;
  ssldir?: string;
  certdir?: string;
  keydir?: string;
  privatekeydir?: string;
  publickeydir?: string;
  requestdir?: string;
  certdnsnames?: string[];
  certipaddresses?: string[];
  vardir?: string;
  rundir?: string;
  logdir?: string;
  codedir?: string;
  confdir?: string;
  hiera_config?: string;
  user?: string;
  group?: string;
  logLevel?: 'debug' | 'info' | 'notice' | 'warning' | 'err' | 'alert' | 'emerg' | 'crit';
  verbose?: boolean;
  debug?: boolean;
  noop?: boolean;
  dryRun?: boolean;
  test?: boolean;
  onetime?: boolean;
  detailed_exitcodes?: boolean;
  disable_warnings?: string[];
  strict?: 'off' | 'warning' | 'error';
  strict_variables?: boolean;
  disable_warnings_list?: string[];
  compile?: boolean;
  catalog?: string;
  facts?: string;
  fact_format?: 'yaml' | 'json' | 'pson';
  execute?: string;
  tags?: string[];
  skip_tags?: string[];
  ignorecache?: boolean;
  ignoreschedules?: boolean;
  usecacheonfailure?: boolean;
  no_use_srv_records?: boolean;
  use_srv_records?: boolean;
  srv_domain?: string;
  preferred_serialization_format?: 'pson' | 'json' | 'yaml' | 'b64_zlib_yaml';
  report?: boolean;
  reports?: string[];
  report_server?: string;
  report_port?: number;
  report_handler?: string[];
  graph?: boolean;
  graphdir?: string;
  digest?: string;
  node_name?: string;
  node_name_fact?: string;
  node_name_value?: string;
  external_nodes?: string;
  enc_api?: string;
  storeconfigs?: boolean;
  storeconfigs_backend?: string;
  dbadapter?: string;
  dbname?: string;
  dbserver?: string;
  dbport?: number;
  dbuser?: string;
  dbpassword?: string;
  dbconnections?: number;
  railslog?: boolean;
  rails_loglevel?: 'debug' | 'info' | 'notice' | 'warning' | 'err' | 'alert' | 'emerg' | 'crit';
  autosign?: boolean | string;
  autosign_whitelist?: string;
  csr_attributes?: string;
  trusted_oid_mapping_file?: string;
  dns_alt_names?: string[];
  ca?: boolean;
  ca_name?: string;
  cadir?: string;
  cacert?: string;
  cakey?: string;
  caprivatedir?: string;
  capublicdir?: string;
  csrdir?: string;
  signeddir?: string;
  ca_ttl?: string;
  ca_days?: number;
  req_bits?: number;
  keylength?: number;
  digest_algorithm?: string;
  ca_md?: string;
  bucketdir?: string;
  archive_files?: boolean;
  archive_file_server?: string;
  show_diff?: boolean;
  diff?: boolean;
  daemonize?: boolean;
  pid_file?: string;
  waitforcert?: number;
  maxwaitforcert?: number;
  http_proxy_host?: string;
  http_proxy_port?: number;
  http_proxy_user?: string;
  http_proxy_password?: string;
  http_keepalive_timeout?: number;
  http_debug?: boolean;
  filetimeout?: number;
  http_user_agent?: string;
  autoflush?: boolean;
  syslogfacility?: string;
  statedir?: string;
  clientyamldir?: string;
  client_datadir?: string;
  classfile?: string;
  resourcefile?: string;
  puppetdlockfile?: string;
  statefile?: string;
  clientbucketdir?: string;
  inventory_server?: string;
  inventory_port?: number;
  inventory_terminus?: string;
  facts_terminus?: string;
  catalog_terminus?: string;
  node_terminus?: string;
  report_terminus?: string;
  file_bucket_terminus?: string;
  yaml_facts?: boolean;
  plugindest?: string;
  pluginsource?: string;
  pluginsync?: boolean;
  pluginsignore?: string[];
  ignoremissingtypes?: boolean;
  priority?: number;
  trace?: boolean;
  profile?: boolean;
  evaltrace?: boolean;
  summarize?: boolean;
  prerun_command?: string;
  postrun_command?: string;
  freeze_main?: boolean;
  preview_outputdir?: string;
  rich_data?: boolean;
  basemodulepath?: string;
  disable_per_environment_manifest?: boolean;
  parser?: 'current' | 'future';
  binder?: boolean;
  environmentpath?: string;
  default_manifest?: string;
  disable_warnings_puppet?: string[];
  always_retry_plugins?: boolean;
  module_working_dir?: string;
  module_skeleton_dir?: string;
  forge_authorization?: string;
  forge_cache_dir?: string;
  module_repository?: string;
  module_tool_pre_install_check?: boolean;
  module_tool_post_install_check?: boolean;
  resolve_options?: Record<string, any>;
  customPuppetPath?: string;
  customFlags?: string[];
  environmentVars?: Record<string, string>;
}

/**
 * Puppet Protocol Implementation
 *
 * Provides Puppet configuration management capabilities for infrastructure automation
 * Supports comprehensive Puppet functionality including manifests, modules, agents, masters,
 * certificate management, facts, resources, environments, Hiera, PuppetDB integration,
 * and enterprise Puppet Enterprise features
 */
export class PuppetProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'puppet';
  public readonly capabilities: ProtocolCapabilities;

  private puppetProcesses = new Map<string, ChildProcess>();

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
    super('puppet');

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
      maxConcurrentSessions: 50, // Puppet can handle many concurrent operations
      defaultTimeout: 600000, // Puppet operations can take a very long time
      supportedEncodings: ['utf-8', 'ascii'],
      supportedAuthMethods: ['cert', 'psk'],
      platformSupport: {
        windows: true, // Puppet supports Windows
        linux: true, // Primary Puppet platform
        macos: true, // Puppet supports macOS
        freebsd: true
      }
    };
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Check if Puppet is available
      await this.checkPuppetAvailability();
      this.isInitialized = true;
      this.logger.info('Puppet protocol initialized with enterprise features');
    } catch (error: any) {
      this.logger.error('Failed to initialize Puppet protocol', error);
      throw error;
    }
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const sessionId = `puppet-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
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
    const puppetProcess = this.puppetProcesses.get(sessionId);
    const session = this.sessions.get(sessionId);

    if (!puppetProcess || !puppetProcess.stdin || !session) {
      throw new Error(`No active Puppet session: ${sessionId}`);
    }

    puppetProcess.stdin.write(input);
    session.lastActivity = new Date();

    this.emit('input-sent', {
      sessionId,
      input,
      timestamp: new Date(),
    });

    this.logger.debug(`Sent input to Puppet session ${sessionId}: ${input.substring(0, 100)}`);
  }

  async closeSession(sessionId: string): Promise<void> {
    try {
      const puppetProcess = this.puppetProcesses.get(sessionId);
      if (puppetProcess) {
        // Try graceful shutdown first
        puppetProcess.kill('SIGTERM');

        // Force kill after timeout
        setTimeout(() => {
          if (puppetProcess && !puppetProcess.killed) {
            puppetProcess.kill('SIGKILL');
          }
        }, 30000); // Puppet operations can take a long time

        this.puppetProcesses.delete(sessionId);
      }

      // Clean up base protocol session
      this.sessions.delete(sessionId);

      this.logger.info(`Puppet session ${sessionId} closed`);
      this.emit('session-closed', sessionId);
    } catch (error) {
      this.logger.error(`Error closing Puppet session ${sessionId}:`, error);
      throw error;
    }
  }

  async doCreateSession(sessionId: string, options: SessionOptions, sessionState: SessionState): Promise<ConsoleSession> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const puppetOptions = options.puppetOptions || {} as PuppetConnectionOptions;

    // Build Puppet command
    const puppetCommand = this.buildPuppetCommand(puppetOptions);

    // Spawn Puppet process
    const puppetProcess = spawn(puppetCommand[0], puppetCommand.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...this.buildEnvironment(puppetOptions), ...options.env }
    });

    // Set up output handling
    puppetProcess.stdout?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stdout',
        data: data.toString(),
        timestamp: new Date()
      };
      this.addToOutputBuffer(sessionId, output);
    });

    puppetProcess.stderr?.on('data', (data) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stderr',
        data: data.toString(),
        timestamp: new Date()
      };
      this.addToOutputBuffer(sessionId, output);
    });

    puppetProcess.on('error', (error) => {
      this.logger.error(`Puppet process error for session ${sessionId}:`, error);
      this.emit('session-error', { sessionId, error });
    });

    puppetProcess.on('close', (code) => {
      this.logger.info(`Puppet process closed for session ${sessionId} with code ${code}`);
      this.markSessionComplete(sessionId, code || 0);
    });

    // Store the process
    this.puppetProcesses.set(sessionId, puppetProcess);

    // Create session object
    const session: ConsoleSession = {
      id: sessionId,
      command: puppetCommand[0],
      args: puppetCommand.slice(1),
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...this.buildEnvironment(puppetOptions), ...options.env },
      createdAt: new Date(),
      lastActivity: new Date(),
      status: 'running',
      type: this.type,
      streaming: options.streaming,
      executionState: 'idle',
      activeCommands: new Map(),
      pid: puppetProcess.pid
    };

    this.sessions.set(sessionId, session);

    this.logger.info(`Puppet session ${sessionId} created for operation ${puppetOptions.operation || 'apply'}`);
    this.emit('session-created', { sessionId, type: 'puppet', session });

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
      isOneShot: true, // Most Puppet operations are one-shot
      isPersistent: false,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      pid: session.pid,
      metadata: {}
    };
  }

  async handleError(error: Error, context: ErrorContext): Promise<ErrorRecoveryResult> {
    this.logger.error(`Error in Puppet session ${context.sessionId}: ${error.message}`);

    return {
      recovered: false,
      strategy: 'none',
      attempts: 0,
      duration: 0,
      error: error.message
    };
  }

  async recoverSession(sessionId: string): Promise<boolean> {
    const puppetProcess = this.puppetProcesses.get(sessionId);
    return puppetProcess && !puppetProcess.killed || false;
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
        connectionsActive: this.puppetProcesses.size
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
      await this.checkPuppetAvailability();
      return {
        ...baseStatus,
        dependencies: {
          puppet: { available: true }
        }
      };
    } catch (error) {
      return {
        ...baseStatus,
        isHealthy: false,
        errors: [...baseStatus.errors, `Puppet not available: ${error}`],
        dependencies: {
          puppet: { available: false }
        }
      };
    }
  }

  private async checkPuppetAvailability(): Promise<void> {
    return new Promise((resolve, reject) => {
      const testProcess = spawn('puppet', ['--version'], { stdio: 'pipe' });

      testProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error('Puppet not found. Please install Puppet or Puppet Agent.'));
        }
      });

      testProcess.on('error', () => {
        reject(new Error('Puppet not found. Please install Puppet or Puppet Agent.'));
      });
    });
  }

  private buildPuppetCommand(options: PuppetConnectionOptions): string[] {
    const command = [];

    // Puppet executable
    if (options.customPuppetPath) {
      command.push(options.customPuppetPath);
    } else {
      command.push('puppet');
    }

    // Puppet operation
    if (options.operation) {
      command.push(options.operation);
    } else {
      command.push('apply');
    }

    // Build operation-specific arguments
    switch (options.operation) {
      case 'apply':
        this.buildApplyArguments(command, options);
        break;
      case 'agent':
        this.buildAgentArguments(command, options);
        break;
      case 'master':
        this.buildMasterArguments(command, options);
        break;
      case 'cert':
        this.buildCertArguments(command, options);
        break;
      case 'module':
        this.buildModuleArguments(command, options);
        break;
      case 'node':
        this.buildNodeArguments(command, options);
        break;
      case 'resource':
        this.buildResourceArguments(command, options);
        break;
      case 'config':
        this.buildConfigArguments(command, options);
        break;
      case 'device':
        this.buildDeviceArguments(command, options);
        break;
      case 'lookup':
        this.buildLookupArguments(command, options);
        break;
      case 'facts':
        this.buildFactsArguments(command, options);
        break;
      case 'filebucket':
        this.buildFilebucketArguments(command, options);
        break;
      case 'describe':
        this.buildDescribeArguments(command, options);
        break;
      case 'doc':
        this.buildDocArguments(command, options);
        break;
      case 'epp':
        this.buildEppArguments(command, options);
        break;
      case 'parser':
        this.buildParserArguments(command, options);
        break;
      default:
        this.buildApplyArguments(command, options);
        break;
    }

    // Common arguments for all operations
    this.buildCommonArguments(command, options);

    // Custom flags
    if (options.customFlags && options.customFlags.length > 0) {
      command.push(...options.customFlags);
    }

    return command;
  }

  private buildApplyArguments(command: string[], options: PuppetConnectionOptions): void {
    // Manifest file or content
    if (options.manifestFile) {
      command.push(options.manifestFile);
    } else if (options.manifestContent) {
      command.push('-e', options.manifestContent);
    }

    // Apply-specific options
    if (options.noop) {
      command.push('--noop');
    }

    if (options.test) {
      command.push('--test');
    }

    if (options.detailed_exitcodes) {
      command.push('--detailed-exitcodes');
    }

    if (options.catalog) {
      command.push('--catalog', options.catalog);
    }

    if (options.facts) {
      command.push('--facts', options.facts);
    }

    if (options.compile) {
      command.push('--compile');
    }

    if (options.execute) {
      command.push('--execute', options.execute);
    }

    if (options.tags && options.tags.length > 0) {
      command.push('--tags', options.tags.join(','));
    }

    if (options.skip_tags && options.skip_tags.length > 0) {
      command.push('--skip-tags', options.skip_tags.join(','));
    }
  }

  private buildAgentArguments(command: string[], options: PuppetConnectionOptions): void {
    // Agent-specific options
    if (options.onetime) {
      command.push('--onetime');
    }

    if (options.test) {
      command.push('--test');
    }

    if (options.detailed_exitcodes) {
      command.push('--detailed-exitcodes');
    }

    if (options.noop) {
      command.push('--noop');
    }

    if (options.ignorecache) {
      command.push('--ignorecache');
    }

    if (options.ignoreschedules) {
      command.push('--ignoreschedules');
    }

    if (options.usecacheonfailure) {
      command.push('--usecacheonfailure');
    }

    if (options.tags && options.tags.length > 0) {
      command.push('--tags', options.tags.join(','));
    }

    if (options.skip_tags && options.skip_tags.length > 0) {
      command.push('--skip-tags', options.skip_tags.join(','));
    }

    if (options.waitforcert !== undefined) {
      command.push('--waitforcert', options.waitforcert.toString());
    }

    if (options.maxwaitforcert !== undefined) {
      command.push('--maxwaitforcert', options.maxwaitforcert.toString());
    }

    if (options.daemonize) {
      command.push('--daemonize');
    }

    if (options.no_use_srv_records) {
      command.push('--no-use_srv_records');
    }

    if (options.use_srv_records) {
      command.push('--use_srv_records');
    }

    if (options.srv_domain) {
      command.push('--srv_domain', options.srv_domain);
    }
  }

  private buildMasterArguments(command: string[], options: PuppetConnectionOptions): void {
    // Master-specific options
    if (options.compile) {
      command.push('--compile');
    }

    if (options.node_name) {
      command.push('--node-name', options.node_name);
    }

    if (options.daemonize) {
      command.push('--daemonize');
    }

    if (options.ca) {
      command.push('--ca');
    }

    if (options.no_use_srv_records) {
      command.push('--no-use_srv_records');
    }

    if (options.use_srv_records) {
      command.push('--use_srv_records');
    }

    if (options.srv_domain) {
      command.push('--srv_domain', options.srv_domain);
    }

    if (options.autosign !== undefined) {
      if (typeof options.autosign === 'boolean') {
        command.push('--autosign', options.autosign.toString());
      } else {
        command.push('--autosign', options.autosign);
      }
    }
  }

  private buildCertArguments(command: string[], options: PuppetConnectionOptions): void {
    // Certificate management arguments
    if (options.certname) {
      command.push('--certname', options.certname);
    }

    if (options.ca_server) {
      command.push('--ca_server', options.ca_server);
    }

    if (options.ca_port) {
      command.push('--ca_port', options.ca_port.toString());
    }

    if (options.certdnsnames && options.certdnsnames.length > 0) {
      command.push('--certdnsnames', options.certdnsnames.join(','));
    }

    if (options.certipaddresses && options.certipaddresses.length > 0) {
      command.push('--certipaddresses', options.certipaddresses.join(','));
    }

    if (options.digest) {
      command.push('--digest', options.digest);
    }

    if (options.ca_name) {
      command.push('--ca-name', options.ca_name);
    }

    if (options.ca_ttl) {
      command.push('--ca-ttl', options.ca_ttl);
    }

    if (options.req_bits) {
      command.push('--req-bits', options.req_bits.toString());
    }

    if (options.keylength) {
      command.push('--keylength', options.keylength.toString());
    }
  }

  private buildModuleArguments(command: string[], options: PuppetConnectionOptions): void {
    // Module management arguments
    if (options.module_working_dir) {
      command.push('--module_working_dir', options.module_working_dir);
    }

    if (options.module_skeleton_dir) {
      command.push('--module_skeleton_dir', options.module_skeleton_dir);
    }

    if (options.forge_authorization) {
      command.push('--forge_authorization', options.forge_authorization);
    }

    if (options.forge_cache_dir) {
      command.push('--forge_cache_dir', options.forge_cache_dir);
    }

    if (options.module_repository) {
      command.push('--module_repository', options.module_repository);
    }

    if (options.module_tool_pre_install_check !== undefined) {
      command.push('--module_tool_pre_install_check', options.module_tool_pre_install_check.toString());
    }

    if (options.module_tool_post_install_check !== undefined) {
      command.push('--module_tool_post_install_check', options.module_tool_post_install_check.toString());
    }
  }

  private buildNodeArguments(command: string[], options: PuppetConnectionOptions): void {
    // Node management arguments
    if (options.node_name) {
      command.push('--node-name', options.node_name);
    }

    if (options.node_name_fact) {
      command.push('--node-name-fact', options.node_name_fact);
    }

    if (options.node_name_value) {
      command.push('--node-name-value', options.node_name_value);
    }

    if (options.external_nodes) {
      command.push('--external_nodes', options.external_nodes);
    }

    if (options.enc_api) {
      command.push('--enc_api', options.enc_api);
    }
  }

  private buildResourceArguments(command: string[], options: PuppetConnectionOptions): void {
    // Resource management arguments
    if (options.tags && options.tags.length > 0) {
      command.push('--tags', options.tags.join(','));
    }

    if (options.facts) {
      command.push('--facts', options.facts);
    }

    if (options.fact_format) {
      command.push('--fact-format', options.fact_format);
    }
  }

  private buildConfigArguments(command: string[], options: PuppetConnectionOptions): void {
    // Config management arguments - most handled in common arguments
  }

  private buildDeviceArguments(command: string[], options: PuppetConnectionOptions): void {
    // Device management arguments
    if (options.detailed_exitcodes) {
      command.push('--detailed-exitcodes');
    }

    if (options.test) {
      command.push('--test');
    }

    if (options.waitforcert !== undefined) {
      command.push('--waitforcert', options.waitforcert.toString());
    }
  }

  private buildLookupArguments(command: string[], options: PuppetConnectionOptions): void {
    // Hiera lookup arguments
    if (options.facts) {
      command.push('--facts', options.facts);
    }

    if (options.fact_format) {
      command.push('--fact-format', options.fact_format);
    }

    if (options.node_name) {
      command.push('--node', options.node_name);
    }
  }

  private buildFactsArguments(command: string[], options: PuppetConnectionOptions): void {
    // Facts management arguments
    if (options.fact_format) {
      command.push('--format', options.fact_format);
    }
  }

  private buildFilebucketArguments(command: string[], options: PuppetConnectionOptions): void {
    // Filebucket arguments
    if (options.bucketdir) {
      command.push('--bucketdir', options.bucketdir);
    }
  }

  private buildDescribeArguments(command: string[], options: PuppetConnectionOptions): void {
    // Describe arguments - typically just the resource type
  }

  private buildDocArguments(command: string[], options: PuppetConnectionOptions): void {
    // Documentation arguments
    if (options.modulePath && options.modulePath.length > 0) {
      command.push('--modulepath', options.modulePath.join(':'));
    }
  }

  private buildEppArguments(command: string[], options: PuppetConnectionOptions): void {
    // EPP template arguments
    if (options.facts) {
      command.push('--facts', options.facts);
    }
  }

  private buildParserArguments(command: string[], options: PuppetConnectionOptions): void {
    // Parser arguments
    if (options.parser) {
      command.push('--parser', options.parser);
    }
  }

  private buildCommonArguments(command: string[], options: PuppetConnectionOptions): void {
    // Configuration and directories
    if (options.configFile) {
      command.push('--config', options.configFile);
    }

    if (options.confdir) {
      command.push('--confdir', options.confdir);
    }

    if (options.vardir) {
      command.push('--vardir', options.vardir);
    }

    if (options.rundir) {
      command.push('--rundir', options.rundir);
    }

    if (options.logdir) {
      command.push('--logdir', options.logdir);
    }

    if (options.codedir) {
      command.push('--codedir', options.codedir);
    }

    if (options.ssldir) {
      command.push('--ssldir', options.ssldir);
    }

    // Environment and paths
    if (options.environment) {
      command.push('--environment', options.environment);
    }

    if (options.modulePath && options.modulePath.length > 0) {
      command.push('--modulepath', options.modulePath.join(':'));
    }

    if (options.basemodulepath) {
      command.push('--basemodulepath', options.basemodulepath);
    }

    if (options.environmentpath) {
      command.push('--environmentpath', options.environmentpath);
    }

    if (options.hiera_config) {
      command.push('--hiera_config', options.hiera_config);
    }

    // Server connection
    if (options.server) {
      command.push('--server', options.server);
    }

    if (options.port) {
      command.push('--serverport', options.port.toString());
    }

    if (options.masterport) {
      command.push('--masterport', options.masterport.toString());
    }

    // Certificate settings
    if (options.certname) {
      command.push('--certname', options.certname);
    }

    // User and group
    if (options.user) {
      command.push('--user', options.user);
    }

    if (options.group) {
      command.push('--group', options.group);
    }

    // Logging and verbosity
    if (options.logLevel) {
      command.push('--log_level', options.logLevel);
    }

    if (options.verbose) {
      command.push('--verbose');
    }

    if (options.debug) {
      command.push('--debug');
    }

    if (options.trace) {
      command.push('--trace');
    }

    if (options.profile) {
      command.push('--profile');
    }

    if (options.evaltrace) {
      command.push('--evaltrace');
    }

    if (options.summarize) {
      command.push('--summarize');
    }

    // Behavior options
    if (options.strict) {
      command.push('--strict', options.strict);
    }

    if (options.strict_variables) {
      command.push('--strict_variables');
    }

    if (options.disable_warnings && options.disable_warnings.length > 0) {
      command.push('--disable_warnings', options.disable_warnings.join(','));
    }

    if (options.graph) {
      command.push('--graph');
    }

    if (options.graphdir) {
      command.push('--graphdir', options.graphdir);
    }

    if (options.show_diff) {
      command.push('--show_diff');
    }

    if (options.diff) {
      command.push('--diff');
    }

    // HTTP settings
    if (options.http_proxy_host) {
      command.push('--http_proxy_host', options.http_proxy_host);
    }

    if (options.http_proxy_port) {
      command.push('--http_proxy_port', options.http_proxy_port.toString());
    }

    if (options.http_debug) {
      command.push('--http_debug');
    }

    // Report settings
    if (options.report) {
      command.push('--report');
    }

    if (options.reports && options.reports.length > 0) {
      command.push('--reports', options.reports.join(','));
    }

    // Plugin settings
    if (options.pluginsync) {
      command.push('--pluginsync');
    }

    if (options.pluginsource) {
      command.push('--pluginsource', options.pluginsource);
    }

    if (options.plugindest) {
      command.push('--plugindest', options.plugindest);
    }

    // PID file
    if (options.pid_file) {
      command.push('--pidfile', options.pid_file);
    }
  }

  private buildEnvironment(options: PuppetConnectionOptions): Record<string, string> {
    const env: Record<string, string> = {};

    // Puppet environment variables
    if (options.environment) {
      env.PUPPET_ENVIRONMENT = options.environment;
    }

    if (options.confdir) {
      env.PUPPET_CONFDIR = options.confdir;
    }

    if (options.vardir) {
      env.PUPPET_VARDIR = options.vardir;
    }

    if (options.codedir) {
      env.PUPPET_CODEDIR = options.codedir;
    }

    if (options.logdir) {
      env.PUPPET_LOGDIR = options.logdir;
    }

    if (options.rundir) {
      env.PUPPET_RUNDIR = options.rundir;
    }

    if (options.ssldir) {
      env.PUPPET_SSLDIR = options.ssldir;
    }

    // Module path
    if (options.modulePath && options.modulePath.length > 0) {
      env.PUPPET_MODULEPATH = options.modulePath.join(':');
    }

    // Server settings
    if (options.server) {
      env.PUPPET_SERVER = options.server;
    }

    if (options.port) {
      env.PUPPET_SERVERPORT = options.port.toString();
    }

    if (options.certname) {
      env.PUPPET_CERTNAME = options.certname;
    }

    // Hiera settings
    if (options.hiera_config) {
      env.PUPPET_HIERA_CONFIG = options.hiera_config;
    }

    // Logging
    if (options.logLevel) {
      env.PUPPET_LOG_LEVEL = options.logLevel;
    }

    // Database settings for PuppetDB
    if (options.storeconfigs) {
      env.PUPPET_STORECONFIGS = 'true';
      if (options.storeconfigs_backend) {
        env.PUPPET_STORECONFIGS_BACKEND = options.storeconfigs_backend;
      }
    }

    if (options.dbadapter) {
      env.PUPPET_DBADAPTER = options.dbadapter;
    }

    if (options.dbname) {
      env.PUPPET_DBNAME = options.dbname;
    }

    if (options.dbserver) {
      env.PUPPET_DBSERVER = options.dbserver;
    }

    if (options.dbport) {
      env.PUPPET_DBPORT = options.dbport.toString();
    }

    if (options.dbuser) {
      env.PUPPET_DBUSER = options.dbuser;
    }

    // HTTP proxy settings
    if (options.http_proxy_host) {
      env.http_proxy = `http://${options.http_proxy_host}:${options.http_proxy_port || 8080}`;
      env.https_proxy = env.http_proxy;
    }

    // Custom environment variables
    if (options.environmentVars) {
      Object.assign(env, options.environmentVars);
    }

    return env;
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up Puppet protocol');

    // Close all Puppet processes
    for (const [sessionId, process] of Array.from(this.puppetProcesses)) {
      try {
        process.kill();
      } catch (error) {
        this.logger.error(`Error killing Puppet process for session ${sessionId}:`, error);
      }
    }

    // Clear all data
    this.puppetProcesses.clear();

    // Call parent cleanup
    await super.cleanup();
  }
}

export default PuppetProtocol;