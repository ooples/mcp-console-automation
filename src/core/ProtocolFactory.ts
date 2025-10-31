import { EventEmitter } from 'events';
import { Logger } from '../utils/logger.js';
import {
  ConsoleType,
  ConsoleSession,
  SessionOptions,
  LocalConsoleType,
  RemoteConsoleType,
  CloudConsoleType,
  ContainerConsoleType,
  VirtualizationConsoleType,
  HardwareConsoleType,
  RemoteDesktopType,
  NetworkConsoleType,
  WindowsRemoteType,
  IPCConsoleType,
  AutomationConsoleType,
  DatabaseConsoleType,
  ApplicationConsoleType,
  SSHConnectionOptions,
  TelnetConnectionOptions,
  AzureConnectionOptions,
  GCPConnectionOptions,
  AWSSSMConnectionOptions,
  SerialConnectionOptions,
  RDPConnectionOptions,
  VNCConnectionOptions,
  KubernetesConnectionOptions,
  WinRMConnectionOptions,
  WebSocketTerminalConnectionOptions,
  IPCConnectionOptions,
  AnsibleConnectionOptions,
  WSLConnectionOptions,
} from '../types/index.js';

// Protocol interfaces
export interface IProtocol extends EventEmitter {
  readonly type: ConsoleType;
  readonly capabilities: ProtocolCapabilities;
  readonly healthStatus: ProtocolHealthStatus;

  initialize(): Promise<void>;
  createSession(options: SessionOptions): Promise<ConsoleSession>;
  executeCommand(
    sessionId: string,
    command: string,
    args?: string[]
  ): Promise<void>;
  sendInput(sessionId: string, input: string): Promise<void>;
  getOutput(sessionId: string, since?: Date): Promise<string>;
  closeSession(sessionId: string): Promise<void>;
  getHealthStatus(): Promise<ProtocolHealthStatus>;
  dispose(): Promise<void>;
}

export interface ProtocolCapabilities {
  supportsStreaming: boolean;
  supportsFileTransfer: boolean;
  supportsX11Forwarding: boolean;
  supportsPortForwarding: boolean;
  supportsAuthentication: boolean;
  supportsEncryption: boolean;
  supportsCompression: boolean;
  supportsMultiplexing: boolean;
  supportsKeepAlive: boolean;
  supportsReconnection: boolean;
  supportsBinaryData: boolean;
  supportsCustomEnvironment: boolean;
  supportsWorkingDirectory: boolean;
  supportsSignals: boolean;
  supportsResizing: boolean;
  supportsPTY: boolean;
  maxConcurrentSessions: number;
  defaultTimeout: number;
  supportedEncodings: string[];
  supportedAuthMethods: string[];
  platformSupport: {
    windows: boolean;
    linux: boolean;
    macos: boolean;
    freebsd: boolean;
  };
}

export interface ProtocolHealthStatus {
  isHealthy: boolean;
  lastChecked: Date;
  errors: string[];
  warnings: string[];
  metrics: {
    activeSessions: number;
    totalSessions: number;
    averageLatency: number;
    successRate: number;
    uptime: number;
  };
  dependencies: {
    [key: string]: {
      available: boolean;
      version?: string;
      error?: string;
    };
  };
}

export interface ProtocolConfig {
  enabled: boolean;
  maxSessions: number;
  defaultTimeout: number;
  retryAttempts: number;
  healthCheckInterval: number;
  enableLogging: boolean;
  enableMetrics: boolean;
  customSettings: Record<string, any>;
}

export interface ProtocolRegistry {
  [key: string]: {
    factory: () => Promise<IProtocol>;
    config: ProtocolConfig;
    lazy: boolean;
    priority: number;
  };
}

/**
 * Protocol detection utilities
 */
export class ProtocolDetector {
  private static readonly PROTOCOL_PATTERNS: Record<string, RegExp[]> = {
    ssh: [/^ssh:\/\//, /^.+@.+:.+$/, /^.+ -p \d+/],
    sftp: [/^sftp:\/\//, /^sftp\s+/],
    telnet: [/^telnet:\/\//, /^telnet\s+/],
    docker: [/^docker\s+/, /^docker:\/\//, /container:/],
    kubectl: [/^kubectl\s+/, /^k8s:\/\//, /^kubernetes:/],
    wsl: [/^wsl\s+/, /^wsl\.exe/, /\\\\wsl\$/],
    rdp: [/^rdp:\/\//, /^mstsc\s+/, /:3389$/],
    vnc: [/^vnc:\/\//, /:5900$/, /:59\d\d$/],
    winrm: [/^winrm\s+/, /^winrm:\/\//, /^psremoting/],
    'azure-shell': [/^az\s+/, /^azure:\/\//, /\.azure\.com/],
    'gcp-shell': [/^gcloud\s+/, /^gcp:\/\//, /\.googleapis\.com/],
    'aws-ssm': [/^aws\s+ssm/, /^ssm:\/\//, /i-[0-9a-f]+/],
    'websocket-term': [/^ws:\/\//, /^wss:\/\//, /\/terminal$/],
    serial: [/^\/dev\/tty/, /^COM\d+/, /^serial:/],
    ansible: [/^ansible\s+/, /^ansible-playbook/, /\.yml$/],
  };

  static detectProtocol(
    command: string,
    connectionString?: string
  ): ConsoleType | null {
    const testString = connectionString || command;

    for (const [protocol, patterns] of Object.entries(this.PROTOCOL_PATTERNS)) {
      if (patterns.some((pattern) => pattern.test(testString))) {
        return protocol as ConsoleType;
      }
    }

    // Platform-specific defaults
    if (process.platform === 'win32') {
      return 'powershell';
    } else {
      return 'bash';
    }
  }

  static getProtocolCapabilities(
    type: ConsoleType
  ): Partial<ProtocolCapabilities> {
    const baseCapabilities: Partial<ProtocolCapabilities> = {
      supportsStreaming: true,
      supportsCustomEnvironment: true,
      supportsWorkingDirectory: true,
      maxConcurrentSessions: 10,
      defaultTimeout: 30000,
      supportedEncodings: ['utf-8'],
      platformSupport: {
        windows: false,
        linux: false,
        macos: false,
        freebsd: false,
      },
    };

    // Protocol-specific capabilities
    switch (type) {
      case 'ssh':
        return {
          ...baseCapabilities,
          supportsFileTransfer: true,
          supportsX11Forwarding: true,
          supportsPortForwarding: true,
          supportsAuthentication: true,
          supportsEncryption: true,
          supportsCompression: true,
          supportsMultiplexing: true,
          supportsKeepAlive: true,
          supportsReconnection: true,
          supportsPTY: true,
          supportedAuthMethods: [
            'password',
            'publickey',
            'keyboard-interactive',
          ],
          platformSupport: {
            windows: true,
            linux: true,
            macos: true,
            freebsd: true,
          },
        };

      case 'docker':
        return {
          ...baseCapabilities,
          supportsStreaming: true,
          supportsBinaryData: true,
          supportsSignals: true,
          supportsResizing: true,
          supportsPTY: true,
          maxConcurrentSessions: 50,
          platformSupport: {
            windows: true,
            linux: true,
            macos: true,
            freebsd: false,
          },
        };

      case 'winrm':
        return {
          ...baseCapabilities,
          supportsAuthentication: true,
          supportsEncryption: true,
          supportedAuthMethods: ['basic', 'negotiate', 'kerberos'],
          platformSupport: {
            windows: true,
            linux: false,
            macos: false,
            freebsd: false,
          },
        };

      default:
        return baseCapabilities;
    }
  }
}

/**
 * Main Protocol Factory for creating and managing protocol instances
 */
export class ProtocolFactory extends EventEmitter {
  private static instance: ProtocolFactory;
  private registry: ProtocolRegistry = {};
  private protocolInstances: Map<string, IProtocol> = new Map();
  private protocolConfigs: Map<ConsoleType, ProtocolConfig> = new Map();
  private logger: Logger;

  private constructor() {
    super();
    this.logger = new Logger('ProtocolFactory');
    this.setupDefaultConfigs();
    this.registerDefaultProtocols();
  }

  public static getInstance(): ProtocolFactory {
    if (!ProtocolFactory.instance) {
      ProtocolFactory.instance = new ProtocolFactory();
    }
    return ProtocolFactory.instance;
  }

  /**
   * Setup default configurations for all protocol types
   */
  private setupDefaultConfigs(): void {
    const defaultConfig: ProtocolConfig = {
      enabled: true,
      maxSessions: 10,
      defaultTimeout: 30000,
      retryAttempts: 3,
      healthCheckInterval: 60000,
      enableLogging: true,
      enableMetrics: true,
      customSettings: {},
    };

    // Set specific configs for different protocol types
    const protocolTypes: ConsoleType[] = [
      'cmd',
      'powershell',
      'bash',
      'ssh',
      'telnet',
      'docker',
      'kubectl',
      'azure-shell',
      'gcp-shell',
      'aws-ssm',
      'wsl',
      'serial',
      'rdp',
      'vnc',
      'winrm',
      'websocket-term',
      'ansible',
      'ipmi',
      'guacamole',
      'wetty',
      'wmi',
      'x11vnc',
      'xen',
      'ipc',
      'sftp',
      'chef',
      'puppet',
      'saltstack',
      'pulumi',
      'terraform',
      'jenkins',
      'gitlab-runner',
      'github-actions',
      'circleci',
      'mysql',
      'postgresql',
      'redis',
      'mongodb',
      'elasticsearch',
      'sqlite',
      'oracle',
      'mssql',
      'cassandra',
      'neo4j',
      'jupyter',
      'vscode-remote',
      'code-server',
      'theia',
      'cloud9',
    ];

    // Set default config for all protocol types
    protocolTypes.forEach((type) => {
      this.protocolConfigs.set(type, { ...defaultConfig });
    });

    // Override specific configs for different protocol types
    this.protocolConfigs.set('ssh', {
      ...defaultConfig,
      maxSessions: 20,
      customSettings: { keepAliveInterval: 30000 },
    });

    this.protocolConfigs.set('docker', {
      ...defaultConfig,
      maxSessions: 50,
      customSettings: { attachStdout: true, attachStderr: true },
    });

    this.protocolConfigs.set('kubectl', {
      ...defaultConfig,
      maxSessions: 30,
      customSettings: { namespace: 'default' },
    });
  }

  /**
   * Register default protocol factories
   */
  private registerDefaultProtocols(): void {
    // Lazy loading of protocol modules
    this.registry = {
      // Local protocols
      cmd: {
        factory: () => this.createLocalProtocol('cmd'),
        config: this.protocolConfigs.get('cmd')!,
        lazy: false,
        priority: 1,
      },
      powershell: {
        factory: () => this.createLocalProtocol('powershell'),
        config: this.protocolConfigs.get('powershell')!,
        lazy: false,
        priority: 1,
      },
      bash: {
        factory: () => this.createLocalProtocol('bash'),
        config: this.protocolConfigs.get('bash')!,
        lazy: false,
        priority: 1,
      },

      // Remote protocols
      ssh: {
        factory: () =>
          this.loadProtocolModule('SSHProtocol', '../protocols/SSHProtocol.js'),
        config: this.protocolConfigs.get('ssh')!,
        lazy: true,
        priority: 2,
      },
      telnet: {
        factory: () =>
          this.loadProtocolModule(
            'TelnetProtocol',
            '../protocols/TelnetProtocol.js'
          ),
        config: this.protocolConfigs.get('telnet')!,
        lazy: true,
        priority: 3,
      },

      // Container protocols
      docker: {
        factory: () =>
          this.loadProtocolModule(
            'DockerProtocol',
            '../protocols/DockerProtocol.js'
          ),
        config: this.protocolConfigs.get('docker')!,
        lazy: true,
        priority: 2,
      },
      kubectl: {
        factory: () =>
          this.loadProtocolModule(
            'KubernetesProtocol',
            '../protocols/KubernetesProtocol.js'
          ),
        config: this.protocolConfigs.get('kubectl')!,
        lazy: true,
        priority: 2,
      },

      // Cloud protocols
      'azure-shell': {
        factory: () =>
          this.loadProtocolModule(
            'AzureProtocol',
            '../protocols/AzureProtocol.js'
          ),
        config: this.protocolConfigs.get('azure-shell')!,
        lazy: true,
        priority: 3,
      },
      'gcp-shell': {
        factory: () =>
          this.loadProtocolModule('GCPProtocol', '../protocols/GCPProtocol.js'),
        config: this.protocolConfigs.get('gcp-shell')!,
        lazy: true,
        priority: 3,
      },
      'aws-ssm': {
        factory: () =>
          this.loadProtocolModule(
            'AWSSSMProtocol',
            '../protocols/AWSSSMProtocol.js'
          ),
        config: this.protocolConfigs.get('aws-ssm')!,
        lazy: true,
        priority: 3,
      },

      // Virtualization protocols
      wsl: {
        factory: () =>
          this.loadProtocolModule('WSLProtocol', '../protocols/WSLProtocol.js'),
        config: this.protocolConfigs.get('wsl')!,
        lazy: true,
        priority: 2,
      },

      // Hardware protocols
      serial: {
        factory: () =>
          this.loadProtocolModule(
            'SerialProtocol',
            '../protocols/SerialProtocol.js'
          ),
        config: this.protocolConfigs.get('serial')!,
        lazy: true,
        priority: 4,
      },

      // Remote desktop protocols
      rdp: {
        factory: () =>
          this.loadProtocolModule('RDPProtocol', '../protocols/RDPProtocol.js'),
        config: this.protocolConfigs.get('rdp')!,
        lazy: true,
        priority: 4,
      },
      vnc: {
        factory: () =>
          this.loadProtocolModule('VNCProtocol', '../protocols/VNCProtocol.js'),
        config: this.protocolConfigs.get('vnc')!,
        lazy: true,
        priority: 4,
      },

      // Windows remote protocols
      winrm: {
        factory: () =>
          this.loadProtocolModule(
            'WinRMProtocol',
            '../protocols/WinRMProtocol.js'
          ),
        config: this.protocolConfigs.get('winrm')!,
        lazy: true,
        priority: 3,
      },

      // Network protocols
      'websocket-term': {
        factory: () =>
          this.loadProtocolModule(
            'WebSocketTerminalProtocol',
            '../protocols/WebSocketTerminalProtocol.js'
          ),
        config: this.protocolConfigs.get('websocket-term')!,
        lazy: true,
        priority: 3,
      },

      // Automation protocols
      ansible: {
        factory: () =>
          this.loadProtocolModule(
            'AnsibleProtocol',
            '../protocols/AnsibleProtocol.js'
          ),
        config: this.protocolConfigs.get('ansible')!,
        lazy: true,
        priority: 4,
      },

      // Hardware management protocols
      ipmi: {
        factory: () =>
          this.loadProtocolModule(
            'IPMIProtocol',
            '../protocols/IPMIProtocol.js'
          ),
        config: this.protocolConfigs.get('ipmi')!,
        lazy: true,
        priority: 4,
      },

      // Web-based terminal protocols
      guacamole: {
        factory: () =>
          this.loadProtocolModule(
            'GuacamoleProtocol',
            '../protocols/GuacamoleProtocol.js'
          ),
        config: this.protocolConfigs.get('guacamole')!,
        lazy: true,
        priority: 4,
      },
      wetty: {
        factory: () =>
          this.loadProtocolModule(
            'WeTTYProtocol',
            '../protocols/WeTTYProtocol.js'
          ),
        config: this.protocolConfigs.get('wetty')!,
        lazy: true,
        priority: 4,
      },

      // Windows management protocols
      wmi: {
        factory: () =>
          this.loadProtocolModule('WMIProtocol', '../protocols/WMIProtocol.js'),
        config: this.protocolConfigs.get('wmi')!,
        lazy: true,
        priority: 4,
      },

      // X11/VNC protocols
      x11vnc: {
        factory: () =>
          this.loadProtocolModule(
            'X11VNCProtocol',
            '../protocols/X11VNCProtocol.js'
          ),
        config: this.protocolConfigs.get('x11vnc')!,
        lazy: true,
        priority: 4,
      },

      // Hypervisor protocols
      xen: {
        factory: () =>
          this.loadProtocolModule('XenProtocol', '../protocols/XenProtocol.js'),
        config: this.protocolConfigs.get('xen')!,
        lazy: true,
        priority: 4,
      },

      // IPC protocol
      ipc: {
        factory: () =>
          this.loadProtocolModule('IPCProtocol', '../protocols/IPCProtocol.js'),
        config: this.protocolConfigs.get('ipc')!,
        lazy: true,
        priority: 3,
      },

      // File transfer protocols
      sftp: {
        factory: () =>
          this.loadProtocolModule(
            'SFTPProtocol',
            '../protocols/SFTPProtocol.js'
          ),
        config: this.protocolConfigs.get('sftp')!,
        lazy: true,
        priority: 3,
      },

      // Configuration management protocols
      chef: {
        factory: () =>
          this.loadProtocolModule(
            'ChefProtocol',
            '../protocols/ChefProtocol.js'
          ),
        config: this.protocolConfigs.get('chef')!,
        lazy: true,
        priority: 4,
      },
      puppet: {
        factory: () =>
          this.loadProtocolModule(
            'PuppetProtocol',
            '../protocols/PuppetProtocol.js'
          ),
        config: this.protocolConfigs.get('puppet')!,
        lazy: true,
        priority: 4,
      },
      saltstack: {
        factory: () =>
          this.loadProtocolModule(
            'SaltStackProtocol',
            '../protocols/SaltStackProtocol.js'
          ),
        config: this.protocolConfigs.get('saltstack')!,
        lazy: true,
        priority: 4,
      },

      // Infrastructure as Code protocols
      pulumi: {
        factory: () =>
          this.loadProtocolModule(
            'PulumiProtocol',
            '../protocols/PulumiProtocol.js'
          ),
        config: this.protocolConfigs.get('pulumi')!,
        lazy: true,
        priority: 4,
      },
      terraform: {
        factory: () =>
          this.loadProtocolModule(
            'TerraformProtocol',
            '../protocols/TerraformProtocol.js'
          ),
        config: this.protocolConfigs.get('terraform')!,
        lazy: true,
        priority: 4,
      },

      // CI/CD protocols
      jenkins: {
        factory: () =>
          this.loadProtocolModule(
            'JenkinsProtocol',
            '../protocols/JenkinsProtocol.js'
          ),
        config: this.protocolConfigs.get('jenkins')!,
        lazy: true,
        priority: 4,
      },
      'gitlab-runner': {
        factory: () =>
          this.loadProtocolModule(
            'GitLabRunnerProtocol',
            '../protocols/GitLabRunnerProtocol.js'
          ),
        config: this.protocolConfigs.get('gitlab-runner')!,
        lazy: true,
        priority: 4,
      },
      'github-actions': {
        factory: () =>
          this.loadProtocolModule(
            'GitHubActionsProtocol',
            '../protocols/GitHubActionsProtocol.js'
          ),
        config: this.protocolConfigs.get('github-actions')!,
        lazy: true,
        priority: 4,
      },
      circleci: {
        factory: () =>
          this.loadProtocolModule(
            'CircleCIProtocol',
            '../protocols/CircleCIProtocol.js'
          ),
        config: this.protocolConfigs.get('circleci')!,
        lazy: true,
        priority: 4,
      },

      // Database protocols
      mysql: {
        factory: () =>
          this.loadProtocolModule(
            'MySQLProtocol',
            '../protocols/MySQLProtocol.js'
          ),
        config: this.protocolConfigs.get('mysql')!,
        lazy: true,
        priority: 3,
      },
      postgresql: {
        factory: () =>
          this.loadProtocolModule(
            'PostgreSQLProtocol',
            '../protocols/PostgreSQLProtocol.js'
          ),
        config: this.protocolConfigs.get('postgresql')!,
        lazy: true,
        priority: 3,
      },
      redis: {
        factory: () =>
          this.loadProtocolModule(
            'RedisProtocol',
            '../protocols/RedisProtocol.js'
          ),
        config: this.protocolConfigs.get('redis')!,
        lazy: true,
        priority: 3,
      },
      mongodb: {
        factory: () =>
          this.loadProtocolModule(
            'MongoDBProtocol',
            '../protocols/MongoDBProtocol.js'
          ),
        config: this.protocolConfigs.get('mongodb')!,
        lazy: true,
        priority: 3,
      },
      elasticsearch: {
        factory: () =>
          this.loadProtocolModule(
            'ElasticsearchProtocol',
            '../protocols/ElasticsearchProtocol.js'
          ),
        config: this.protocolConfigs.get('elasticsearch')!,
        lazy: true,
        priority: 3,
      },
      sqlite: {
        factory: () =>
          this.loadProtocolModule(
            'SQLiteProtocol',
            '../protocols/SQLiteProtocol.js'
          ),
        config: this.protocolConfigs.get('sqlite')!,
        lazy: true,
        priority: 3,
      },
      oracle: {
        factory: () =>
          this.loadProtocolModule(
            'OracleProtocol',
            '../protocols/OracleProtocol.js'
          ),
        config: this.protocolConfigs.get('oracle')!,
        lazy: true,
        priority: 3,
      },
      mssql: {
        factory: () =>
          this.loadProtocolModule(
            'MSSQLProtocol',
            '../protocols/MSSQLProtocol.js'
          ),
        config: this.protocolConfigs.get('mssql')!,
        lazy: true,
        priority: 3,
      },
      cassandra: {
        factory: () =>
          this.loadProtocolModule(
            'CassandraProtocol',
            '../protocols/CassandraProtocol.js'
          ),
        config: this.protocolConfigs.get('cassandra')!,
        lazy: true,
        priority: 3,
      },
      neo4j: {
        factory: () =>
          this.loadProtocolModule(
            'Neo4jProtocol',
            '../protocols/Neo4jProtocol.js'
          ),
        config: this.protocolConfigs.get('neo4j')!,
        lazy: true,
        priority: 3,
      },

      // Development environment protocols
      jupyter: {
        factory: () =>
          this.loadProtocolModule(
            'JupyterProtocol',
            '../protocols/JupyterProtocol.js'
          ),
        config: this.protocolConfigs.get('jupyter')!,
        lazy: true,
        priority: 4,
      },
      'vscode-remote': {
        factory: () =>
          this.loadProtocolModule(
            'VSCodeRemoteProtocol',
            '../protocols/VSCodeRemoteProtocol.js'
          ),
        config: this.protocolConfigs.get('vscode-remote')!,
        lazy: true,
        priority: 4,
      },
      'code-server': {
        factory: () =>
          this.loadProtocolModule(
            'CodeServerProtocol',
            '../protocols/CodeServerProtocol.js'
          ),
        config: this.protocolConfigs.get('code-server')!,
        lazy: true,
        priority: 4,
      },
      theia: {
        factory: () =>
          this.loadProtocolModule(
            'TheiaProtocol',
            '../protocols/TheiaProtocol.js'
          ),
        config: this.protocolConfigs.get('theia')!,
        lazy: true,
        priority: 4,
      },
      cloud9: {
        factory: () =>
          this.loadProtocolModule(
            'Cloud9Protocol',
            '../protocols/Cloud9Protocol.js'
          ),
        config: this.protocolConfigs.get('cloud9')!,
        lazy: true,
        priority: 4,
      },
    };
  }

  /**
   * Create a protocol instance
   */
  public async createProtocol(type: ConsoleType): Promise<IProtocol> {
    const cacheKey = `${type}`;

    // Return cached instance if available
    if (this.protocolInstances.has(cacheKey)) {
      return this.protocolInstances.get(cacheKey)!;
    }

    const registryEntry = this.registry[type];
    if (!registryEntry) {
      throw new Error(`Protocol '${type}' is not registered`);
    }

    if (!registryEntry.config.enabled) {
      throw new Error(`Protocol '${type}' is disabled`);
    }

    try {
      this.logger.info(`Creating protocol instance: ${type}`);
      const protocol = await registryEntry.factory();

      // Initialize the protocol
      await protocol.initialize();

      // Cache the instance
      this.protocolInstances.set(cacheKey, protocol);

      // Setup event listeners
      this.setupProtocolEventListeners(protocol, type);

      this.emit('protocolCreated', { type, protocol });
      return protocol;
    } catch (error) {
      this.logger.error(`Failed to create protocol '${type}':`, error);
      throw error;
    }
  }

  /**
   * Load protocol module dynamically
   */
  private async loadProtocolModule(
    className: string,
    modulePath: string
  ): Promise<IProtocol> {
    try {
      const module = await import(modulePath);
      const ProtocolClass = module[className];

      if (!ProtocolClass) {
        throw new Error(
          `Protocol class '${className}' not found in module '${modulePath}'`
        );
      }

      return new ProtocolClass();
    } catch (error) {
      this.logger.error(
        `Failed to load protocol module '${modulePath}':`,
        error
      );
      throw error;
    }
  }

  /**
   * Create local protocol (built-in shell protocols)
   */
  private async createLocalProtocol(
    type: LocalConsoleType
  ): Promise<IProtocol> {
    const { LocalProtocol } = await import('../protocols/LocalProtocol.js');
    return new LocalProtocol(type);
  }

  /**
   * Setup event listeners for protocol instances
   */
  private setupProtocolEventListeners(
    protocol: IProtocol,
    type: ConsoleType
  ): void {
    protocol.on('sessionCreated', (session) => {
      this.emit('sessionCreated', { type, session });
    });

    protocol.on('sessionClosed', (sessionId) => {
      this.emit('sessionClosed', { type, sessionId });
    });

    protocol.on('error', (error) => {
      this.logger.error(`Protocol '${type}' error:`, error);
      this.emit('protocolError', { type, error });
    });

    protocol.on('healthStatusChanged', (status) => {
      this.emit('healthStatusChanged', { type, status });
    });
  }

  /**
   * Get all registered protocols
   */
  public getRegisteredProtocols(): string[] {
    return Object.keys(this.registry);
  }

  /**
   * Get protocol configuration
   */
  public getProtocolConfig(type: ConsoleType): ProtocolConfig | undefined {
    return this.protocolConfigs.get(type);
  }

  /**
   * Update protocol configuration
   */
  public updateProtocolConfig(
    type: ConsoleType,
    config: Partial<ProtocolConfig>
  ): void {
    const existing = this.protocolConfigs.get(type);
    if (existing) {
      this.protocolConfigs.set(type, { ...existing, ...config });
      this.emit('configUpdated', { type, config });
    }
  }

  /**
   * Get health status for all protocols
   */
  public async getOverallHealthStatus(): Promise<
    Record<string, ProtocolHealthStatus>
  > {
    const healthStatuses: Record<string, ProtocolHealthStatus> = {};

    for (const [key, protocol] of Array.from(
      this.protocolInstances.entries()
    )) {
      try {
        healthStatuses[key] = await protocol.getHealthStatus();
      } catch (error) {
        healthStatuses[key] = {
          isHealthy: false,
          lastChecked: new Date(),
          errors: [error instanceof Error ? error.message : 'Unknown error'],
          warnings: [],
          metrics: {
            activeSessions: 0,
            totalSessions: 0,
            averageLatency: 0,
            successRate: 0,
            uptime: 0,
          },
          dependencies: {},
        };
      }
    }

    return healthStatuses;
  }

  /**
   * Dispose of all protocol instances
   */
  public async dispose(): Promise<void> {
    this.logger.info('Disposing protocol factory and all instances');

    const disposePromises = Array.from(this.protocolInstances.values()).map(
      (protocol) =>
        protocol
          .dispose()
          .catch((error) =>
            this.logger.error('Error disposing protocol:', error)
          )
    );

    await Promise.all(disposePromises);
    this.protocolInstances.clear();
    this.removeAllListeners();
  }

  /**
   * Register a custom protocol
   */
  public registerProtocol(
    type: string,
    factory: () => Promise<IProtocol>,
    config: ProtocolConfig,
    options: { lazy?: boolean; priority?: number } = {}
  ): void {
    this.registry[type] = {
      factory,
      config,
      lazy: options.lazy ?? true,
      priority: options.priority ?? 5,
    };

    this.protocolConfigs.set(type as ConsoleType, config);
    this.emit('protocolRegistered', { type, config });
  }

  /**
   * Unregister a protocol
   */
  public async unregisterProtocol(type: string): Promise<void> {
    // Dispose of any existing instances
    const protocol = this.protocolInstances.get(type);
    if (protocol) {
      await protocol.dispose();
      this.protocolInstances.delete(type);
    }

    // Remove from registry
    delete this.registry[type];
    this.protocolConfigs.delete(type as ConsoleType);

    this.emit('protocolUnregistered', { type });
  }
}

// Export singleton instance
export const protocolFactory = ProtocolFactory.getInstance();
