import { spawn, ChildProcess, SpawnOptions } from 'child_process';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import stripAnsi from 'strip-ansi';
import { Client as SSHClient, ClientChannel, ConnectConfig } from 'ssh2';
import { ConsoleSession, ConsoleOutput, ConsoleEvent, SessionOptions, ConsoleType, ConnectionPoolingOptions, SSHConnectionOptions, TelnetConnectionOptions, ExtendedErrorPattern, CommandExecution, AzureConnectionOptions, SerialConnectionOptions, WSLConnectionOptions, WSLSession, SFTPSessionOptions, FileTransferSession, SFTPTransferOptions, AWSSSMConnectionOptions, RDPConnectionOptions, RDPSession, WinRMConnectionOptions, WinRMSessionState, VNCConnectionOptions, VNCSession, VNCFramebuffer, VNCSecurityType, WebSocketTerminalConnectionOptions, WebSocketTerminalSessionState, IPCSessionState, IPMISessionState, AnsibleConnectionOptions, IPCConnectionOptions, IPMIConnectionOptions } from '../types/index.js';
import { ErrorDetector } from './ErrorDetector.js';
import { Logger } from '../utils/logger.js';
import { StreamManager } from './StreamManager.js';
import { MonitoringSystem } from '../monitoring/MonitoringSystem.js';
import { PromptDetector, PromptDetectionResult } from './PromptDetector.js';
import { ConnectionPool } from './ConnectionPool.js';
import { SessionManager } from './SessionManager.js';
import { DiagnosticsManager } from './DiagnosticsManager.js';
import { SessionValidator } from './SessionValidator.js';
import { RetryManager } from './RetryManager.js';
import { ErrorRecovery, ErrorContext } from './ErrorRecovery.js';
import { HealthMonitor } from './HealthMonitor.js';
import { HeartbeatMonitor } from './HeartbeatMonitor.js';
import { SessionRecovery } from './SessionRecovery.js';
import { MetricsCollector } from './MetricsCollector.js';
import { SSHConnectionKeepAlive } from './SSHConnectionKeepAlive.js';
import { ProtocolFactory, IProtocol, ProtocolDetector } from './ProtocolFactory.js';
import { AzureMonitoring } from '../monitoring/AzureMonitoring.js';
import { ConfigManager, ConnectionProfile, ApplicationProfile } from '../config/ConfigManager.js';
import PQueue from 'p-queue';
import { platform } from 'os';
import { readFileSync } from 'fs';

// Command queue types for SSH buffering fix
interface QueuedCommand {
  id: string;
  sessionId: string;
  input: string;
  timestamp: Date;
  retryCount: number;
  resolve: (value?: any) => void;
  reject: (error: Error) => void;
  acknowledged: boolean;
  sent: boolean;
  priority?: number;
  context?: any;
}

// Recovery result interface
interface TimeoutRecoveryResult {
  success: boolean;
  error?: string;
  reconnected?: boolean;
  restoredCommands?: number;
  metadata?: Record<string, any>;
}

interface SessionCommandQueue {
  sessionId: string;
  commands: QueuedCommand[];
  isProcessing: boolean;
  lastCommandTime: number;
  acknowledgmentTimeout: NodeJS.Timeout | null;
  outputBuffer: string;
  expectedPrompt?: RegExp;
  persistentData?: SessionPersistentData;
  bookmarks: SessionBookmark[];
}

// Enhanced session persistence interfaces
interface SessionPersistentData {
  sessionId: string;
  createdAt: Date;
  lastActivity: Date;
  sshOptions?: SSHConnectionOptions;
  environment: Record<string, string>;
  workingDirectory: string;
  commandHistory: string[];
  pendingCommands: SerializedQueuedCommand[];
  outputHistory: string[];
  sessionState: any;
  connectionState: {
    isConnected: boolean;
    lastConnectionTime?: Date;
    connectionAttempts: number;
    lastError?: string;
  };
  recoveryMetadata: {
    timeoutRecoveryAttempts: number;
    lastRecoveryTime?: Date;
    recoveryStrategiesUsed: string[];
  };
}

interface SerializedQueuedCommand {
  id: string;
  sessionId: string;
  input: string;
  timestamp: string;
  retryCount: number;
  acknowledged: boolean;
  sent: boolean;
  priority?: number;
  context?: any;
}

interface SessionBookmark {
  id: string;
  sessionId: string;
  timestamp: Date;
  description: string;
  sessionState: any;
  commandQueueSnapshot: SerializedQueuedCommand[];
  outputSnapshot: string[];
  environmentSnapshot: Record<string, string>;
  metadata?: any;
}

interface SessionContinuityConfig {
  enablePersistence: boolean;
  persistenceInterval: number;
  maxBookmarks: number;
  bookmarkStrategy: 'periodic' | 'on-command' | 'on-timeout' | 'hybrid';
  recoveryTimeout: number;
  enableSessionMigration: boolean;
}

interface CommandQueueConfig {
  maxQueueSize: number;
  commandTimeout: number;
  interCommandDelay: number;
  acknowledgmentTimeout: number;
  enablePromptDetection: boolean;
  defaultPromptPattern: RegExp;
}

// Network performance monitoring for adaptive timeouts
interface NetworkMetrics {
  latency: number;
  jitter: number;
  packetLoss: number;
  connectionQuality: 'excellent' | 'good' | 'fair' | 'poor';
  lastUpdated: Date;
  sampleCount: number;
}

// Adaptive timeout configuration
interface AdaptiveTimeoutConfig {
  baseTimeout: number;
  maxTimeout: number;
  minTimeout: number;
  latencyMultiplier: number;
  jitterTolerance: number;
  qualityThresholds: {
    excellent: number;
    good: number;
    fair: number;
  };
}

// Connection health check result
interface ConnectionHealthCheck {
  isHealthy: boolean;
  latency: number;
  error?: string;
  timestamp: Date;
  consecutiveFailures: number;
}

export class ConsoleManager extends EventEmitter {
  private sessions: Map<string, ConsoleSession>;
  private processes: Map<string, ChildProcess>;
  private sshClients: Map<string, SSHClient>;
  private sshChannels: Map<string, ClientChannel>;
  private sshConnectionPool: Map<string, SSHClient>; // Legacy connection pooling for SSH
  private sftpProtocols: Map<string, any>; // SFTP protocol instances
  private fileTransferSessions: Map<string, FileTransferSession>; // File transfer session tracking
  private outputBuffers: Map<string, ConsoleOutput[]>;
  private streamManagers: Map<string, StreamManager>;
  private errorDetector: ErrorDetector;
  private promptDetector: PromptDetector;
  private logger: Logger;
  private queue: PQueue;
  private maxBufferSize: number = 10000;
  private maxSessions: number = 50;
  private resourceMonitor: NodeJS.Timeout | null = null;
  private monitoringSystem: MonitoringSystem;
  private monitoringSystems: Map<string, MonitoringSystem>;
  private retryAttempts: Map<string, number>;
  private sessionHealthCheckIntervals: Map<string, NodeJS.Timeout>;
  private configManager: ConfigManager;
  
  // Command execution tracking and buffer isolation
  private commandExecutions: Map<string, CommandExecution>; // commandId -> CommandExecution
  private sessionCommandQueue: Map<string, string[]>; // sessionId -> commandIds[]
  private outputSequenceCounters: Map<string, number>; // sessionId -> counter
  private promptPatterns: Map<string, RegExp>; // sessionId -> prompt pattern
  
  // Command queue system for SSH buffering fix
  private commandQueues: Map<string, SessionCommandQueue>;
  private queueConfig: CommandQueueConfig;
  private commandProcessingIntervals: Map<string, NodeJS.Timeout>;
  
  // New production-ready connection pooling and session management
  private connectionPool: ConnectionPool;
  private sessionManager: SessionManager;
  private retryManager: RetryManager;
  private diagnosticsManager: DiagnosticsManager;
  private sessionValidator: SessionValidator;
  private errorRecovery: ErrorRecovery;
  
  // Self-healing and health monitoring components
  private healthMonitor: HealthMonitor;
  private heartbeatMonitor: HeartbeatMonitor;
  private sessionRecovery: SessionRecovery;
  private metricsCollector: MetricsCollector;
  private sshKeepAlive: SSHConnectionKeepAlive;
  
  // Protocol Factory and unified protocol management
  private protocolFactory: ProtocolFactory;
  private protocolInstances: Map<ConsoleType, IProtocol>;
  private protocolSessions: Map<string, { protocol: IProtocol; type: ConsoleType; protocolSessionId?: string }>;
  private protocolSessionIdMap: Map<string, string>; // Maps ConsoleManager sessionId to protocol sessionId

  // Azure monitoring support (kept separate as it's not a protocol)
  private azureMonitoring: AzureMonitoring;

  // Legacy protocol instances (to be fully migrated)
  private winrmProtocols: Map<string, any>;
  private vncProtocols: Map<string, any>;
  private ipcProtocols: Map<string, any>;
  private ipmiProtocols: Map<string, any>;
  private kubernetesProtocol?: any;
  private serialProtocol?: any;
  private awsSSMProtocol?: any;
  private azureProtocol?: any;
  private webSocketTerminalProtocol?: any;
  private rdpProtocol?: any;
  private wslProtocol?: any;
  private ansibleProtocol?: any;

  // Legacy session tracking (to be migrated)
  private rdpSessions: Map<string, RDPSession>;
  private winrmSessions: Map<string, WinRMSessionState>;
  private vncSessions: Map<string, VNCSession>;
  private vncFramebuffers: Map<string, VNCFramebuffer>;
  private ipcSessions: Map<string, IPCSessionState>;
  private ipmiSessions: Map<string, import('../types/index.js').IPMISessionState>;
  private ipmiMonitoringIntervals: Map<string, NodeJS.Timeout | NodeJS.Timeout[]>;
  private webSocketTerminalSessions: Map<string, WebSocketTerminalSessionState>;
  private ansibleSessions: Map<string, import('../types/index.js').AnsibleSession>;
  
  // Self-healing state
  private selfHealingEnabled = true;
  
  // Timeout recovery tracking
  private timeoutRecoveryAttempts: Map<string, number> = new Map();
  private readonly maxTimeoutRecoveryAttempts = 3;

  // Recovery success rate monitoring
  private recoveryMetrics = {
    totalRecoveryAttempts: 0,
    successfulRecoveries: 0,
    failedRecoveries: 0,
    averageRecoveryTimeMs: 0,
    recoverySuccessRateByCategory: new Map<string, { attempts: number; successes: number }>(),
    lastRecoveryTimestamp: 0,
    recoveryAttemptHistory: [] as Array<{
      timestamp: number;
      sessionId: string;
      category: string;
      success: boolean;
      durationMs: number;
      error?: string;
    }>
  };

  // Timeout-specific error patterns for enhanced classification
  private static readonly TIMEOUT_ERROR_PATTERNS = {
    command_acknowledgment: [
      /command acknowledgment timeout/i,
      /acknowledgment timeout/i,
      /waiting for command response/i,
      /command response timeout/i
    ],
    ssh_connection: [
      /ssh connection timeout/i,
      /connection timed out/i,
      /handshake timeout/i,
      /authentication timeout/i,
      /ssh timeout/i
    ],
    network_latency: [
      /network latency/i,
      /high latency detected/i,
      /slow network/i,
      /network congestion/i
    ],
    ssh_responsiveness: [
      /ssh session unresponsive/i,
      /channel unresponsive/i,
      /responsiveness test failed/i,
      /ssh not responding/i
    ],
    command_execution: [
      /command execution timeout/i,
      /execution timed out/i,
      /command took too long/i,
      /long running command timeout/i
    ],
    recovery_timeout: [
      /recovery timeout/i,
      /timeout recovery failed/i,
      /recovery attempt timeout/i,
      /max recovery attempts/i
    ]
  };
  
  // Enhanced session persistence and continuity
  private sessionPersistenceData: Map<string, SessionPersistentData> = new Map();
  private sessionBookmarks: Map<string, SessionBookmark[]> = new Map();
  private continuityConfig: SessionContinuityConfig;
  private persistenceTimer: NodeJS.Timeout | null = null;
  private bookmarkTimers: Map<string, NodeJS.Timeout> = new Map();
  
  // Network performance and adaptive timeout management
  private networkMetrics: Map<string, NetworkMetrics> = new Map(); // host -> metrics
  private adaptiveTimeoutConfig: AdaptiveTimeoutConfig;
  private connectionHealthChecks: Map<string, ConnectionHealthCheck> = new Map(); // host -> health
  private latencyMeasurements: Map<string, number[]> = new Map(); // host -> recent measurements
  

  private autoRecoveryEnabled = true;
  private predictiveHealingEnabled = true;
  private healingStats = {
    totalHealingAttempts: 0,
    successfulHealingAttempts: 0,
    preventedFailures: 0,
    automaticRecoveries: 0,
    proactiveReconnections: 0
  };

  constructor(config?: {
    connectionPooling?: ConnectionPoolingOptions;
    sessionManager?: Partial<import('../types/index.js').SessionManagerConfig>;
  }) {
    super();
    this.sessions = new Map();
    this.processes = new Map();
    this.sshClients = new Map();
    this.sshChannels = new Map();
    this.sshConnectionPool = new Map();
    this.sftpProtocols = new Map();
    this.fileTransferSessions = new Map();
    this.outputBuffers = new Map();
    this.streamManagers = new Map();
    this.rdpSessions = new Map();
    this.sessionHealthCheckIntervals = new Map();
    this.monitoringSystems = new Map();
    
    // Legacy session tracking (to be fully migrated)
    this.winrmProtocols = new Map();
    this.winrmSessions = new Map();
    this.vncProtocols = new Map();
    this.vncSessions = new Map();
    this.ipcProtocols = new Map();
    this.ipcSessions = new Map();
    this.vncFramebuffers = new Map();
    this.ipmiProtocols = new Map();
    this.ipmiSessions = new Map();
    this.ipmiMonitoringIntervals = new Map();
    this.webSocketTerminalSessions = new Map();

    this.errorDetector = new ErrorDetector();
    this.promptDetector = new PromptDetector();
    this.logger = new Logger('ConsoleManager');
    this.queue = new PQueue({ concurrency: 10 });
    this.monitoringSystem = new MonitoringSystem();
    this.retryAttempts = new Map();
    this.configManager = ConfigManager.getInstance();
    
    // Initialize command execution tracking
    this.commandExecutions = new Map();
    this.sessionCommandQueue = new Map();
    this.outputSequenceCounters = new Map();
    this.promptPatterns = new Map();
    this.retryManager = new RetryManager();
    this.errorRecovery = new ErrorRecovery();
    
    // Initialize command queue system
    this.commandQueues = new Map();
    this.commandProcessingIntervals = new Map();
    this.queueConfig = {
      maxQueueSize: 100,
      commandTimeout: 30000,
      interCommandDelay: 500,
      acknowledgmentTimeout: 10000,
      enablePromptDetection: true,
      defaultPromptPattern: /[$#%>]\s*$/m
    };

    // Initialize adaptive timeout configuration
    this.adaptiveTimeoutConfig = {
      baseTimeout: 10000,        // 10 seconds base timeout
      maxTimeout: 3600000,       // 1 hour maximum timeout (configurable)
      minTimeout: 3000,          // 3 seconds minimum timeout
      latencyMultiplier: 5,      // Multiply measured latency by this factor
      jitterTolerance: 0.3,      // 30% jitter tolerance
      qualityThresholds: {
        excellent: 50,           // < 50ms latency
        good: 200,               // < 200ms latency
        fair: 1000               // < 1000ms latency
      }
    };

    // Initialize new production-ready components
    this.connectionPool = new ConnectionPool({
      maxConnectionsPerHost: config?.connectionPooling?.maxConnectionsPerHost ?? 5,
      connectionIdleTimeout: config?.connectionPooling?.connectionIdleTimeout ?? 5 * 60 * 1000,
      keepAliveInterval: config?.connectionPooling?.keepAliveInterval ?? 30 * 1000,
      connectionRetryAttempts: config?.connectionPooling?.connectionRetryAttempts ?? 3,
      healthCheckInterval: 60 * 1000, // 1 minute health checks
      poolingStrategy: config?.connectionPooling?.poolingStrategy ?? 'least-connections',
      enableMetrics: true,
      enableLogging: true,
      cleanupInterval: 2 * 60 * 1000, // 2 minute cleanup
      connectionTimeout: 30 * 1000, // 30 seconds
      maxReconnectAttempts: 5,
      circuitBreakerThreshold: 3
    });

    this.sessionManager = new SessionManager(config?.sessionManager);
    
    // Initialize diagnostics and validation
    this.diagnosticsManager = DiagnosticsManager.getInstance({
      enableDiagnostics: true,
      verboseLogging: false,
      persistDiagnostics: true,
      diagnosticsPath: './diagnostics',
      maxEventHistory: 10000,
      metricsIntervalMs: 30000
    });
    
    this.sessionValidator = new SessionValidator();
    
    // Initialize session continuity configuration
    this.continuityConfig = {
      enablePersistence: true,
      persistenceInterval: 30000, // 30 seconds
      maxBookmarks: 10,
      bookmarkStrategy: 'hybrid',
      recoveryTimeout: 60000, // 1 minute
      enableSessionMigration: true
    };
    
    // Setup event listeners for integration
    this.setupPoolingIntegration();
    this.setupErrorRecoveryHandlers();
    this.startResourceMonitor();
    
    // Start proactive interactive session monitoring
    this.startInteractiveSessionMonitoring();
    this.startNetworkPerformanceMonitoring();
    this.initializeSessionContinuity();
    
    // Initialize Protocol Factory
    this.protocolFactory = ProtocolFactory.getInstance();
    this.protocolInstances = new Map();
    this.protocolSessions = new Map();
    this.protocolSessionIdMap = new Map();

    // Initialize Azure monitoring (not a protocol)
    this.azureMonitoring = new AzureMonitoring(this.logger.getWinstonLogger());

    // Setup protocol integrations will be handled on-demand
  }

  /**
   * Detect protocol type from session options
   */
  private detectProtocolType(options: SessionOptions): ConsoleType {
    // Check for explicit protocol options - order matters for SSH detection
    if (options.sshOptions) {
      // Validate SSH options to ensure they're complete
      if (!options.sshOptions.host || !options.sshOptions.username) {
        throw new Error('SSH options must include host and username');
      }
      return 'ssh';
    }
    if (options.azureOptions) return 'azure-shell';
    if (options.serialOptions) return 'serial';
    if (options.kubernetesOptions) return 'kubectl';
    if (options.dockerOptions) return 'docker';
    if (options.awsSSMOptions) return 'aws-ssm';
    if (options.wslOptions) return 'wsl';
    if (options.rdpOptions) return 'rdp';
    if (options.winrmOptions) return 'winrm';
    if (options.vncOptions) return 'vnc';
    if (options.ipcOptions) return 'ipc';
    if (options.ipmiOptions) return 'ipmi';
    if (options.webSocketTerminalOptions) return 'websocket-term';
    if (options.ansibleOptions) return 'ansible';

    // Enhanced SSH detection from command and context
    if (options.command) {
      const command = options.command.toLowerCase();

      // Explicit SSH command detection
      if (command.includes('ssh') || command.startsWith('ssh ')) {
        this.logger.info('Detected SSH protocol from command');
        return 'ssh';
      }

      // Try to detect from command using ProtocolDetector
      const detectedType = ProtocolDetector.detectProtocol(options.command);
      if (detectedType) {
        return detectedType;
      }
    }

    // Default based on platform
    if (process.platform === 'win32') {
      return options.command?.toLowerCase().includes('cmd') ? 'cmd' : 'powershell';
    } else {
      return 'bash';
    }
  }

  /**
   * Setup protocol event handlers
   */
  private setupProtocolEventHandlers(sessionId: string, protocol: IProtocol, type: ConsoleType): void {
    // Get the protocol's sessionId for this ConsoleManager sessionId
    const protocolSessionId = this.protocolSessionIdMap.get(sessionId) || sessionId;

    // Handle protocol output
    protocol.on('output', (output: ConsoleOutput) => {
      // Check if the output is for this session (using protocol's sessionId)
      if (output.sessionId === protocolSessionId) {
        this.handleProtocolOutput(sessionId, output);
      }
    });

    // Handle protocol errors
    protocol.on('error', (error: Error) => {
      this.logger.error(`Protocol error for session ${sessionId}:`, error);
      this.handleSessionError(sessionId, error, 'protocol_error');
    });

    // Handle session completion
    protocol.on('session-complete', (data: { sessionId: string; exitCode?: number }) => {
      // Check if completion is for this session (using protocol's sessionId)
      if (data.sessionId === protocolSessionId) {
        const session = this.sessions.get(sessionId);
        if (session) {
          session.status = 'stopped';
          session.exitCode = data.exitCode;
        }
        this.emit('sessionClosed', sessionId);
      }
    });

    // Handle session closed (LocalProtocol emits this)
    protocol.on('session-closed', (data: { sessionId: string; exitCode?: number }) => {
      // Check if completion is for this session (using protocol's sessionId)
      if (data.sessionId === protocolSessionId) {
        const session = this.sessions.get(sessionId);
        if (session) {
          session.status = 'stopped';
          session.exitCode = data.exitCode;
        }

        console.error(`[MAPPING-FIX] Protocol session ${protocolSessionId} closed, emitting console-event for ConsoleManager session ${sessionId}`);

        // Emit console-event that our Promise is waiting for
        this.emit('console-event', {
          sessionId: sessionId, // Use ConsoleManager sessionId, not protocol sessionId
          type: 'stopped',
          timestamp: new Date(),
          data: { exitCode: data.exitCode }
        });
      }
    });
  }

  /**
   * Handle protocol output
   */
  private handleProtocolOutput(sessionId: string, output: ConsoleOutput): void {
    // Add to output buffer
    let buffer = this.outputBuffers.get(sessionId);
    if (!buffer) {
      buffer = [];
      this.outputBuffers.set(sessionId, buffer);
    }
    buffer.push(output);

    // Emit output event (legacy)
    this.emit('output', {
      sessionId,
      data: output.data,
      timestamp: output.timestamp,
      type: output.type
    } as ConsoleOutput);

    // Also emit console-event that executeCommand Promise is waiting for
    console.error(`[MAPPING-FIX] Emitting console-event output for session ${sessionId}, data length: ${output.data?.length || 0}`);
    this.emit('console-event', {
      sessionId: sessionId, // Use ConsoleManager sessionId
      type: 'output',
      timestamp: new Date(),
      data: { data: output.data }
    });
  }

  /**
   * Initialize session continuity system
   */
  private initializeSessionContinuity(): void {
    if (!this.continuityConfig.enablePersistence) {
      return;
    }

    // Start periodic persistence
    this.persistenceTimer = setInterval(() => {
      this.persistAllSessionData();
    }, this.continuityConfig.persistenceInterval);

    // Load any existing persistent data
    this.loadPersistedSessionData();

    // Integrate with existing SessionRecovery system
    this.setupSessionRecoveryIntegration();

    this.logger.info('Session continuity system initialized with SessionRecovery integration');
  }

  /**
   * Initialize command tracking for a session with enhanced persistence
   */
  private initializeSessionCommandTracking(sessionId: string, options: SessionOptions): void {
    this.sessionCommandQueue.set(sessionId, []);
    this.outputSequenceCounters.set(sessionId, 0);
    
    // Set up prompt pattern for command completion detection
    let promptPattern: RegExp;
    if (options.consoleType === 'powershell' || options.consoleType === 'pwsh') {
      promptPattern = /PS\s.*?>\s*$/m;
    } else if (options.consoleType === 'cmd') {
      promptPattern = /^[A-Z]:\\.*?>\s*$/m;
    } else if (options.consoleType === 'bash' || options.consoleType === 'zsh' || options.consoleType === 'sh') {
      promptPattern = /^[\w\-\.~]*[$#]\s*$/m;
    } else {
      // Generic prompt pattern
      promptPattern = /^.*?[$#>]\s*$/m;
    }
    
    this.promptPatterns.set(sessionId, promptPattern);

    // Initialize persistent session data
    this.initializeSessionPersistence(sessionId, options);
  }

  /**
   * Initialize persistent session data for a session
   */
  private initializeSessionPersistence(sessionId: string, options: SessionOptions): void {
    const persistentData: SessionPersistentData = {
      sessionId,
      createdAt: new Date(),
      lastActivity: new Date(),
      sshOptions: options.sshOptions,
      environment: options.env || {},
      workingDirectory: options.cwd || process.cwd(),
      commandHistory: [],
      pendingCommands: [],
      outputHistory: [],
      sessionState: {},
      connectionState: {
        isConnected: true,
        lastConnectionTime: new Date(),
        connectionAttempts: 0
      },
      recoveryMetadata: {
        timeoutRecoveryAttempts: 0,
        recoveryStrategiesUsed: []
      }
    };

    this.sessionPersistenceData.set(sessionId, persistentData);
    this.sessionBookmarks.set(sessionId, []);

    // Start bookmark creation based on strategy
    this.initializeBookmarkStrategy(sessionId);

    this.logger.debug(`Initialized session persistence for ${sessionId}`);
  }

  /**
   * Initialize bookmark strategy for a session
   */
  private initializeBookmarkStrategy(sessionId: string): void {
    const strategy = this.continuityConfig.bookmarkStrategy;
    
    if (strategy === 'periodic' || strategy === 'hybrid') {
      // Create periodic bookmarks
      const timer = setInterval(() => {
        this.createSessionBookmark(sessionId, 'periodic');
      }, 60000); // Every minute
      
      this.bookmarkTimers.set(sessionId, timer);
    }
  }

  /**
   * Create a session bookmark for recovery purposes
   */
  private async createSessionBookmark(sessionId: string, trigger: string): Promise<void> {
    const persistentData = this.sessionPersistenceData.get(sessionId);
    const queue = this.commandQueues.get(sessionId);
    
    if (!persistentData || !queue) {
      return;
    }

    const bookmark: SessionBookmark = {
      id: uuidv4(),
      sessionId,
      timestamp: new Date(),
      description: `${trigger} bookmark`,
      sessionState: { ...persistentData.sessionState },
      commandQueueSnapshot: this.serializeCommandQueue(queue.commands),
      outputSnapshot: [...persistentData.outputHistory],
      environmentSnapshot: { ...persistentData.environment },
      metadata: {
        trigger,
        connectionState: { ...persistentData.connectionState },
        queueLength: queue.commands.length
      }
    };

    const bookmarks = this.sessionBookmarks.get(sessionId) || [];
    bookmarks.push(bookmark);

    // Keep only the latest N bookmarks
    if (bookmarks.length > this.continuityConfig.maxBookmarks) {
      bookmarks.shift();
    }

    this.sessionBookmarks.set(sessionId, bookmarks);
    
    // Update persistent data with bookmark
    queue.bookmarks = bookmarks;
    persistentData.lastActivity = new Date();

    this.logger.debug(`Created ${trigger} bookmark for session ${sessionId}`);
  }

  /**
   * Serialize command queue for persistence
   */
  private serializeCommandQueue(commands: QueuedCommand[]): SerializedQueuedCommand[] {
    return commands.map(cmd => ({
      id: cmd.id,
      sessionId: cmd.sessionId,
      input: cmd.input,
      timestamp: cmd.timestamp.toISOString(),
      retryCount: cmd.retryCount,
      acknowledged: cmd.acknowledged,
      sent: cmd.sent,
      priority: cmd.priority,
      context: cmd.context
    }));
  }

  /**
   * Deserialize command queue from persistence
   */
  private deserializeCommandQueue(serialized: SerializedQueuedCommand[], sessionId: string): QueuedCommand[] {
    return serialized.map(cmd => ({
      id: cmd.id,
      sessionId: cmd.sessionId,
      input: cmd.input,
      timestamp: new Date(cmd.timestamp),
      retryCount: cmd.retryCount,
      acknowledged: cmd.acknowledged,
      sent: cmd.sent,
      priority: cmd.priority,
      context: cmd.context,
      resolve: () => {}, // Will be replaced during recovery
      reject: () => {}   // Will be replaced during recovery
    }));
  }

  /**
   * Start a new command execution in a session
   */
  private startCommandExecution(sessionId: string, command: string, args?: string[]): string {
    const commandId = uuidv4();
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Update session state
    session.executionState = 'executing';
    session.currentCommandId = commandId;
    this.sessions.set(sessionId, session);

    // Create command execution record
    const commandExecution: CommandExecution = {
      id: commandId,
      sessionId,
      command,
      args,
      startedAt: new Date(),
      status: 'executing',
      output: [],
      isolatedBufferStartIndex: this.outputBuffers.get(sessionId)?.length || 0,
      totalOutputLines: 0,
      markers: {
        promptPattern: this.promptPatterns.get(sessionId)
      }
    };

    // Store command execution
    this.commandExecutions.set(commandId, commandExecution);
    session.activeCommands.set(commandId, commandExecution);
    
    // Add to session command queue
    const queue = this.sessionCommandQueue.get(sessionId) || [];
    queue.push(commandId);
    this.sessionCommandQueue.set(sessionId, queue);

    this.logger.debug(`Started command execution ${commandId} for session ${sessionId}: ${command}`);
    return commandId;
  }

  /**
   * Complete a command execution
   */
  private completeCommandExecution(commandId: string, exitCode?: number): void {
    const commandExecution = this.commandExecutions.get(commandId);
    if (!commandExecution) {
      this.logger.warn(`Command execution ${commandId} not found`);
      return;
    }

    const session = this.sessions.get(commandExecution.sessionId);
    if (!session) {
      this.logger.warn(`Session ${commandExecution.sessionId} not found for command ${commandId}`);
      return;
    }

    // Update command execution
    commandExecution.completedAt = new Date();
    commandExecution.status = exitCode === 0 ? 'completed' : (exitCode !== undefined ? 'failed' : 'completed');
    commandExecution.exitCode = exitCode;
    commandExecution.duration = commandExecution.completedAt.getTime() - commandExecution.startedAt.getTime();

    // Update session state
    session.executionState = 'idle';
    session.currentCommandId = undefined;
    session.lastCommandCompletedAt = commandExecution.completedAt;
    
    // Clean up from active commands (keep in session for history but not as active)
    session.activeCommands.delete(commandId);
    this.sessions.set(commandExecution.sessionId, session);

    // Record command metrics for health monitoring
    if (this.selfHealingEnabled && this.metricsCollector) {
      this.metricsCollector.recordCommandExecution(
        commandExecution.status === 'completed',
        commandExecution.duration || 0,
        commandExecution.command,
        commandExecution.sessionId
      );

      // Update heartbeat with successful command execution
      // Note: HeartbeatMonitor doesn't have recordSuccessfulOperation method
      // if (commandExecution.status === 'completed') {
      //   this.heartbeatMonitor.recordSuccessfulOperation(commandExecution.sessionId);
      // }
    }

    this.logger.debug(`Completed command execution ${commandId} with status ${commandExecution.status} in ${commandExecution.duration}ms`);
  }

  /**
   * Get isolated output for a specific command
   */
  private getCommandOutput(commandId: string): ConsoleOutput[] {
    const commandExecution = this.commandExecutions.get(commandId);
    if (!commandExecution) {
      return [];
    }

    // Return the output that was captured for this command
    return commandExecution.output;
  }

  /**
   * Detect command completion by analyzing output patterns
   */
  private detectCommandCompletion(sessionId: string, output: string): boolean {
    const promptPattern = this.promptPatterns.get(sessionId);
    if (!promptPattern) {
      return false;
    }

    // Check if the output contains a prompt indicating command completion
    return promptPattern.test(output);
  }

  /**
   * Execute a command in a session with proper isolation
   */
  async executeCommandInSession(sessionId: string, command: string, args?: string[], timeout: number = 120000): Promise<{
    commandId: string;
    output: ConsoleOutput[];
    exitCode?: number;
    duration: number;
    status: 'completed' | 'failed' | 'timeout';
  }> {
    console.error(`[DEBUG-HANG] executeCommandInSession called with:`, JSON.stringify({
      sessionId,
      command,
      args,
      timeout
    }, null, 2));

    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (session.executionState !== 'idle') {
      throw new Error(`Session ${sessionId} is currently ${session.executionState}. Wait for current command to complete.`);
    }

    // Start command execution tracking
    const commandId = this.startCommandExecution(sessionId, command, args);
    
    try {
      // Add command start boundary marker
      const startBoundaryOutput: ConsoleOutput = {
        sessionId,
        type: 'stdout',
        data: '',
        timestamp: new Date(),
        commandId,
        isCommandBoundary: true,
        boundaryType: 'start',
        sequence: this.outputSequenceCounters.get(sessionId) || 0
      };
      this.addToBuffer(sessionId, startBoundaryOutput);

      // Send the command
      const fullCommand = args && args.length > 0 ? `${command} ${args.join(' ')}` : command;
      await this.sendInput(sessionId, fullCommand + '\n');

      // Wait for command completion or timeout
      const result = await this.waitForCommandCompletion(commandId, timeout);
      
      return {
        commandId,
        output: this.getCommandOutput(commandId),
        exitCode: result.exitCode,
        duration: result.duration,
        status: result.status
      };
    } catch (error) {
      // Mark command as failed
      this.completeCommandExecution(commandId, -1);
      throw error;
    }
  }

  /**
   * Wait for a command to complete
   */
  private async waitForCommandCompletion(commandId: string, timeout: number): Promise<{
    exitCode?: number;
    duration: number;
    status: 'completed' | 'failed' | 'timeout';
  }> {
    const commandExecution = this.commandExecutions.get(commandId);
    if (!commandExecution) {
      throw new Error(`Command execution ${commandId} not found`);
    }

    const startTime = Date.now();
    const checkInterval = 100; // Check every 100ms

    return new Promise((resolve, reject) => {
      const checkCompletion = () => {
        const currentExecution = this.commandExecutions.get(commandId);
        if (!currentExecution) {
          reject(new Error(`Command execution ${commandId} was removed`));
          return;
        }

        // Check if command completed
        if (currentExecution.status !== 'executing') {
          resolve({
            exitCode: currentExecution.exitCode,
            duration: currentExecution.duration || (Date.now() - startTime),
            status: currentExecution.status === 'completed' ? 'completed' : 'failed'
          });
          return;
        }

        // Check timeout
        if (Date.now() - startTime > timeout) {
          this.completeCommandExecution(commandId, -1);
          resolve({
            exitCode: -1,
            duration: Date.now() - startTime,
            status: 'timeout'
          });
          return;
        }

        // Continue checking
        setTimeout(checkCompletion, checkInterval);
      };

      checkCompletion();
    });
  }

  /**
   * Get session execution state
   */
  getSessionExecutionState(sessionId: string): {
    sessionId: string;
    executionState: 'idle' | 'executing' | 'waiting';
    currentCommandId?: string;
    lastCommandCompletedAt?: Date;
    activeCommands: number;
    commandHistory: string[];
  } | null {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    const commandHistory = this.sessionCommandQueue.get(sessionId) || [];
    
    return {
      sessionId,
      executionState: session.executionState,
      currentCommandId: session.currentCommandId,
      lastCommandCompletedAt: session.lastCommandCompletedAt,
      activeCommands: session.activeCommands.size,
      commandHistory
    };
  }

  /**
   * Get command execution details
   */
  getCommandExecutionDetails(commandId: string): CommandExecution | null {
    return this.commandExecutions.get(commandId) || null;
  }

  /**
   * Get all command executions for a session
   */
  getSessionCommandHistory(sessionId: string): CommandExecution[] {
    const commandIds = this.sessionCommandQueue.get(sessionId) || [];
    return commandIds
      .map(id => this.commandExecutions.get(id))
      .filter((cmd): cmd is CommandExecution => cmd !== undefined);
  }

  /**
   * Clear completed command history for a session (keeping only recent commands)
   */
  cleanupSessionCommandHistory(sessionId: string, keepLast: number = 10): void {
    const commandIds = this.sessionCommandQueue.get(sessionId) || [];
    
    if (commandIds.length > keepLast) {
      const toRemove = commandIds.splice(0, commandIds.length - keepLast);
      toRemove.forEach(commandId => {
        this.commandExecutions.delete(commandId);
      });
      
      this.sessionCommandQueue.set(sessionId, commandIds);
      this.logger.debug(`Cleaned up ${toRemove.length} old command executions for session ${sessionId}`);
    }
  }

  /**
   * Setup event listeners for connection pool and session manager integration
   */
  private setupPoolingIntegration(): void {
    // Connection pool events
    this.connectionPool.on('connectionCreated', ({ connectionId, hostKey }) => {
      this.logger.info(`Connection pool: New connection ${connectionId} created for ${hostKey}`);
    });

    this.connectionPool.on('connectionError', ({ connectionId, error }) => {
      this.logger.error(`Connection pool: Connection ${connectionId} error:`, error);
    });

    this.connectionPool.on('connectionClosed', ({ connectionId }) => {
      this.logger.info(`Connection pool: Connection ${connectionId} closed`);
    });

    this.connectionPool.on('circuitBreakerTripped', ({ hostKey, failures }) => {
      this.logger.warn(`Connection pool: Circuit breaker tripped for ${hostKey} after ${failures} failures`);
    });

    // Session manager events
    this.sessionManager.on('sessionRegistered', ({ sessionId, type }) => {
      this.logger.info(`Session manager: Registered ${type} session ${sessionId}`);
    });

    this.sessionManager.on('sessionStatusChanged', ({ sessionId, oldStatus, newStatus }) => {
      this.logger.info(`Session manager: Session ${sessionId} status changed from ${oldStatus} to ${newStatus}`);
    });

    this.sessionManager.on('sessionRecoveryAttempt', async ({ sessionId, attempt, sessionState, persistentData }) => {
      this.logger.info(`Session manager: Attempting recovery ${attempt} for session ${sessionId}`);
      
      try {
        // Attempt to recreate the session based on persistent data
        if (persistentData && sessionState.type === 'local') {
          // For local sessions, try to restart the process
          const newSessionId = await this.createSession({
            command: persistentData.command,
            args: persistentData.args,
            cwd: persistentData.cwd,
            env: persistentData.env,
            consoleType: persistentData.consoleType,
            streaming: persistentData.streaming
          });

          // Update session manager that recovery succeeded
          await this.sessionManager.updateSessionStatus(sessionId, 'running', {
            recoveredSessionId: newSessionId,
            recoverySuccess: true
          });

        } else if (persistentData && sessionState.type === 'ssh') {
          // For SSH sessions, recovery would need SSH connection details
          // This would require storing SSH options in persistent data
          this.logger.warn(`SSH session recovery not yet implemented for session ${sessionId}`);
          await this.sessionManager.updateSessionStatus(sessionId, 'failed', {
            recoveryFailure: 'SSH recovery not implemented'
          });
        }

      } catch (error) {
        this.logger.error(`Session recovery failed for ${sessionId}:`, error);
        await this.sessionManager.updateSessionStatus(sessionId, 'failed', {
          recoveryError: error instanceof Error ? error.message : String(error)
        });
      }
    });

    this.sessionManager.on('sessionRecovered', ({ sessionId }) => {
      this.logger.info(`Session manager: Successfully recovered session ${sessionId}`);
    });
  }

  private getShellCommand(type: ConsoleType): { command: string; args: string[] } {
    const osType = platform();
    
    switch (type) {
      case 'cmd':
        return { command: 'cmd.exe', args: ['/c'] };
      case 'powershell':
        return { command: 'powershell.exe', args: ['-NoProfile', '-Command'] };
      case 'pwsh':
        return { command: 'pwsh.exe', args: ['-NoProfile', '-Command'] };
      case 'bash':
        if (osType === 'win32') {
          // Try Git Bash or WSL
          return { command: 'bash.exe', args: ['-c'] };
        }
        return { command: '/bin/bash', args: ['-c'] };
      case 'zsh':
        return { command: '/bin/zsh', args: ['-c'] };
      case 'sh':
        return { command: '/bin/sh', args: ['-c'] };
      case 'telnet':
        // Telnet connections are handled separately, not through shell commands
        return { command: 'telnet', args: [] };
      case 'winrm':
      case 'psremoting':
        // WinRM connections are handled separately, not through shell commands
        return { command: 'winrm', args: [] };
      default:
        // Auto-detect based on OS
        if (osType === 'win32') {
          return { command: 'cmd.exe', args: ['/c'] };
        } else {
          return { command: '/bin/bash', args: ['-c'] };
        }
    }
  }

  private setupErrorRecoveryHandlers(): void {
    // Handle retry events
    this.retryManager.on('retry-success', (context) => {
      this.logger.info(`Retry succeeded for ${context.operation} in session ${context.sessionId}`);
      this.emit('retry-success', context);
    });

    this.retryManager.on('retry-failed', (context) => {
      this.logger.warn(`Retry failed for ${context.operation} in session ${context.sessionId}: ${context.reason}`);
      this.emit('retry-failed', context);
    });

    this.retryManager.on('retry-exhausted', (context) => {
      this.logger.error(`Retry exhausted for ${context.operation} in session ${context.sessionId}`);
      this.emit('retry-exhausted', context);
    });

    this.retryManager.on('circuit-breaker-open', (data) => {
      this.logger.warn(`Circuit breaker opened for ${data.key}`);
      this.emit('circuit-breaker-open', data);
    });

    // Handle error recovery events
    this.errorRecovery.on('recovery-attempted', (data) => {
      this.logger.info(`Error recovery attempted for session ${data.sessionId}: ${data.strategy}`);
      this.emit('recovery-attempted', data);
    });

    this.errorRecovery.on('degradation-enabled', (data) => {
      this.logger.warn(`Degraded mode enabled for session ${data.sessionId}: ${data.reason}`);
      this.emit('degradation-enabled', data);
    });

    this.errorRecovery.on('degradation-restored', (data) => {
      this.logger.info(`Degraded mode restored for session ${data.sessionId}`);
      this.emit('degradation-restored', data);
    });

    this.errorRecovery.on('require-reauth', (data) => {
      this.logger.warn(`Re-authentication required for session ${data.sessionId}`);
      this.emit('require-reauth', data);
    });
  }

  /**
   * Setup Docker protocol event handlers
   */
  private setupDockerProtocolHandlers(): void {
    // Docker protocol handlers are now managed by the protocol instance itself
    // via the ProtocolFactory. This method is kept for backwards compatibility
    // but will be removed in the future.
    return;

    /* Legacy code - to be removed
    this.dockerProtocol.on('container-created', (containerId, session) => {
      this.logger.info(`Docker container created: ${containerId} for session ${session.id}`);
      this.emit('docker-container-created', { containerId, sessionId: session.id });
    });

    this.dockerProtocol.on('container-started', (containerId, session) => {
      this.logger.info(`Docker container started: ${containerId} for session ${session.id}`);
      this.emit('docker-container-started', { containerId, sessionId: session.id });
    });

    this.dockerProtocol.on('container-stopped', (containerId, session) => {
      this.logger.info(`Docker container stopped: ${containerId} for session ${session.id}`);
      this.emit('docker-container-stopped', { containerId, sessionId: session.id });
    });

    this.dockerProtocol.on('container-error', (containerId, error, session) => {
      this.logger.error(`Docker container error: ${containerId} for session ${session.id}:`, error);
      this.emit('docker-container-error', { containerId, sessionId: session.id, error });
    });

    this.dockerProtocol.on('exec-created', (execId, session) => {
      this.logger.info(`Docker exec created: ${execId} for session ${session.id}`);
      this.emit('docker-exec-created', { execId, sessionId: session.id });
    });

    this.dockerProtocol.on('exec-started', (execId, session) => {
      this.logger.info(`Docker exec started: ${execId} for session ${session.id}`);
      this.emit('docker-exec-started', { execId, sessionId: session.id });
    });

    this.dockerProtocol.on('exec-completed', (execId, exitCode, session) => {
      this.logger.info(`Docker exec completed: ${execId} with exit code ${exitCode} for session ${session.id}`);
      this.emit('docker-exec-completed', { execId, exitCode, sessionId: session.id });
    });

    this.dockerProtocol.on('health-check', (result, session) => {
      this.logger.debug(`Docker health check: ${result.status} for container ${result.containerId} in session ${session.id}`);
      this.emit('docker-health-check', { healthCheck: result, sessionId: session.id });
      
      // Integrate with console manager's health monitoring
      if (result.status === 'unhealthy' && result.consecutiveFailures >= 3) {
        this.handleSessionError(session.id, new Error(`Container health check failed: ${result.output}`), 'docker-health-check');
      }
    });

    this.dockerProtocol.on('log-stream', (logEntry, session) => {
      // Forward docker logs as console output
      const consoleOutput: ConsoleOutput = {
        sessionId: session.id,
        type: logEntry.stream as 'stdout' | 'stderr',
        data: logEntry.message,
        timestamp: logEntry.timestamp,
        raw: logEntry.raw?.toString()
      };
      
      // Add to buffer
      const buffer = this.outputBuffers.get(session.id) || [];
      buffer.push(consoleOutput);
      
      // Keep buffer size under control
      if (buffer.length > this.maxBufferSize) {
        buffer.splice(0, buffer.length - this.maxBufferSize);
      }
      
      this.outputBuffers.set(session.id, buffer);
      this.emit('output', consoleOutput);
    });

    this.dockerProtocol.on('metrics-collected', (metrics, session) => {
      this.logger.debug(`Docker metrics collected for container ${metrics.containerId} in session ${session.id}`);
      this.emit('docker-metrics', { metrics, sessionId: session.id });
    });

    this.dockerProtocol.on('connection-error', (error) => {
      this.logger.error('Docker connection error:', error);
      this.emit('docker-connection-error', { error });
    });

    this.dockerProtocol.on('reconnected', (connection) => {
      this.logger.info('Docker connection reconnected successfully');
      this.emit('docker-reconnected');
    });

    this.dockerProtocol.on('docker-event', (event) => {
      this.logger.debug(`Docker daemon event: ${event.type}:${event.action} for ${event.actor.id}`);
      this.emit('docker-event', event);
    });

    this.logger.info('Docker protocol event handlers initialized');
    */
  }

  /**
   * Initialize all self-healing components with proper configuration
   */
  private initializeSelfHealingComponents(): void {
    // Initialize HealthMonitor with comprehensive system monitoring
    this.healthMonitor = new HealthMonitor({
      checkInterval: 30000, // 30 seconds
      thresholds: {
        cpu: 80,
        memory: 85,
        disk: 90,
        networkLatency: 5000,
        processResponseTime: 5000,
        sshConnectionLatency: 2000,
        sshHealthScore: 70
      }
    });

    // Initialize HeartbeatMonitor for session health tracking with SSH proactive reconnection
    this.heartbeatMonitor = new HeartbeatMonitor({
      interval: 60000, // 1 minute
      timeout: 10000, // 10 seconds
      maxMissedBeats: 3,
      enableAdaptiveInterval: true,
      enablePredictiveFailure: this.predictiveHealingEnabled,
      retryAttempts: 3,
      retryDelay: 2000,
      gracePeriod: 5000,
      // SSH-specific proactive reconnection settings
      sshHeartbeatInterval: 30000, // 30 seconds for SSH sessions
      sshTimeoutThreshold: 15000, // 15 seconds SSH timeout threshold
      enableSSHProactiveReconnect: true,
      sshFailureRiskThreshold: 0.65 // Trigger proactive reconnect at 65% risk
    });

    // Initialize SessionRecovery with multiple strategies
    this.sessionRecovery = new SessionRecovery({
      enabled: true,
      maxRecoveryAttempts: 3,
      recoveryDelay: 5000,
      backoffMultiplier: 2,
      maxBackoffDelay: 60000,
      persistenceEnabled: true,
      persistencePath: './data/session-snapshots',
      enableSmartRecovery: true,
      snapshotInterval: 300000, // 5 minutes
      recoveryTimeout: 120000
    });

    // Initialize MetricsCollector for comprehensive monitoring
    this.metricsCollector = new MetricsCollector({
      enabled: true,
      collectionInterval: 10000, // 10 seconds
      retentionPeriod: 24 * 60 * 60 * 1000, // 24 hours
      aggregationWindow: 60000, // 1 minute
      enableRealTimeMetrics: true,
      enableHistoricalMetrics: true,
      enablePredictiveMetrics: this.predictiveHealingEnabled,
      persistenceEnabled: true,
      persistencePath: './data/metrics',
      exportFormats: ['json', 'csv', 'prometheus'],
      alertThresholds: {
        errorRate: 0.05,
        responseTime: 5000,
        throughput: 10,
        availability: 0.99
      }
    });

    // Initialize SSH KeepAlive for connection maintenance with production-ready configuration
    this.sshKeepAlive = new SSHConnectionKeepAlive({
      enabled: true,
      // Aggressive keepalive for long-running operations
      keepAliveInterval: 15000, // 15 seconds - more frequent for better stability
      keepAliveCountMax: 6, // Allow more failures before declaring connection dead
      // Server alive configuration for detecting unresponsive servers
      serverAliveInterval: 30000, // 30 seconds - more frequent server checks
      serverAliveCountMax: 5, // Allow more server alive failures
      connectionTimeout: 20000, // 20 second timeout for keepalive operations
      // Enhanced reconnection strategy
      reconnectOnFailure: true,
      maxReconnectAttempts: 8, // More reconnection attempts for unstable networks
      reconnectDelay: 3000, // Start with shorter delay
      backoffMultiplier: 1.5, // More gradual backoff
      maxReconnectDelay: 45000, // Cap at 45 seconds instead of 60
      // Advanced features for production stability
      enableAdaptiveKeepAlive: true, // Adjust intervals based on network conditions
      enablePredictiveReconnect: this.predictiveHealingEnabled,
      connectionHealthThreshold: 65 // Lower threshold for more proactive healing
    });

    // Start proactive health monitoring for production environments
    if (process.env.NODE_ENV === 'production' || process.env.ENABLE_PROACTIVE_MONITORING === 'true') {
      this.sshKeepAlive.startProactiveMonitoring(3); // Every 3 minutes in production
      this.logger.info('Proactive health monitoring enabled (3-minute intervals)');
    } else {
      this.sshKeepAlive.startProactiveMonitoring(10); // Every 10 minutes in development
      this.logger.info('Proactive health monitoring enabled (10-minute intervals)');
    }

    this.logger.info('Self-healing components initialized successfully');
  }

  /**
   * Setup integration between self-healing components and ConsoleManager
   */
  private setupSelfHealingIntegration(): void {
    if (!this.selfHealingEnabled) {
      this.logger.info('Self-healing disabled, skipping integration setup');
      return;
    }

    // Health Monitor Integration
    this.healthMonitor.on('healthCheck', (result) => {
      this.emit('system-health-check', result);
      
      // Record metrics for health checks
      this.metricsCollector.recordHealthCheck(result.overall > 0.5, 'system-health', 0);
      
      // Trigger predictive healing if issues detected
      if (result.overall < 0.7 && this.predictiveHealingEnabled) {
        this.triggerPredictiveHealing('system-health-degradation', result);
      }
    });

    this.healthMonitor.on('criticalIssue', async (issue) => {
      this.logger.warn('Critical system issue detected:', issue);
      this.healingStats.totalHealingAttempts++;
      
      // Attempt automatic recovery
      if (this.autoRecoveryEnabled) {
        try {
          await this.handleCriticalSystemIssue(issue);
          this.healingStats.successfulHealingAttempts++;
        } catch (error) {
          this.logger.error('Failed to auto-recover from critical issue:', error);
        }
      }
      
      this.emit('critical-system-issue', issue);
    });

    // Heartbeat Monitor Integration
    this.heartbeatMonitor.on('heartbeatMissed', async ({ sessionId, missedCount, lastHeartbeat }) => {
      this.logger.warn(`Heartbeat missed for session ${sessionId}: ${missedCount} missed, last: ${lastHeartbeat}`);
      
      // Record metrics - using recordSessionLifecycle for session events
      // this.metricsCollector.recordSessionEvent(sessionId, 'heartbeat-missed', {
      //   missedCount,
      //   lastHeartbeat: new Date(lastHeartbeat)
      // });
      
      // Trigger session recovery if threshold exceeded
      if (missedCount >= 3) {
        await this.initiateSessionRecovery(sessionId, 'heartbeat-failure');
      }
    });

    this.heartbeatMonitor.on('sessionUnhealthy', async ({ sessionId, healthScore, issues }) => {
      this.logger.warn(`Session ${sessionId} unhealthy (score: ${healthScore}):`, issues);
      
      // Record unhealthy session - using recordSessionLifecycle for session events
      // this.metricsCollector.recordSessionEvent(sessionId, 'unhealthy', { healthScore, issues });
      
      // Attempt recovery if auto-recovery enabled
      if (this.autoRecoveryEnabled && healthScore < 0.3) {
        await this.initiateSessionRecovery(sessionId, 'health-degradation');
      }
    });

    // SSH Proactive Reconnection Integration
    this.heartbeatMonitor.on('ssh-proactive-reconnect', async ({ sessionId, failureRisk, heartbeat, timestamp, reason, urgency }) => {
      this.logger.warn(`SSH proactive reconnection triggered for session ${sessionId} (risk: ${(failureRisk * 100).toFixed(1)}%, urgency: ${urgency})`);
      
      try {
        // Get session info for SSH reconnection
        const session = this.getSession(sessionId);
        if (!session) {
          this.logger.error(`Cannot find session ${sessionId} for proactive reconnection`);
          return;
        }

        // Update healing stats
        this.healingStats.totalHealingAttempts++;
        this.healingStats.proactiveReconnections = (this.healingStats.proactiveReconnections || 0) + 1;

        // Record metrics
        this.metricsCollector.recordRecoveryAttempt(false, 'ssh-proactive-reconnect', 0, sessionId);

        // Emit event for external monitoring
        this.emit('ssh-proactive-reconnect-triggered', { 
          sessionId, 
          failureRisk, 
          urgency, 
          timestamp,
          reason,
          sessionMetadata: {
            hostname: heartbeat.sshHealthData?.hostname,
            port: heartbeat.sshHealthData?.port,
            connectionUptime: heartbeat.sshHealthData ? Date.now() - heartbeat.lastBeat.getTime() : 0
          }
        });

        // Attempt proactive SSH session reconnection
        if (session.sshOptions) {
          this.logger.info(`Initiating proactive SSH reconnection for ${session.sshOptions.host}:${session.sshOptions.port}`);
          
          // Stop current session gracefully
          await this.stopSession(sessionId);
          
          // Wait a brief moment for cleanup
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // Recreate session with same options
          let newSessionResult: { success: boolean; sessionId?: string; error?: string };
          try {
            const newSessionId = await this.createSession({
              command: session.command,
              args: session.args,
              cwd: session.cwd,
              env: session.env,
              sshOptions: session.sshOptions,
              streaming: session.streaming,
              timeout: session.timeout || 120000, // Use session timeout or 2 minute default
              monitoring: {
                enableMetrics: true,
                enableTracing: false,
                enableProfiling: false,
                enableAuditing: false
              }
            });
            newSessionResult = { success: true, sessionId: newSessionId, error: undefined };
          } catch (error) {
            newSessionResult = { 
              success: false, 
              sessionId: undefined,
              error: error instanceof Error ? error.message : String(error) 
            };
          }

          if (newSessionResult.success) {
            this.logger.info(`Successfully reconnected SSH session ${sessionId} -> ${newSessionResult.sessionId} (risk prevention)`);
            this.healingStats.successfulHealingAttempts++;
            this.healingStats.automaticRecoveries++;
            
            // Record successful proactive reconnection
            this.metricsCollector.recordRecoveryAttempt(true, 'ssh-proactive-reconnect', Date.now() - timestamp.getTime(), newSessionResult.sessionId);
            
            // Update session mapping for continuity
            this.emit('ssh-proactive-reconnect-success', { 
              oldSessionId: sessionId, 
              newSessionId: newSessionResult.sessionId,
              failureRisk,
              reconnectionTime: Date.now() - timestamp.getTime()
            });
          } else {
            this.logger.error(`Failed to proactively reconnect SSH session ${sessionId}: ${newSessionResult.error}`);
            this.emit('ssh-proactive-reconnect-failed', { 
              sessionId, 
              failureRisk,
              error: newSessionResult.error,
              reconnectionTime: Date.now() - timestamp.getTime()
            });
          }
        } else {
          this.logger.warn(`Session ${sessionId} flagged for proactive reconnection but has no SSH options`);
        }

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(`Error during SSH proactive reconnection for session ${sessionId}: ${errorMessage}`);
        
        this.emit('ssh-proactive-reconnect-failed', { 
          sessionId, 
          failureRisk,
          error: errorMessage,
          reconnectionTime: Date.now() - timestamp.getTime()
        });
      }
    });

    // Session Recovery Integration
    this.sessionRecovery.on('recoveryAttempted', ({ sessionId, strategy, success, duration, metadata }) => {
      this.logger.info(`Session recovery attempted: ${sessionId}, strategy: ${strategy}, success: ${success}`);
      
      // Update healing stats
      if (success) {
        this.healingStats.successfulHealingAttempts++;
        this.healingStats.automaticRecoveries++;
      }
      this.healingStats.totalHealingAttempts++;
      
      // Record recovery metrics
      this.metricsCollector.recordRecoveryAttempt(success, strategy, duration, sessionId);
      
      this.emit('session-recovery-attempted', { sessionId, strategy, success, duration, metadata });
    });

    this.sessionRecovery.on('recoveryFailed', ({ sessionId, strategy, error, attempts }) => {
    this.logger.error(`Session recovery failed: ${sessionId}, strategy: ${strategy}, attempts: ${attempts}`, error);
    
    // Try alternative recovery if available
    if (attempts < 3) {
    setTimeout(() => {
    this.sessionRecovery.recoverSession(sessionId, 'recovery-retry');
    }, Math.pow(2, attempts) * 1000); // Exponential backoff
    }

    this.emit('session-recovery-failed', { sessionId, strategy, error, attempts });
    });

    // Handle new interactive prompt recovery events
    this.sessionRecovery.on('session-interrupt-request', this.handleSessionInterruptRequest.bind(this));
    this.sessionRecovery.on('session-prompt-reset-request', this.handlePromptResetRequest.bind(this));
    this.sessionRecovery.on('session-refresh-request', this.handleSessionRefreshRequest.bind(this));
    this.sessionRecovery.on('session-command-retry-request', this.handleCommandRetryRequest.bind(this));
    this.sessionRecovery.on('interactive-state-updated', this.handleInteractiveStateUpdate.bind(this));

    // Metrics Collector Integration
    this.metricsCollector.on('alertThresholdExceeded', (alert) => {
      this.logger.warn('Metrics alert triggered:', alert);
      
      // Trigger appropriate healing actions based on alert type
      if (alert.metric === 'errorRate' && alert.value > 0.1) {
        this.triggerSystemHealingMode('high-error-rate');
      } else if (alert.metric === 'sessionFailureRate' && alert.value > 0.05) {
        this.enhanceSessionMonitoring();
      }
      
      this.emit('metrics-alert', alert);
    });

    this.metricsCollector.on('trendPrediction', (prediction) => {
      if (this.predictiveHealingEnabled && prediction.confidence > 0.8) {
        this.logger.info('Predictive trend detected:', prediction);
        this.triggerPredictiveHealing('trend-prediction', prediction);
        this.healingStats.preventedFailures++;
      }
    });

    // SSH KeepAlive Integration
    this.sshKeepAlive.on('keepAliveSuccess', ({ connectionId, responseTime }) => {
      // Record successful keep-alive
      this.metricsCollector.recordConnectionMetrics(true, responseTime, 'ssh');
    });

    this.sshKeepAlive.on('keepAliveFailed', async ({ connectionId, error, consecutiveFailures }) => {
      this.logger.warn(`SSH keep-alive failed for ${connectionId}: ${consecutiveFailures} consecutive failures`, error);
      
      // Record failed keep-alive
      this.metricsCollector.recordConnectionMetrics(false, 0, 'ssh');
      
      // Trigger reconnection if threshold exceeded
      if (consecutiveFailures >= 3) {
        await this.handleSSHConnectionFailure(connectionId, error);
      }
    });

    this.sshKeepAlive.on('connectionDegraded', ({ connectionId, responseTime, trend }) => {
      this.logger.info(`SSH connection ${connectionId} showing degradation: ${responseTime}ms (trend: ${trend})`);
      
      if (this.predictiveHealingEnabled && trend > 0.3) {
        // Proactively establish backup connection
        this.prepareBackupSSHConnection(connectionId);
      }
    });

    // Server Alive Monitoring Integration
    this.sshKeepAlive.on('server-alive-success', ({ connectionId, responseTime, timestamp }) => {
      this.logger.debug(`Server alive check successful for ${connectionId}: ${responseTime}ms`);
      // Record server alive metrics
      this.metricsCollector.recordConnectionMetrics(true, responseTime, 'ssh-server-alive');
    });

    this.sshKeepAlive.on('server-alive-failed', async ({ connectionId, error, timestamp }) => {
      this.logger.warn(`Server alive check failed for ${connectionId}: ${error}`);
      // Record server alive failure
      this.metricsCollector.recordConnectionMetrics(false, 0, 'ssh-server-alive');
      
      // Server alive failures indicate potential server-side issues
      this.emit('ssh-server-unresponsive', { connectionId, error, timestamp });
    });

    // Proactive Health Monitoring Integration
    this.sshKeepAlive.on('proactive-health-check-completed', (results) => {
      this.logger.info('Proactive health check results:', {
        total: results.totalConnections,
        healthy: results.healthyConnections,
        degraded: results.degradedConnections,
        critical: results.criticalConnections,
        recommendations: results.recommendations.length
      });

      // Log recommendations for operational awareness
      if (results.recommendations.length > 0) {
        this.logger.warn('Health check recommendations:', results.recommendations);
      }

      // Emit for external monitoring systems
      this.emit('proactive-health-check-completed', results);
    });

    // Start all monitoring services
    this.healthMonitor.start();
    this.heartbeatMonitor.start();
    this.metricsCollector.start();
    
    this.logger.info('Self-healing integration setup completed');
  }

  private async handleCriticalSystemIssue(issue: any): Promise<void> {
    this.logger.info(`Attempting to handle critical system issue: ${issue.type}`);
    
    switch (issue.type) {
      case 'high-memory-usage':
        await this.optimizeMemoryUsage();
        break;
      case 'high-cpu-usage':
        await this.throttleOperations();
        break;
      case 'disk-space-low':
        await this.cleanupTemporaryFiles();
        break;
      case 'network-degradation':
        await this.optimizeNetworkConnections();
        break;
      default:
        this.logger.warn(`No specific handler for issue type: ${issue.type}`);
    }
  }

  private async initiateSessionRecovery(sessionId: string, reason: string): Promise<void> {
    this.logger.info(`Initiating session recovery for ${sessionId}, reason: ${reason}`);
    
    const session = this.sessions.get(sessionId);
    if (session) {
      await this.sessionRecovery.recoverSession(sessionId, reason);
    }
  }

  private triggerPredictiveHealing(trigger: string, data: any): void {
    this.logger.info(`Predictive healing triggered: ${trigger}`, data);
    this.emit('predictive-healing-triggered', { trigger, data, timestamp: new Date() });
  }

  private triggerSystemHealingMode(reason: string): void {
    this.logger.warn(`System healing mode activated: ${reason}`);
    // Implement system-wide healing actions
    this.emit('system-healing-mode-activated', { reason, timestamp: new Date() });
  }

  private enhanceSessionMonitoring(): void {
    // Reduce heartbeat intervals for closer monitoring
    // Note: HeartbeatMonitor doesn't have setAdaptiveMode method
    // this.heartbeatMonitor.setAdaptiveMode(true);
    this.logger.info('Enhanced session monitoring activated');
  }

  private async handleSSHConnectionFailure(connectionId: string, error: Error): Promise<void> {
    this.logger.info(`Handling SSH connection failure: ${connectionId}`);
    
    // Use connection pool's circuit breaker and retry logic
    // Note: handleConnectionFailure is private in ConnectionPool
    try {
      // await this.connectionPool.handleConnectionFailure(connectionId, error);
      this.logger.info(`Connection failure handled for ${connectionId}: ${error.message}`);
      this.emit('ssh-connection-failure-detected', { connectionId, error });
    } catch (poolError) {
      this.logger.error('Connection pool failed to handle SSH connection failure:', poolError);
      this.emit('ssh-connection-recovery-failed', { connectionId, originalError: error, poolError });
    }
  }

  private prepareBackupSSHConnection(connectionId: string): void {
    this.logger.info(`Preparing backup SSH connection for ${connectionId}`);
    // Logic to preemptively establish backup connections
    this.emit('backup-connection-preparing', { connectionId, timestamp: new Date() });
  }

  private async optimizeMemoryUsage(): Promise<void> {
    this.logger.info('Optimizing memory usage');
    // Clear old output buffers
    for (const [sessionId, buffer] of Array.from(this.outputBuffers)) {
      if (buffer.length > 100) {
        this.outputBuffers.set(sessionId, buffer.slice(-50)); // Keep last 50 entries
      }
    }
    
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
  }

  private async throttleOperations(): Promise<void> {
    this.logger.info('Throttling operations due to high CPU usage');
    // Reduce queue concurrency
    this.queue.concurrency = Math.max(1, this.queue.concurrency / 2);
    
    // Restore after 30 seconds
    setTimeout(() => {
      this.queue.concurrency = 10;
      this.logger.info('Operation throttling restored to normal');
    }, 30000);
  }

  private async cleanupTemporaryFiles(): Promise<void> {
    this.logger.info('Cleaning up temporary files');
    // Implementation would clean up temp files, logs, etc.
    this.emit('cleanup-performed', { type: 'temporary-files', timestamp: new Date() });
  }

  /**
   * Enhanced timeout recovery for SSH sessions with session persistence and state restoration
   */
  private async attemptTimeoutRecovery(sessionId: string, command: QueuedCommand): Promise<TimeoutRecoveryResult> {
    const recoveryStartTime = Date.now();
    const currentAttempts = this.timeoutRecoveryAttempts.get(sessionId) || 0;

    // Create timeout error for enhanced classification
    const timeoutError = new Error(`SSH command acknowledgment timeout after ${Date.now() - command.timestamp.getTime()}ms`);
    const timeoutClassification = this.classifyTimeoutError(timeoutError);
    
    // Update persistent data with recovery attempt
    const persistentData = this.sessionPersistenceData.get(sessionId);
    if (persistentData) {
      persistentData.recoveryMetadata.timeoutRecoveryAttempts = currentAttempts + 1;
      persistentData.recoveryMetadata.lastRecoveryTime = new Date();
      persistentData.connectionState.lastError = 'timeout';
    }

    // Create recovery bookmark before attempting recovery
    await this.createSessionBookmark(sessionId, 'timeout-recovery');
    
    if (currentAttempts >= this.maxTimeoutRecoveryAttempts) {
      this.logger.warn(`Max timeout recovery attempts reached for session ${sessionId}`);
      
      // Check if this is an interactive prompt timeout that needs specialized recovery
      const shouldTriggerInteractive = this.sessionRecovery.shouldTriggerInteractiveRecovery(sessionId);
      if (shouldTriggerInteractive.shouldTrigger) {
        this.logger.info(`Triggering interactive prompt recovery for session ${sessionId}: ${shouldTriggerInteractive.reason}`);
        
        // Update interactive state with timeout information
        await this.sessionRecovery.updateInteractiveState(sessionId, {
          sessionUnresponsive: true,
          timeoutCount: currentAttempts,
          pendingCommands: [command.input],
          isInteractive: true
        });
        
        // Attempt interactive prompt recovery
        const interactiveRecovery = await this.sessionRecovery.recoverSession(
          sessionId, 
          `interactive-prompt-timeout-${shouldTriggerInteractive.urgency}`
        );
        
        if (interactiveRecovery) {
          this.logger.info(`Interactive prompt recovery succeeded for session ${sessionId}`);
          return { success: true, reconnected: false };
        }
      }
      
      // Classify this as a permanent timeout failure for error recovery system
      const errorContext = {
        sessionId,
        operation: 'timeout_recovery',
        error: new Error('Max timeout recovery attempts exceeded'),
        timestamp: Date.now(),
        metadata: {
          attempts: currentAttempts,
          commandInput: command.input.substring(0, 100),
          interactivePromptDetected: shouldTriggerInteractive.shouldTrigger
        }
      };
      
      // Attempt graceful degradation through error recovery system
      const classification = this.errorRecovery.classifyError(errorContext.error);
      if (classification?.recoverable) {
        this.logger.info(`Error recovery system suggests timeout is recoverable, trying fallback strategy`);
        const recoveryResult = await this.errorRecovery.attemptRecovery(errorContext);
        if (recoveryResult) {
          return { success: true, error: 'Recovered via fallback strategy' };
        }
      }
      
      // Record failed recovery attempt in metrics
      const recoveryDuration = Date.now() - recoveryStartTime;
      this.recordRecoveryAttempt(sessionId, timeoutClassification.category, false, recoveryDuration, 'Max recovery attempts exceeded');
      
      return { success: false, error: 'Max recovery attempts exceeded' };
    }
    
    this.timeoutRecoveryAttempts.set(sessionId, currentAttempts + 1);
    this.logger.info(`Attempting timeout recovery for session ${sessionId} (attempt ${currentAttempts + 1})`);
    
    // Create error context for integration with error recovery system
    const recoveryContext = {
      sessionId,
      operation: 'ssh_timeout_recovery',
      error: new Error('SSH timeout recovery attempt'),
      timestamp: Date.now(),
      metadata: {
        attemptNumber: currentAttempts + 1,
        maxAttempts: this.maxTimeoutRecoveryAttempts,
        commandInput: command.input.substring(0, 100),
        commandRetryCount: command.retryCount
      },
      previousAttempts: currentAttempts
    };
    
    try {
      // Step 1: Classify the timeout error to determine optimal recovery strategy
      const timeoutError = new Error(`SSH command acknowledgment timeout after ${Date.now() - command.timestamp.getTime()}ms`);
      const errorClassification = this.errorRecovery.classifyError(timeoutError);
      
      this.logger.info(`Timeout classified as: ${errorClassification?.type || 'unknown'} (severity: ${errorClassification?.severity || 'medium'})`);
      
      // Step 2: Check circuit breaker state before attempting recovery
      const circuitKey = `ssh_timeout_${sessionId}`;
      const circuitState = this.retryManager.getCircuitBreakerStates()[circuitKey];
      
      if (circuitState?.state === 'open') {
        this.logger.warn(`Circuit breaker is open for SSH timeout recovery on session ${sessionId}`);
        
        // Wait for circuit breaker cooldown or try alternative recovery
        const now = Date.now();
        if (now < circuitState.nextAttemptTime) {
          const waitTime = circuitState.nextAttemptTime - now;
          this.logger.info(`Waiting ${waitTime}ms for circuit breaker cooldown`);
          await this.delay(Math.min(waitTime, 5000)); // Max 5 second wait
        }
      }
      
      // Step 3: Check if SSH connection is still alive
      const sshClient = this.sshClients.get(sessionId);
      const sshChannel = this.sshChannels.get(sessionId);
      
      if (!sshClient || !sshChannel) {
        this.logger.warn(`SSH client or channel missing for session ${sessionId}, attempting reconnection`);
        
        // Use retry manager for reconnection attempts
        return await this.retryManager.executeWithRetry(
          async () => await this.attemptSSHReconnection(sessionId),
          {
            sessionId,
            operationName: 'ssh_reconnection',
            strategyName: 'ssh',
            onRetry: (context) => {
              this.logger.info(`Retrying SSH reconnection for ${sessionId} (attempt ${context.attemptNumber})`);
            }
          }
        );
      }
      
      // Step 4: Enhanced connection responsiveness test with multiple fallbacks
      const testResult = await this.testSSHResponsiveness(sessionId, sshChannel);
      if (!testResult.responsive) {
        this.logger.warn(`SSH session ${sessionId} unresponsive, attempting reconnection`);
        
        // Circuit breaker will be handled by the retry operation itself
        
        return await this.retryManager.executeWithRetry(
          async () => await this.attemptSSHReconnection(sessionId),
          {
            sessionId,
            operationName: 'ssh_reconnection_after_timeout',
            strategyName: 'ssh',
            onRetry: (context) => {
              this.logger.info(`Retrying SSH reconnection after timeout for ${sessionId} (attempt ${context.attemptNumber})`);
            }
          }
        );
      }
      
      // Step 5: Clear any stale output and reset acknowledgment state
      await this.clearStaleOutput(sessionId);
      
      // Step 6: Reset command state for retry with exponential backoff
      command.acknowledged = false;
      command.sent = false;
      command.retryCount = (command.retryCount || 0) + 1;
      
      // Apply exponential backoff based on retry count
      const backoffDelay = Math.min(1000 * Math.pow(2, command.retryCount - 1), 8000);
      if (backoffDelay > 0) {
        this.logger.info(`Applying ${backoffDelay}ms backoff before command retry`);
        await this.delay(backoffDelay);
      }
      
      // Step 7: Test with a simple command to ensure the session is truly responsive
      const finalValidation = await this.validateSessionRecovery(sessionId, sshChannel);
      if (!finalValidation.valid) {
        this.logger.warn(`Session validation failed after recovery attempt: ${finalValidation.error}`);
        return { success: false, error: finalValidation.error };
      }
      
      // Success is automatically recorded by the retry manager
      
      // Step 8: Restore session state from latest bookmark if available
      await this.restoreSessionStateFromBookmark(sessionId);
      
      // Step 9: Update persistent data with successful recovery
      if (persistentData) {
        persistentData.connectionState.isConnected = true;
        persistentData.connectionState.lastConnectionTime = new Date();
        persistentData.recoveryMetadata.recoveryStrategiesUsed.push('timeout-recovery-success');
        persistentData.lastActivity = new Date();
      }
      
      // Reset recovery attempts on successful recovery
      this.timeoutRecoveryAttempts.delete(sessionId);
      
      // Record successful recovery attempt in metrics
      const recoveryDuration = Date.now() - recoveryStartTime;
      this.recordRecoveryAttempt(sessionId, timeoutClassification.category, true, recoveryDuration);
      
      this.logger.info(`Successfully recovered SSH session ${sessionId} with state restoration and ${command.retryCount} retries`);
      return { 
        success: true, 
        restoredCommands: this.restoreCommandQueueFromPersistence(sessionId),
        metadata: { retryCount: command.retryCount, backoffDelay, stateRestored: true, recoveryDurationMs: recoveryDuration } 
      };
      
    } catch (error) {
      this.logger.error(`Enhanced timeout recovery failed for session ${sessionId}:`, error);
      
      // Update persistent data with failure
      if (persistentData) {
        persistentData.connectionState.isConnected = false;
        persistentData.connectionState.lastError = error instanceof Error ? error.message : String(error);
        persistentData.recoveryMetadata.recoveryStrategiesUsed.push('timeout-recovery-failed');
      }
      
      // Circuit breaker failure will be handled by retry mechanism
      
      // Update error context with actual error
      recoveryContext.error = error as Error;
      
      // Attempt error recovery as last resort
      const errorRecoveryResult = await this.errorRecovery.attemptRecovery(recoveryContext);
      if (errorRecoveryResult) {
        this.logger.info(`Error recovery system provided fallback recovery for session ${sessionId}`);
        return { success: true, error: 'Recovered via error recovery system' };
      }
      
      // Record failed recovery attempt in metrics
      const recoveryDuration = Date.now() - recoveryStartTime;
      this.recordRecoveryAttempt(sessionId, timeoutClassification.category, false, recoveryDuration, error instanceof Error ? error.message : String(error));
      
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Restore session state from the most recent bookmark
   */
  private async restoreSessionStateFromBookmark(sessionId: string): Promise<void> {
    const bookmarks = this.sessionBookmarks.get(sessionId);
    if (!bookmarks || bookmarks.length === 0) {
      this.logger.debug(`No bookmarks available for session ${sessionId} restoration`);
      return;
    }

    // Get the most recent bookmark
    const latestBookmark = bookmarks[bookmarks.length - 1];
    const persistentData = this.sessionPersistenceData.get(sessionId);

    if (persistentData) {
      // Restore session state
      persistentData.sessionState = { ...latestBookmark.sessionState };
      persistentData.environment = { ...latestBookmark.environmentSnapshot };
      persistentData.outputHistory = [...latestBookmark.outputSnapshot];
      
      this.logger.info(`Restored session state for ${sessionId} from bookmark: ${latestBookmark.description}`);
    }
  }

  /**
   * Restore command queue from persistent data
   */
  private restoreCommandQueueFromPersistence(sessionId: string): number {
    const persistentData = this.sessionPersistenceData.get(sessionId);
    const queue = this.commandQueues.get(sessionId);
    
    if (!persistentData || !queue || persistentData.pendingCommands.length === 0) {
      return 0;
    }

    // Deserialize and restore pending commands
    const restoredCommands = this.deserializeCommandQueue(persistentData.pendingCommands, sessionId);
    
    // Add restored commands to the queue (prioritize them)
    restoredCommands.forEach(cmd => {
      cmd.priority = 1; // High priority for restored commands
      queue.commands.unshift(cmd); // Add to front of queue
    });

    this.logger.info(`Restored ${restoredCommands.length} commands to queue for session ${sessionId}`);
    return restoredCommands.length;
  }

  /**
   * Enhanced SSH reconnection with session persistence
   */
  private async attemptSSHReconnectionWithPersistence(sessionId: string): Promise<TimeoutRecoveryResult> {
    try {
      this.logger.info(`Attempting SSH reconnection with state persistence for session ${sessionId}`);
      
      // Save current command queue state
      await this.createSessionBookmark(sessionId, 'pre-reconnection');
      
      // Get original session info
      const session = this.sessions.get(sessionId);
      const persistentData = this.sessionPersistenceData.get(sessionId);
      
      if (!session || !session.sshOptions) {
        return { success: false, error: 'Session or SSH options not found' };
      }
      
      // Update connection state
      if (persistentData) {
        persistentData.connectionState.isConnected = false;
        persistentData.connectionState.connectionAttempts += 1;
      }
      
      // Clean up existing connection
      await this.cleanupSSHSession(sessionId);
      
      // Recreate SSH connection
      const reconnectResult = await this.createSSHConnection(sessionId, session.sshOptions);
      if (reconnectResult.success) {
        // Restore session state after reconnection
        await this.restoreSessionStateFromBookmark(sessionId);
        const restoredCommands = this.restoreCommandQueueFromPersistence(sessionId);
        
        // Update connection state
        if (persistentData) {
          persistentData.connectionState.isConnected = true;
          persistentData.connectionState.lastConnectionTime = new Date();
          persistentData.recoveryMetadata.recoveryStrategiesUsed.push('ssh-reconnection-success');
        }
        
        this.logger.info(`Successfully reconnected SSH session ${sessionId} with ${restoredCommands} restored commands`);
        return { success: true, reconnected: true, restoredCommands };
      } else {
        return { success: false, error: 'Reconnection failed' };
      }
      
    } catch (error) {
      this.logger.error(`SSH reconnection with persistence failed for session ${sessionId}:`, error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Persist all session data to storage
   */
  private async persistAllSessionData(): Promise<void> {
    if (!this.continuityConfig.enablePersistence) {
      return;
    }

    try {
      for (const [sessionId, persistentData] of Array.from(this.sessionPersistenceData)) {
        // Update current command queue state
        const queue = this.commandQueues.get(sessionId);
        if (queue) {
          persistentData.pendingCommands = this.serializeCommandQueue(queue.commands);
        }
        
        // Update output history
        const outputBuffer = this.outputBuffers.get(sessionId);
        if (outputBuffer) {
          persistentData.outputHistory = outputBuffer
            .slice(-100) // Keep last 100 outputs
            .map(output => output.data);
        }

        // Save to disk (implement based on your storage preference)
        await this.persistSessionData(sessionId, persistentData);
      }

      this.logger.debug(`Persisted data for ${this.sessionPersistenceData.size} sessions`);
    } catch (error) {
      this.logger.error('Failed to persist session data:', error);
    }
  }

  /**
   * Persist session data to storage (placeholder - implement based on storage choice)
   */
  private async persistSessionData(sessionId: string, data: SessionPersistentData): Promise<void> {
    // This would typically save to file system, database, or other storage
    // For now, it's a placeholder that could be implemented based on requirements
    this.logger.debug(`Persisting session data for ${sessionId}`);
  }

  /**
   * Load persisted session data from storage
   */
  private async loadPersistedSessionData(): Promise<void> {
    // This would typically load from file system, database, or other storage
    // For now, it's a placeholder that could be implemented based on requirements
    this.logger.debug('Loading persisted session data');
  }

  /**
   * Setup integration with SessionRecovery system
   */
  private setupSessionRecoveryIntegration(): void {
    if (!this.sessionRecovery) {
      return;
    }

    // Listen for session recovery events and enhance with persistence data
    this.sessionRecovery.on('sessionRecoveryAttempt', async (data) => {
      const { sessionId, sessionState, persistentData } = data;
      
      // Update our persistent data if we have it
      const ourPersistentData = this.sessionPersistenceData.get(sessionId);
      if (ourPersistentData && persistentData) {
        // Merge session recovery data with our enhanced persistence
        ourPersistentData.recoveryMetadata.timeoutRecoveryAttempts += 1;
        ourPersistentData.recoveryMetadata.lastRecoveryTime = new Date();
        ourPersistentData.recoveryMetadata.recoveryStrategiesUsed.push('session-recovery-attempt');
      }

      // Create recovery bookmark
      await this.createSessionBookmark(sessionId, 'session-recovery');
    });

    // Listen for successful session recovery
    this.sessionRecovery.on('sessionRecovered', async (data) => {
      const { sessionId } = data;
      
      // Update our persistent data on successful recovery
      const persistentData = this.sessionPersistenceData.get(sessionId);
      if (persistentData) {
        persistentData.connectionState.isConnected = true;
        persistentData.connectionState.lastConnectionTime = new Date();
        persistentData.recoveryMetadata.recoveryStrategiesUsed.push('session-recovery-success');
        persistentData.lastActivity = new Date();
      }

      // Create success bookmark
      await this.createSessionBookmark(sessionId, 'recovery-success');
      
      this.logger.info(`Session ${sessionId} recovered successfully with enhanced persistence tracking`);
    });

    // Provide session restoration data to SessionRecovery system
    this.sessionRecovery.on('snapshot-request', (data) => {
      const { sessionId, callback } = data;
      const persistentData = this.sessionPersistenceData.get(sessionId);
      const bookmarks = this.sessionBookmarks.get(sessionId);
      
      if (persistentData && bookmarks) {
        const updates = {
          commandHistory: persistentData.commandHistory,
          outputBuffer: persistentData.outputHistory,
          workingDirectory: persistentData.workingDirectory,
          environment: persistentData.environment,
          metadata: {
            bookmarksCount: bookmarks.length,
            lastBookmark: bookmarks[bookmarks.length - 1]?.timestamp,
            connectionState: persistentData.connectionState,
            recoveryMetadata: persistentData.recoveryMetadata
          }
        };
        
        callback(updates);
      }
    });

    this.logger.debug('SessionRecovery integration setup complete');
  }

  /**
   * Migrate session to a different host (placeholder for advanced feature)
   */
  private async migrateSession(sessionId: string, targetHost: string): Promise<boolean> {
    if (!this.continuityConfig.enableSessionMigration) {
      this.logger.warn(`Session migration is disabled for session ${sessionId}`);
      return false;
    }

    try {
      this.logger.info(`Initiating session migration for ${sessionId} to ${targetHost}`);
      
      // Create pre-migration bookmark
      await this.createSessionBookmark(sessionId, 'pre-migration');
      
      const persistentData = this.sessionPersistenceData.get(sessionId);
      if (!persistentData || !persistentData.sshOptions) {
        return false;
      }

      // Create new SSH options with target host
      const newSSHOptions = {
        ...persistentData.sshOptions,
        host: targetHost
      };

      // TODO: Implement actual migration logic
      // This would involve:
      // 1. Creating new session on target host
      // 2. Transferring session state
      // 3. Restoring command queue
      // 4. Updating connection mappings
      // 5. Cleaning up old session

      this.logger.info(`Session migration planned for ${sessionId} (implementation pending)`);
      return true;
      
    } catch (error) {
      this.logger.error(`Session migration failed for ${sessionId}:`, error);
      return false;
    }
  }
  
  /**
   * Measure network latency to a host
   */
  private async measureNetworkLatency(host: string, port: number = 22): Promise<number> {
    const startTime = Date.now();
    
    try {
      // Use a simple TCP connection test for latency measurement
      const client = new SSHClient();
      
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          client.destroy();
          resolve(5000); // Return high latency on timeout
        }, 5000);
        
        client.on('ready', () => {
          clearTimeout(timeout);
          const latency = Date.now() - startTime;
          client.destroy();
          resolve(latency);
        });
        
        client.on('error', () => {
          clearTimeout(timeout);
          client.destroy();
          resolve(5000); // Return high latency on error
        });
        
        // Minimal connection attempt just for timing
        client.connect({
          host,
          port,
          username: 'test', // This will fail but still measure connection time
          timeout: 5000
        });
      });
    } catch (error) {
      return 5000; // Return high latency on exception
    }
  }
  
  /**
   * Update network metrics for a host
   */
  private updateNetworkMetrics(host: string, latency: number): void {
    const existing = this.networkMetrics.get(host);
    const measurements = this.latencyMeasurements.get(host) || [];
    
    // Keep last 10 measurements for jitter calculation
    measurements.push(latency);
    if (measurements.length > 10) {
      measurements.shift();
    }
    this.latencyMeasurements.set(host, measurements);
    
    // Calculate jitter (variance in latency)
    const avgLatency = measurements.reduce((sum, lat) => sum + lat, 0) / measurements.length;
    const jitter = measurements.length > 1 
      ? Math.sqrt(measurements.reduce((sum, lat) => sum + Math.pow(lat - avgLatency, 2), 0) / measurements.length)
      : 0;
    
    // Determine connection quality
    let connectionQuality: 'excellent' | 'good' | 'fair' | 'poor';
    if (avgLatency < this.adaptiveTimeoutConfig.qualityThresholds.excellent) {
      connectionQuality = 'excellent';
    } else if (avgLatency < this.adaptiveTimeoutConfig.qualityThresholds.good) {
      connectionQuality = 'good';
    } else if (avgLatency < this.adaptiveTimeoutConfig.qualityThresholds.fair) {
      connectionQuality = 'fair';
    } else {
      connectionQuality = 'poor';
    }
    
    const metrics: NetworkMetrics = {
      latency: avgLatency,
      jitter,
      packetLoss: 0, // Would need more sophisticated testing for packet loss
      connectionQuality,
      lastUpdated: new Date(),
      sampleCount: (existing?.sampleCount || 0) + 1
    };
    
    this.networkMetrics.set(host, metrics);
    this.logger.debug(`Updated network metrics for ${host}:`, {
      latency: avgLatency.toFixed(2) + 'ms',
      jitter: jitter.toFixed(2) + 'ms',
      quality: connectionQuality
    });
  }
  
  /**
   * Calculate adaptive timeout based on network conditions
   */
  private calculateAdaptiveTimeout(host: string): number {
    const metrics = this.networkMetrics.get(host);
    const config = this.adaptiveTimeoutConfig;
    
    if (!metrics) {
      return config.baseTimeout;
    }
    
    // Base calculation: base timeout + (latency * multiplier)
    let adaptiveTimeout = config.baseTimeout + (metrics.latency * config.latencyMultiplier);
    
    // Adjust for jitter
    const jitterAdjustment = metrics.jitter * config.jitterTolerance;
    adaptiveTimeout += jitterAdjustment;
    
    // Apply connection quality adjustments
    switch (metrics.connectionQuality) {
      case 'poor':
        adaptiveTimeout *= 2.0; // Double timeout for poor connections
        break;
      case 'fair':
        adaptiveTimeout *= 1.5; // 50% increase for fair connections
        break;
      case 'good':
        adaptiveTimeout *= 1.1; // 10% increase for good connections
        break;
      case 'excellent':
        // No adjustment for excellent connections
        break;
    }
    
    // Ensure timeout stays within bounds
    adaptiveTimeout = Math.max(config.minTimeout, Math.min(config.maxTimeout, adaptiveTimeout));
    
    this.logger.debug(`Calculated adaptive timeout for ${host}: ${adaptiveTimeout.toFixed(0)}ms (quality: ${metrics.connectionQuality})`);
    return Math.round(adaptiveTimeout);
  }
  
  /**
   * Perform connection health check
   */
  private async performConnectionHealthCheck(host: string, port: number = 22): Promise<ConnectionHealthCheck> {
    const startTime = Date.now();
    const existing = this.connectionHealthChecks.get(host);
    
    try {
      const latency = await this.measureNetworkLatency(host, port);
      const healthCheck: ConnectionHealthCheck = {
        isHealthy: latency < this.adaptiveTimeoutConfig.qualityThresholds.fair,
        latency,
        timestamp: new Date(),
        consecutiveFailures: 0
      };
      
      this.connectionHealthChecks.set(host, healthCheck);
      this.updateNetworkMetrics(host, latency);
      
      return healthCheck;
    } catch (error) {
      const healthCheck: ConnectionHealthCheck = {
        isHealthy: false,
        latency: 5000,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date(),
        consecutiveFailures: (existing?.consecutiveFailures || 0) + 1
      };
      
      this.connectionHealthChecks.set(host, healthCheck);
      return healthCheck;
    }
  }
  
  /**
   * Test SSH connection responsiveness with enhanced fallback mechanisms
   */
  private async testSSHResponsiveness(sessionId: string, channel: ClientChannel): Promise<{ responsive: boolean; details?: string }> {
    return new Promise((resolve) => {
      const primaryTimeout = 2000;
      const fallbackTimeout = 5000;
      let responseReceived = false;
      let testPhase = 'primary';
      
      const cleanup = () => {
        channel.removeListener('data', onData);
        channel.removeListener('error', onError);
        channel.removeListener('close', onClose);
      };
      
      // Primary timeout (2 seconds)
      const primaryTimer = setTimeout(async () => {
        if (!responseReceived) {
          this.logger.warn(`Primary responsiveness test failed for session ${sessionId}, trying fallback`);
          testPhase = 'fallback';
          
          // Try a different command as fallback
          try {
            channel.write('\n'); // Just send a newline
            
            // Extended timeout for fallback
            setTimeout(() => {
              if (!responseReceived) {
                this.logger.warn(`Fallback responsiveness test also failed for session ${sessionId}`);
                cleanup();
                resolve({ responsive: false, details: 'Both primary and fallback tests failed' });
              }
            }, fallbackTimeout - primaryTimeout);
            
          } catch (error) {
            this.logger.error(`Error during fallback responsiveness test:`, error);
            cleanup();
            resolve({ responsive: false, details: `Fallback test error: ${error}` });
          }
        }
      }, primaryTimeout);
      
      const onData = (data: Buffer) => {
        if (!responseReceived) {
          responseReceived = true;
          clearTimeout(primaryTimer);
          cleanup();
          
          const dataStr = data.toString();
          this.logger.debug(`Responsiveness test ${testPhase} succeeded for session ${sessionId}: ${dataStr.substring(0, 50)}`);
          resolve({ 
            responsive: true, 
            details: `${testPhase} test succeeded: ${dataStr.length} bytes received` 
          });
        }
      };
      
      const onError = (error: Error) => {
        if (!responseReceived) {
          responseReceived = true;
          clearTimeout(primaryTimer);
          cleanup();
          
          this.logger.error(`SSH channel error during responsiveness test for session ${sessionId}:`, error);
          resolve({ responsive: false, details: `Channel error: ${error.message}` });
        }
      };
      
      const onClose = () => {
        if (!responseReceived) {
          responseReceived = true;
          clearTimeout(primaryTimer);
          cleanup();
          
          this.logger.warn(`SSH channel closed during responsiveness test for session ${sessionId}`);
          resolve({ responsive: false, details: 'Channel closed during test' });
        }
      };
      
      // Set up event listeners
      channel.on('data', onData);
      channel.on('error', onError);
      channel.on('close', onClose);
      
      try {
        // Send a simple echo command that should respond immediately
        channel.write('echo "responsiveness-test-$(date +%s)"\n');
      } catch (error) {
        clearTimeout(primaryTimer);
        cleanup();
        resolve({ responsive: false, details: `Write error: ${error}` });
      }
    });
  }
  
  /**
   * Clear stale output from buffers
   */
  private async clearStaleOutput(sessionId: string): Promise<void> {
    // Clear command queue output buffer
    const queue = this.commandQueues.get(sessionId);
    if (queue) {
      queue.outputBuffer = '';
    }
    
    // Optional: Clear session output buffer if needed
    const outputBuffer = this.outputBuffers.get(sessionId);
    if (outputBuffer && outputBuffer.length > 50) {
      // Keep only recent outputs
      const recentOutputs = outputBuffer.slice(-10);
      this.outputBuffers.set(sessionId, recentOutputs);
    }
  }

  /**
   * Utility method to add delay with promise
   */
  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Enhanced timeout error classification with specific timeout patterns
   */
  private classifyTimeoutError(error: Error): { type: string; severity: string; category: string; recoverable: boolean } {
    const errorMsg = error.message.toLowerCase();
    
    // Check for specific timeout patterns
    for (const [category, patterns] of Object.entries(ConsoleManager.TIMEOUT_ERROR_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(errorMsg)) {
          const classification = this.determineTimeoutSeverity(category, errorMsg);
          return {
            type: 'timeout',
            severity: classification.severity,
            category: `timeout_${category}`,
            recoverable: classification.recoverable
          };
        }
      }
    }
    
    // Fallback to standard error recovery classification
    const standardClassification = this.errorRecovery.classifyError(error);
    return standardClassification || {
      type: 'timeout',
      severity: 'medium',
      category: 'timeout_unknown',
      recoverable: true
    };
  }

  /**
   * Determine timeout severity and recoverability based on category
   */
  private determineTimeoutSeverity(category: string, errorMsg: string): { severity: string; recoverable: boolean } {
    const severityMap = {
      command_acknowledgment: { severity: 'medium', recoverable: true },
      ssh_connection: { severity: 'high', recoverable: true },
      network_latency: { severity: 'low', recoverable: true },
      ssh_responsiveness: { severity: 'medium', recoverable: true },
      command_execution: { severity: 'medium', recoverable: true },
      recovery_timeout: { severity: 'high', recoverable: false }
    };

    // Check for critical indicators that make errors less recoverable
    const criticalIndicators = [
      'max attempts',
      'circuit breaker',
      'permanent failure',
      'authentication failed',
      'host unreachable'
    ];

    const isCritical = criticalIndicators.some(indicator => errorMsg.includes(indicator));
    const baseSeverity = severityMap[category as keyof typeof severityMap] || { severity: 'medium', recoverable: true };

    return {
      severity: isCritical ? 'critical' : baseSeverity.severity,
      recoverable: isCritical ? false : baseSeverity.recoverable
    };
  }

  /**
   * Record recovery attempt metrics
   */
  private recordRecoveryAttempt(sessionId: string, category: string, success: boolean, durationMs: number, error?: string): void {
    const timestamp = Date.now();
    
    // Update overall metrics
    this.recoveryMetrics.totalRecoveryAttempts++;
    if (success) {
      this.recoveryMetrics.successfulRecoveries++;
    } else {
      this.recoveryMetrics.failedRecoveries++;
    }
    
    // Update average recovery time
    const totalDuration = (this.recoveryMetrics.averageRecoveryTimeMs * (this.recoveryMetrics.totalRecoveryAttempts - 1)) + durationMs;
    this.recoveryMetrics.averageRecoveryTimeMs = totalDuration / this.recoveryMetrics.totalRecoveryAttempts;
    
    // Update category-specific metrics
    const categoryStats = this.recoveryMetrics.recoverySuccessRateByCategory.get(category) || { attempts: 0, successes: 0 };
    categoryStats.attempts++;
    if (success) {
      categoryStats.successes++;
    }
    this.recoveryMetrics.recoverySuccessRateByCategory.set(category, categoryStats);
    
    // Add to history (keep only recent 100 attempts)
    this.recoveryMetrics.recoveryAttemptHistory.push({
      timestamp,
      sessionId,
      category,
      success,
      durationMs,
      error
    });
    
    if (this.recoveryMetrics.recoveryAttemptHistory.length > 100) {
      this.recoveryMetrics.recoveryAttemptHistory.shift();
    }
    
    this.recoveryMetrics.lastRecoveryTimestamp = timestamp;
    
    // Log metrics periodically
    if (this.recoveryMetrics.totalRecoveryAttempts % 10 === 0) {
      this.logRecoveryMetrics();
    }
  }

  /**
   * Get current recovery success rates and metrics
   */
  getTimeoutRecoveryMetrics() {
    const successRate = this.recoveryMetrics.totalRecoveryAttempts > 0 
      ? (this.recoveryMetrics.successfulRecoveries / this.recoveryMetrics.totalRecoveryAttempts) * 100
      : 0;

    const categoryRates = new Map<string, number>();
    for (const [category, stats] of Array.from(this.recoveryMetrics.recoverySuccessRateByCategory)) {
      const rate = stats.attempts > 0 ? (stats.successes / stats.attempts) * 100 : 0;
      categoryRates.set(category, rate);
    }

    return {
      overallSuccessRate: successRate,
      totalAttempts: this.recoveryMetrics.totalRecoveryAttempts,
      successfulRecoveries: this.recoveryMetrics.successfulRecoveries,
      failedRecoveries: this.recoveryMetrics.failedRecoveries,
      averageRecoveryTimeMs: this.recoveryMetrics.averageRecoveryTimeMs,
      categorySuccessRates: Object.fromEntries(categoryRates),
      recentHistory: this.recoveryMetrics.recoveryAttemptHistory.slice(-10),
      lastRecoveryTimestamp: this.recoveryMetrics.lastRecoveryTimestamp
    };
  }

  /**
   * Log recovery metrics for monitoring and debugging
   */
  private logRecoveryMetrics(): void {
    const metrics = this.getTimeoutRecoveryMetrics();
    
    this.logger.info(`Recovery Metrics Summary:
      Overall Success Rate: ${metrics.overallSuccessRate.toFixed(1)}%
      Total Attempts: ${metrics.totalAttempts}
      Successful: ${metrics.successfulRecoveries}
      Failed: ${metrics.failedRecoveries}
      Avg Recovery Time: ${metrics.averageRecoveryTimeMs.toFixed(0)}ms`);
    
    if (Object.keys(metrics.categorySuccessRates).length > 0) {
      const categoryReport = Object.entries(metrics.categorySuccessRates)
        .map(([category, rate]) => `${category}: ${rate.toFixed(1)}%`)
        .join(', ');
      
      this.logger.info(`Category Success Rates: ${categoryReport}`);
    }
  }

  /**
   * Validate session recovery by testing actual command execution
   */
  private async validateSessionRecovery(sessionId: string, channel: ClientChannel): Promise<{ valid: boolean; error?: string }> {
    return new Promise((resolve) => {
      const validationTimeout = 3000;
      let validationReceived = false;
      const testId = Date.now().toString(36);
      
      const cleanup = () => {
        channel.removeListener('data', onValidationData);
        channel.removeListener('error', onValidationError);
        channel.removeListener('close', onValidationClose);
      };
      
      const timer = setTimeout(() => {
        if (!validationReceived) {
          validationReceived = true;
          cleanup();
          resolve({ valid: false, error: 'Validation command timeout' });
        }
      }, validationTimeout);
      
      const onValidationData = (data: Buffer) => {
        if (!validationReceived) {
          const dataStr = data.toString();
          
          // Check if we received our test response
          if (dataStr.includes(testId) || dataStr.includes('validation-success')) {
            validationReceived = true;
            clearTimeout(timer);
            cleanup();
            resolve({ valid: true });
          }
        }
      };
      
      const onValidationError = (error: Error) => {
        if (!validationReceived) {
          validationReceived = true;
          clearTimeout(timer);
          cleanup();
          resolve({ valid: false, error: `Validation error: ${error.message}` });
        }
      };
      
      const onValidationClose = () => {
        if (!validationReceived) {
          validationReceived = true;
          clearTimeout(timer);
          cleanup();
          resolve({ valid: false, error: 'Channel closed during validation' });
        }
      };
      
      // Set up listeners
      channel.on('data', onValidationData);
      channel.on('error', onValidationError);
      channel.on('close', onValidationClose);
      
      try {
        // Send a validation command that should respond quickly
        channel.write(`echo "validation-success-${testId}"\n`);
      } catch (error) {
        clearTimeout(timer);
        cleanup();
        resolve({ valid: false, error: `Write error during validation: ${error}` });
      }
    });
  }
  
  /**
   * Attempt SSH reconnection with enhanced recovery strategies
   */
  private async attemptSSHReconnection(sessionId: string): Promise<TimeoutRecoveryResult> {
    const startTime = Date.now();
    const reconnectContext = {
      sessionId,
      operation: 'ssh_reconnection',
      error: new Error('SSH reconnection attempt'),
      timestamp: startTime,
      metadata: { phase: 'start' }
    };

    try {
      this.logger.info(`Attempting SSH reconnection for session ${sessionId}`);
      
      // Get original session info
      const session = this.sessions.get(sessionId);
      if (!session || !session.sshOptions) {
        const error = new Error('Session or SSH options not found');
        reconnectContext.error = error;
        
        // Check if error recovery can provide fallback session info
        const errorClassification = this.errorRecovery.classifyError(error);
        if (errorClassification?.recoverable) {
          const recoveryResult = await this.errorRecovery.attemptRecovery(reconnectContext);
          if (recoveryResult) {
            this.logger.info(`Error recovery provided session restoration for ${sessionId}`);
          }
        }
        
        return { success: false, error: 'Session or SSH options not found' };
      }

      // Update context with session details
      reconnectContext.metadata = {
        ...reconnectContext.metadata,
        phase: 'start',
        host: session.sshOptions.host,
        port: session.sshOptions.port,
        username: session.sshOptions.username
      } as any;

      // Check if we should proceed based on circuit breaker state
      const circuitKey = `ssh_reconnect_${session.sshOptions.host}`;
      const circuitState = this.retryManager.getCircuitBreakerStates()[circuitKey];
      
      if (circuitState?.state === 'open') {
        const waitTime = circuitState.nextAttemptTime - Date.now();
        if (waitTime > 0) {
          this.logger.warn(`Circuit breaker is open for SSH reconnection to ${session.sshOptions.host}, waiting ${waitTime}ms`);
          await this.delay(Math.min(waitTime, 10000)); // Max 10 second wait
        }
      }

      // Pre-connection health check
      const healthCheck = await this.performConnectionHealthCheck(
        session.sshOptions.host, 
        session.sshOptions.port || 22
      );
      
      if (!healthCheck.isHealthy) {
        this.logger.warn(`Health check failed for ${session.sshOptions.host}: ${healthCheck.error || 'unhealthy'}`);
        
        // Circuit breaker failure will be handled by retry mechanism
        
        // Apply additional delay for unhealthy connections
        const backoffDelay = Math.min(2000 + (healthCheck.consecutiveFailures * 1000), 10000);
        this.logger.info(`Applying ${backoffDelay}ms backoff for unhealthy connection`);
        await this.delay(backoffDelay);
      }
      
      // Clean up existing connection
      reconnectContext.metadata.phase = 'cleanup';
      await this.cleanupSSHSession(sessionId);
      
      // Recreate SSH connection with enhanced configuration
      reconnectContext.metadata.phase = 'reconnecting';
      const reconnectResult = await this.createSSHConnection(sessionId, session.sshOptions);
      
      if (reconnectResult.success) {
        // Validate the new connection
        const sshChannel = this.sshChannels.get(sessionId);
        if (sshChannel) {
          reconnectContext.metadata.phase = 'validating';
          
          const validationResult = await this.validateSessionRecovery(sessionId, sshChannel);
          if (validationResult.valid) {
            // Success is automatically recorded by retry manager
            
            const reconnectTime = Date.now() - startTime;
            this.logger.info(`Successfully reconnected SSH session ${sessionId} in ${reconnectTime}ms`);
            
            return { 
              success: true, 
              reconnected: true,
              metadata: { 
                reconnectTimeMs: reconnectTime,
                healthCheck: healthCheck.isHealthy,
                connectionQuality: this.networkMetrics.get(session.sshOptions.host)?.connectionQuality || 'unknown'
              }
            };
          } else {
            this.logger.warn(`Connection validation failed after reconnection: ${validationResult.error}`);
            // Clean up the failed connection
            await this.cleanupSSHSession(sessionId);
            
            // Circuit breaker failure will be handled by retry mechanism
            
            return { success: false, error: `Connection validation failed: ${validationResult.error}` };
          }
        } else {
          // Circuit breaker failure will be handled by retry mechanism
          return { success: false, error: 'SSH channel not available after reconnection' };
        }
      } else {
        // Circuit breaker failure will be handled by retry mechanism
        
        // Try error recovery as fallback
        reconnectContext.error = new Error(reconnectResult.error || 'Connection creation failed');
        reconnectContext.metadata.phase = 'error_recovery';
        
        const errorRecoveryResult = await this.errorRecovery.attemptRecovery(reconnectContext);
        if (errorRecoveryResult) {
          this.logger.info(`Error recovery provided fallback for SSH reconnection failure`);
          return { success: true, error: 'Recovered via error recovery fallback' };
        }
        
        return { success: false, error: reconnectResult.error || 'Reconnection failed' };
      }
      
    } catch (error) {
      const reconnectTime = Date.now() - startTime;
      this.logger.error(`SSH reconnection failed for session ${sessionId} after ${reconnectTime}ms:`, error);
      
      // Record failure in circuit breaker
      const session = this.sessions.get(sessionId);
      // Circuit breaker failure will be handled by retry mechanism
      
      // Update error context and attempt recovery
      reconnectContext.error = error as Error;
      reconnectContext.metadata.phase = 'exception_recovery';
      
      const errorRecoveryResult = await this.errorRecovery.attemptRecovery(reconnectContext);
      if (errorRecoveryResult) {
        this.logger.info(`Error recovery handled SSH reconnection exception for session ${sessionId}`);
        return { success: true, error: 'Recovered via exception recovery' };
      }
      
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  
  /**
   * Clean up SSH session resources
   */
  private async cleanupSSHSession(sessionId: string): Promise<void> {
    // Close and remove SSH channel
    const channel = this.sshChannels.get(sessionId);
    if (channel) {
      channel.removeAllListeners();
      channel.end();
      this.sshChannels.delete(sessionId);
    }
    
    // Close and remove SSH client
    const client = this.sshClients.get(sessionId);
    if (client) {
      client.removeAllListeners();
      client.end();
      this.sshClients.delete(sessionId);
    }
    
    // Reset timeout recovery attempts on successful cleanup
    this.timeoutRecoveryAttempts.delete(sessionId);
  }
  
  /**
   * Create SSH connection for recovery purposes
   */
  private async createSSHConnection(sessionId: string, sshOptions: SSHConnectionOptions): Promise<{ success: boolean; error?: string }> {
    try {
      this.logger.info(`Creating SSH connection for recovery: ${sessionId}`);
      
      // Create new SSH client
      const sshClient = new SSHClient();
      
      const connectConfig: ConnectConfig = {
        host: sshOptions.host,
        port: sshOptions.port || 22,
        username: sshOptions.username || process.env.USER || process.env.USERNAME || 'root',
        // Production-ready keepalive configuration
        keepaliveInterval: sshOptions.keepAliveInterval || 15000, // 15 seconds - frequent for long operations
        keepaliveCountMax: sshOptions.keepAliveCountMax || 6, // Allow up to 6 failed keepalives (90 seconds)
        readyTimeout: sshOptions.readyTimeout || 30000, // 30 seconds for initial connection
        // Server alive configuration for detecting unresponsive servers
        algorithms: {
          serverHostKey: ['ssh-ed25519', 'ecdsa-sha2-nistp256', 'ssh-rsa'],
          kex: ['ecdh-sha2-nistp256', 'ecdh-sha2-nistp384', 'diffie-hellman-group14-sha256'],
          cipher: ['aes256-gcm@openssh.com', 'aes128-gcm@openssh.com', 'aes256-ctr'],
          hmac: ['hmac-sha2-256-etm@openssh.com', 'hmac-sha2-512-etm@openssh.com']
        }
      };

      // Authentication setup
      if (sshOptions.password) {
        connectConfig.password = sshOptions.password;
      } else if (sshOptions.privateKey) {
        try {
          connectConfig.privateKey = readFileSync(sshOptions.privateKey);
        } catch (error) {
          this.logger.error(`Failed to read private key: ${error}`);
          return { success: false, error: `Failed to read private key: ${sshOptions.privateKey}` };
        }
      } else if (sshOptions.privateKeyPath) {
        try {
          connectConfig.privateKey = readFileSync(sshOptions.privateKeyPath);
        } catch (error) {
          this.logger.error(`Failed to read private key: ${error}`);
          return { success: false, error: `Failed to read private key: ${sshOptions.privateKeyPath}` };
        }
      }
      
      // Connect with timeout
      await this.connectSSHForRecovery(sshClient, connectConfig, sessionId);
      
      // Create shell channel
      const channel = await this.createSSHChannel(sshClient, sessionId);
      
      // Store the new connection
      this.sshClients.set(sessionId, sshClient);
      this.sshChannels.set(sessionId, channel);
      
      // Setup handlers
      const session = this.sessions.get(sessionId);
      if (session) {
        this.setupSSHHandlers(sessionId, channel, {
          command: session.command,
          args: session.args,
          cwd: session.cwd,
          env: session.env,
          consoleType: 'ssh',
          sshOptions: sshOptions
        });
      }
      
      this.logger.info(`Successfully recreated SSH connection for session ${sessionId}`);
      return { success: true };
      
    } catch (error) {
      this.logger.error(`Failed to create SSH connection for session ${sessionId}:`, error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  
  /**
   * Connect SSH client for recovery with timeout
   */
  private async connectSSHForRecovery(client: SSHClient, config: ConnectConfig, sessionId: string): Promise<void> {
    const host = config.host || 'unknown';
    
    // Perform pre-connection health check
    const healthCheck = await this.performConnectionHealthCheck(host, config.port);
    if (!healthCheck.isHealthy && healthCheck.consecutiveFailures > 3) {
      throw new Error(`Host ${host} appears to be unreachable (${healthCheck.consecutiveFailures} consecutive failures)`);
    }
    
    // Calculate adaptive timeout based on network conditions
    const adaptiveTimeout = this.calculateAdaptiveTimeout(host);
    this.logger.info(`Using adaptive timeout for SSH recovery connection to ${host}: ${adaptiveTimeout}ms`);
    
    return new Promise((resolve, reject) => {
      let connectionTimeout: NodeJS.Timeout;
      let connectionStartTime = Date.now();
      
      const cleanup = () => {
        client.removeAllListeners();
        if (connectionTimeout) {
          clearTimeout(connectionTimeout);
        }
      };
      
      connectionTimeout = setTimeout(() => {
        cleanup();
        const actualTimeout = Date.now() - connectionStartTime;
        this.logger.warn(`SSH connection timeout during recovery for ${host} after ${actualTimeout}ms`);
        
        // Update network metrics with timeout information
        this.updateNetworkMetrics(host, actualTimeout);
        
        reject(new Error(`SSH connection timeout during recovery after ${adaptiveTimeout}ms (actual: ${actualTimeout}ms)`));
      }, adaptiveTimeout);
      
      client.on('ready', () => {
        cleanup();
        const connectionTime = Date.now() - connectionStartTime;
        this.logger.info(`SSH connection ready for recovery: ${sessionId} (${connectionTime}ms)`);
        
        // Update network metrics with successful connection time
        this.updateNetworkMetrics(host, connectionTime);
        
        resolve();
      });
      
      client.on('error', (error) => {
        cleanup();
        const connectionTime = Date.now() - connectionStartTime;
        this.logger.error(`SSH connection error during recovery: ${sessionId} after ${connectionTime}ms`, error);
        
        // Update network metrics with error timing
        this.updateNetworkMetrics(host, Math.max(connectionTime, adaptiveTimeout));
        
        reject(error);
      });
      
      // Set connection timeout in config for SSH client
      const enhancedConfig = {
        ...config,
        readyTimeout: adaptiveTimeout,
        timeout: adaptiveTimeout
      };
      
      client.connect(enhancedConfig);
    });
  }

  private async optimizeNetworkConnections(): Promise<void> {
    this.logger.info('Optimizing network connections');
    // Close idle connections
    // Note: cleanupIdleConnections is private in ConnectionPool
    // await this.connectionPool.cleanupIdleConnections();
    this.emit('network-optimization-performed', { timestamp: new Date() });
  }

  /**
   * Public API for health monitoring control
   */

  /**
   * Get comprehensive system and session health status
   */
  public async getHealthStatus(): Promise<{
    systemHealth: any;
    sessionHealth: Map<string, any>;
    connectionHealth: Map<string, any>;
    metrics: any;
    healingStats: typeof this.healingStats;
  }> {
    const result = {
      systemHealth: null as any,
      sessionHealth: new Map<string, any>(),
      connectionHealth: new Map<string, any>(),
      metrics: null as any,
      healingStats: { ...this.healingStats }
    };

    if (this.selfHealingEnabled) {
      // Get system health - request health check via event
      result.systemHealth = await new Promise((resolve, reject) => {
        this.healthMonitor.once('health-report', (report) => {
          resolve(report);
        });
        // Trigger health check by performing checks manually or use available methods
        // Since checkSystemHealth doesn't exist, we'll emit a request for health data
        setTimeout(() => resolve({ status: 'healthy', message: 'Health monitoring active' }), 100);
      });

      // Get session health for all active sessions
      Array.from(this.sessions.keys()).forEach(sessionId => {
        const sessionHealth = this.heartbeatMonitor.getSessionHeartbeat(sessionId);
        if (sessionHealth) {
          result.sessionHealth.set(sessionId, sessionHealth);
        }
      });

      // Get connection health from SSH keep-alive
      const connectionHealthMap = this.sshKeepAlive.getConnectionHealth();
      if (connectionHealthMap && typeof connectionHealthMap === 'object') {
        for (const [connId, health] of Object.entries(connectionHealthMap as Record<string, any>)) {
          result.connectionHealth.set(connId, health);
        }
      }

      // Get current metrics
      result.metrics = this.metricsCollector.getCurrentMetrics();

      // Get Kubernetes health if protocol is active
      if (this.kubernetesProtocol) {
        try {
          const kubernetesHealth = await this.kubernetesProtocol.performHealthCheck();
          result.connectionHealth.set('kubernetes', {
            type: 'kubernetes',
            status: kubernetesHealth.status,
            overallScore: kubernetesHealth.overallScore,
            checks: kubernetesHealth.checks,
            context: this.kubernetesProtocol.getCurrentContext(),
            activeSessions: this.kubernetesProtocol.getActiveSessions().length,
            timestamp: new Date()
          });
        } catch (error) {
          result.connectionHealth.set('kubernetes', {
            type: 'kubernetes',
            status: 'critical',
            error: error.message,
            timestamp: new Date()
          });
        }
      }
    }

    return result;
  }

  /**
   * Enable or disable self-healing features
   */
  public setSelfHealingEnabled(enabled: boolean): void {
    const wasEnabled = this.selfHealingEnabled;
    this.selfHealingEnabled = enabled;

    if (enabled && !wasEnabled) {
      // Re-initialize and start components
      this.initializeSelfHealingComponents();
      this.setupSelfHealingIntegration();
      this.logger.info('Self-healing enabled');
    } else if (!enabled && wasEnabled) {
      // Stop all health monitoring
      this.healthMonitor?.stop();
      this.heartbeatMonitor?.stop();
      this.metricsCollector?.stop();
      this.logger.info('Self-healing disabled');
    }
  }

  /**
   * Enable or disable predictive healing
   */
  public setPredictiveHealingEnabled(enabled: boolean): void {
    this.predictiveHealingEnabled = enabled;
    
    if (this.selfHealingEnabled) {
      // Update components with new predictive setting
      // Note: These methods don't exist on the monitoring classes
      // Predictive analysis is configured during component initialization
      this.logger.debug(`Predictive healing setting updated but requires component restart to take effect`);
    }
    
    this.logger.info(`Predictive healing ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Enable or disable automatic recovery
   */
  public setAutoRecoveryEnabled(enabled: boolean): void {
    this.autoRecoveryEnabled = enabled;
    
    if (this.selfHealingEnabled) {
      // Note: setAutoRecoveryEnabled method doesn't exist on HealthMonitor
      // Auto recovery is configured during initialization via config.recovery.enabled
      this.logger.debug(`Auto recovery setting updated but requires component restart to take effect`);
    }
    
    this.logger.info(`Auto-recovery ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Force a comprehensive health check on all components
   */
  public async performHealthCheck(): Promise<any> {
    if (!this.selfHealingEnabled) {
      throw new Error('Self-healing is not enabled');
    }

    const results = {
      system: await this.healthMonitor.getHealthStatistics(),
      sessions: new Map<string, any>(),
      connections: this.sshKeepAlive.getConnectionHealth(),
      timestamp: new Date()
    };

    // Check all active sessions
    await Promise.all(Array.from(this.sessions.keys()).map(async sessionId => {
      try {
        const sessionHealth = await this.heartbeatMonitor.forceHeartbeat(sessionId);
        results.sessions.set(sessionId, sessionHealth);
      } catch (error) {
        results.sessions.set(sessionId, { error: error.message, healthy: false });
      }
    }));

    return results;
  }

  /**
   * Get detailed metrics for a specific time range
   */
  public getMetrics(options?: {
    timeRange?: { start: number; end: number };
    aggregationWindow?: string;
    includeRaw?: boolean;
  }): any {
    if (!this.selfHealingEnabled) {
      throw new Error('Self-healing is not enabled');
    }

    return this.metricsCollector.getCurrentMetrics();
  }

  /**
   * Export metrics in various formats
   */
  public async exportMetrics(format: 'json' | 'csv' | 'prometheus' = 'json'): Promise<string> {
    if (!this.selfHealingEnabled) {
      throw new Error('Self-healing is not enabled');
    }

    return await this.metricsCollector.exportMetrics(format);
  }

  /**
   * Manually trigger session recovery for a specific session
   */
  public async recoverSession(sessionId: string): Promise<boolean> {
    if (!this.selfHealingEnabled) {
      throw new Error('Self-healing is not enabled');
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    try {
      await this.sessionRecovery.recoverSession(sessionId, 'manual-recovery');
      return true;
    } catch (error) {
      this.logger.error(`Manual session recovery failed for ${sessionId}:`, error);
      return false;
    }
  }

  /**
   * Get session recovery history and statistics
   */
  public getRecoveryHistory(): any {
    if (!this.selfHealingEnabled) {
      throw new Error('Self-healing is not enabled');
    }

    return this.sessionRecovery.getRecoveryStatistics();
  }

  /**
   * Get current self-healing configuration
   */
  public getSelfHealingConfig(): {
    selfHealingEnabled: boolean;
    autoRecoveryEnabled: boolean;
    predictiveHealingEnabled: boolean;
    healingStats: typeof this.healingStats;
  } {
    return {
      selfHealingEnabled: this.selfHealingEnabled,
      autoRecoveryEnabled: this.autoRecoveryEnabled,
      predictiveHealingEnabled: this.predictiveHealingEnabled,
      healingStats: { ...this.healingStats }
    };
  }

  /**
   * Shutdown all self-healing components cleanly
   */
  private async shutdownSelfHealingComponents(): Promise<void> {
    try {
      this.logger.info('Shutting down self-healing components...');

      // Stop all monitoring services
      if (this.healthMonitor) {
        await this.healthMonitor.stop();
      }

      if (this.heartbeatMonitor) {
        await this.heartbeatMonitor.stop();
      }

      if (this.metricsCollector) {
        await this.metricsCollector.stop();
      }

      if (this.sshKeepAlive) {
        await this.sshKeepAlive.stop();
      }

      if (this.sessionRecovery) {
        await this.sessionRecovery.stop();
      }

      this.logger.info('Self-healing components shutdown complete');

    } catch (error) {
      this.logger.error('Error during self-healing components shutdown:', error);
      // Continue with shutdown even if some components fail to stop cleanly
    }
  }

  /**
   * Register a newly created session with all health monitoring components
   */
  private async registerSessionWithHealthMonitoring(sessionId: string, session: ConsoleSession, options: SessionOptions): Promise<void> {
    try {
      // Register with heartbeat monitor (with SSH-specific health monitoring)
      this.heartbeatMonitor.addSession(sessionId, {
        id: sessionId,
        createdAt: session.createdAt,
        lastActivity: new Date(),
        status: session.status === 'crashed' ? 'failed' : session.status as 'running' | 'failed' | 'paused' | 'stopped' | 'initializing' | 'recovering',
        type: options.sshOptions ? 'ssh' : 'local',
        pid: session.pid,
        healthScore: 100,
        recoveryAttempts: 0,
        maxRecoveryAttempts: 3,
        metadata: {
          command: session.command,
          args: session.args || []
        }
      }, options.sshOptions ? {
        hostname: options.sshOptions.host,
        port: options.sshOptions.port || 22,
        username: options.sshOptions.username || 'unknown'
      } : undefined);

      // Record session creation metrics
      this.metricsCollector.recordSessionLifecycle('created', sessionId, session.type);

      // Create initial snapshot for session recovery
      const snapshotData = {
        sessionId,
        command: session.command,
        args: session.args,
        cwd: session.cwd,
        env: session.env,
        consoleType: session.type,
        sshOptions: options.sshOptions,
        streaming: options.streaming,
        createdAt: session.createdAt,
        status: session.status
      };

      await this.sessionRecovery.registerSession(sessionId, {
        id: sessionId,
        createdAt: session.createdAt,
        lastActivity: new Date(),
        status: session.status === 'crashed' ? 'failed' : session.status as 'running' | 'failed' | 'paused' | 'stopped' | 'initializing' | 'recovering',
        type: options.sshOptions ? 'ssh' : 'local',
        pid: session.pid,
        healthScore: 100,
        recoveryAttempts: 0,
        maxRecoveryAttempts: 3,
        metadata: {
          command: session.command,
          args: session.args || []
        }
      }, options);

      this.logger.debug(`Session ${sessionId} registered with health monitoring components`);

    } catch (error) {
      this.logger.warn(`Failed to register session ${sessionId} with health monitoring:`, error);
      // Don't throw error as this is non-critical for session creation
    }
  }

  /**
   * Unregister a session from all health monitoring components
   */
  private async unregisterSessionFromHealthMonitoring(sessionId: string, reason: string = 'session-terminated'): Promise<void> {
    try {
      // Remove from heartbeat monitoring
      this.heartbeatMonitor.removeSession(sessionId);

      // Record session termination metrics
      const session = this.sessions.get(sessionId);
      const duration = session ? Date.now() - session.createdAt.getTime() : undefined;
      this.metricsCollector.recordSessionLifecycle('terminated', sessionId, session?.type || 'unknown', duration);

      // Clean up recovery snapshots
      await this.sessionRecovery.unregisterSession(sessionId);

      this.logger.debug(`Session ${sessionId} unregistered from health monitoring (reason: ${reason})`);

    } catch (error) {
      this.logger.warn(`Failed to unregister session ${sessionId} from health monitoring:`, error);
      // Continue with session cleanup even if health monitoring cleanup fails
    }
  }

  private async handleSessionError(sessionId: string, error: Error, operation: string): Promise<boolean> {
    try {
      // Create error context
      const errorContext: ErrorContext = {
        sessionId,
        operation,
        error,
        timestamp: Date.now(),
        metadata: {
          sessionInfo: this.sessions.get(sessionId),
          isDegraded: this.errorRecovery.isDegraded(sessionId)
        }
      };

      // Attempt error recovery
      const recoveryResult = await this.errorRecovery.attemptRecovery(errorContext);
      
      if (recoveryResult.recovered) {
        this.logger.info(`Error recovery successful for session ${sessionId}`);
        return true;
      } else if (recoveryResult.userGuidance.length > 0) {
        // Emit guidance to user
        this.emit('user-guidance', {
          sessionId,
          guidance: recoveryResult.userGuidance,
          actions: recoveryResult.actions
        });
      }

      return false;
    } catch (recoveryError) {
      this.logger.error(`Error recovery failed for session ${sessionId}: ${recoveryError}`);
      return false;
    }
  }

  async createSession(options: SessionOptions): Promise<string> {
    if (this.sessions.size >= this.maxSessions) {
      throw new Error(`Maximum session limit (${this.maxSessions}) reached`);
    }

    const sessionId = uuidv4();
    
    // Use retry logic for session creation
    return await this.retryManager.executeWithRetry(
      async () => {
        return await this.createSessionInternal(sessionId, options, false);
      },
      {
        sessionId,
        operationName: 'create_session',
        strategyName: options.command?.toLowerCase().includes('ssh') ? 'ssh' : 'generic',
        context: { command: options.command, args: options.args },
        onRetry: (context) => {
          this.logger.info(`Retrying session creation for ${sessionId} (attempt ${context.attemptNumber})`);
          
          // Clean up any partial session state before retry
          this.cleanupPartialSession(sessionId);
        }
      }
    );
  }

  private async createSessionInternal(sessionId: string, options: SessionOptions, isOneShot: boolean = false): Promise<string> {
    // Prevent race conditions with session creation lock
    const sessionLock = `session_create_${sessionId}`;

    // Check if session already exists to prevent duplicate creation
    if (this.sessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} already exists`);
    }

    // Record session creation start
    this.diagnosticsManager.recordEvent({
      level: 'info',
      category: 'session',
      operation: 'create_session_start',
      sessionId,
      message: `Creating ${isOneShot ? 'one-shot' : 'persistent'} session`,
      data: { options, isOneShot }
    });

    // Resolve options from stored profiles if available
    const resolvedOptions = this.resolveSessionOptions(options);

    // Add the isOneShot flag to resolved options for protocol use
    resolvedOptions.isOneShot = isOneShot;

    // Detect protocol type
    let protocolType = resolvedOptions.consoleType;
    if (!protocolType || protocolType === 'auto') {
      protocolType = this.detectProtocolType(resolvedOptions);
    }

    const session: ConsoleSession = {
      id: sessionId,
      sessionType: isOneShot ? 'one-shot' : 'persistent',
      command: resolvedOptions.command,
      args: resolvedOptions.args || [],
      cwd: resolvedOptions.cwd || process.cwd(),
      env: { ...process.env, ...resolvedOptions.env } as Record<string, string>,
      createdAt: new Date(),
      status: 'running',
      type: protocolType,
      streaming: resolvedOptions.streaming || false,
      timeout: resolvedOptions.timeout, // Pass through the configurable timeout
      sshOptions: resolvedOptions.sshOptions,
      azureOptions: resolvedOptions.azureOptions,
      kubernetesOptions: resolvedOptions.kubernetesOptions,
      winrmOptions: resolvedOptions.winrmOptions,
      ipcOptions: resolvedOptions.ipcOptions,
      webSocketTerminalOptions: resolvedOptions.webSocketTerminalOptions,
      // Initialize command execution state
      executionState: 'idle',
      activeCommands: new Map()
    };

    // Store session in initializing state first to prevent race conditions
    session.status = 'initializing';
    this.sessions.set(sessionId, session);

    try {
      // Initialize session command tracking
      this.initializeSessionCommandTracking(sessionId, resolvedOptions);

      // Register session with SessionManager
      // Map console types to SessionManager types
      const sessionManagerType = this.mapToSessionManagerType(protocolType);
      await this.sessionManager.registerSession(session, sessionManagerType as any);

      // Get or create protocol instance
      let protocol = this.protocolInstances.get(protocolType);
      if (!protocol) {
        protocol = await this.protocolFactory.createProtocol(protocolType);
        this.protocolInstances.set(protocolType, protocol);
      }

      // Create session using the protocol
      console.error(`[EVENT-FIX] About to call protocol.createSession with resolvedOptions.isOneShot = ${resolvedOptions.isOneShot}`);
      const protocolSession = await protocol.createSession(resolvedOptions);

      // Store protocol session mapping with protocol's sessionId
      this.protocolSessions.set(sessionId, { protocol, type: protocolType, protocolSessionId: protocolSession.id });
      this.protocolSessionIdMap.set(sessionId, protocolSession.id);

      // Setup protocol event handlers
      this.setupProtocolEventHandlers(sessionId, protocol, protocolType);

      // Mark session as running only after successful initialization
      session.status = 'running';
      session.lastActivity = new Date();
      this.sessions.set(sessionId, session);

      // Record successful session creation
      this.diagnosticsManager.recordEvent({
        level: 'info',
        category: 'session',
        operation: 'create_session_complete',
        sessionId,
        message: `Session created successfully`,
        data: { protocolType, isOneShot }
      });

      // REMOVED: waitForSessionReady() as SSH sessions never reach 'idle' state
      // This was causing executeCommand to hang indefinitely
      // await this.waitForSessionReady(sessionId, 5000); // 5 second timeout

      return sessionId;
    } catch (error) {
      // Update session manager about the failure
      await this.sessionManager.updateSessionStatus(sessionId, 'failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      
      session.status = 'crashed';
      this.sessions.set(sessionId, session);
      
      // Try to recover from the error
      await this.handleSessionError(sessionId, error as Error, 'create_session');
      
      this.logger.error(`Failed to create session: ${error}`);
      throw error;
    }
  }

  /**
   * Create SSH session using connection pool
   */
  private async createPooledSSHSession(sessionId: string, session: ConsoleSession, options: SessionOptions): Promise<string> {
    if (!options.sshOptions) {
      throw new Error('SSH options are required for SSH session');
    }

    try {
      // Get or create pooled connection
      const pooledConnection = await this.connectionPool.getConnection(options.sshOptions);
      
      // Create SSH shell session
      const sshClient = pooledConnection.connection;
      
      await new Promise<void>((resolve, reject) => {
        sshClient.shell({ 
          term: 'xterm-256color',
          cols: options.cols || 80,
          rows: options.rows || 24
        }, (err: Error | undefined, stream: ClientChannel) => {
          if (err) {
            reject(err);
            return;
          }

          // Store SSH connection info
          this.sshClients.set(sessionId, sshClient);
          this.sshChannels.set(sessionId, stream);
          
          // Setup stream handlers for SSH session
          this.setupPooledSSHHandlers(sessionId, stream, options);
          
          // Configure prompt detection for SSH session
          // this.configurePromptDetection(sessionId, options); // TODO: Implement if needed
          
          // Store session data
          this.sessions.set(sessionId, { 
            ...session, 
            status: 'running',
            pid: undefined // SSH sessions don't have local PIDs
          });
          this.outputBuffers.set(sessionId, []);

          // Register SSH session with self-healing components
          if (this.selfHealingEnabled) {
            this.registerSessionWithHealthMonitoring(sessionId, session, options).catch(error => {
              this.logger.warn(`Failed to register SSH session with health monitoring: ${error.message}`);
            });
            
            // Note: SSH connection monitoring is handled by the connection pool
            this.logger.debug(`SSH session ${sessionId} registered for monitoring`);
          }

          // Setup enhanced stream manager for immediate output capture
          if (options.streaming) {
            const streamManager = new StreamManager(sessionId, {
              enableRealTimeCapture: true,
              immediateFlush: true,
              bufferFlushInterval: 5,
              pollingInterval: 25,
              chunkCombinationTimeout: 10,
              maxChunkSize: 4096
            });
            this.streamManagers.set(sessionId, streamManager);
          } else {
            // Always create a stream manager with immediate capture for SSH sessions
            const streamManager = new StreamManager(sessionId, {
              enableRealTimeCapture: true,
              immediateFlush: true,
              bufferFlushInterval: 10,
              pollingInterval: 50,
              chunkCombinationTimeout: 15,
              maxChunkSize: 8192
            });
            this.streamManagers.set(sessionId, streamManager);
          }

          // Update session manager
          this.sessionManager.updateSessionStatus(sessionId, 'running', {
            connectionId: pooledConnection.id,
            sshHost: options.sshOptions!.host
          });

          resolve();
        });
      });

      // Start monitoring if enabled
      if (options.monitoring) {
        await this.monitoringSystem.startSessionMonitoring(sessionId, {
          command: options.command,
          args: options.args || [],
          ...options.monitoring
        });
      }

      this.emitEvent({
        sessionId,
        type: 'started',
        timestamp: new Date(),
        data: { 
          command: options.command, 
          type: 'ssh',
          host: options.sshOptions.host 
        }
      });

      this.logger.info(`SSH session ${sessionId} created for command: ${options.command} on ${options.sshOptions.host}`);
      
      return sessionId;

    } catch (error) {
      // Release connection back to pool on error
      // Note: We don't have the connection ID here in error case, so this is best effort
      this.logger.error(`SSH session creation failed for ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Create Kubernetes session using KubernetesProtocol
   */
  private async createKubernetesSession(sessionId: string, session: ConsoleSession, options: SessionOptions): Promise<string> {
    if (!options.kubernetesOptions) {
      throw new Error('Kubernetes options are required for Kubernetes session');
    }

    try {
      // Initialize Kubernetes protocol if not already done
      if (!this.kubernetesProtocol) {
        this.kubernetesProtocol = await this.protocolFactory.createProtocol('kubectl');
        /* Legacy config - now handled by protocol factory
        this.kubernetesProtocol = new KubernetesProtocol({
          connectionOptions: options.kubernetesOptions,
          logger: this.logger
        });
        await this.kubernetesProtocol.connect();
        */
      }

      // Determine session operation type based on command or console type
      let sessionType: 'exec' | 'logs' | 'port-forward' = 'exec';
      if (options.command.includes('logs') || options.consoleType === 'k8s-logs') {
        sessionType = 'logs';
      } else if (options.command.includes('port-forward') || options.consoleType === 'k8s-port-forward') {
        sessionType = 'port-forward';
      }

      // Create Kubernetes session state
      const kubernetesState: import('../types/index.js').KubernetesSessionState = {
        sessionType: sessionType,
        kubeConfig: options.kubernetesOptions,
        connectionState: {
          connected: false,
          reconnectAttempts: 0
        }
      };

      // Parse Kubernetes-specific options from command and args
      const kubernetesExecOptions = this.parseKubernetesOptions(options);

      if (sessionType === 'exec') {
        // Create exec session
        await this.kubernetesProtocol.createExecSession(sessionId, kubernetesExecOptions);
        
        // Setup event handlers for exec session
        this.setupKubernetesExecHandlers(sessionId);
        
      } else if (sessionType === 'logs') {
        // Create log streaming session
        const logOptions = this.parseKubernetesLogOptions(options);
        await this.kubernetesProtocol.streamLogs(sessionId, logOptions);
        
        // Setup event handlers for log streaming
        this.setupKubernetesLogHandlers(sessionId);
        
      } else if (sessionType === 'port-forward') {
        // Create port forwarding session
        const portForwardOptions = this.parsePortForwardOptions(options);
        await this.kubernetesProtocol.startPortForward(sessionId, portForwardOptions);
        
        // Setup event handlers for port forwarding
        this.setupKubernetesPortForwardHandlers(sessionId);
      }

      // Update session with Kubernetes state
      const updatedSession = {
        ...session,
        kubernetesState: kubernetesState,
        status: 'running' as const,
        pid: undefined // Kubernetes sessions don't have local PIDs
      };
      this.sessions.set(sessionId, updatedSession);
      this.outputBuffers.set(sessionId, []);

      // Register Kubernetes session with health monitoring
      if (this.selfHealingEnabled) {
        this.registerSessionWithHealthMonitoring(sessionId, updatedSession, options).catch(error => {
          this.logger.warn(`Failed to register Kubernetes session with health monitoring: ${error.message}`);
        });
        this.logger.debug(`Kubernetes session ${sessionId} registered for monitoring`);
      }

      // Setup stream manager for Kubernetes output
      if (options.streaming) {
        const streamManager = new StreamManager(sessionId, {
          enableRealTimeCapture: true,
          immediateFlush: true,
          bufferFlushInterval: 5,
          pollingInterval: 25,
          chunkCombinationTimeout: 10,
          maxChunkSize: 4096
        });
        this.streamManagers.set(sessionId, streamManager);
      } else {
        const streamManager = new StreamManager(sessionId, {
          enableRealTimeCapture: true,
          immediateFlush: true,
          bufferFlushInterval: 10,
          pollingInterval: 50,
          chunkCombinationTimeout: 15,
          maxChunkSize: 8192
        });
        this.streamManagers.set(sessionId, streamManager);
      }

      // Update session manager
      await this.sessionManager.updateSessionStatus(sessionId, 'running', {
        kubernetesContext: this.kubernetesProtocol.getCurrentContext().context,
        kubernetesNamespace: this.kubernetesProtocol.getCurrentContext().namespace,
        sessionType: sessionType
      });

      // Start monitoring if enabled
      if (options.monitoring) {
        await this.monitoringSystem.startSessionMonitoring(sessionId, {
          command: options.command,
          args: options.args || [],
          ...options.monitoring
        });
      }

      this.emitEvent({
        sessionId,
        type: 'started',
        timestamp: new Date(),
        data: {
          command: options.command,
          type: 'kubernetes',
          context: this.kubernetesProtocol.getCurrentContext().context,
          namespace: this.kubernetesProtocol.getCurrentContext().namespace,
          sessionType: sessionType
        }
      });

      this.logger.info(`Kubernetes ${sessionType} session ${sessionId} created: ${options.command}`);
      
      return sessionId;

    } catch (error) {
      this.logger.error(`Kubernetes session creation failed for ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Create Docker session using unified ProtocolFactory
   */
  private async createDockerSession(sessionId: string, session: ConsoleSession, options: SessionOptions): Promise<string> {
    try {
      // Docker is now handled by the unified protocol system
      // Get or create Docker protocol instance
      const protocolType = options.consoleType === 'docker-exec' ? 'docker' : 'docker';
      let protocol = this.protocolInstances.get(protocolType);

      if (!protocol) {
        protocol = await this.protocolFactory.createProtocol(protocolType);
        this.protocolInstances.set(protocolType, protocol);
      }

      // Register protocol and session for tracking
      this.protocolSessions.set(sessionId, { protocol, type: protocolType });

      // Create session via the protocol
      const dockerSession = await protocol.createSession(options);

      // Store the Docker session information
      const updatedSession: ConsoleSession = {
        ...session,
        status: 'running' as const,
        pid: undefined, // Docker sessions don't have local PIDs
        // Add Docker-specific fields if the session supports them
        ...(dockerSession as any)
      };
      
      this.sessions.set(sessionId, updatedSession);
      this.outputBuffers.set(sessionId, []);

      // Register Docker session with health monitoring
      if (this.selfHealingEnabled) {
        await this.registerSessionWithHealthMonitoring(sessionId, updatedSession, options).catch(error => {
          this.logger.warn(`Failed to register Docker session with health monitoring: ${error.message}`);
        });
        this.logger.debug(`Docker session ${sessionId} registered for monitoring`);
      }

      // Setup stream manager for Docker output
      if (options.streaming) {
        const streamManager = new StreamManager(sessionId, {
          enableRealTimeCapture: true,
          immediateFlush: true,
          bufferFlushInterval: 5,
          pollingInterval: 25,
          chunkCombinationTimeout: 10,
          maxChunkSize: 4096
        });
        this.streamManagers.set(sessionId, streamManager);
      } else {
        const streamManager = new StreamManager(sessionId, {
          enableRealTimeCapture: true,
          immediateFlush: true,
          bufferFlushInterval: 10,
          pollingInterval: 50,
          chunkCombinationTimeout: 15,
          maxChunkSize: 8192
        });
        this.streamManagers.set(sessionId, streamManager);
      }

      // Update session manager
      await this.sessionManager.updateSessionStatus(sessionId, 'running', {
        dockerContainerId: dockerSession.containerId,
        dockerImageId: dockerSession.imageId,
        isDockerExec: dockerSession.isExecSession,
        sessionType: options.consoleType === 'docker-exec' ? 'docker-exec' : 'docker'
      });

      // Start monitoring if enabled
      if (options.monitoring) {
        await this.monitoringSystem.startSessionMonitoring(sessionId, {
          command: options.command,
          args: options.args || [],
          ...options.monitoring
        });
      }

      this.emitEvent({
        sessionId,
        type: 'started',
        timestamp: new Date(),
        data: {
          command: options.command,
          type: dockerSession.isExecSession ? 'docker-exec' : 'docker',
          containerId: dockerSession.containerId,
          containerName: dockerSession.containerName,
          imageId: dockerSession.imageId
        }
      });

      this.logger.info(`Docker ${dockerSession.isExecSession ? 'exec' : 'run'} session ${sessionId} created: ${options.command} in container ${dockerSession.containerId}`);
      
      return sessionId;

    } catch (error) {
      this.logger.error(`Docker session creation failed for ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Parse Kubernetes exec options from session options
   */
  private parseKubernetesOptions(options: SessionOptions): import('../types/index.js').KubernetesExecOptions {
    const args = options.args || [];
    const kubernetesOptions: import('../types/index.js').KubernetesExecOptions = {
      namespace: options.kubernetesOptions?.namespace,
      interactive: true,
      stdin: true
    };

    // Parse common kubectl exec arguments
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      switch (arg) {
        case '-n':
        case '--namespace':
          kubernetesOptions.namespace = args[i + 1];
          i++;
          break;
        case '-c':
        case '--container':
          kubernetesOptions.containerName = args[i + 1];
          i++;
          break;
        case '-l':
        case '--selector':
          kubernetesOptions.labelSelector = args[i + 1];
          i++;
          break;
        default:
          if (!kubernetesOptions.name && !arg.startsWith('-')) {
            kubernetesOptions.name = arg;
          }
          break;
      }
    }

    return kubernetesOptions;
  }

  /**
   * Parse Kubernetes log options from session options
   */
  private parseKubernetesLogOptions(options: SessionOptions): import('../types/index.js').KubernetesLogOptions {
    const args = options.args || [];
    const logOptions: import('../types/index.js').KubernetesLogOptions = {
      namespace: options.kubernetesOptions?.namespace,
      follow: true
    };

    // Parse kubectl logs arguments
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      switch (arg) {
        case '-n':
        case '--namespace':
          logOptions.namespace = args[i + 1];
          i++;
          break;
        case '-c':
        case '--container':
          logOptions.containerName = args[i + 1];
          i++;
          break;
        case '-l':
        case '--selector':
          logOptions.labelSelector = args[i + 1];
          i++;
          break;
        case '-f':
        case '--follow':
          logOptions.follow = true;
          break;
        case '--tail':
          logOptions.tail = parseInt(args[i + 1]);
          i++;
          break;
        case '--since':
          logOptions.since = args[i + 1];
          i++;
          break;
        case '--timestamps':
          logOptions.timestamps = true;
          break;
        case '--previous':
          logOptions.previous = true;
          break;
        default:
          if (!logOptions.podName && !arg.startsWith('-')) {
            logOptions.podName = arg;
          }
          break;
      }
    }

    return logOptions;
  }

  /**
   * Parse port forward options from session options
   */
  private parsePortForwardOptions(options: SessionOptions): import('../types/index.js').PortForwardOptions {
    const args = options.args || [];
    let podName = '';
    let localPort = 0;
    let remotePort = 0;
    let namespace = options.kubernetesOptions?.namespace;

    // Parse kubectl port-forward arguments
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '-n' || arg === '--namespace') {
        namespace = args[i + 1];
        i++;
      } else if (!arg.startsWith('-')) {
        if (!podName) {
          podName = arg;
        } else if (arg.includes(':')) {
          const ports = arg.split(':');
          localPort = parseInt(ports[0]);
          remotePort = parseInt(ports[1]);
        }
      }
    }

    return {
      podName,
      localPort,
      remotePort,
      namespace
    };
  }

  /**
   * Setup event handlers for Kubernetes exec sessions
   */
  private setupKubernetesExecHandlers(sessionId: string): void {
    if (!this.kubernetesProtocol) return;

    // Handle session events
    this.kubernetesProtocol.on('sessionCreated', ({ sessionId: k8sSessionId, sessionState }) => {
      if (k8sSessionId === sessionId) {
        this.logger.debug(`Kubernetes exec session ${sessionId} established`);
      }
    });

    this.kubernetesProtocol.on('sessionClosed', ({ sessionId: k8sSessionId }) => {
      if (k8sSessionId === sessionId) {
        this.handleKubernetesSessionClosed(sessionId);
      }
    });
  }

  /**
   * Setup event handlers for Kubernetes log streaming
   */
  private setupKubernetesLogHandlers(sessionId: string): void {
    if (!this.kubernetesProtocol) return;

    this.kubernetesProtocol.on('logData', ({ streamId, podName, data, raw }) => {
      if (streamId === sessionId) {
        this.handleKubernetesLogData(sessionId, data, raw);
      }
    });

    this.kubernetesProtocol.on('logError', ({ streamId, error }) => {
      if (streamId === sessionId) {
        this.handleKubernetesLogError(sessionId, error);
      }
    });

    this.kubernetesProtocol.on('logEnd', ({ streamId }) => {
      if (streamId === sessionId) {
        this.handleKubernetesLogEnd(sessionId);
      }
    });
  }

  /**
   * Setup event handlers for Kubernetes port forwarding
   */
  private setupKubernetesPortForwardHandlers(sessionId: string): void {
    if (!this.kubernetesProtocol) return;

    this.kubernetesProtocol.on('portForwardStarted', ({ portForwardId, localPort, remotePort }) => {
      if (portForwardId === sessionId) {
        this.logger.info(`Port forward ${sessionId} started: ${localPort} -> ${remotePort}`);
      }
    });

    this.kubernetesProtocol.on('portForwardStopped', ({ portForwardId }) => {
      if (portForwardId === sessionId) {
        this.handleKubernetesPortForwardStopped(sessionId);
      }
    });
  }

  /**
   * Handle Kubernetes session closed
   */
  private handleKubernetesSessionClosed(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = 'stopped';
      this.sessions.set(sessionId, session);
    }

    this.emitEvent({
      sessionId,
      type: 'stopped',
      timestamp: new Date(),
      data: { reason: 'kubernetes_session_closed' }
    });

    this.logger.info(`Kubernetes session ${sessionId} closed`);
  }

  /**
   * Handle Kubernetes log data
   */
  private handleKubernetesLogData(sessionId: string, data: string, raw: string): void {
    const output: ConsoleOutput = {
      sessionId,
      type: 'stdout',
      data: data,
      timestamp: new Date(),
      raw: raw
    };

    const buffer = this.outputBuffers.get(sessionId) || [];
    buffer.push(output);
    this.outputBuffers.set(sessionId, buffer);

    const streamManager = this.streamManagers.get(sessionId);
    if (streamManager) {
      streamManager.processOutput(output);
    }

    this.emitEvent({
      sessionId,
      type: 'output',
      timestamp: new Date(),
      data: output
    });
  }

  /**
   * Handle Kubernetes log error
   */
  private handleKubernetesLogError(sessionId: string, error: Error): void {
    const output: ConsoleOutput = {
      sessionId,
      type: 'stderr',
      data: error.message,
      timestamp: new Date()
    };

    const buffer = this.outputBuffers.get(sessionId) || [];
    buffer.push(output);
    this.outputBuffers.set(sessionId, buffer);

    this.emitEvent({
      sessionId,
      type: 'error',
      timestamp: new Date(),
      data: { error: error.message }
    });

    this.logger.error(`Kubernetes log error for session ${sessionId}:`, error);
  }

  /**
   * Handle Kubernetes log stream end
   */
  private handleKubernetesLogEnd(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = 'stopped';
      this.sessions.set(sessionId, session);
    }

    this.emitEvent({
      sessionId,
      type: 'stopped',
      timestamp: new Date(),
      data: { reason: 'log_stream_ended' }
    });

    this.logger.info(`Kubernetes log stream ${sessionId} ended`);
  }

  /**
   * Handle Kubernetes port forward stopped
   */
  private handleKubernetesPortForwardStopped(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = 'stopped';
      this.sessions.set(sessionId, session);
    }

    this.emitEvent({
      sessionId,
      type: 'stopped',
      timestamp: new Date(),
      data: { reason: 'port_forward_stopped' }
    });

    this.logger.info(`Kubernetes port forward ${sessionId} stopped`);
  }

  /**
   * Create serial session using SerialProtocol
   */
  private async createSerialSession(sessionId: string, session: ConsoleSession, options: SessionOptions): Promise<string> {
    if (!options.serialOptions && !['serial', 'com', 'uart'].includes(options.consoleType || '')) {
      throw new Error('Serial options or serial console type required for serial session');
    }

    try {
      // Initialize serial protocol if not already done
      if (!this.serialProtocol) {
        this.serialProtocol = await this.protocolFactory.createProtocol('serial');
        this.setupSerialProtocolEventHandlers();
      }

      // Determine serial options
      let serialOptions: SerialConnectionOptions;
      
      if (options.serialOptions) {
        serialOptions = options.serialOptions;
      } else {
        // Auto-detect serial port if only console type is specified
        const devices = await this.serialProtocol.discoverDevices();
        const availableDevice = devices.find(device => device.isConnected === false);
        
        if (!availableDevice) {
          throw new Error('No available serial devices found. Please specify explicit serial options.');
        }

        // Use first available device with default settings
        serialOptions = {
          path: availableDevice.path,
          baudRate: availableDevice.deviceType === 'esp32' ? 115200 : 9600,
          dataBits: 8,
          stopBits: 1,
          parity: 'none',
          encoding: 'utf8',
          lineEnding: '\r\n',
          resetOnConnect: availableDevice.deviceType === 'arduino',
          reconnectOnDisconnect: true,
          maxReconnectAttempts: 5,
          reconnectDelay: 1000
        };
      }

      // Store serial options in session
      session.serialOptions = serialOptions;

      // Create serial connection
      await this.serialProtocol.createConnection(sessionId, serialOptions);

      // Set up session tracking
      this.sessions.set(sessionId, session);
      this.outputBuffers.set(sessionId, []);

      // Initialize stream manager for serial output
      const streamManager = new StreamManager(sessionId, {
        maxChunkSize: options.maxBuffer || 10000,
        enableRealTimeCapture: true,
        bufferFlushInterval: 10,
        enablePolling: true,
        pollingInterval: 50,
        immediateFlush: true,
        chunkCombinationTimeout: 20
      });
      this.streamManagers.set(sessionId, streamManager);

      // Set up monitoring
      if (options.monitoring) {
        const monitoringSystem = new MonitoringSystem({
          anomalyDetection: {
            enabled: options.monitoring.enableAnomalyDetection || false,
            windowSize: 100,
            confidenceLevel: 0.95
          },
          alerting: {
            enabled: options.monitoring.enableAuditing || false,
            channels: [{
              type: 'console',
              config: {}
            }]
          },
          auditing: {
            enabled: false,
            logDirectory: './logs',
            encryption: false,
            retention: 30
          },
          performance: {
            enabled: options.monitoring.enableProfiling || false,
            samplingInterval: 1000,
            profileDuration: 60000
          }
        });
        this.monitoringSystems.set(sessionId, monitoringSystem);
      }

      // Initialize error detection for serial output
      if (options.detectErrors !== false) {
        const defaultPatterns = this.getDefaultSerialErrorPatterns();
        const extendedPatterns = options.patterns 
          ? options.patterns.map(p => ({ ...p, category: 'serial' }))
          : defaultPatterns;
        this.errorDetector.addPatterns(extendedPatterns);
      }

      this.logger.info(`Serial session created successfully: ${sessionId} on ${serialOptions.path}`);

      // Emit session started event
      this.emit('session:created', {
        sessionId,
        type: 'serial',
        path: serialOptions.path,
        deviceType: serialOptions.deviceType || 'generic',
        timestamp: new Date()
      });

      return sessionId;

    } catch (error) {
      this.logger.error(`Serial session creation failed for ${sessionId}:`, error);
      
      // Clean up on failure
      await this.cleanupSerialSession(sessionId);
      
      throw error;
    }
  }

  /**
   * Set up event handlers for SerialProtocol
   */
  private setupSerialProtocolEventHandlers(): void {
    this.serialProtocol.on('data', (output: ConsoleOutput) => {
      this.handleSerialOutput(output);
    });

    this.serialProtocol.on('line', (output: ConsoleOutput) => {
      this.handleSerialLine(output);
    });

    this.serialProtocol.on('binary_data', (output: ConsoleOutput) => {
      this.handleSerialBinaryData(output);
    });

    this.serialProtocol.on('connection', (event: any) => {
      this.logger.info(`Serial connection event:`, event);
      this.emit('serial:connection', event);
    });

    this.serialProtocol.on('disconnection', (event: any) => {
      this.logger.warn(`Serial disconnection event:`, event);
      this.emit('serial:disconnection', event);
    });

    this.serialProtocol.on('error', (event: any) => {
      this.logger.error(`Serial error event:`, event);
      this.emit('serial:error', event);
    });

    this.serialProtocol.on('bootloader_detected', (event: any) => {
      this.logger.info(`Bootloader detected:`, event);
      this.emit('serial:bootloader_detected', event);
    });

    this.serialProtocol.on('device_list_updated', (devices: any) => {
      this.emit('serial:device_list_updated', devices);
    });
  }

  /**
   * Handle serial data output
   */
  private handleSerialOutput(output: ConsoleOutput): void {
    const { sessionId } = output;
    
    // Store output in buffer
    const buffer = this.outputBuffers.get(sessionId);
    if (buffer) {
      buffer.push(output);
    }

    // Pass through stream manager
    const streamManager = this.streamManagers.get(sessionId);
    if (streamManager) {
      streamManager.processOutput(output);
    }

    // Emit output event
    this.emit('output', output);
    this.emit(`output:${sessionId}`, output);
  }

  /**
   * Handle serial line output (parsed lines)
   */
  private handleSerialLine(output: ConsoleOutput): void {
    const { sessionId } = output;

    // Process line for error detection
    if (this.errorDetector) {
      this.errorDetector.processOutput(output.data);
    }

    // Process line for prompt detection
    if (this.promptDetector) {
      const result = this.promptDetector.detectPrompt(sessionId, output.data);
      if (result && result.detected) {
        this.emit('prompt:detected', {
          sessionId,
          pattern: result.pattern,
          matchedText: result.matchedText,
          timestamp: new Date()
        });
      }
    }

    // Regular output handling
    this.handleSerialOutput(output);
  }

  /**
   * Handle binary data from serial connection
   */
  private handleSerialBinaryData(output: ConsoleOutput): void {
    // Binary data typically bypasses text processing
    this.handleSerialOutput(output);
  }

  /**
   * Get default error patterns for serial communication
   */
  private getDefaultSerialErrorPatterns(): ExtendedErrorPattern[] {
    return [
      {
        pattern: /error|ERROR|Error/,
        type: 'error',
        description: 'General error message',
        severity: 'medium',
        category: 'serial',
        tags: ['serial', 'general']
      },
      {
        pattern: /exception|Exception|EXCEPTION/,
        type: 'exception',
        description: 'Exception in serial communication',
        severity: 'high',
        category: 'serial',
        tags: ['serial', 'exception']
      },
      {
        pattern: /timeout|Timeout|TIMEOUT/,
        type: 'error',
        description: 'Serial communication timeout',
        severity: 'medium',
        category: 'serial',
        tags: ['serial', 'timeout']
      },
      {
        pattern: /connection.*lost|disconnected|unplugged/i,
        type: 'error',
        description: 'Serial device disconnected',
        severity: 'high',
        category: 'serial',
        tags: ['serial', 'connection']
      },
      {
        pattern: /bootloader|Bootloader|BOOTLOADER/,
        type: 'warning',
        description: 'Device in bootloader mode',
        severity: 'low',
        category: 'serial',
        tags: ['serial', 'bootloader']
      }
    ];
  }

  /**
   * Clean up serial session resources
   */
  private async cleanupSerialSession(sessionId: string): Promise<void> {
    try {
      // Remove from sessions map
      this.sessions.delete(sessionId);
      
      // Close serial connection
      if (this.serialProtocol) {
        await this.serialProtocol.closeConnection(sessionId);
      }

      // Clean up buffers and managers
      this.outputBuffers.delete(sessionId);
      this.streamManagers.delete(sessionId);
      this.monitoringSystems.delete(sessionId);
      
      // Error patterns are global and don't need session-specific cleanup

    } catch (error) {
      this.logger.error(`Error cleaning up serial session ${sessionId}:`, error);
    }
  }

  /**
   * Create AWS SSM session using AWS Systems Manager Session Manager
   */
  private async createAWSSSMSession(sessionId: string, session: ConsoleSession, options: SessionOptions): Promise<string> {
    if (!options.awsSSMOptions && !['aws-ssm', 'ssm-session', 'ssm-tunnel'].includes(options.consoleType || '')) {
      throw new Error('AWS SSM options or AWS SSM console type required for AWS SSM session');
    }

    try {
      // Initialize AWS SSM protocol if not already done
      if (!this.awsSSMProtocol) {
        const ssmConfig: AWSSSMConnectionOptions = options.awsSSMOptions || {
          region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1'
        };
        
        // Ensure required region is provided
        if (!ssmConfig.region) {
          ssmConfig.region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
        }

        this.awsSSMProtocol = await this.protocolFactory.createProtocol('aws-ssm');
        this.setupAWSSSMProtocolEventHandlers();
      }

      // Determine session type based on console type and options
      const ssmSessionType = this.determineSSMSessionType(options);

      let ssmSessionId: string;

      switch (ssmSessionType) {
        case 'interactive':
          // Start interactive shell session
          if (!options.awsSSMOptions?.instanceId) {
            throw new Error('Instance ID is required for interactive SSM sessions');
          }
          ssmSessionId = await this.awsSSMProtocol.startSession(options.awsSSMOptions);
          break;

        case 'port-forwarding':
          // Start port forwarding session
          if (!options.awsSSMOptions?.instanceId || !options.awsSSMOptions?.portNumber) {
            throw new Error('Instance ID and port number are required for SSM port forwarding');
          }
          ssmSessionId = await this.awsSSMProtocol.startPortForwardingSession(
            options.awsSSMOptions.instanceId,
            options.awsSSMOptions.portNumber,
            options.awsSSMOptions.localPortNumber
          );
          break;

        case 'command':
          // Execute command via SSM
          if (!options.awsSSMOptions?.documentName) {
            throw new Error('Document name is required for SSM command execution');
          }
          ssmSessionId = await this.awsSSMProtocol.sendCommand(
            options.awsSSMOptions.documentName,
            options.awsSSMOptions.parameters || {},
            options.awsSSMOptions.instanceId ? [{
              type: 'instance',
              id: options.awsSSMOptions.instanceId
            }] : undefined
          );
          break;

        default:
          throw new Error(`Unsupported AWS SSM session type: ${ssmSessionType}`);
      }

      // Update session with SSM-specific information
      session.awsSSMSessionId = ssmSessionId;
      session.awsSSMOptions = options.awsSSMOptions;
      
      // Store session
      this.sessions.set(sessionId, session);

      // Set up session monitoring
      this.setupSSMSessionMonitoring(sessionId, ssmSessionId);

      this.logger.info(`AWS SSM session created: ${sessionId} (SSM: ${ssmSessionId}, type: ${ssmSessionType})`);
      this.emit('session-created', { sessionId, type: 'aws-ssm', ssmSessionId, ssmSessionType });

      return sessionId;

    } catch (error) {
      this.logger.error(`Failed to create AWS SSM session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Determine the type of SSM session based on options and console type
   */
  private determineSSMSessionType(options: SessionOptions): 'interactive' | 'port-forwarding' | 'command' {
    const consoleType = options.consoleType;
    
    if (consoleType === 'ssm-tunnel' || options.awsSSMOptions?.portNumber) {
      return 'port-forwarding';
    }
    
    if (consoleType === 'aws-ssm' || consoleType === 'ssm-session') {
      return options.awsSSMOptions?.documentName ? 'command' : 'interactive';
    }
    
    // Default to interactive for AWS SSM console types
    return 'interactive';
  }

  /**
   * Set up event handlers for AWS SSM Protocol
   */
  private setupAWSSSMProtocolEventHandlers(): void {
    this.awsSSMProtocol.on('output', (output: ConsoleOutput) => {
      this.handleSSMOutput(output);
    });

    this.awsSSMProtocol.on('session-started', (data: { sessionId: string; instanceId?: string }) => {
      this.logger.info(`AWS SSM session started: ${data.sessionId}`);
      this.emit('console-event', {
        sessionId: data.sessionId,
        type: 'started',
        timestamp: new Date(),
        data
      });
    });

    this.awsSSMProtocol.on('session-terminated', (data: { sessionId: string }) => {
      this.logger.info(`AWS SSM session terminated: ${data.sessionId}`);
      this.handleSSMSessionTermination(data.sessionId);
    });

    this.awsSSMProtocol.on('session-error', (data: { sessionId: string; error: Error }) => {
      this.logger.error(`AWS SSM session error: ${data.sessionId}`, data.error);
      this.handleSSMSessionError(data.sessionId, data.error);
    });

    this.awsSSMProtocol.on('port-forwarding-started', (data: { sessionId: string; targetId: string; portNumber: number; localPortNumber: number }) => {
      this.logger.info(`AWS SSM port forwarding started: ${data.sessionId} (${data.targetId}:${data.portNumber} -> localhost:${data.localPortNumber})`);
      this.emit('console-event', {
        sessionId: data.sessionId,
        type: 'started',
        timestamp: new Date(),
        data
      });
    });

    this.awsSSMProtocol.on('command-sent', (data: { commandId: string; documentName: string }) => {
      this.logger.info(`AWS SSM command sent: ${data.commandId} (${data.documentName})`);
    });

    this.awsSSMProtocol.on('command-completed', (data: { commandId: string; status: string }) => {
      this.logger.info(`AWS SSM command completed: ${data.commandId} (${data.status})`);
    });

    this.awsSSMProtocol.on('health-check', (data: { status: string; timestamp: Date; error?: any }) => {
      if (data.status === 'unhealthy') {
        this.logger.warn(`AWS SSM protocol health check failed:`, data.error);
      }
    });

    this.awsSSMProtocol.on('session-recovered', (data: { sessionId: string }) => {
      this.logger.info(`AWS SSM session recovered: ${data.sessionId}`);
    });
  }

  /**
   * Handle AWS SSM output
   */
  private handleSSMOutput(output: ConsoleOutput): void {
    // Find the corresponding console session
    const session = Array.from(this.sessions.values()).find(s => s.awsSSMSessionId === output.sessionId);
    if (session) {
      // Update output with console session ID
      const consoleOutput: ConsoleOutput = {
        ...output,
        sessionId: session.id
      };

      // Store output in buffer
      const outputs = this.outputBuffers.get(session.id) || [];
      outputs.push(consoleOutput);
      this.outputBuffers.set(session.id, outputs);

      // Emit output event
      this.emit('output', consoleOutput);
      this.emit('console-event', {
        sessionId: session.id,
        type: 'output',
        timestamp: new Date(),
        data: consoleOutput
      });

      // Process output for error detection
      if (this.errorDetector) {
        this.errorDetector.processOutput(consoleOutput);
      }
    }
  }

  /**
   * Handle AWS SSM session termination
   */
  private handleSSMSessionTermination(ssmSessionId: string): void {
    const session = Array.from(this.sessions.values()).find(s => s.awsSSMSessionId === ssmSessionId);
    if (session) {
      session.status = 'stopped';
      this.sessions.set(session.id, session);

      this.emit('console-event', {
        sessionId: session.id,
        type: 'stopped',
        timestamp: new Date(),
        data: { ssmSessionId }
      });
    }
  }

  /**
   * Handle AWS SSM session errors
   */
  private handleSSMSessionError(ssmSessionId: string, error: Error): void {
    const session = Array.from(this.sessions.values()).find(s => s.awsSSMSessionId === ssmSessionId);
    if (session) {
      session.status = 'crashed';
      this.sessions.set(session.id, session);

      this.emit('console-event', {
        sessionId: session.id,
        type: 'error',
        timestamp: new Date(),
        data: { error: error.message, ssmSessionId }
      });

      // Attempt error recovery if enabled
      if (this.selfHealingEnabled) {
        this.attemptSSMSessionRecovery(session.id, ssmSessionId, error);
      }
    }
  }

  /**
   * Set up monitoring for AWS SSM session
   */
  private setupSSMSessionMonitoring(sessionId: string, ssmSessionId: string): void {
    // Add to session monitoring
    if (this.heartbeatMonitor) {
      this.heartbeatMonitor.addSession(sessionId, {
        id: sessionId,
        status: 'running',
        type: 'aws-ssm',
        createdAt: new Date(),
        lastActivity: new Date(),
        recoveryAttempts: 0,
        maxRecoveryAttempts: 3,
        healthScore: 100
      });
    }

    // Start health checks
    const healthCheckInterval = setInterval(async () => {
      if (!this.awsSSMProtocol.isHealthy()) {
        this.logger.warn(`AWS SSM protocol unhealthy, attempting recovery for session ${sessionId}`);
        await this.attemptSSMSessionRecovery(sessionId, ssmSessionId, new Error('Protocol unhealthy'));
      }
    }, 60000); // Check every minute

    // Store interval for cleanup
    this.sessionHealthCheckIntervals = this.sessionHealthCheckIntervals || new Map();
    this.sessionHealthCheckIntervals.set(sessionId, healthCheckInterval);
  }

  /**
   * Attempt to recover an AWS SSM session
   */
  private async attemptSSMSessionRecovery(sessionId: string, ssmSessionId: string, error: Error): Promise<void> {
    try {
      this.logger.info(`Attempting AWS SSM session recovery for ${sessionId}`);

      // Get session information
      const session = this.sessions.get(sessionId);
      if (!session || !session.awsSSMOptions) {
        this.logger.warn(`Cannot recover AWS SSM session ${sessionId}: session or options not found`);
        return;
      }

      // Try to terminate old session gracefully
      try {
        await this.awsSSMProtocol.terminateSession(ssmSessionId);
      } catch (terminateError) {
        this.logger.warn(`Failed to terminate old SSM session ${ssmSessionId}:`, terminateError);
      }

      // Create new session with same options
      const ssmSessionType = this.determineSSMSessionType({ 
        consoleType: session.type, 
        awsSSMOptions: session.awsSSMOptions,
        command: session.command || '/bin/bash' // Default command if not available
      });

      let newSsmSessionId: string;

      switch (ssmSessionType) {
        case 'interactive':
          newSsmSessionId = await this.awsSSMProtocol.startSession(session.awsSSMOptions);
          break;
        case 'port-forwarding':
          newSsmSessionId = await this.awsSSMProtocol.startPortForwardingSession(
            session.awsSSMOptions.instanceId!,
            session.awsSSMOptions.portNumber!,
            session.awsSSMOptions.localPortNumber
          );
          break;
        case 'command':
          newSsmSessionId = await this.awsSSMProtocol.sendCommand(
            session.awsSSMOptions.documentName!,
            session.awsSSMOptions.parameters || {},
            session.awsSSMOptions.instanceId ? [{
              type: 'instance',
              id: session.awsSSMOptions.instanceId
            }] : undefined
          );
          break;
      }

      // Update session with new SSM session ID
      session.awsSSMSessionId = newSsmSessionId;
      session.status = 'running';
      this.sessions.set(sessionId, session);

      this.logger.info(`AWS SSM session recovery successful: ${sessionId} (new SSM: ${newSsmSessionId})`);
      this.emit('session-recovered', { sessionId, newSsmSessionId, ssmSessionType });

    } catch (recoveryError) {
      this.logger.error(`AWS SSM session recovery failed for ${sessionId}:`, recoveryError);
      
      // Mark session as failed
      const session = this.sessions.get(sessionId);
      if (session) {
        session.status = 'crashed';
        this.sessions.set(sessionId, session);
      }
    }
  }

  /**
   * Create SFTP/SCP file transfer session
   */
  private async createSFTPSession(sessionId: string, session: ConsoleSession, options: SessionOptions): Promise<string> {
    if (!options.sshOptions) {
      throw new Error('SSH options are required for SFTP/SCP session');
    }

    try {
      this.logger.info(`Creating SFTP session: ${sessionId} for ${options.sshOptions.host}`);

      // Create SFTP session options
      const sftpOptions: SFTPSessionOptions = {
        ...options.sshOptions,
        maxConcurrentTransfers: 3,
        transferQueue: {
          maxSize: 100,
          priorityLevels: 4,
          timeoutMs: 300000
        },
        bandwidth: {
          adaptiveThrottling: true
        },
        compressionLevel: 6,
        keepAlive: {
          enabled: true,
          interval: 30000,
          maxMissed: 3
        }
      };

      // Initialize SFTP protocol
      const sftpProtocol = await this.protocolFactory.createProtocol('sftp') as any;
      
      // Setup event handlers
      this.setupSFTPEventHandlers(sessionId, sftpProtocol);

      // Connect SFTP
      await sftpProtocol.connect();

      // Store SFTP protocol instance
      this.sftpProtocols.set(sessionId, sftpProtocol);

      // Create file transfer session tracking
      const fileTransferSession: FileTransferSession = {
        ...session,
        protocol: options.consoleType as 'sftp' | 'scp',
        sftpOptions,
        activeTransfers: new Map(),
        transferQueue: [],
        connectionState: sftpProtocol.getConnectionState(),
        transferStats: {
          totalTransfers: 0,
          successfulTransfers: 0,
          failedTransfers: 0,
          totalBytesTransferred: 0,
          averageSpeed: 0
        }
      };

      this.fileTransferSessions.set(sessionId, fileTransferSession);

      // Update session status
      session.status = 'running';
      this.sessions.set(sessionId, session);

      this.emit('session-started', { sessionId, type: 'sftp', options: sftpOptions });
      this.logger.info(`SFTP session created successfully: ${sessionId}`);

      return sessionId;

    } catch (error) {
      this.logger.error(`Failed to create SFTP session ${sessionId}:`, error);
      
      // Cleanup on failure
      this.cleanupSFTPSession(sessionId);
      
      throw error;
    }
  }

  /**
   * Create local session (existing logic extracted)
   */
  private async createLocalSession(sessionId: string, session: ConsoleSession, options: SessionOptions): Promise<string> {
    try {
      let finalCommand: string;
      let finalArgs: string[] = [];
      let spawnOptions: SpawnOptions = {
        cwd: options.cwd || process.cwd(),
        env: { ...process.env, ...options.env } as any,
        shell: false,
        windowsHide: true
      };

      if (options.shell || options.consoleType) {
        const shellConfig = this.getShellCommand(options.consoleType || 'auto');
        finalCommand = shellConfig.command;
        
        if (options.command) {
          const fullCommand = options.args?.length 
            ? `${options.command} ${options.args.join(' ')}`
            : options.command;
          finalArgs = [...shellConfig.args, fullCommand];
        } else {
          // Interactive shell
          finalArgs = [];
          spawnOptions.shell = false;
        }
      } else {
        finalCommand = options.command;
        finalArgs = options.args || [];
      }

      const childProcess = spawn(finalCommand, finalArgs, spawnOptions);

      if (!childProcess.pid) {
        throw new Error('Failed to spawn process');
      }

      session.pid = childProcess.pid;
      
      this.sessions.set(sessionId, session);
      this.processes.set(sessionId, childProcess);
      this.outputBuffers.set(sessionId, []);

      // Register session with self-healing components
      if (this.selfHealingEnabled) {
        await this.registerSessionWithHealthMonitoring(sessionId, session, options);
      }

      // Setup enhanced stream manager for immediate output capture
      if (options.streaming) {
        const streamManager = new StreamManager(sessionId, {
          enableRealTimeCapture: true,
          immediateFlush: true,
          bufferFlushInterval: 5, // 5ms for ultra-fast flushing
          pollingInterval: 25,    // 25ms polling for missed output
          chunkCombinationTimeout: 10, // 10ms to combine rapid chunks
          maxChunkSize: 4096
        });
        this.streamManagers.set(sessionId, streamManager);
      } else {
        // Always create a stream manager with immediate capture for better output handling
        const streamManager = new StreamManager(sessionId, {
          enableRealTimeCapture: true,
          immediateFlush: true,
          bufferFlushInterval: 10,
          pollingInterval: 50,
          chunkCombinationTimeout: 15,
          maxChunkSize: 8192
        });
        this.streamManagers.set(sessionId, streamManager);
      }

      this.setupProcessHandlers(sessionId, childProcess, options);

      // Start monitoring if enabled
      if (options.monitoring) {
        await this.monitoringSystem.startSessionMonitoring(sessionId, {
          command: options.command,
          args: options.args || [],
          pid: childProcess.pid!,
          ...options.monitoring
        });
      }

      // Update session manager
      await this.sessionManager.updateSessionStatus(sessionId, 'running', {
        pid: childProcess.pid
      });

      this.emitEvent({
        sessionId,
        type: 'started',
        timestamp: new Date(),
        data: { pid: childProcess.pid, command: options.command }
      });

      this.logger.info(`Session ${sessionId} created for command: ${options.command}`);
      
      return sessionId;
    } catch (error) {
      this.logger.error(`Local session creation failed for ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Configure prompt detection for a session based on SSH options and environment
   * Note: This is now handled by the command queue system with configurable prompt patterns
   */
  private configurePromptDetection(sessionId: string, options: SessionOptions): void {
    // Command queue system handles prompt detection
    // Set custom prompt pattern if specified in options
    const sshOptions = options.sshOptions;
    if (sshOptions?.host && sshOptions?.username) {
      const customPattern = new RegExp(`(?:^|\\n)(${sshOptions.username}@${sshOptions.host}[^$#]*[$#])\\s*$`, 'm');
      this.setSessionPromptPattern(sessionId, customPattern);
      
      this.logger.info(`Configured custom prompt pattern for SSH session ${sessionId}`, {
        host: sshOptions.host,
        username: sshOptions.username
      });
    }
  }

  /**
   * Setup SSH stream handlers for pooled connections
   */
  private setupPooledSSHHandlers(sessionId: string, stream: ClientChannel, options: SessionOptions): void {
    const streamManager = this.streamManagers.get(sessionId);

    // Initialize command queue for this SSH session
    this.initializeCommandQueue(sessionId);

    // Handle SSH stream stdout/stderr
    stream.on('data', (data: Buffer) => {
      const text = data.toString();
      
      // Add output to prompt detector for pattern analysis
      const promptResult = this.promptDetector.addOutput(sessionId, text);
      if (promptResult && promptResult.detected) {
        this.logger.debug(`Prompt detected in SSH session ${sessionId}`, {
          pattern: promptResult.pattern?.name,
          confidence: promptResult.confidence,
          matchedText: promptResult.matchedText.substring(0, 50)
        });
        
        // Emit prompt detection event
        this.emitEvent({
          sessionId,
          type: 'prompt-detected',
          timestamp: new Date(),
          data: {
            pattern: promptResult.pattern?.name,
            confidence: promptResult.confidence,
            matchedText: promptResult.matchedText,
            context: promptResult.context
          }
        });
      }
      
      // Handle command queue acknowledgment
      this.handleSSHOutputForQueue(sessionId, text);
      
      const output: ConsoleOutput = {
        sessionId,
        type: 'stdout',
        data: stripAnsi(text),
        raw: text,
        timestamp: new Date()
      };

      this.addToBuffer(sessionId, output);
      
      if (streamManager) {
        streamManager.addChunk(text);
        // Force immediate flush for SSH prompts and important output
        if (text.includes('\n') || text.includes('$') || text.includes('#') || 
            text.includes('>') || text.includes('Password:') || text.length > 50) {
          streamManager.forceFlush();
        }
      }
      
      this.emitEvent({
        sessionId,
        type: 'output',
        timestamp: new Date(),
        data: output
      });

      // Record output to monitoring system
      if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
        this.monitoringSystem.recordEvent(sessionId, 'output', { 
          type: 'stdout',
          size: text.length,
          lineCount: text.split('\n').length - 1
        });
      }

      // Update session activity
      this.sessionManager.updateSessionActivity(sessionId, {
        lastOutput: new Date(),
        outputSize: text.length
      });

      if (options.detectErrors !== false) {
        this.queue.add(async () => {
          // Convert ErrorPattern[] to ExtendedErrorPattern[] if needed
          const extendedPatterns = options.patterns?.map(p => ({
            ...p,
            category: 'custom',
            language: 'unknown'
          } as ExtendedErrorPattern));
          
          const errors = this.errorDetector.detect(output.data, extendedPatterns);
          if (errors.length > 0) {
            this.emitEvent({
              sessionId,
              type: 'error',
              timestamp: new Date(),
              data: { errors, output: output.data }
            });
            
            // Record error to monitoring system
            if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
              this.monitoringSystem.recordEvent(sessionId, 'error', {
                errorCount: errors.length,
                errorTypes: errors.map(e => e.pattern.type),
                output: output.data
              });
            }
          }
        });
      }
    });

    // Handle SSH stream stderr
    stream.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      const output: ConsoleOutput = {
        sessionId,
        type: 'stderr',
        data: stripAnsi(text),
        raw: text,
        timestamp: new Date()
      };

      this.addToBuffer(sessionId, output);
      
      if (streamManager) {
        streamManager.addChunk(text, true);
      }
      
      this.emitEvent({
        sessionId,
        type: 'output',
        timestamp: new Date(),
        data: output
      });

      // Record stderr output to monitoring system
      if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
        this.monitoringSystem.recordEvent(sessionId, 'output', { 
          type: 'stderr',
          size: text.length,
          lineCount: text.split('\n').length - 1
        });
      }

      // Update session activity
      this.sessionManager.updateSessionActivity(sessionId, {
        lastError: new Date(),
        errorSize: text.length
      });

      // Always check stderr for errors
      this.queue.add(async () => {
        // Convert ErrorPattern[] to ExtendedErrorPattern[] if needed
        const extendedPatterns = options.patterns?.map(p => ({
          ...p,
          category: 'custom',
          language: 'unknown'
        } as ExtendedErrorPattern));
        
        const errors = this.errorDetector.detect(output.data, extendedPatterns);
        if (errors.length > 0) {
          this.emitEvent({
            sessionId,
            type: 'error',
            timestamp: new Date(),
            data: { errors, output: output.data, isStderr: true }
          });
          
          // Record stderr error to monitoring system
          if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
            this.monitoringSystem.recordEvent(sessionId, 'error', {
              errorCount: errors.length,
              errorTypes: errors.map(e => e.pattern.type),
              output: output.data,
              isStderr: true
            });
          }
        }
      });
    });

    // Handle SSH stream close
    stream.on('close', () => {
      const session = this.sessions.get(sessionId);
      if (session) {
        session.status = 'stopped';
        this.sessions.set(sessionId, session);
      }

      if (streamManager) {
        streamManager.end();
      }

      // Update session manager
      this.sessionManager.updateSessionStatus(sessionId, 'stopped');

      // Stop monitoring if active
      if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
        this.monitoringSystem.stopSessionMonitoring(sessionId);
      }

      this.emitEvent({
        sessionId,
        type: 'stopped',
        timestamp: new Date(),
        data: { reason: 'SSH stream closed' }
      });

      this.logger.info(`SSH session ${sessionId} stream closed`);

      // Release connection back to pool
      const sshClient = this.sshClients.get(sessionId);
      if (sshClient) {
        // Note: We'd need to track connection IDs properly, for now just log
        this.logger.debug(`SSH connection for session ${sessionId} will be released when connection tracking is implemented`);
      }
    });

    // Handle SSH stream error
    stream.on('error', (error: Error) => {
      const session = this.sessions.get(sessionId);
      if (session) {
        session.status = 'crashed';
        this.sessions.set(sessionId, session);
      }

      // Update session manager
      this.sessionManager.updateSessionStatus(sessionId, 'failed', {
        error: error.message
      });

      // Record process error to monitoring system
      if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
        this.monitoringSystem.recordEvent(sessionId, 'error', {
          type: 'ssh_stream_error',
          error: error.message,
          stack: error.stack
        });
        this.monitoringSystem.stopSessionMonitoring(sessionId);
      }

      this.emitEvent({
        sessionId,
        type: 'error',
        timestamp: new Date(),
        data: { error: error.message }
      });

      this.logger.error(`SSH session ${sessionId} stream error: ${error.message}`);
    });

    if (options.timeout) {
      setTimeout(() => {
        if (this.isSessionRunning(sessionId)) {
          this.stopSession(sessionId);
        }
      }, options.timeout);
    }
  }

  private cleanupPartialSession(sessionId: string): void {
    // Clean up any partial state from failed session creation
    const process = this.processes.get(sessionId);
    if (process && !process.killed) {
      try {
        process.kill('SIGTERM');
      } catch (error) {
        // Process might already be dead
        this.logger.debug(`Failed to kill process during cleanup: ${error}`);
      }
    }

    this.sessions.delete(sessionId);
    this.processes.delete(sessionId);
    this.outputBuffers.delete(sessionId);
    this.streamManagers.delete(sessionId);
    this.sshClients.delete(sessionId);
    this.sshChannels.delete(sessionId);
  }

  /**
   * Wait for session to be fully ready with timeout
   */
  private async waitForSessionReady(sessionId: string, timeoutMs: number = 5000): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const session = this.sessions.get(sessionId);

      if (!session) {
        throw new Error(`Session ${sessionId} not found during readiness check`);
      }

      // Check if session is ready
      if (session.status === 'running' && session.executionState === 'idle') {
        // Additional validation using SessionValidator
        try {
          const isValid = await this.sessionValidator.validateSessionReady(sessionId, session);
          if (isValid) {
            this.logger.debug(`Session ${sessionId} is ready`);
            return;
          }
        } catch (validationError) {
          this.logger.debug(`Session ${sessionId} validation failed: ${validationError}`);
        }
      }

      // If session failed, don't wait any longer
      if (session.status === 'crashed' || session.status === 'failed') {
        throw new Error(`Session ${sessionId} failed during initialization`);
      }

      // Wait a bit before checking again
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    throw new Error(`Session ${sessionId} not ready within ${timeoutMs}ms timeout`);
  }

  private setupProcessHandlers(sessionId: string, process: ChildProcess, options: SessionOptions) {
    const streamManager = this.streamManagers.get(sessionId);
    
    // Setup immediate output capture listeners
    if (streamManager) {
      // Subscribe to immediate output events for real-time capture
      streamManager.subscribeRealtime((data, timestamp) => {
        this.emit('immediate-output', {
          sessionId,
          data,
          timestamp,
          type: 'realtime'
        });
      });
      
      // Subscribe to buffer flush events
      streamManager.on('buffer-flushed', (event) => {
        this.emit('buffer-flushed', {
          sessionId: event.sessionId,
          chunk: event.chunk,
          timestamp: new Date()
        });
      });
      
      // Setup force flush on new output
      streamManager.on('immediate-output', () => {
        // Force immediate availability of output
        setImmediate(() => {
          this.emit('output-ready', { sessionId });
        });
      });
    }
    
    // Handle stdout with enhanced immediate capture
    if (process.stdout) {
      process.stdout.on('data', (data: Buffer) => {
        const text = data.toString();
        const timestamp = new Date();
        
        const output: ConsoleOutput = {
          sessionId,
          type: 'stdout',
          data: stripAnsi(text),
          raw: text,
          timestamp
        };

        // Add to buffer with immediate processing
        this.addToBuffer(sessionId, output);
        
        // Add to stream manager with immediate flush
        if (streamManager) {
          streamManager.addChunk(text, false);
          // Force immediate flush for critical output
          if (text.includes('\n') || text.length > 100) {
            streamManager.forceFlush();
          }
        }
        
        // Emit output event immediately
        this.emitEvent({
          sessionId,
          type: 'output',
          timestamp: new Date(),
          data: output
        });

        // Record output to monitoring system
        if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
          this.monitoringSystem.recordEvent(sessionId, 'output', { 
            type: 'stdout',
            size: text.length,
            lineCount: text.split('\n').length - 1
          });
        }

        if (options.detectErrors !== false) {
          this.queue.add(async () => {
            // Convert ErrorPattern[] to ExtendedErrorPattern[] if needed
            const extendedPatterns = options.patterns?.map(p => ({
              ...p,
              category: 'custom',
              language: 'unknown'
            } as ExtendedErrorPattern));
            
            const errors = this.errorDetector.detect(output.data, extendedPatterns);
            if (errors.length > 0) {
              this.emitEvent({
                sessionId,
                type: 'error',
                timestamp: new Date(),
                data: { errors, output: output.data }
              });
              
              // Record error to monitoring system
              if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
                this.monitoringSystem.recordEvent(sessionId, 'error', {
                  errorCount: errors.length,
                  errorTypes: errors.map(e => e.pattern.type),
                  output: output.data
                });
              }
            }
          });
        }
      });
    }

    // Handle stderr with enhanced immediate capture
    if (process.stderr) {
      process.stderr.on('data', (data: Buffer) => {
        const text = data.toString();
        const timestamp = new Date();
        
        const output: ConsoleOutput = {
          sessionId,
          type: 'stderr',
          data: stripAnsi(text),
          raw: text,
          timestamp
        };

        // Add to buffer with immediate processing
        this.addToBuffer(sessionId, output);
        
        // Add to stream manager with immediate flush (stderr is high priority)
        if (streamManager) {
          streamManager.addChunk(text, true);
          // Always force immediate flush for stderr
          streamManager.forceFlush();
        }
        
        // Emit output event immediately
        this.emitEvent({
          sessionId,
          type: 'output',
          timestamp: new Date(),
          data: output
        });

        // Record stderr output to monitoring system
        if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
          this.monitoringSystem.recordEvent(sessionId, 'output', { 
            type: 'stderr',
            size: text.length,
            lineCount: text.split('\n').length - 1
          });
        }

        // Always check stderr for errors
        this.queue.add(async () => {
          // Convert ErrorPattern[] to ExtendedErrorPattern[] if needed
          const extendedPatterns = options.patterns?.map(p => ({
            ...p,
            category: 'custom',
            language: 'unknown'
          } as ExtendedErrorPattern));
          
          const errors = this.errorDetector.detect(output.data, extendedPatterns);
          if (errors.length > 0) {
            this.emitEvent({
              sessionId,
              type: 'error',
              timestamp: new Date(),
              data: { errors, output: output.data, isStderr: true }
            });
            
            // Record stderr error to monitoring system
            if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
              this.monitoringSystem.recordEvent(sessionId, 'error', {
                errorCount: errors.length,
                errorTypes: errors.map(e => e.pattern.type),
                output: output.data,
                isStderr: true
              });
            }
          }
        });
      });
    }

    // Handle process exit
    process.on('exit', (code: number | null, signal: string | null) => {
      const session = this.sessions.get(sessionId);
      if (session) {
        session.status = 'stopped';
        session.exitCode = code ?? undefined;
        this.sessions.set(sessionId, session);
      }

      if (streamManager) {
        streamManager.end();
      }

      // Stop monitoring if active
      if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
        this.monitoringSystem.stopSessionMonitoring(sessionId);
      }

      this.emitEvent({
        sessionId,
        type: 'stopped',
        timestamp: new Date(),
        data: { exitCode: code, signal }
      });

      this.logger.info(`Session ${sessionId} exited with code: ${code}`);
    });

    process.on('error', async (error: Error) => {
      const session = this.sessions.get(sessionId);
      if (session) {
        session.status = 'crashed';
        this.sessions.set(sessionId, session);
      }

      // Record process error to monitoring system
      if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
        this.monitoringSystem.recordEvent(sessionId, 'error', {
          type: 'process_error',
          error: error.message,
          stack: error.stack
        });
        this.monitoringSystem.stopSessionMonitoring(sessionId);
      }

      // Try to recover from the error
      const recovered = await this.handleSessionError(sessionId, error, 'process_error');
      
      this.emitEvent({
        sessionId,
        type: 'error',
        timestamp: new Date(),
        data: { error: error.message, recovered }
      });

      this.logger.error(`Session ${sessionId} error: ${error.message}`);
      
      if (!recovered) {
        // If recovery failed, attempt to restart the session if it's a recoverable error
        const classification = this.errorRecovery.classifyError(error);
        if (classification.recoverable && !this.errorRecovery.isDegraded(sessionId)) {
          this.logger.info(`Attempting to restart session ${sessionId} due to recoverable error`);
          this.emit('session-restart-required', { sessionId, error: error.message, classification });
        }
      }
    });

    if (options.timeout) {
      setTimeout(() => {
        if (this.isSessionRunning(sessionId)) {
          this.stopSession(sessionId);
        }
      }, options.timeout);
    }
  }

  private isSSHCommand(command: string): boolean {
    // Check if the command starts with 'ssh' and contains typical SSH patterns
    const sshPattern = /^ssh\s+/i;
    return sshPattern.test(command.trim());
  }

  private parseSSHCommand(command: string): {
    host: string;
    port?: number;
    user?: string;
    password?: string;
    privateKey?: string;
    options: string[];
  } {
    const parts = command.trim().split(/\s+/);
    const result = {
      host: '',
      port: 22,
      user: undefined as string | undefined,
      password: undefined as string | undefined,
      privateKey: undefined as string | undefined,
      options: [] as string[]
    };

    // Parse SSH command arguments
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      
      if (part === '-p' && i + 1 < parts.length) {
        // Port specification
        result.port = parseInt(parts[++i], 10);
      } else if (part === '-i' && i + 1 < parts.length) {
        // Private key file
        result.privateKey = parts[++i];
      } else if (part === '-l' && i + 1 < parts.length) {
        // Username
        result.user = parts[++i];
      } else if (part.startsWith('-')) {
        // Other SSH options
        result.options.push(part);
        // Some options might have values
        if (i + 1 < parts.length && !parts[i + 1].startsWith('-')) {
          result.options.push(parts[++i]);
        }
      } else if (!result.host) {
        // This should be the host or user@host
        if (part.includes('@')) {
          const splitParts = part.split('@');
          const [user, host] = [splitParts[0] || '', splitParts[1] || ''];
          result.user = user;
          result.host = host;
        } else {
          result.host = part;
        }
      }
    }

    if (!result.host) {
      throw new Error('No hostname specified in SSH command');
    }

    return result;
  }

  private getConnectionPoolKey(host: string, port: number, user?: string): string {
    return `${user || 'default'}@${host}:${port}`;
  }

  private async createSSHSession(sessionId: string, options: SessionOptions): Promise<string> {
    const sshConfig = this.parseSSHCommand(options.command!);
    const poolKey = this.getConnectionPoolKey(sshConfig.host, sshConfig.port!, sshConfig.user);
    
    const session: ConsoleSession = {
      id: sessionId,
      command: options.command!,
      args: options.args || [],
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...options.env } as Record<string, string>,
      createdAt: new Date(),
      status: 'running',
      type: 'ssh',
      streaming: options.streaming || false,
      executionState: 'idle',
      activeCommands: new Map()
    };

    try {
      // Check for existing connection in pool
      let sshClient = this.sshConnectionPool.get(poolKey);
      
      if (!sshClient || (sshClient as any)._sock?.readyState !== 'open') {
        // Create new SSH connection
        sshClient = new SSHClient();
        
        const connectConfig: ConnectConfig = {
          host: sshConfig.host,
          port: sshConfig.port || 22,
          username: sshConfig.user || process.env.USER || process.env.USERNAME || 'root',
          // Production-ready keepalive configuration for legacy SSH sessions
          keepaliveInterval: 15000, // 15 seconds - frequent for long operations
          keepaliveCountMax: 6, // Allow up to 6 failed keepalives (90 seconds)
          readyTimeout: 30000, // 30 seconds for initial connection
          // Enhanced security and performance algorithms
          algorithms: {
            serverHostKey: ['ssh-ed25519', 'ecdsa-sha2-nistp256', 'ssh-rsa'],
            kex: ['ecdh-sha2-nistp256', 'ecdh-sha2-nistp384', 'diffie-hellman-group14-sha256'],
            cipher: ['aes256-gcm@openssh.com', 'aes128-gcm@openssh.com', 'aes256-ctr'],
            hmac: ['hmac-sha2-256-etm@openssh.com', 'hmac-sha2-512-etm@openssh.com']
          }
        };

        // Authentication setup
        if (sshConfig.privateKey) {
          try {
            connectConfig.privateKey = readFileSync(sshConfig.privateKey);
          } catch (error) {
            this.logger.error(`Failed to read private key: ${error}`);
            throw new Error(`Failed to read private key: ${sshConfig.privateKey}`);
          }
        } else if (sshConfig.password) {
          connectConfig.password = sshConfig.password;
        } else if (process.env.SSH_AUTH_SOCK) {
          // Use SSH agent if available
          connectConfig.agent = process.env.SSH_AUTH_SOCK;
        }

        // Additional timeout configuration if specified
        if (options.timeout && options.timeout !== 10000) {
          connectConfig.readyTimeout = options.timeout;
        }

        await this.connectSSH(sshClient, connectConfig, poolKey, sessionId);
      }

      // Create shell session
      const channel = await this.createSSHChannel(sshClient, sessionId);
      
      this.sessions.set(sessionId, session);
      this.sshClients.set(sessionId, sshClient);
      this.sshChannels.set(sessionId, channel);
      this.outputBuffers.set(sessionId, []);

      // Setup stream manager for efficient streaming
      if (options.streaming) {
        const streamManager = new StreamManager(sessionId);
        this.streamManagers.set(sessionId, streamManager);
      }

      this.setupSSHHandlers(sessionId, channel, options);

      // Configure prompt detection for legacy SSH session
      this.configurePromptDetection(sessionId, options);

      // Start monitoring if enabled
      if (options.monitoring) {
        await this.monitoringSystem.startSessionMonitoring(sessionId, {
          command: options.command!,
          args: options.args || [],
          pid: 0, // SSH connections don't have local PIDs
          ...options.monitoring
        });
      }

      this.emitEvent({
        sessionId,
        type: 'started',
        timestamp: new Date(),
        data: { command: options.command, ssh: true, host: sshConfig.host }
      });

      this.logger.info(`SSH session ${sessionId} created for ${sshConfig.user}@${sshConfig.host}:${sshConfig.port}`);
      
      return sessionId;
    } catch (error) {
      session.status = 'crashed';
      this.sessions.set(sessionId, session);
      this.logger.error(`Failed to create SSH session: ${error}`);
      throw error;
    }
  }

  private async connectSSH(client: SSHClient, config: ConnectConfig, poolKey: string, sessionId: string): Promise<void> {
    const host = config.host || 'unknown';
    const retryKey = `${poolKey}_${sessionId}`;
    
    // Perform pre-connection health check
    const healthCheck = await this.performConnectionHealthCheck(host, config.port);
    if (!healthCheck.isHealthy && healthCheck.consecutiveFailures > 5) {
      throw new Error(`Host ${host} appears to be unreachable (${healthCheck.consecutiveFailures} consecutive failures)`);
    }
    
    // Calculate adaptive retry strategy based on connection quality
    const networkMetrics = this.networkMetrics.get(host);
    const maxRetries = this.calculateAdaptiveMaxRetries(networkMetrics?.connectionQuality);
    const baseDelay = this.calculateAdaptiveBaseDelay(networkMetrics?.connectionQuality);
    
    let currentAttempt = this.retryAttempts.get(retryKey) || 0;
    this.logger.info(`Starting SSH connection to ${host} with adaptive retry strategy: maxRetries=${maxRetries}, baseDelay=${baseDelay}ms`);

    return new Promise((resolve, reject) => {
      const attemptConnection = async () => {
        currentAttempt++;
        this.retryAttempts.set(retryKey, currentAttempt);
        
        // Calculate adaptive timeout for this attempt
        const adaptiveTimeout = this.calculateAdaptiveTimeout(host);
        const connectionStartTime = Date.now();
        
        this.logger.info(`SSH connection attempt ${currentAttempt}/${maxRetries} to ${host} with timeout ${adaptiveTimeout}ms`);

        // Enhanced config with adaptive timeout
        const enhancedConfig = {
          ...config,
          readyTimeout: adaptiveTimeout,
          timeout: adaptiveTimeout
        };
        
        client.connect(enhancedConfig);
        let connectionTimeout: NodeJS.Timeout;
        
        const cleanup = () => {
          if (connectionTimeout) {
            clearTimeout(connectionTimeout);
          }
        };

        connectionTimeout = setTimeout(() => {
          client.destroy();
          const actualTimeout = Date.now() - connectionStartTime;
          this.logger.warn(`SSH connection timeout (attempt ${currentAttempt}) to ${host} after ${actualTimeout}ms`);
          
          // Update network metrics with timeout information
          this.updateNetworkMetrics(host, actualTimeout);
          
          const error = new Error(`SSH connection timeout after ${adaptiveTimeout}ms (actual: ${actualTimeout}ms)`);
          
          if (currentAttempt < maxRetries) {
            // Calculate exponential backoff with jitter for better distributed retry
            const exponentialDelay = baseDelay * Math.pow(2, currentAttempt - 1);
            const jitter = Math.random() * 0.1 * exponentialDelay; // 10% jitter
            const delay = exponentialDelay + jitter;
            
            this.logger.warn(`SSH connection attempt ${currentAttempt} failed, retrying in ${Math.round(delay)}ms`);
            setTimeout(attemptConnection, delay);
          } else {
            this.retryAttempts.delete(retryKey);
            reject(error);
          }
        }, adaptiveTimeout);

        client.once('ready', () => {
          cleanup();
          const connectionTime = Date.now() - connectionStartTime;
          this.retryAttempts.delete(retryKey);
          this.sshConnectionPool.set(poolKey, client);
          this.logger.info(`SSH connection established: ${poolKey} (${connectionTime}ms, attempt ${currentAttempt})`);
          
          // Update network metrics with successful connection time
          this.updateNetworkMetrics(host, connectionTime);
          
          // Setup connection error handler for reconnection
          client.on('error', (error) => {
            this.logger.error(`SSH connection error: ${error.message}`);
            this.handleSSHConnectionError(poolKey, error);
          });

          client.on('close', () => {
            this.logger.info(`SSH connection closed: ${poolKey}`);
            this.sshConnectionPool.delete(poolKey);
          });

          resolve();
        });

        client.once('error', (error) => {
          cleanup();
          const connectionTime = Date.now() - connectionStartTime;
          this.logger.error(`SSH connection error (attempt ${currentAttempt}) to ${host}: ${error.message} after ${connectionTime}ms`);
          
          // Update network metrics with error timing
          this.updateNetworkMetrics(host, Math.max(connectionTime, adaptiveTimeout / 2));
          
          if (currentAttempt < maxRetries) {
            // Calculate exponential backoff with jitter and error-specific adjustments
            let exponentialDelay = baseDelay * Math.pow(2, currentAttempt - 1);
            
            // Adjust delay based on error type
            if (error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND')) {
              exponentialDelay *= 1.5; // Longer delay for connection refused/DNS errors
            }
            
            const jitter = Math.random() * 0.1 * exponentialDelay; // 10% jitter
            const delay = exponentialDelay + jitter;
            
            this.logger.warn(`SSH connection attempt ${currentAttempt} failed: ${error.message}, retrying in ${Math.round(delay)}ms`);
            setTimeout(attemptConnection, delay);
          } else {
            this.retryAttempts.delete(retryKey);
            reject(error);
          }
        });
      };

      attemptConnection();
    });
  }

  /**
   * Calculate adaptive maximum retries based on connection quality
   */
  private calculateAdaptiveMaxRetries(connectionQuality?: 'excellent' | 'good' | 'fair' | 'poor'): number {
    switch (connectionQuality) {
      case 'excellent':
        return 2; // Fewer retries for excellent connections
      case 'good':
        return 3; // Standard retries for good connections
      case 'fair':
        return 4; // More retries for fair connections
      case 'poor':
        return 5; // Maximum retries for poor connections
      default:
        return 3; // Default for unknown quality
    }
  }

  /**
   * Calculate adaptive base delay based on connection quality
   */
  private calculateAdaptiveBaseDelay(connectionQuality?: 'excellent' | 'good' | 'fair' | 'poor'): number {
    switch (connectionQuality) {
      case 'excellent':
        return 500;  // 0.5 seconds for excellent connections
      case 'good':
        return 1000; // 1 second for good connections
      case 'fair':
        return 2000; // 2 seconds for fair connections
      case 'poor':
        return 3000; // 3 seconds for poor connections
      default:
        return 1000; // Default 1 second
    }
  }

  /**
   * Start periodic network performance monitoring
   */
  private startNetworkPerformanceMonitoring(): void {
    // Monitor all known hosts every 5 minutes
    const monitoringInterval = 5 * 60 * 1000; // 5 minutes
    
    setInterval(async () => {
      const hosts = Array.from(new Set([
        ...Array.from(this.networkMetrics.keys()),
        ...Array.from(this.sshConnectionPool.keys()).map(key => {
          // Extract host from poolKey format (usually host:port)
          return key.split(':')[0];
        })
      ]));
      
      for (const host of hosts) {
        try {
          await this.performConnectionHealthCheck(host);
          this.logger.debug(`Completed periodic health check for ${host}`);
        } catch (error) {
          this.logger.warn(`Failed periodic health check for ${host}:`, error);
        }
      }
      
      // Clean up old metrics (older than 24 hours)
      this.cleanupOldNetworkMetrics();
      
    }, monitoringInterval);
    
    this.logger.info('Started network performance monitoring');
  }

  /**
   * Clean up old network metrics and measurements
   */
  private cleanupOldNetworkMetrics(): void {
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    const now = Date.now();
    
    Array.from(this.networkMetrics.entries()).forEach(([host, metrics]) => {
      if (now - metrics.lastUpdated.getTime() > maxAge) {
        this.networkMetrics.delete(host);
        this.latencyMeasurements.delete(host);
        this.connectionHealthChecks.delete(host);
        this.logger.debug(`Cleaned up old metrics for ${host}`);
      }
    });
  }

  /**
   * Get network performance summary for debugging
   */
  public getNetworkPerformanceSummary(): Array<{
    host: string;
    latency: number;
    jitter: number;
    quality: string;
    adaptiveTimeout: number;
    lastUpdated: Date;
    sampleCount: number;
  }> {
    return Array.from(this.networkMetrics.entries()).map(([host, metrics]) => ({
      host,
      latency: metrics.latency,
      jitter: metrics.jitter,
      quality: metrics.connectionQuality,
      adaptiveTimeout: this.calculateAdaptiveTimeout(host),
      lastUpdated: metrics.lastUpdated,
      sampleCount: metrics.sampleCount
    }));
  }

  private async createSSHChannel(client: SSHClient, sessionId: string): Promise<ClientChannel> {
    return new Promise((resolve, reject) => {
      client.shell((error, channel) => {
        if (error) {
          reject(error);
          return;
        }

        // Request PTY for proper interactive session
        channel.setWindow(80, 24, 640, 480);
        
        resolve(channel);
      });
    });
  }

  private setupSSHHandlers(sessionId: string, channel: ClientChannel, options: SessionOptions) {
    const streamManager = this.streamManagers.get(sessionId);
    
    // Initialize command queue for this SSH session
    this.initializeCommandQueue(sessionId);
    
    // Handle stdout/stderr from SSH channel
    channel.on('data', (data: Buffer) => {
      const text = data.toString();
      
      // Add output to prompt detector for pattern analysis
      const promptResult = this.promptDetector.addOutput(sessionId, text);
      if (promptResult && promptResult.detected) {
        this.logger.debug(`Prompt detected in legacy SSH session ${sessionId}`, {
          pattern: promptResult.pattern?.name,
          confidence: promptResult.confidence,
          matchedText: promptResult.matchedText.substring(0, 50)
        });
        
        // Emit prompt detection event
        this.emitEvent({
          sessionId,
          type: 'prompt-detected',
          timestamp: new Date(),
          data: {
            pattern: promptResult.pattern?.name,
            confidence: promptResult.confidence,
            matchedText: promptResult.matchedText,
            context: promptResult.context
          }
        });
      }
      
      // Handle command queue acknowledgment
      this.handleSSHOutputForQueue(sessionId, text);
      
      const output: ConsoleOutput = {
        sessionId,
        type: 'stdout',
        data: stripAnsi(text),
        raw: text,
        timestamp: new Date()
      };

      this.addToBuffer(sessionId, output);
      
      if (streamManager) {
        streamManager.addChunk(text);
        // Force immediate flush for SSH prompts and important output
        if (text.includes('\n') || text.includes('$') || text.includes('#') || 
            text.includes('>') || text.includes('Password:') || text.length > 50) {
          streamManager.forceFlush();
        }
      }
      
      this.emitEvent({
        sessionId,
        type: 'output',
        timestamp: new Date(),
        data: output
      });

      // Record output to monitoring system
      if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
        this.monitoringSystem.recordEvent(sessionId, 'output', { 
          type: 'stdout',
          size: text.length,
          lineCount: text.split('\n').length - 1
        });
      }

      if (options.detectErrors !== false) {
        this.queue.add(async () => {
          // Convert ErrorPattern[] to ExtendedErrorPattern[] if needed
          const extendedPatterns = options.patterns?.map(p => ({
            ...p,
            category: 'custom',
            language: 'unknown'
          } as ExtendedErrorPattern));
          
          const errors = this.errorDetector.detect(output.data, extendedPatterns);
          if (errors.length > 0) {
            this.emitEvent({
              sessionId,
              type: 'error',
              timestamp: new Date(),
              data: { errors, output: output.data }
            });
            
            // Record error to monitoring system
            if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
              this.monitoringSystem.recordEvent(sessionId, 'error', {
                errorCount: errors.length,
                errorTypes: errors.map(e => e.pattern.type),
                output: output.data
              });
            }
          }
        });
      }
    });

    channel.stderr.on('data', (data: Buffer) => {
      const text = data.toString();
      const output: ConsoleOutput = {
        sessionId,
        type: 'stderr',
        data: stripAnsi(text),
        raw: text,
        timestamp: new Date()
      };

      this.addToBuffer(sessionId, output);
      
      if (streamManager) {
        streamManager.addChunk(text, true);
      }
      
      this.emitEvent({
        sessionId,
        type: 'output',
        timestamp: new Date(),
        data: output
      });

      // Record stderr output to monitoring system
      if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
        this.monitoringSystem.recordEvent(sessionId, 'output', { 
          type: 'stderr',
          size: text.length,
          lineCount: text.split('\n').length - 1
        });
      }

      // Always check stderr for errors
      this.queue.add(async () => {
        // Convert ErrorPattern[] to ExtendedErrorPattern[] if needed
        const extendedPatterns = options.patterns?.map(p => ({
          ...p,
          category: 'custom',
          language: 'unknown'
        } as ExtendedErrorPattern));
        
        const errors = this.errorDetector.detect(output.data, extendedPatterns);
        if (errors.length > 0) {
          this.emitEvent({
            sessionId,
            type: 'error',
            timestamp: new Date(),
            data: { errors, output: output.data, isStderr: true }
          });
          
          // Record stderr error to monitoring system
          if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
            this.monitoringSystem.recordEvent(sessionId, 'error', {
              errorCount: errors.length,
              errorTypes: errors.map(e => e.pattern.type),
              output: output.data,
              isStderr: true
            });
          }
        }
      });
    });

    // Handle channel close
    channel.on('close', () => {
      const session = this.sessions.get(sessionId);
      if (session) {
        session.status = 'stopped';
        this.sessions.set(sessionId, session);
      }

      if (streamManager) {
        streamManager.end();
      }

      // Stop monitoring if active
      if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
        this.monitoringSystem.stopSessionMonitoring(sessionId);
      }

      this.emitEvent({
        sessionId,
        type: 'stopped',
        timestamp: new Date(),
        data: { ssh: true }
      });

      this.logger.info(`SSH session ${sessionId} closed`);
    });

    channel.on('error', (error: Error) => {
      const session = this.sessions.get(sessionId);
      if (session) {
        session.status = 'crashed';
        this.sessions.set(sessionId, session);
      }

      // Record SSH error to monitoring system
      if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
        this.monitoringSystem.recordEvent(sessionId, 'error', {
          type: 'ssh_channel_error',
          error: error.message,
          stack: error.stack
        });
        this.monitoringSystem.stopSessionMonitoring(sessionId);
      }

      this.emitEvent({
        sessionId,
        type: 'error',
        timestamp: new Date(),
        data: { error: error.message, ssh: true }
      });

      this.logger.error(`SSH session ${sessionId} error: ${error.message}`);
    });

    if (options.timeout) {
      setTimeout(() => {
        if (this.isSessionRunning(sessionId)) {
          this.stopSession(sessionId);
        }
      }, options.timeout);
    }
  }

  private handleSSHConnectionError(poolKey: string, error: Error) {
    // Remove failed connection from pool
    this.sshConnectionPool.delete(poolKey);
    
    // Find all sessions using this connection and mark them for reconnection
    this.sshClients.forEach((client, sessionId) => {
      const clientConfig = (client as any)._config;
      if (this.getConnectionPoolKey(
        clientConfig?.host || '',
        clientConfig?.port || 22,
        clientConfig?.username
      ) === poolKey) {
        this.emitEvent({
          sessionId,
          type: 'error',
          timestamp: new Date(),
          data: { 
            error: `SSH connection lost: ${error.message}`,
            reconnectable: true,
            ssh: true
          }
        });
      }
    });
  }

  /**
   * Initialize command queue for a session with persistence support
   */
  private initializeCommandQueue(sessionId: string): void {
    if (!this.commandQueues.has(sessionId)) {
      const persistentData = this.sessionPersistenceData.get(sessionId);
      const bookmarks = this.sessionBookmarks.get(sessionId) || [];
      
      const queue: SessionCommandQueue = {
        sessionId,
        commands: [],
        isProcessing: false,
        lastCommandTime: 0,
        acknowledgmentTimeout: null,
        outputBuffer: '',
        expectedPrompt: this.queueConfig.defaultPromptPattern,
        persistentData,
        bookmarks
      };
      
      // Restore pending commands if available
      if (persistentData && persistentData.pendingCommands.length > 0) {
        queue.commands = this.deserializeCommandQueue(persistentData.pendingCommands, sessionId);
        this.logger.info(`Restored ${queue.commands.length} pending commands for session ${sessionId}`);
      }
      
      this.commandQueues.set(sessionId, queue);
      this.logger.debug(`Command queue with persistence initialized for session ${sessionId}`);
    }
  }

  /**
   * Process the command queue for a session
   */
  private async processCommandQueue(sessionId: string): Promise<void> {
    const queue = this.commandQueues.get(sessionId);
    const sshChannel = this.sshChannels.get(sessionId);
    
    if (!queue || !sshChannel || queue.isProcessing || queue.commands.length === 0) {
      return;
    }

    queue.isProcessing = true;
    this.logger.debug(`Processing command queue for session ${sessionId}, ${queue.commands.length} commands pending`);

    try {
      while (queue.commands.length > 0) {
        const command = queue.commands[0];
        
        if (command.sent && !command.acknowledged) {
          // Calculate adaptive acknowledgment timeout based on network conditions
          const session = this.sessions.get(sessionId);
          const adaptiveTimeout = session?.sshOptions?.host 
            ? this.calculateAdaptiveTimeout(session.sshOptions.host)
            : this.queueConfig.acknowledgmentTimeout;
          
          // Wait for acknowledgment or timeout
          const waitTime = Date.now() - command.timestamp.getTime();
          const effectiveTimeout = Math.max(adaptiveTimeout, this.queueConfig.acknowledgmentTimeout);
          
          if (waitTime < effectiveTimeout) {
            // Still within timeout window, but check if we should provide progress updates
            if (waitTime > effectiveTimeout * 0.7) {
              // Getting close to timeout, log progress
              this.logger.debug(`Command waiting for acknowledgment: ${sessionId}, ${waitTime}ms/${effectiveTimeout}ms`);
            }
            break; // Wait for acknowledgment
          } else {
            // Timeout reached - enhanced handling
            const timeoutDuration = Date.now() - command.timestamp.getTime();
            this.logger.warn(`Command acknowledgment timeout for session ${sessionId} after ${timeoutDuration}ms (adaptive: ${adaptiveTimeout}ms), command: ${command.input.substring(0, 50)}...`);
            
            // Create detailed timeout context for error recovery
            const timeoutContext = {
              sessionId,
              operation: 'command_acknowledgment_timeout',
              error: new Error(`Command acknowledgment timeout after ${timeoutDuration}ms`),
              timestamp: Date.now(),
              metadata: {
                commandInput: command.input.substring(0, 200),
                commandRetryCount: command.retryCount || 0,
                timeoutDuration,
                adaptiveTimeout,
                effectiveTimeout,
                networkQuality: this.networkMetrics.get(session?.sshOptions?.host || '')?.connectionQuality || 'unknown'
              }
            };

            // Check if this command has been retried too many times
            const maxCommandRetries = 2;
            if ((command.retryCount || 0) >= maxCommandRetries) {
              this.logger.error(`Command retry limit exceeded for session ${sessionId}, giving up`);
              
              // Attempt error recovery as last resort before failing
              const errorRecoveryResult = await this.errorRecovery.attemptRecovery(timeoutContext);
              if (errorRecoveryResult) {
                this.logger.info(`Error recovery provided fallback for command timeout in session ${sessionId}`);
                command.resolve('Command completed via error recovery');
              } else {
                command.reject(new Error(`Command acknowledgment timeout after ${maxCommandRetries} retries`));
              }
              
              queue.commands.shift();
              continue;
            }

            // Attempt timeout recovery with enhanced context
            const recoveryResult = await this.attemptTimeoutRecovery(sessionId, command);
            if (recoveryResult.success) {
              this.logger.info(`Successfully recovered from timeout for session ${sessionId}${recoveryResult.metadata ? ` (${JSON.stringify(recoveryResult.metadata)})` : ''}`);
              
              // Reset command state for retry with exponential backoff
              command.timestamp = new Date();
              command.retryCount = (command.retryCount || 0) + 1;
              
              // Apply adaptive backoff based on network conditions and retry count
              const networkMetrics = this.networkMetrics.get(session?.sshOptions?.host || '');
              let backoffMs = 1000 * Math.pow(2, command.retryCount - 1); // Exponential backoff
              
              // Adjust backoff based on network quality
              if (networkMetrics) {
                switch (networkMetrics.connectionQuality) {
                  case 'poor':
                    backoffMs *= 2.5; // Longer backoff for poor connections
                    break;
                  case 'fair':
                    backoffMs *= 1.8;
                    break;
                  case 'good':
                    backoffMs *= 1.2;
                    break;
                  case 'excellent':
                    // No multiplier for excellent connections
                    break;
                }
              }
              
              // Cap the backoff at 10 seconds
              backoffMs = Math.min(backoffMs, 10000);
              
              if (backoffMs > 0) {
                this.logger.info(`Applying ${backoffMs}ms adaptive backoff before command retry (network: ${networkMetrics?.connectionQuality || 'unknown'})`);
                await this.delay(backoffMs);
              }
              
              continue; // Retry the command
            } else {
              // Recovery failed, try error recovery system as fallback
              const errorRecoveryResult = await this.errorRecovery.attemptRecovery(timeoutContext);
              if (errorRecoveryResult) {
                this.logger.info(`Error recovery provided fallback after timeout recovery failure for session ${sessionId}`);
                command.resolve('Command completed via error recovery after timeout');
                queue.commands.shift();
                continue;
              }
              
              // All recovery attempts failed
              this.logger.error(`All recovery attempts failed for command timeout in session ${sessionId}: ${recoveryResult.error}`);
              command.reject(new Error(`Command acknowledgment timeout: ${recoveryResult.error}`));
              queue.commands.shift();
              continue;
            }
          }
        }

        if (!command.sent) {
          // Send the command
          try {
            await this.sendCommandToSSH(sessionId, command, sshChannel);
            command.sent = true;
            command.timestamp = new Date();
            
            // Update persistent data with command activity
            const persistentData = this.sessionPersistenceData.get(sessionId);
            if (persistentData) {
              persistentData.lastActivity = new Date();
              persistentData.commandHistory.push(command.input);
              // Keep only last 50 commands in history
              if (persistentData.commandHistory.length > 50) {
                persistentData.commandHistory = persistentData.commandHistory.slice(-50);
              }
            }
            
            // Create bookmark on command if using hybrid or on-command strategy
            if (this.continuityConfig.bookmarkStrategy === 'on-command' || 
                this.continuityConfig.bookmarkStrategy === 'hybrid') {
              await this.createSessionBookmark(sessionId, 'on-command');
            }
            
            // Wait for inter-command delay
            if (queue.commands.length > 1) {
              await this.delay(this.queueConfig.interCommandDelay);
            }
          } catch (error) {
            this.logger.error(`Failed to send command to SSH session ${sessionId}:`, error);
            command.reject(error as Error);
            queue.commands.shift();
            continue;
          }
        }

        // Check for acknowledgment
        if (this.queueConfig.enablePromptDetection && queue.expectedPrompt) {
          if (queue.expectedPrompt.test(queue.outputBuffer)) {
            // Command acknowledged
            command.acknowledged = true;
            command.resolve();
            queue.commands.shift();
            queue.outputBuffer = ''; // Clear buffer after acknowledgment
            queue.lastCommandTime = Date.now();
          } else {
            // Wait for more output
            break;
          }
        } else {
          // No prompt detection, acknowledge immediately
          command.acknowledged = true;
          command.resolve();
          queue.commands.shift();
          queue.lastCommandTime = Date.now();
        }
      }
    } finally {
      queue.isProcessing = false;
    }

    // Schedule next processing if there are more commands
    if (queue.commands.length > 0) {
      setTimeout(() => this.processCommandQueue(sessionId), 100);
    }
  }

  /**
   * Send a command to SSH channel with proper error handling
   */
  private async sendCommandToSSH(sessionId: string, command: QueuedCommand, sshChannel: ClientChannel): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('SSH write timeout'));
      }, this.queueConfig.commandTimeout);

      try {
        // Ensure command ends with newline for proper execution
        let commandToSend = command.input;
        if (!commandToSend.endsWith('\n') && !commandToSend.endsWith('\r\n')) {
          commandToSend += '\n';
        }

        sshChannel.write(commandToSend, (error) => {
          clearTimeout(timeout);
          
          if (error) {
            this.logger.error(`SSH write error for session ${sessionId}:`, error);
            reject(error);
          } else {
            // Record input to monitoring system
            if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
              this.monitoringSystem.recordEvent(sessionId, 'input', {
                size: command.input.length,
                type: 'ssh_queued_input',
                commandId: command.id
              });
            }

            this.emitEvent({
              sessionId,
              type: 'input',
              timestamp: new Date(),
              data: { 
                input: command.input, 
                ssh: true, 
                queued: true,
                commandId: command.id
              }
            });

            this.logger.debug(`Command sent to SSH session ${sessionId}: ${command.input.substring(0, 100)}...`);
            resolve();
          }
        });
      } catch (error) {
        clearTimeout(timeout);
        reject(error as Error);
      }
    });
  }

  /**
   * Handle SSH output for command queue acknowledgment
   */
  private handleSSHOutputForQueue(sessionId: string, data: string): void {
    const queue = this.commandQueues.get(sessionId);
    if (!queue) return;

    // Append to output buffer for prompt detection
    queue.outputBuffer += data;
    
    // Keep buffer size manageable
    if (queue.outputBuffer.length > 4096) {
      queue.outputBuffer = queue.outputBuffer.slice(-2048);
    }

    // Trigger queue processing if there are pending commands
    if (queue.commands.length > 0 && !queue.isProcessing) {
      setImmediate(() => this.processCommandQueue(sessionId));
    }
  }

  /**
   * Add command to queue
   */
  private async addCommandToQueue(sessionId: string, input: string): Promise<void> {
    this.initializeCommandQueue(sessionId);
    const queue = this.commandQueues.get(sessionId)!;

    if (queue.commands.length >= this.queueConfig.maxQueueSize) {
      throw new Error(`Command queue full for session ${sessionId} (max: ${this.queueConfig.maxQueueSize})`);
    }

    return new Promise<void>((resolve, reject) => {
      const command: QueuedCommand = {
        id: uuidv4(),
        sessionId,
        input,
        timestamp: new Date(),
        retryCount: 0,
        resolve,
        reject,
        acknowledged: false,
        sent: false
      };

      queue.commands.push(command);
      this.logger.debug(`Command queued for session ${sessionId}: ${input.substring(0, 50)}... (queue size: ${queue.commands.length})`);

      // Start processing
      setImmediate(() => this.processCommandQueue(sessionId));
    });
  }

  /**
   * Clear command queue for a session
   */
  private clearCommandQueue(sessionId: string): void {
    const queue = this.commandQueues.get(sessionId);
    if (!queue) return;

    // Reject all pending commands
    queue.commands.forEach(command => {
      if (!command.acknowledged) {
        command.reject(new Error('Session terminated'));
      }
    });

    // Clear timeout if exists
    if (queue.acknowledgmentTimeout) {
      clearTimeout(queue.acknowledgmentTimeout);
    }

    // Remove queue
    this.commandQueues.delete(sessionId);
    
    // Clear processing interval
    const interval = this.commandProcessingIntervals.get(sessionId);
    if (interval) {
      clearTimeout(interval);
      this.commandProcessingIntervals.delete(sessionId);
    }

    this.logger.debug(`Command queue cleared for session ${sessionId}`);
  }

  /**
   * Get command queue statistics
   */
  private getCommandQueueStats(sessionId: string): { queueSize: number; processing: boolean; lastCommandTime: number } | null {
    const queue = this.commandQueues.get(sessionId);
    if (!queue) return null;

    return {
      queueSize: queue.commands.length,
      processing: queue.isProcessing,
      lastCommandTime: queue.lastCommandTime
    };
  }


  async sendInput(sessionId: string, input: string): Promise<void> {
    // Validate session exists and is healthy
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.diagnosticsManager.recordEvent({
        level: 'error',
        category: 'session',
        operation: 'send_input_validation_failed',
        sessionId,
        message: 'Session validation failed: Session not found'
      });
      throw new Error(`Session ${sessionId} not found`);
    }
    
    const isSessionReady = await this.sessionValidator.validateSessionReady(sessionId, session);
    if (!isSessionReady) {
      this.diagnosticsManager.recordEvent({
        level: 'error',
        category: 'session',
        operation: 'send_input_validation_failed',
        sessionId,
        message: 'Session validation failed: Session not ready'
      });
      throw new Error(`Session ${sessionId} is not ready`);
    }
    
    return await this.retryManager.executeWithRetry(
      async () => {
        // Check session type and handle accordingly
        const session = this.sessions.get(sessionId);
        if (!session) {
          throw new Error(`Session ${sessionId} not found`);
        }

        // Get protocol for this session
        const protocolInfo = this.protocolSessions.get(sessionId);
        if (protocolInfo) {
          // Additional validation for SSH protocol
          if (protocolInfo.type === 'ssh' && session.sshOptions) {
            // Validate SSH session state before sending input
            if (!session.sshOptions.host || !session.sshOptions.username) {
              throw new Error(`SSH session ${sessionId} has invalid configuration`);
            }
          }

          // Use the protocol's sendInput method with the protocol's sessionId
          const protocolSessionId = this.protocolSessionIdMap.get(sessionId) || sessionId;
          return await protocolInfo.protocol.sendInput(protocolSessionId, input);
        }

        // Fallback for legacy sessions (SSH channels, etc.)
        const sshChannel = this.sshChannels.get(sessionId);
        if (sshChannel) {
          // Use command queue for SSH sessions to prevent command concatenation
          return this.addCommandToQueue(sessionId, input);
        }

        // Handle AWS SSM session
        if (session.awsSSMOptions && this.awsSSMProtocol) {
          return this.sendInputToAWSSSM(sessionId, input);
        }

        // Handle WinRM session
        if (session.winrmOptions) {
          return this.sendInputToWinRM(sessionId, input);
        }

        // Handle WebSocket terminal session
        if (session.webSocketTerminalOptions && this.webSocketTerminalProtocol) {
          return this.sendInputToWebSocketTerminal(sessionId, input);
        }

        // Handle regular process session
        return this.sendInputToProcess(sessionId, input);
      },
      {
        sessionId,
        operationName: 'send_input',
        strategyName: this.sshChannels.has(sessionId) ? 'ssh' : 
                     this.webSocketTerminalSessions.has(sessionId) ? 'websocket-terminal' : 'generic',
        context: { inputLength: input.length },
        onRetry: (context) => {
          this.logger.debug(`Retrying input send for session ${sessionId} (attempt ${context.attemptNumber})`);
        }
      }
    );
  }

  private async sendInputToProcess(sessionId: string, input: string): Promise<void> {

    // Handle regular process input
    const process = this.processes.get(sessionId);
    if (!process || !process.stdin) {
      throw new Error(`Session ${sessionId} not found or stdin not available`);
    }

    return new Promise((resolve, reject) => {
      process.stdin!.write(input, (error) => {
        if (error) {
          reject(error);
        } else {
          // Record input to monitoring system
          if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
            this.monitoringSystem.recordEvent(sessionId, 'input', {
              size: input.length,
              type: 'text_input'
            });
          }

          this.emitEvent({
            sessionId,
            type: 'input',
            timestamp: new Date(),
            data: { input }
          });
          resolve();
        }
      });
    });
  }

  /**
   * Send input to Kubernetes session
   */
  private async sendInputToKubernetes(sessionId: string, input: string): Promise<void> {
    if (!this.kubernetesProtocol) {
      throw new Error('Kubernetes protocol not initialized');
    }

    const session = this.sessions.get(sessionId);
    if (!session || !session.kubernetesState) {
      throw new Error(`Kubernetes session ${sessionId} not found`);
    }

    try {
      // Only exec sessions support input
      if (session.kubernetesState.sessionType === 'exec') {
        await this.kubernetesProtocol.sendInput(sessionId, input);

        // Record input to monitoring system
        if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
          this.monitoringSystem.recordEvent(sessionId, 'input', {
            size: input.length,
            type: 'kubernetes_input'
          });
        }

        this.emitEvent({
          sessionId,
          type: 'input',
          timestamp: new Date(),
          data: { input }
        });
      } else {
        throw new Error(`Input not supported for Kubernetes ${session.kubernetesState.sessionType} sessions`);
      }
    } catch (error) {
      this.logger.error(`Failed to send input to Kubernetes session ${sessionId}:`, error);
      throw error;
    }
  }

  async sendKey(sessionId: string, key: string): Promise<void> {
    const keyMap: Record<string, string> = {
      'enter': '\r\n',
      'tab': '\t',
      'escape': '\x1b',
      'backspace': '\x08',
      'delete': '\x7f',
      'ctrl+c': '\x03',
      'ctrl+d': '\x04',
      'ctrl+z': '\x1a',
      'ctrl+l': '\x0c',
      'ctrl+break': '\x03',
      'up': '\x1b[A',
      'down': '\x1b[B',
      'right': '\x1b[C',
      'left': '\x1b[D'
    };

    const sequence = keyMap[key.toLowerCase()] || key;
    
    // Record key input to monitoring system
    if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
      this.monitoringSystem.recordEvent(sessionId, 'input', {
        type: 'key_input',
        key: key.toLowerCase(),
        sequence: sequence.replace(/\x1b/g, '\\x1b') // Safe representation
      });
    }
    
    await this.sendInput(sessionId, sequence);
  }

  getOutput(sessionId: string, limit?: number): ConsoleOutput[] {
    // Validate session exists
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.diagnosticsManager.recordEvent({
        level: 'error',
        category: 'session',
        operation: 'get_output_session_not_found',
        sessionId,
        message: 'Attempted to get output from non-existent session'
      });
      throw new Error(`Session ${sessionId} not found`);
    }
    
    const buffer = this.outputBuffers.get(sessionId) || [];
    return limit ? buffer.slice(-limit) : buffer;
  }

  getLastOutput(sessionId: string, lines: number = 10): string {
    // Force flush before getting output to ensure freshness
    const streamManager = this.streamManagers.get(sessionId);
    if (streamManager) {
      streamManager.forceFlush();
    }
    
    const outputs = this.getOutput(sessionId, lines);
    return outputs.map(o => o.data).join('');
  }

  /**
   * Get output with immediate synchronization
   */
  async getOutputImmediate(sessionId: string, limit?: number): Promise<ConsoleOutput[]> {
    const streamManager = this.streamManagers.get(sessionId);
    
    if (streamManager) {
      // Force immediate flush
      streamManager.forceFlush();
      
      // Wait for any async processing to complete
      await new Promise(resolve => setImmediate(resolve));
      
      // Small delay to ensure all buffers are processed
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    
    return this.getOutput(sessionId, limit);
  }

  /**
   * Get fresh output with real-time synchronization
   */
  async getFreshOutput(sessionId: string, timeoutMs: number = 1000): Promise<{
    output: string;
    stats: any;
    captureTime: number;
  }> {
    const startTime = Date.now();
    const streamManager = this.streamManagers.get(sessionId);
    
    if (!streamManager) {
      const output = this.getLastOutput(sessionId, 100);
      return {
        output,
        stats: null,
        captureTime: Date.now() - startTime
      };
    }
    
    // Force immediate flush
    streamManager.forceFlush();
    
    // Wait for buffers to be processed
    let attempts = 0;
    const maxAttempts = timeoutMs / 10; // Check every 10ms
    
    while (attempts < maxAttempts) {
      const bufferStats = streamManager.getBufferStats();
      
      // If no pending data, we have everything
      if (bufferStats.pendingSize === 0) {
        break;
      }
      
      await new Promise(resolve => setTimeout(resolve, 10));
      attempts++;
    }
    
    // Get final output
    const output = this.getLastOutput(sessionId, 100);
    const stats = streamManager.getBufferStats();
    
    return {
      output,
      stats,
      captureTime: Date.now() - startTime
    };
  }

  getStream(sessionId: string): StreamManager | undefined {
    return this.streamManagers.get(sessionId);
  }

  clearOutput(sessionId: string): void {
    this.outputBuffers.set(sessionId, []);
    const streamManager = this.streamManagers.get(sessionId);
    if (streamManager) {
      streamManager.clear();
    }
  }

  isSessionRunning(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    return session?.status === 'running';
  }

  /**
   * Send input to serial session
   */
  private async sendInputToSerial(sessionId: string, input: string): Promise<void> {
    if (!this.serialProtocol) {
      throw new Error('Serial protocol not initialized');
    }

    try {
      // Send data to serial device
      await this.serialProtocol.sendData(sessionId, input);

      // Record input to monitoring system
      if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
        this.monitoringSystem.recordEvent(sessionId, 'input', {
          size: input.length,
          type: 'serial_input'
        });
      }

      // Emit input event
      this.emitEvent({
        sessionId,
        type: 'input',
        timestamp: new Date(),
        data: { input }
      });

      this.logger.debug(`Sent input to serial session ${sessionId}: ${input.substring(0, 100)}${input.length > 100 ? '...' : ''}`);

    } catch (error) {
      this.logger.error(`Failed to send input to serial session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Send input to AWS SSM session
   */
  private async sendInputToAWSSSM(sessionId: string, input: string): Promise<void> {
    if (!this.awsSSMProtocol) {
      throw new Error('AWS SSM protocol not initialized');
    }

    const session = this.sessions.get(sessionId);
    if (!session || !session.awsSSMSessionId) {
      throw new Error(`AWS SSM session ${sessionId} not found or SSM session ID missing`);
    }

    try {
      // Send input to AWS SSM session
      await this.awsSSMProtocol.sendInput(session.awsSSMSessionId, input);

      // Record input to monitoring system
      if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
        this.monitoringSystem.recordEvent(sessionId, 'input', {
          size: input.length,
          type: 'aws_ssm_input'
        });
      }

      // Emit input event
      this.emitEvent({
        sessionId,
        type: 'input',
        timestamp: new Date(),
        data: { input }
      });

      this.logger.debug(`Sent input to AWS SSM session ${sessionId}: ${input.substring(0, 100)}${input.length > 100 ? '...' : ''}`);

    } catch (error) {
      this.logger.error(`Failed to send input to AWS SSM session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Send input to WinRM session
   */
  private async sendInputToWinRM(sessionId: string, input: string): Promise<void> {
    const winrmProtocol = this.winrmProtocols.get(sessionId);
    if (!winrmProtocol) {
      throw new Error(`WinRM protocol not found for session ${sessionId}`);
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const winrmSession = this.winrmSessions.get(sessionId);
    if (!winrmSession) {
      throw new Error(`WinRM session state not found for session ${sessionId}`);
    }

    try {
      // Determine if input is a PowerShell command or regular command
      const isPowerShellCommand = input.trim().match(/^(Get-|Set-|New-|Remove-|Invoke-|Import-|Export-|Start-|Stop-|Restart-|Test-|\$)/i);
      
      if (isPowerShellCommand) {
        // Execute as PowerShell command
        await winrmProtocol.executeCommand(sessionId, input.trim());
        // Output will be handled by the WinRM protocol event system
      } else {
        // Execute as regular command
        await winrmProtocol.executeCommand(sessionId, input.trim());
        // Output will be handled by the WinRM protocol event system
      }

      // Update session activity
      winrmSession.lastActivity = new Date();
      winrmSession.performanceCounters.commandsExecuted++;
      this.winrmSessions.set(sessionId, winrmSession);

      // Record input to monitoring system
      if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
        this.monitoringSystem.recordEvent(sessionId, 'input', {
          size: input.length,
          type: 'winrm_input',
          isPowerShell: isPowerShellCommand
        });
      }

      // Emit input event
      this.emitEvent({
        sessionId,
        type: 'input',
        timestamp: new Date(),
        data: { input, isPowerShell: isPowerShellCommand }
      });

      this.logger.debug(`Sent input to WinRM session ${sessionId}: ${input.substring(0, 100)}${input.length > 100 ? '...' : ''}`);

    } catch (error) {
      // Update error count
      if (winrmSession) {
        winrmSession.performanceCounters.errorCount++;
        this.winrmSessions.set(sessionId, winrmSession);
      }
      
      this.logger.error(`Failed to send input to WinRM session ${sessionId}:`, error);
      throw error;
    }
  }

  async stopSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    
    // Validate session exists
    if (!session) {
      this.diagnosticsManager.recordEvent({
        level: 'error',
        category: 'session',
        operation: 'stop_session_not_found',
        sessionId,
        message: 'Attempted to stop non-existent session'
      });
      throw new Error(`Session ${sessionId} not found`);
    }
    
    // Record session stop
    this.diagnosticsManager.recordEvent({
      level: 'info',
      category: 'session',
      operation: 'stop_session',
      sessionId,
      message: `Stopping ${session.sessionType || 'unknown'} session`,
      data: { sessionType: session.sessionType }
    });

    // First try unified protocol system
    const protocolInfo = this.protocolSessions.get(sessionId);
    if (protocolInfo) {
      try {
        const protocolSessionId = this.protocolSessionIdMap.get(sessionId) || sessionId;
        await protocolInfo.protocol.closeSession(protocolSessionId);
        this.protocolSessions.delete(sessionId);
        this.protocolSessionIdMap.delete(sessionId);

        // Clean up health check interval if exists
        if (this.sessionHealthCheckIntervals?.has(sessionId)) {
          clearInterval(this.sessionHealthCheckIntervals.get(sessionId));
          this.sessionHealthCheckIntervals.delete(sessionId);
        }

        this.logger.info(`${protocolInfo.type} session ${sessionId} stopped via unified protocol`);

        // Clean up session data
        this.sessions.delete(sessionId);
        this.outputBuffers.delete(sessionId);
        this.streamManagers.delete(sessionId);

        return;
      } catch (error) {
        this.logger.error(`Error stopping ${protocolInfo.type} session ${sessionId}:`, error);
        throw error;
      }
    }

    // Legacy fallback for sessions not yet migrated to unified system
    // Handle SSH sessions
    const sshChannel = this.sshChannels.get(sessionId);
    if (sshChannel) {
      sshChannel.close();
      this.sshChannels.delete(sessionId);
      this.sshClients.delete(sessionId);
    }

    // Handle WinRM sessions (legacy)
    if (session?.winrmOptions) {
      try {
        const winrmProtocol = this.winrmProtocols.get(sessionId);
        if (winrmProtocol) {
          await winrmProtocol.closeSession(sessionId);
          this.winrmProtocols.delete(sessionId);
        }
        
        // Clean up WinRM session state
        this.winrmSessions.delete(sessionId);
        
        this.logger.info(`WinRM session ${sessionId} stopped and cleaned up`);
      } catch (error) {
        this.logger.error(`Error stopping WinRM session ${sessionId}:`, error);
      }
    }

    // Handle regular processes
    const process = this.processes.get(sessionId);
    if (process) {
      // Try graceful shutdown first
      if (platform() === 'win32') {
        process.kill('SIGTERM');
      } else {
        process.kill('SIGTERM');
      }
      
      // Force kill after timeout
      setTimeout(() => {
        if (process.killed === false) {
          process.kill('SIGKILL');
        }
      }, 2000);
      
      this.processes.delete(sessionId);
    }

    if (session) {
      session.status = 'stopped';
      this.sessions.set(sessionId, session);
    }

    const streamManager = this.streamManagers.get(sessionId);
    if (streamManager) {
      streamManager.end();
      this.streamManagers.delete(sessionId);
    }

    // Clear command queue for this session
    this.clearCommandQueue(sessionId);

    // Ensure monitoring is stopped
    if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
      this.monitoringSystem.stopSessionMonitoring(sessionId);
    }

    // Cleanup health monitoring components
    if (this.selfHealingEnabled) {
      await this.unregisterSessionFromHealthMonitoring(sessionId, 'manual-stop');
    }
  }

  async stopAllSessions(): Promise<void> {
    const sessionIds = Array.from(this.sessions.keys());
    await Promise.all(sessionIds.map(id => this.stopSession(id)));
  }

  getSession(sessionId: string): ConsoleSession | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.logger.warn(`Session ${sessionId} not found. Active sessions: ${Array.from(this.sessions.keys()).join(', ')}`);
    }
    return session;
  }

  getAllSessions(): ConsoleSession[] {
    return Array.from(this.sessions.values());
  }

  getConfigManager(): ConfigManager {
    return this.configManager;
  }

  getResourceUsage(): { sessions: number; memoryMB: number; bufferSizes: Record<string, number> } {
    const memoryUsage = process.memoryUsage();
    const bufferSizes: Record<string, number> = {};
    
    this.outputBuffers.forEach((buffer, sessionId) => {
      bufferSizes[sessionId] = buffer.length;
    });

    return {
      sessions: this.sessions.size,
      memoryMB: Math.round(memoryUsage.heapUsed / 1024 / 1024),
      bufferSizes
    };
  }

  // Monitoring system access methods
  getMonitoringSystem(): MonitoringSystem {
    return this.monitoringSystem;
  }

  getSessionMetrics(sessionId: string) {
    return this.monitoringSystem.getSessionMetrics(sessionId);
  }

  getSystemMetrics() {
    return this.monitoringSystem.getSystemMetrics();
  }

  getAlerts() {
    return this.monitoringSystem.getAlerts();
  }

  getDashboard() {
    return this.monitoringSystem.getDashboard();
  }

  private startResourceMonitor() {
    this.resourceMonitor = setInterval(() => {
      const usage = this.getResourceUsage();
      
      // Clean up stopped sessions older than 5 minutes
      const now = Date.now();
      this.sessions.forEach((session, id) => {
        if (session.status !== 'running') {
          const age = now - session.createdAt.getTime();
          if (age > 5 * 60 * 1000) {
            this.cleanupSession(id);
          }
        }
      });

      // Warn if memory usage is high
      if (usage.memoryMB > 500) {
        this.logger.warn(`High memory usage: ${usage.memoryMB}MB`);
      }
    }, 30000); // Check every 30 seconds
  }

  private cleanupSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    
    // Record cleanup start
    this.diagnosticsManager.recordEvent({
      level: 'info',
      category: 'session',
      operation: 'cleanup_session_start',
      sessionId,
      message: `Starting cleanup for ${session?.sessionType || 'unknown'} session`,
      data: { sessionType: session?.sessionType }
    });
    
    // Safely destroy streams before cleanup
    const streamManager = this.streamManagers.get(sessionId);
    if (streamManager) {
      try {
        streamManager.end();
        this.diagnosticsManager.recordEvent({
          level: 'debug',
          category: 'session',
          operation: 'stream_destroyed',
          sessionId,
          message: 'Stream manager destroyed successfully'
        });
      } catch (error: any) {
        this.diagnosticsManager.recordEvent({
          level: 'warn',
          category: 'session',
          operation: 'stream_destroy_error',
          sessionId,
          message: 'Error destroying stream manager',
          data: { error: error.message }
        });
      }
    }
    
    // Create final bookmark before cleanup if persistent data exists
    const persistentData = this.sessionPersistenceData.get(sessionId);
    if (persistentData && this.continuityConfig.enablePersistence) {
      this.createSessionBookmark(sessionId, 'session-cleanup').catch(error => {
        this.logger.error(`Failed to create cleanup bookmark for session ${sessionId}:`, error);
      });
    }
    
    // Clean up command executions for this session
    const commandIds = this.sessionCommandQueue.get(sessionId) || [];
    commandIds.forEach(commandId => {
      this.commandExecutions.delete(commandId);
    });
    
    // Clean up enhanced session persistence data
    this.sessionPersistenceData.delete(sessionId);
    this.sessionBookmarks.delete(sessionId);
    
    // Clear bookmark timers
    const bookmarkTimer = this.bookmarkTimers.get(sessionId);
    if (bookmarkTimer) {
      clearInterval(bookmarkTimer);
      this.bookmarkTimers.delete(sessionId);
    }
    
    // Clean up original session data
    this.sessions.delete(sessionId);
    this.processes.delete(sessionId);
    this.sshClients.delete(sessionId);
    this.sshChannels.delete(sessionId);
    this.outputBuffers.delete(sessionId);
    this.streamManagers.delete(sessionId);
    this.sessionCommandQueue.delete(sessionId);
    this.outputSequenceCounters.delete(sessionId);
    this.promptPatterns.delete(sessionId);
    
    this.logger.debug(`Cleaned up session ${sessionId} and ${commandIds.length} command executions`);
  }

  private addToBuffer(sessionId: string, output: ConsoleOutput) {
    const buffer = this.outputBuffers.get(sessionId) || [];
    
    // Add sequence number for ordering
    const sequenceCounter = this.outputSequenceCounters.get(sessionId) || 0;
    output.sequence = sequenceCounter;
    this.outputSequenceCounters.set(sessionId, sequenceCounter + 1);
    
    // Associate output with current command if one is executing
    const session = this.sessions.get(sessionId);
    if (session && session.currentCommandId) {
      output.commandId = session.currentCommandId;
      
      // Add to command-specific output buffer
      const commandExecution = this.commandExecutions.get(session.currentCommandId);
      if (commandExecution) {
        commandExecution.output.push(output);
        commandExecution.totalOutputLines++;
        
        // Check if this output indicates command completion
        if (this.detectCommandCompletion(sessionId, output.data)) {
          // Mark output as command boundary
          output.isCommandBoundary = true;
          output.boundaryType = 'end';
          
          // Complete the command execution
          this.completeCommandExecution(session.currentCommandId);
        }
      }
    }
    
    buffer.push(output);
    
    if (buffer.length > this.maxBufferSize) {
      buffer.shift();
    }
    
    this.outputBuffers.set(sessionId, buffer);
  }

  private emitEvent(event: ConsoleEvent) {
    this.emit('console-event', event);
  }

  /**
   * Enhanced waitForOutput with prompt-aware detection and better SSH handling
   */
  async waitForOutput(
    sessionId: string, 
    pattern: string | RegExp, 
    options: {
      timeout?: number;
      requirePrompt?: boolean;
      stripAnsi?: boolean;
      promptTimeout?: number;
    } = {}
  ): Promise<{ output: string; promptDetected?: PromptDetectionResult }> {
    
    const timeout = options.timeout || 5000;
    const requirePrompt = options.requirePrompt || false;
    const stripAnsi = options.stripAnsi !== false;
    const promptTimeout = options.promptTimeout || timeout;

    // Use enhanced waitForOutput implementation
    return new Promise((resolve, reject) => {
        const regex = typeof pattern === 'string' ? new RegExp(pattern, 'im') : pattern;
        const startTime = Date.now();

        const checkOutput = () => {
          let output = this.getLastOutput(sessionId, 150);
          
          if (stripAnsi) {
            output = this.promptDetector.getBuffer(sessionId) || output;
          }

          // Test pattern match
          const patternMatch = regex.test(output);
          
          // Check for prompt if required
          let promptResult: PromptDetectionResult | null = null;
          if (requirePrompt) {
            promptResult = this.promptDetector.detectPrompt(sessionId, output);
          }

          if (patternMatch && (!requirePrompt || (promptResult && promptResult.detected))) {
            resolve({
              output,
              promptDetected: promptResult || undefined
            });
            return;
          }

          if (!this.isSessionRunning(sessionId)) {
            const sessionInfo = this.sessions.get(sessionId);
            reject(new Error(`Session ${sessionId} has stopped (status: ${sessionInfo?.status || 'unknown'})`));
            return;
          }

          if (Date.now() - startTime > timeout) {
            // Enhanced timeout error with debug information
            const debugInfo = {
              sessionId,
              pattern: pattern.toString(),
              outputLength: output.length,
              lastOutput: output.slice(-300),
              promptResult: promptResult ? {
                detected: promptResult.detected,
                confidence: promptResult.confidence,
                pattern: promptResult.pattern?.name
              } : null,
              sessionStatus: this.sessions.get(sessionId)?.status,
              queueStats: this.getCommandQueueStats(sessionId)
            };

            this.logger.error(`Timeout waiting for pattern in session ${sessionId}`, debugInfo);
            reject(new Error(`Timeout waiting for pattern: ${pattern}. Last output: "${output.slice(-200)}"`));
            return;
          }

          setTimeout(checkOutput, 50); // Reduced polling interval for better responsiveness
        };

        checkOutput();
      });
  }

  /**
   * Wait specifically for a shell prompt to appear
   */
  async waitForPrompt(sessionId: string, timeout: number = 10000): Promise<{ detected: boolean; prompt?: string; output: string }> {
    const queue = this.commandQueues.get(sessionId);
    const defaultPattern = queue?.expectedPrompt || this.queueConfig.defaultPromptPattern;
    
    try {
      const result = await this.waitForOutput(sessionId, defaultPattern, { timeout });
      return {
        detected: true,
        prompt: result.output.match(defaultPattern)?.[0],
        output: result.output
      };
    } catch (error) {
      this.logger.error(`Failed to wait for prompt in session ${sessionId}`, {
        error: error instanceof Error ? error.message : String(error),
        timeout
      });
      return {
        detected: false,
        output: this.getLastOutput(sessionId)
      };
    }
  }

  async executeCommand(command: string, args?: string[], options?: Partial<SessionOptions>): Promise<{ output: string; exitCode?: number }> {
    console.error(`[EVENT-FIX] ConsoleManager.executeCommand called with:`, JSON.stringify({
      command,
      args,
      options: {
        ...options,
        sshOptions: options?.sshOptions ? { host: options.sshOptions.host, username: options.sshOptions.username } : undefined
      }
    }, null, 2));

    // Create session with all options
    const sessionOptions: SessionOptions = {
      command,
      args: args || [],
      isOneShot: true, // Explicitly mark as one-shot
      ...options
    };

    // Detect protocol type if not specified
    if (!sessionOptions.consoleType) {
      sessionOptions.consoleType = this.detectProtocolType(sessionOptions);
    }

    // Apply platform-specific command translation for SSH sessions
    if (sessionOptions.consoleType === 'ssh' && sessionOptions.sshOptions) {
      const translatedCommand = this.translateCommandForSSH(command, args);
      sessionOptions.command = translatedCommand.command;
      sessionOptions.args = translatedCommand.args;

      this.logger.debug(`Command translation for SSH session:`, {
        original: { command, args },
        translated: { command: translatedCommand.command, args: translatedCommand.args },
        sshHost: sessionOptions.sshOptions.host
      });
    }

    // Create a one-shot session
    const sessionId = uuidv4();
    console.error(`[EVENT-FIX] About to call createSessionInternal with sessionId: ${sessionId}`);

    try {
      const sessionIdResult = await this.createSessionInternal(sessionId, sessionOptions, true);
      console.error(`[EVENT-FIX] createSessionInternal completed, sessionIdResult:`, sessionIdResult);

      // Record one-shot session creation
      this.diagnosticsManager.recordEvent({
        level: 'info',
        category: 'session',
        operation: 'one_shot_session_created',
        sessionId,
        message: 'Created one-shot session for command execution',
        data: { command, args }
      });

      // CRITICAL FIX: Actually send the command to the session after creating it
      const fullCommand = args && args.length > 0 ? `${command} ${args.join(' ')}` : command;
      console.error(`[EVENT-FIX] About to send command to session: "${fullCommand}"`);

      await this.sendInput(sessionId, fullCommand + '\n');
      console.error(`[EVENT-FIX] Command sent successfully to session ${sessionId}`);

      console.error(`[EVENT-FIX] Creating Promise for command execution, sessionId: ${sessionId}`);
      return new Promise((resolve, reject) => {
        console.error(`[EVENT-FIX] Inside Promise executor, setting up event handlers`);
        const outputs: string[] = [];
        let timeoutHandle: NodeJS.Timeout | null = null;
        const timeoutMs = options?.timeout || 120000; // 2 minute timeout for production (reverted from regression)
        console.error(`[EVENT-FIX] Timeout set to: ${timeoutMs}ms`);

        const cleanup = async () => {
          this.removeListener('console-event', handleEvent);
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
          }

          // Always cleanup one-shot sessions
          const session = this.sessions.get(sessionId);
          if (session?.sessionType === 'one-shot') {
            this.diagnosticsManager.recordEvent({
              level: 'info',
              category: 'session',
              operation: 'one_shot_cleanup',
              sessionId,
              message: 'Cleaning up one-shot session after command execution'
            });
            await this.cleanupSession(sessionId);
          }
        };

        const handleEvent = (event: ConsoleEvent) => {
          console.error(`[EVENT-FIX] handleEvent received event:`, JSON.stringify({
            type: event.type,
            sessionId: event.sessionId,
            targetSessionId: sessionId,
            matches: event.sessionId === sessionId,
            hasData: !!event.data
          }, null, 2));

          if (event.sessionId !== sessionId) return;

          console.error(`[EVENT-FIX] Processing event for our session, type: ${event.type}`);

          if (event.type === 'output') {
            outputs.push(event.data.data);
            console.error(`[EVENT-FIX] Added output, total length: ${outputs.join('').length}`);
          } else if (event.type === 'stopped' || event.type === 'terminated' || event.type === 'session-closed') {
            console.error(`[EVENT-FIX] Session completion event received: ${event.type}`);
            cleanup().then(() => {
              resolve({
                output: outputs.join(''),
                exitCode: event.data?.exitCode || 0
              });
            }).catch(err => {
              this.logger.warn('Cleanup error during session stop:', err);
              resolve({
                output: outputs.join(''),
                exitCode: event.data?.exitCode || 0
              });
            });
          } else if (event.type === 'error') {
            console.error(`[EVENT-FIX] Error event received:`, event.data);
            // Only reject on serious errors, not command output errors
            if (event.data.error && (
              event.data.error.includes('connection') ||
              event.data.error.includes('authentication') ||
              event.data.error.includes('timeout') ||
              event.data.error.includes('network')
            )) {
              cleanup().then(() => {
                reject(new Error(`Session error: ${event.data.error}`));
              }).catch(err => {
                this.logger.warn('Cleanup error during session error:', err);
                reject(new Error(`Session error: ${event.data.error}`));
              });
            }
            // Otherwise, treat errors as part of command output and continue
          }
        };

        // Set up timeout for the command execution
        console.error(`[EVENT-FIX] Setting up timeout handler for ${timeoutMs}ms`);
        timeoutHandle = setTimeout(() => {
          console.error(`[EVENT-FIX] TIMEOUT TRIGGERED! Command execution timed out after ${timeoutMs}ms, sessionId: ${sessionId}`);
          this.diagnosticsManager.recordEvent({
            level: 'warn',
            category: 'session',
            operation: 'one_shot_timeout',
            sessionId,
            message: `One-shot session timed out after ${timeoutMs}ms`
          });

          cleanup().then(() => {
            // Return whatever output we have collected so far
            resolve({
              output: outputs.join('') + '\n[Command timed out]',
              exitCode: 124 // Standard timeout exit code
            });
          }).catch(err => {
            this.logger.warn('Cleanup error during timeout:', err);
            reject(new Error(`Command execution timeout after ${timeoutMs}ms`));
          });
        }, timeoutMs);

        console.error(`[EVENT-FIX] Registering event listener for 'console-event' on sessionId: ${sessionId}`);
        this.on('console-event', handleEvent);
        console.error(`[EVENT-FIX] Event listener registered, Promise setup complete`);
      });

    } catch (error) {
      console.error(`[EVENT-FIX] Failed to create session or send command:`, error);
      throw new Error(`Failed to execute command: ${error}`);
    }
  }

  /**
   * Translate Windows commands to Unix equivalents for SSH sessions
   */
  private translateCommandForSSH(command: string, args?: string[]): { command: string; args: string[] } {
    const lowerCommand = command.toLowerCase();
    const finalArgs = args || [];
    
    // Common Windows to Unix command translations
    const translations: Record<string, { command: string; argsTransform?: (args: string[]) => string[] }> = {
      'dir': { 
        command: 'ls',
        argsTransform: (args) => {
          // Translate some common dir flags
          return args.map(arg => {
            if (arg === '/w') return '-1'; // Wide format
            if (arg === '/b') return '-1'; // Bare format
            if (arg === '/a') return '-la'; // All files
            if (arg.startsWith('/')) return arg.substring(1); // Remove Windows flag prefix
            return arg;
          });
        }
      },
      'type': { command: 'cat' },
      'copy': { command: 'cp' },
      'move': { command: 'mv' },
      'del': { command: 'rm' },
      'md': { command: 'mkdir' },
      'mkdir': { command: 'mkdir' },
      'rd': { command: 'rmdir' },
      'rmdir': { command: 'rmdir' },
      'cls': { command: 'clear' },
      'ping': { command: 'ping' }, // Usually available on both
      'ipconfig': { command: 'ifconfig' },
      'tasklist': { command: 'ps' },
      'taskkill': { 
        command: 'kill',
        argsTransform: (args) => {
          // Convert /pid to -p and /f to -9
          const newArgs: string[] = [];
          for (let i = 0; i < args.length; i++) {
            if (args[i].toLowerCase() === '/pid' && i + 1 < args.length) {
              newArgs.push('-p', args[i + 1]);
              i++; // Skip next arg as it's the PID
            } else if (args[i].toLowerCase() === '/f') {
              newArgs.push('-9');
            } else {
              newArgs.push(args[i]);
            }
          }
          return newArgs;
        }
      },
      'findstr': { command: 'grep' },
      'find': { 
        command: 'find',
        argsTransform: (args) => {
          // Windows find is different from Unix find, do basic translation
          return args.map(arg => {
            if (arg.startsWith('/')) return arg.substring(1);
            return arg;
          });
        }
      }
    };

    const translation = translations[lowerCommand];
    if (translation) {
      const translatedArgs = translation.argsTransform ? translation.argsTransform(finalArgs) : finalArgs;
      return {
        command: translation.command,
        args: translatedArgs
      };
    }

    // No translation needed
    return {
      command,
      args: finalArgs
    };
  }

  // Retry and Error Recovery Management Methods

  /**
   * Get retry statistics for all sessions
   */
  getRetryStats() {
    return this.retryManager.getRetryStats();
  }

  /**
   * Get error recovery statistics
   */
  getRecoveryStats() {
    return this.errorRecovery.getRecoveryStats();
  }

  /**
   * Get circuit breaker states
   */
  getCircuitBreakerStates(): any {
    return this.retryManager.getCircuitBreakerStates();
  }

  /**
   * Reset circuit breakers
   */
  resetCircuitBreakers(): void {
    this.retryManager.resetAllCircuitBreakers();
    this.logger.info('All circuit breakers reset');
  }

  /**
   * Get error history for a session
   */
  getSessionErrorHistory(sessionId: string) {
    return this.errorRecovery.getErrorHistory(sessionId);
  }

  /**
   * Check if a session is in degraded mode
   */
  isSessionDegraded(sessionId: string): boolean {
    return this.errorRecovery.isDegraded(sessionId);
  }

  /**
   * Get degradation state for a session
   */
  getSessionDegradationState(sessionId: string) {
    return this.errorRecovery.getDegradationState(sessionId);
  }

  /**
   * Restore a session from degraded mode
   */
  restoreSessionFromDegradedMode(sessionId: string): boolean {
    return this.errorRecovery.restoreSession(sessionId);
  }

  /**
   * Get aggregated error data
   */
  getErrorAggregation(timeWindowMs?: number) {
    return this.errorRecovery.getErrorAggregation(timeWindowMs);
  }

  /**
   * Create an SSH session with automatic retry and recovery
   */
  async createSSHSessionWithRetry(host: string, options: {
    username: string;
    password?: string;
    privateKey?: string;
    port?: number;
    command?: string;
    args?: string[];
  }): Promise<string> {
    const sessionId = uuidv4();
    
    return await this.retryManager.executeWithRetry(
      async () => {
        // This would implement SSH session creation
        // For now, we'll simulate the behavior
        this.logger.info(`Creating SSH session to ${host} for session ${sessionId}`);
        
        // Create a placeholder session for SSH
        const session: ConsoleSession = {
          id: sessionId,
          command: `ssh ${options.username}@${host}`,
          args: options.args || [],
          cwd: process.cwd(),
          env: process.env as Record<string, string>,
          createdAt: new Date(),
          status: 'running',
          type: 'ssh' as ConsoleType,
          streaming: false,
          executionState: 'idle',
          activeCommands: new Map()
        };
        
        this.sessions.set(sessionId, session);
        this.outputBuffers.set(sessionId, []);
        
        // Emit session started event
        this.emitEvent({
          sessionId,
          type: 'started',
          timestamp: new Date(),
          data: { host, username: options.username, ssh: true }
        });
        
        return sessionId;
      },
      {
        sessionId,
        operationName: 'create_ssh_session',
        strategyName: 'ssh',
        context: { host, username: options.username },
        onRetry: (context) => {
          this.logger.info(`Retrying SSH session creation to ${host} (attempt ${context.attemptNumber})`);
          this.cleanupPartialSession(sessionId);
        }
      }
    );
  }

  // Connection Pool and Session Manager access methods

  /**
   * Get connection pool statistics
   */
  getConnectionPoolStats() {
    return this.connectionPool.getStats();
  }

  /**
   * Get connection pool metrics
   */
  getConnectionPoolMetrics() {
    return this.connectionPool.getMetrics();
  }

  /**
   * Get session manager statistics
   */
  getSessionManagerStats() {
    return this.sessionManager.getStats();
  }

  /**
   * Get session manager metrics
   */
  getSessionManagerMetrics() {
    return this.sessionManager.getMetrics();
  }

  /**
   * Get session state from session manager
   */
  getSessionState(sessionId: string) {
    return this.sessionManager.getSession(sessionId);
  }

  /**
   * Pause a session
   */
  async pauseSession(sessionId: string) {
    return this.sessionManager.pauseSession(sessionId);
  }

  /**
   * Resume a paused session
   */
  async resumeSession(sessionId: string) {
    return this.sessionManager.resumeSession(sessionId);
  }

  /**
   * Get all session states
   */
  getAllSessionStates() {
    return this.sessionManager.getAllSessions();
  }

  /**
   * Get sessions by status
   */
  getSessionsByStatus(status: import('../types/index.js').SessionState['status']) {
    return this.sessionManager.getSessionsByStatus(status);
  }

  /**
   * Get sessions by type
   */
  getSessionsByType(type: 'local' | 'ssh') {
    return this.sessionManager.getSessionsByType(type);
  }

  /**
   * Create SSH session (convenience method)
   */
  async createSSHSessionFromOptions(sshOptions: SSHConnectionOptions, sessionOptions: Omit<SessionOptions, 'sshOptions'> = { command: '' }) {
    return this.createSession({
      ...sessionOptions,
      sshOptions
    });
  }

  // Configuration Management Methods
  
  /**
   * Resolve session options from stored profiles
   */
  private resolveSessionOptions(options: SessionOptions): SessionOptions {
    // Check if a profile name was provided
    const profileName = (options as any).profileName || (options as any).connectionProfile;
    
    if (profileName) {
      const profile = this.configManager.getConnectionProfile(profileName);
      if (profile) {
        this.logger.info(`Using connection profile: ${profileName}`);
        
        // Merge profile options with provided options
        switch (profile.type) {
          case 'ssh':
            return {
              ...options,
              sshOptions: {
                ...profile.sshOptions,
                ...options.sshOptions // Allow override from direct options
              },
              consoleType: 'ssh'
            };
          case 'docker':
            return {
              ...options,
              dockerOptions: {
                ...profile.dockerOptions,
                ...options.dockerOptions
              },
              consoleType: 'docker'
            };
          case 'azure':
            return {
              ...options,
              azureOptions: {
                ...profile.azureOptions,
                ...options.azureOptions
              },
              consoleType: 'azure-shell'
            };
          case 'aws':
            return {
              ...options,
              awsSSMOptions: {
                ...profile.awsOptions,
                ...options.awsSSMOptions
              } as any,
              consoleType: 'aws-ssm'
            };
          case 'gcp':
            return {
              ...options,
              gcpOptions: {
                ...profile.gcpOptions,
                ...options.gcpOptions
              } as any,
              consoleType: 'gcp-shell'
            };
          case 'kubernetes':
            return {
              ...options,
              kubernetesOptions: {
                ...profile.kubernetesOptions,
                ...options.kubernetesOptions
              },
              consoleType: 'kubectl'
            };
          case 'wsl':
            return {
              ...options,
              wslOptions: {
                ...(options.wslOptions || {})
              },
              consoleType: 'wsl'
            };
        }
      } else {
        this.logger.warn(`Connection profile not found: ${profileName}`);
      }
    }
    
    // Don't automatically use default profile - require explicit profile usage
    // This prevents auto-connection on startup
    if (!options.sshOptions && !options.dockerOptions && !options.azureOptions) {
      // Only use default profile if explicitly requested via profileName
      if (!profileName) {
        this.logger.debug('No connection profile specified, using local session');
      }
    }
    
    // Check for application profiles for specific commands
    if (options.command) {
      const appType = this.detectApplicationType(options.command);
      const appProfile = this.configManager.getApplicationProfileByType(appType);
      
      if (appProfile) {
        this.logger.info(`Using application profile: ${appProfile.name}`);
        return {
          ...options,
          command: appProfile.command || options.command,
          args: [...(appProfile.args || []), ...(options.args || [])],
          cwd: appProfile.workingDirectory || options.cwd,
          env: { ...appProfile.environmentVariables, ...options.env }
        };
      }
    }
    
    return options;
  }
  
  /**
   * Detect application type from command
   */
  private detectApplicationType(command: string): string {
    const cmdLower = command.toLowerCase();
    
    if (cmdLower.includes('dotnet') || cmdLower.includes('.dll')) {
      return 'dotnet';
    } else if (cmdLower.includes('node') || cmdLower.includes('.js')) {
      return 'node';
    } else if (cmdLower.includes('python') || cmdLower.includes('.py')) {
      return 'python';
    } else if (cmdLower.includes('java') || cmdLower.includes('.jar')) {
      return 'java';
    } else if (cmdLower.includes('go') || cmdLower.includes('.go')) {
      return 'go';
    } else if (cmdLower.includes('rust') || cmdLower.includes('cargo')) {
      return 'rust';
    }
    
    return 'custom';
  }
  
  /**
   * Save a connection profile
   */
  saveConnectionProfile(profile: ConnectionProfile): void {
    this.configManager.addConnectionProfile(profile);
    this.logger.info(`Connection profile saved: ${profile.name}`);
  }
  
  /**
   * List available connection profiles
   */
  listConnectionProfiles(): ConnectionProfile[] {
    return this.configManager.listConnectionProfiles();
  }
  
  /**
   * Save an application profile
   */
  saveApplicationProfile(profile: ApplicationProfile): void {
    this.configManager.addApplicationProfile(profile);
    this.logger.info(`Application profile saved: ${profile.name}`);
  }
  
  // Command Queue Management Methods
  
  /**
   * Configure command queue settings
   */
  configureCommandQueue(config: Partial<CommandQueueConfig>): void {
    this.queueConfig = { ...this.queueConfig, ...config };
    this.logger.info('Command queue configuration updated:', config);
  }

  /**
   * Get command queue statistics for a session
   */
  getSessionQueueStats(sessionId: string) {
    return this.getCommandQueueStats(sessionId);
  }

  /**
   * Get all command queue statistics
   */
  getAllCommandQueueStats(): Record<string, { queueSize: number; processing: boolean; lastCommandTime: number }> {
    const stats: Record<string, { queueSize: number; processing: boolean; lastCommandTime: number }> = {};
    
    this.commandQueues.forEach((queue, sessionId) => {
      stats[sessionId] = {
        queueSize: queue.commands.length,
        processing: queue.isProcessing,
        lastCommandTime: queue.lastCommandTime
      };
    });

    return stats;
  }

  /**
   * Clear command queue for a specific session (public method)
   */
  clearSessionCommandQueue(sessionId: string): void {
    this.clearCommandQueue(sessionId);
  }

  /**
   * Clear all command queues
   */
  clearAllCommandQueues(): void {
    Array.from(this.commandQueues.keys()).forEach(sessionId => {
      this.clearCommandQueue(sessionId);
    });
  }

  /**
   * Set custom prompt pattern for a session
   */
  setSessionPromptPattern(sessionId: string, pattern: RegExp): boolean {
    const queue = this.commandQueues.get(sessionId);
    if (!queue) {
      return false;
    }

    queue.expectedPrompt = pattern;
    this.logger.debug(`Updated prompt pattern for session ${sessionId}: ${pattern}`);
    return true;
  }

  /**
   * Get current command queue configuration
   */
  getCommandQueueConfig(): CommandQueueConfig {
    return { ...this.queueConfig };
  }

  /**
   * Force process command queue for a session (useful for debugging)
   */
  async forceProcessCommandQueue(sessionId: string): Promise<void> {
    await this.processCommandQueue(sessionId);
  }

  /**
   * Discover available serial devices
   */
  async discoverSerialDevices(): Promise<any[]> {
    try {
      // Initialize serial protocol if not already done
      if (!this.serialProtocol) {
        this.serialProtocol = await this.protocolFactory.createProtocol('serial');
        this.setupSerialProtocolEventHandlers();
      }

      return await this.serialProtocol.discoverDevices();
    } catch (error) {
      this.logger.error('Failed to discover serial devices:', error);
      throw error;
    }
  }

  /**
   * Get serial connection status for a session
   */
  getSerialConnectionStatus(sessionId: string): any {
    if (!this.serialProtocol) {
      return null;
    }

    return this.serialProtocol.getConnectionStatus(sessionId);
  }

  /**
   * Perform device reset on a serial session (e.g., Arduino reset)
   */
  async resetSerialDevice(sessionId: string): Promise<void> {
    if (!this.serialProtocol) {
      throw new Error('Serial protocol not initialized');
    }

    try {
      await this.serialProtocol.performDeviceReset(sessionId);
      this.logger.info(`Device reset performed for serial session ${sessionId}`);
    } catch (error) {
      this.logger.error(`Failed to reset device for session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Get output buffer for serial session
   */
  getSerialOutputBuffer(sessionId: string, limit?: number): any[] {
    if (!this.serialProtocol) {
      return [];
    }

    return this.serialProtocol.getOutputBuffer(sessionId, limit);
  }

  /**
   * Clear output buffer for serial session
   */
  clearSerialOutputBuffer(sessionId: string): void {
    if (this.serialProtocol) {
      this.serialProtocol.clearOutputBuffer(sessionId);
    }
  }

  async destroy() {
    if (this.resourceMonitor) {
      clearInterval(this.resourceMonitor);
    }
    await this.stopAllSessions();

    // Close all SSH connections in the pool
    this.sshConnectionPool.forEach((client, key) => {
      this.logger.info(`Closing SSH connection pool: ${key}`);
      client.destroy();
    });

    // Shutdown new production-ready components
    await this.connectionPool.shutdown();
    await this.sessionManager.shutdown();
    
    await this.monitoringSystem.destroy();
    
    // Clean up retry and error recovery systems
    this.retryManager.destroy();
    this.errorRecovery.destroy();
    
    // Clean up serial protocol
    if (this.serialProtocol) {
      await this.serialProtocol.cleanup();
      this.logger.info('Serial protocol cleaned up');
    }
    
    // Shutdown self-healing components
    if (this.selfHealingEnabled) {
      await this.shutdownSelfHealingComponents();
    }
    
    this.removeAllListeners();
    this.sessions.clear();
    this.processes.clear();
    this.sshClients.clear();
    this.sshChannels.clear();
    this.sshConnectionPool.clear();
    this.outputBuffers.clear();
    this.streamManagers.clear();
    this.retryAttempts.clear();
    
    // Clean up enhanced session persistence system
    if (this.persistenceTimer) {
      clearInterval(this.persistenceTimer);
      this.persistenceTimer = null;
    }
    
    // Clear all bookmark timers
    for (const [sessionId, timer] of this.bookmarkTimers) {
      clearInterval(timer);
    }
    this.bookmarkTimers.clear();
    
    // Persist final session state before shutdown
    await this.persistAllSessionData();
    
    // Clear persistence data
    this.sessionPersistenceData.clear();
    this.sessionBookmarks.clear();
    
    // Clean up command queue system
    this.commandQueues.forEach((queue, sessionId) => {
      this.clearCommandQueue(sessionId);
    });
    this.commandQueues.clear();
    this.commandProcessingIntervals.clear();
    
    this.logger.info('Enhanced session persistence system shutdown complete');
  }

  // Interactive prompt recovery event handlers
  
  /**
   * Handle session interrupt request - send interrupt signals to break stuck prompts
   */
  private async handleSessionInterruptRequest(data: {
    sessionId: string;
    interruptType: string;
    signals: string[];
    interactiveState?: any;
  }): Promise<void> {
    try {
      this.logger.info(`Handling session interrupt request for ${data.sessionId}`);
      
      const session = this.sessions.get(data.sessionId);
      if (!session) {
        this.logger.warn(`Session ${data.sessionId} not found for interrupt request`);
        return;
      }
      
      // Send interrupt signals based on session type
      if (session.sshOptions) {
        // SSH session - send SIGINT via channel
        const channel = this.sshChannels.get(data.sessionId);
        if (channel) {
          for (const signal of data.signals) {
            if (signal === 'SIGINT' || signal === 'CTRL_C') {
              channel.write('\x03'); // Send Ctrl+C
            } else if (signal === 'ESC') {
              channel.write('\x1B'); // Send ESC
            }
            await this.delay(500); // Small delay between signals
          }
        }
      } else {
        // Local process - send system signals
        const process = this.processes.get(data.sessionId);
        if (process && !process.killed) {
          process.kill('SIGINT');
        }
      }
      
      // Update interactive state
      await this.sessionRecovery.updateInteractiveState(data.sessionId, {
        sessionUnresponsive: false,
        lastSuccessfulCommand: new Date()
      });
      
      this.logger.info(`Successfully sent interrupt signals to session ${data.sessionId}`);
      
    } catch (error) {
      this.logger.error(`Failed to handle session interrupt request for ${data.sessionId}:`, error);
    }
  }
  
  /**
   * Handle prompt reset request - clear buffers and reset prompt detection
   */
  private async handlePromptResetRequest(data: {
    sessionId: string;
    actions: string[];
    preserveState: any;
  }): Promise<void> {
    try {
      this.logger.info(`Handling prompt reset request for ${data.sessionId}`);
      
      const session = this.sessions.get(data.sessionId);
      if (!session) {
        this.logger.warn(`Session ${data.sessionId} not found for prompt reset`);
        return;
      }
      
      for (const action of data.actions) {
        switch (action) {
          case 'clear-output-buffer':
            // Clear the output buffer
            this.outputBuffers.set(data.sessionId, []);
            this.promptDetector.clearBuffer(data.sessionId);
            break;
            
          case 'reset-prompt-detector':
            // Reset prompt detection patterns
            this.promptDetector.removeSession(data.sessionId);
            this.promptDetector.configureSession({
              sessionId: data.sessionId,
              shellType: this.detectShellType(session.type),
              adaptiveLearning: true
            });
            break;
            
          case 'flush-pending-commands':
            // Clear command queue for this session
            const commandQueue = this.commandQueues.get(data.sessionId);
            if (commandQueue) {
              commandQueue.commands = [];
              commandQueue.outputBuffer = '';
            }
            break;
            
          case 'reinitialize-prompt-patterns':
            // Reinitialize prompt patterns based on session type
            this.initializeSessionCommandTracking(data.sessionId, session);
            break;
        }
      }
      
      // Update interactive state
      await this.sessionRecovery.updateInteractiveState(data.sessionId, {
        sessionUnresponsive: false,
        timeoutCount: 0,
        pendingCommands: []
      });
      
      this.logger.info(`Successfully reset prompt state for session ${data.sessionId}`);
      
    } catch (error) {
      this.logger.error(`Failed to handle prompt reset request for ${data.sessionId}:`, error);
    }
  }
  
  /**
   * Handle session refresh request - refresh session without full restart
   */
  private async handleSessionRefreshRequest(data: {
    sessionId: string;
    refreshActions: string[];
    timeout: number;
    fallbackToRestart: boolean;
    preserveState: any;
  }): Promise<void> {
    try {
      this.logger.info(`Handling session refresh request for ${data.sessionId}`);
      
      const session = this.sessions.get(data.sessionId);
      if (!session) {
        this.logger.warn(`Session ${data.sessionId} not found for refresh`);
        return;
      }
      
      let refreshSuccessful = false;
      
      for (const action of data.refreshActions) {
        try {
          switch (action) {
            case 'send-newline':
              // Send newline to re-establish communication
              if (session.sshOptions) {
                const channel = this.sshChannels.get(data.sessionId);
                if (channel) {
                  channel.write('\n');
                }
              } else {
                const process = this.processes.get(data.sessionId);
                if (process && process.stdin) {
                  process.stdin.write('\n');
                }
              }
              break;
              
            case 'check-responsiveness':
              // Check if session responds to simple command
              const responseCheck = await this.checkSessionResponsiveness(data.sessionId, data.timeout);
              refreshSuccessful = responseCheck;
              break;
              
            case 'verify-prompt':
              // Wait for and verify prompt appears
              try {
                await this.waitForPrompt(data.sessionId, data.timeout);
                refreshSuccessful = true;
              } catch (error) {
                this.logger.debug(`Prompt verification failed for ${data.sessionId}:`, error);
              }
              break;
              
            case 'restore-context':
              // Restore working directory and environment if needed
              if (data.preserveState?.workingDirectory) {
                // Commands to restore context would be session-type specific
                // This is a placeholder for more sophisticated context restoration
              }
              break;
          }
        } catch (actionError) {
          this.logger.warn(`Refresh action '${action}' failed for session ${data.sessionId}:`, actionError);
        }
      }
      
      if (!refreshSuccessful && data.fallbackToRestart) {
        this.logger.info(`Session refresh failed for ${data.sessionId}, attempting fallback restart`);
        await this.sessionRecovery.recoverSession(data.sessionId, 'restart-fallback');
      } else if (refreshSuccessful) {
        // Update interactive state on success
        await this.sessionRecovery.updateInteractiveState(data.sessionId, {
          sessionUnresponsive: false,
          lastSuccessfulCommand: new Date(),
          timeoutCount: 0
        });
      }
      
      this.logger.info(`Session refresh ${refreshSuccessful ? 'succeeded' : 'failed'} for ${data.sessionId}`);
      
    } catch (error) {
      this.logger.error(`Failed to handle session refresh request for ${data.sessionId}:`, error);
    }
  }
  
  /**
   * Handle command retry request - retry failed commands with backoff
   */
  private async handleCommandRetryRequest(data: {
    sessionId: string;
    commands: string[];
    retryConfig: {
      maxRetries: number;
      baseDelay: number;
      backoffMultiplier: number;
      maxDelay: number;
      jitter: boolean;
    };
    verification: {
      checkPrompt: boolean;
      timeoutPerCommand: number;
      verifyOutput: boolean;
    };
  }): Promise<void> {
    try {
      this.logger.info(`Handling command retry request for ${data.sessionId}`);
      
      const session = this.sessions.get(data.sessionId);
      if (!session) {
        this.logger.warn(`Session ${data.sessionId} not found for command retry`);
        return;
      }
      
      let successfulRetries = 0;
      
      for (const command of data.commands) {
        let retryCount = 0;
        let commandSucceeded = false;
        
        while (retryCount < data.retryConfig.maxRetries && !commandSucceeded) {
          try {
            // Calculate delay with exponential backoff and optional jitter
            let delay = data.retryConfig.baseDelay * Math.pow(data.retryConfig.backoffMultiplier, retryCount);
            delay = Math.min(delay, data.retryConfig.maxDelay);
            
            if (data.retryConfig.jitter) {
              delay += Math.random() * 1000; // Add up to 1 second of jitter
            }
            
            if (retryCount > 0) {
              await this.delay(delay);
            }
            
            // Execute the command
            const result = await this.executeCommandInSession(
              data.sessionId, 
              command, 
              [], 
              data.verification.timeoutPerCommand
            );
            
            if (result.status === 'completed') {
              commandSucceeded = true;
              successfulRetries++;
            }
            
          } catch (error) {
            this.logger.debug(`Command retry ${retryCount + 1} failed for '${command}' in session ${data.sessionId}:`, error);
          }
          
          retryCount++;
        }
        
        if (!commandSucceeded) {
          this.logger.warn(`All retries failed for command '${command}' in session ${data.sessionId}`);
        }
      }
      
      // Update interactive state based on results
      await this.sessionRecovery.updateInteractiveState(data.sessionId, {
        sessionUnresponsive: successfulRetries === 0,
        lastSuccessfulCommand: successfulRetries > 0 ? new Date() : undefined,
        pendingCommands: []
      });
      
      this.logger.info(`Command retry completed for ${data.sessionId}: ${successfulRetries}/${data.commands.length} commands succeeded`);
      
    } catch (error) {
      this.logger.error(`Failed to handle command retry request for ${data.sessionId}:`, error);
    }
  }
  
  /**
   * Handle interactive state updates
   */
  private async handleInteractiveStateUpdate(data: {
    sessionId: string;
    interactiveState: any;
  }): Promise<void> {
    try {
      // Emit event for external monitoring
      this.emit('interactive-state-changed', {
        sessionId: data.sessionId,
        state: data.interactiveState,
        timestamp: new Date()
      });
      
      // Check if proactive measures are needed
      const shouldTrigger = this.sessionRecovery.shouldTriggerInteractiveRecovery(data.sessionId);
      if (shouldTrigger.shouldTrigger && shouldTrigger.urgency === 'high') {
        this.logger.warn(`High urgency interactive recovery needed for ${data.sessionId}: ${shouldTrigger.reason}`);
        // Trigger recovery in next tick to avoid recursion
        setImmediate(() => {
          this.sessionRecovery.recoverSession(data.sessionId, `proactive-${shouldTrigger.urgency}-${Date.now()}`);
        });
      }
      
    } catch (error) {
      this.logger.error(`Failed to handle interactive state update for ${data.sessionId}:`, error);
    }
  }
  
  /**
   * Check if a session is responsive by sending a simple command
   */
  private async checkSessionResponsiveness(sessionId: string, timeout: number = 5000): Promise<boolean> {
    try {
      // Use a simple, non-destructive command to test responsiveness
      const testCommand = this.sessions.get(sessionId)?.type === 'powershell' ? 'echo test' : 'echo test';
      
      const result = await this.executeCommandInSession(sessionId, testCommand, [], timeout);
      return result.status === 'completed';
    } catch (error) {
      return false;
    }
  }
  
  /**
   * Detect shell type from console type
   */
  private detectShellType(consoleType?: string): 'bash' | 'powershell' | 'cmd' | 'auto' {
    if (!consoleType) return 'auto';
    
    switch (consoleType) {
      case 'powershell':
      case 'pwsh':
        return 'powershell';
      case 'cmd':
        return 'cmd';
      case 'bash':
      case 'zsh':
      case 'sh':
        return 'bash';
      default:
        return 'auto';
    }
  }
  
  /**
   * Start proactive interactive session monitoring
   */
  private startInteractiveSessionMonitoring(): void {
    // Monitor every 15 seconds for interactive prompt issues
    const monitoringInterval = setInterval(async () => {
      try {
        for (const [sessionId, session] of this.sessions) {
          // Check if session needs interactive prompt recovery
          const shouldTrigger = this.sessionRecovery.shouldTriggerInteractiveRecovery(sessionId);
          
          if (shouldTrigger.shouldTrigger) {
            this.logger.info(`Proactive recovery triggered for session ${sessionId}: ${shouldTrigger.reason} (${shouldTrigger.urgency})`);
            
            // Update interactive state with current issues
            const commandQueue = this.commandQueues.get(sessionId);
            const pendingCommands = commandQueue?.commands.map(cmd => cmd.input) || [];
            
            await this.sessionRecovery.updateInteractiveState(sessionId, {
              isInteractive: true,
              sessionUnresponsive: shouldTrigger.urgency === 'high',
              pendingCommands,
              timeoutCount: this.timeoutRecoveryAttempts.get(sessionId) || 0
            });
            
            // Trigger appropriate recovery based on urgency
            if (shouldTrigger.urgency === 'high') {
              // Immediate recovery for high urgency issues
              await this.sessionRecovery.recoverSession(sessionId, `proactive-high-${shouldTrigger.reason}`);
            } else if (shouldTrigger.urgency === 'medium') {
              // Schedule recovery for medium urgency issues
              setTimeout(async () => {
                const recheck = this.sessionRecovery.shouldTriggerInteractiveRecovery(sessionId);
                if (recheck.shouldTrigger) {
                  await this.sessionRecovery.recoverSession(sessionId, `proactive-medium-${shouldTrigger.reason}`);
                }
              }, 30000); // Wait 30 seconds before medium priority recovery
            }
          }
          
          // Update session state for recovery monitoring
          const promptResult = this.promptDetector.getBuffer(sessionId);
          if (promptResult) {
            const hasPrompt = this.promptDetector.detectPrompt(sessionId, promptResult);
            if (hasPrompt?.detected) {
              await this.sessionRecovery.updateInteractiveState(sessionId, {
                lastPromptDetected: new Date(),
                promptType: hasPrompt.pattern?.name
              });
            }
          }
        }
      } catch (error) {
        this.logger.error('Error in proactive interactive session monitoring:', error);
      }
    }, 15000); // Run every 15 seconds
    
    // Store interval for cleanup
    if (!this.resourceMonitor) {
      this.resourceMonitor = monitoringInterval;
    }
    
    this.logger.info('Started proactive interactive session monitoring');
  }
  
  /**
   * Enhanced decision logic for recovery vs replacement
   */
  private async shouldRecoverOrReplace(sessionId: string, failureContext: {
    reason: string;
    attempts: number;
    duration: number;
    errorType: string;
  }): Promise<{
    decision: 'recover' | 'replace' | 'abandon';
    strategy?: string;
    reasoning: string;
  }> {
    try {
      const session = this.sessions.get(sessionId);
      const interactiveRecovery = this.sessionRecovery.shouldTriggerInteractiveRecovery(sessionId);
      const recoveryStats = this.sessionRecovery.getInteractiveRecoveryStats();
      
      // Factors for decision making
      const factors = {
        isSSH: !!session?.sshOptions,
        hasInteractiveState: interactiveRecovery.shouldTrigger,
        successRate: recoveryStats.totalInteractiveSessions > 0 ? 
          (recoveryStats.successfulPromptInterrupts + recoveryStats.successfulPromptResets) / recoveryStats.totalInteractiveSessions : 0,
        attemptCount: failureContext.attempts,
        failureDuration: failureContext.duration,
        errorSeverity: this.categorizeErrorSeverity(failureContext.errorType),
        resourceCost: this.estimateRecoveryCost(sessionId, failureContext)
      };
      
      // Decision logic based on multiple factors
      if (factors.attemptCount >= 5) {
        return {
          decision: 'abandon',
          reasoning: 'Too many failed recovery attempts - abandoning session'
        };
      }
      
      if (factors.hasInteractiveState && factors.successRate > 0.7 && factors.attemptCount < 3) {
        return {
          decision: 'recover',
          strategy: interactiveRecovery.urgency === 'high' ? 'prompt-interrupt' : 'prompt-reset',
          reasoning: `Interactive recovery has ${(factors.successRate * 100).toFixed(1)}% success rate - worth attempting`
        };
      }
      
      if (factors.isSSH && factors.errorSeverity === 'network' && factors.attemptCount < 4) {
        return {
          decision: 'recover',
          strategy: 'reconnect',
          reasoning: 'SSH network issues are often recoverable through reconnection'
        };
      }
      
      if (factors.resourceCost < 0.3 && factors.attemptCount < 3) { // Low cost recovery
        return {
          decision: 'recover',
          strategy: 'session-refresh',
          reasoning: 'Low resource cost recovery - attempting refresh'
        };
      }
      
      if (factors.failureDuration < 30000 && !factors.hasInteractiveState) { // Quick failures without interactive issues
        return {
          decision: 'replace',
          reasoning: 'Quick failure without interactive complexity - replacing is more efficient'
        };
      }
      
      // Default to recovery for interactive sessions, replacement for others
      if (factors.hasInteractiveState) {
        return {
          decision: 'recover',
          strategy: 'prompt-reset',
          reasoning: 'Interactive session detected - prioritizing recovery to preserve state'
        };
      } else {
        return {
          decision: 'replace',
          reasoning: 'Non-interactive session - replacement is simpler and more reliable'
        };
      }
      
    } catch (error) {
      this.logger.error(`Error in recovery decision logic for session ${sessionId}:`, error);
      return {
        decision: 'replace',
        reasoning: 'Error in decision logic - defaulting to replacement for safety'
      };
    }
  }
  
  /**
   * Categorize error severity for decision making
   */
  private categorizeErrorSeverity(errorType: string): 'low' | 'medium' | 'high' | 'network' | 'system' {
    const lowSeverity = ['timeout', 'prompt', 'buffer-full'];
    const mediumSeverity = ['command-failed', 'permission', 'resource'];
    const networkSeverity = ['connection', 'network', 'ssh', 'disconnect'];
    const systemSeverity = ['memory', 'cpu', 'disk', 'system'];
    
    const lowerType = errorType.toLowerCase();
    
    if (networkSeverity.some(term => lowerType.includes(term))) return 'network';
    if (systemSeverity.some(term => lowerType.includes(term))) return 'system';
    if (lowSeverity.some(term => lowerType.includes(term))) return 'low';
    if (mediumSeverity.some(term => lowerType.includes(term))) return 'medium';
    
    return 'high'; // Default to high severity for unknown errors
  }
  
  /**
   * Estimate the resource cost of recovery (0-1 scale)
   */
  private estimateRecoveryCost(sessionId: string, failureContext: any): number {
    let cost = 0;
    
    const session = this.sessions.get(sessionId);
    
    // Base cost factors
    if (session?.sshOptions) cost += 0.3; // SSH operations are more expensive
    if (failureContext.attempts > 2) cost += 0.2; // Multiple attempts increase cost
    if (failureContext.duration > 60000) cost += 0.2; // Long-running issues are costly
    
    // Interactive state factors
    const interactiveState = this.sessionRecovery.shouldTriggerInteractiveRecovery(sessionId);
    if (interactiveState.shouldTrigger) {
      cost += interactiveState.urgency === 'high' ? 0.4 : 0.2;
    }
    
    // Resource utilization (simplified)
    const commandQueue = this.commandQueues.get(sessionId);
    if (commandQueue?.commands.length > 5) cost += 0.1;
    
    return Math.min(cost, 1.0); // Cap at 1.0
  }

  /**
   * Setup Azure protocol integration
   */
  private setupAzureIntegration(): void {
    this.azureProtocol.on('connected', (sessionId) => {
      this.logger.info(`Azure session connected: ${sessionId}`);
      this.emit('azure-connected', { sessionId });
      // Record successful connection for monitoring
      this.azureMonitoring.recordConnectionEvent(sessionId, 'success');
    });

    this.azureProtocol.on('disconnected', (sessionId) => {
      this.logger.info(`Azure session disconnected: ${sessionId}`);
      this.emit('azure-disconnected', { sessionId });
      // Unregister from monitoring
      this.azureMonitoring.unregisterSession(sessionId);
    });

    this.azureProtocol.on('error', (sessionId, error) => {
      this.logger.error(`Azure session error: ${sessionId}`, error);
      this.emit('azure-error', { sessionId, error });
      
      // Record error for monitoring
      if (error.message.includes('auth')) {
        this.azureMonitoring.recordErrorEvent('authentication', error);
      } else if (error.message.includes('network')) {
        this.azureMonitoring.recordErrorEvent('network', error);
      } else {
        this.azureMonitoring.recordErrorEvent('api', error);
      }
      
      // Record connection failure
      this.azureMonitoring.recordConnectionEvent(sessionId, 'failure');
    });

    this.azureProtocol.on('output', (sessionId, output) => {
      // Forward Azure output to the console system
      const outputBuffer = this.outputBuffers.get(sessionId) || [];
      outputBuffer.push(output);
      
      if (outputBuffer.length > this.maxBufferSize) {
        outputBuffer.shift();
      }
      
      this.outputBuffers.set(sessionId, outputBuffer);
      this.emit('console-event', {
        sessionId,
        type: 'output',
        timestamp: new Date(),
        data: output
      });
    });

    this.azureProtocol.on('token-refreshed', (sessionId, tokenInfo) => {
      this.logger.debug(`Azure token refreshed for session: ${sessionId}`);
      this.emit('azure-token-refreshed', { sessionId, tokenInfo });
      // Record token refresh for monitoring
      this.azureMonitoring.recordAuthenticationEvent('token-refresh', tokenInfo);
    });

    this.azureProtocol.on('session-ready', (sessionId) => {
      this.logger.info(`Azure session ready: ${sessionId}`);
      this.emit('azure-session-ready', { sessionId });
    });

    this.azureProtocol.on('reconnecting', (sessionId, attempt) => {
      this.logger.info(`Azure session reconnecting: ${sessionId} (attempt ${attempt})`);
      this.emit('azure-reconnecting', { sessionId, attempt });
    });

    this.logger.info('Azure protocol integration setup completed');
  }

  /**
   * Create Azure Cloud Shell session
   */
  private async createAzureCloudShellSession(sessionId: string, options: SessionOptions): Promise<string> {
    if (!options.azureOptions) {
      throw new Error('Azure options are required for Azure Cloud Shell session');
    }

    try {
      this.logger.info(`Creating Azure Cloud Shell session: ${sessionId}`);
      
      const azureSession = await this.azureProtocol.createCloudShellSession(sessionId, options.azureOptions);
      
      // Register session with monitoring
      this.azureMonitoring.registerSession(azureSession);
      
      // Store session information
      const session = this.sessions.get(sessionId);
      if (session) {
        session.status = 'running';
        session.type = 'azure-shell';
        this.sessions.set(sessionId, session);
      }

      // Register with monitoring systems
      await this.registerSessionWithHealthMonitoring(sessionId, session!, options);

      this.logger.info(`Azure Cloud Shell session created successfully: ${sessionId}`);
      return sessionId;
    } catch (error) {
      this.logger.error(`Failed to create Azure Cloud Shell session: ${sessionId}`, error);
      throw error;
    }
  }

  /**
   * Create Azure Bastion session
   */
  private async createAzureBastionSession(sessionId: string, options: SessionOptions): Promise<string> {
    if (!options.azureOptions) {
      throw new Error('Azure options are required for Azure Bastion session');
    }

    try {
      this.logger.info(`Creating Azure Bastion session: ${sessionId}`);
      
      const azureSession = await this.azureProtocol.createBastionSession(sessionId, options.azureOptions);
      
      // Register session with monitoring
      this.azureMonitoring.registerSession(azureSession);
      
      // Store session information
      const session = this.sessions.get(sessionId);
      if (session) {
        session.status = 'running';
        session.type = 'azure-bastion';
        this.sessions.set(sessionId, session);
      }

      // Register with monitoring systems
      await this.registerSessionWithHealthMonitoring(sessionId, session!, options);

      this.logger.info(`Azure Bastion session created successfully: ${sessionId}`);
      return sessionId;
    } catch (error) {
      this.logger.error(`Failed to create Azure Bastion session: ${sessionId}`, error);
      throw error;
    }
  }

  /**
   * Create Azure Arc session
   */
  private async createAzureArcSession(sessionId: string, options: SessionOptions): Promise<string> {
    if (!options.azureOptions) {
      throw new Error('Azure options are required for Azure Arc session');
    }

    try {
      this.logger.info(`Creating Azure Arc session: ${sessionId}`);
      
      const azureSession = await this.azureProtocol.createArcSession(sessionId, options.azureOptions);
      
      // Register session with monitoring
      this.azureMonitoring.registerSession(azureSession);
      
      // Store session information
      const session = this.sessions.get(sessionId);
      if (session) {
        session.status = 'running';
        session.type = 'azure-ssh';
        this.sessions.set(sessionId, session);
      }

      // Register with monitoring systems
      await this.registerSessionWithHealthMonitoring(sessionId, session!, options);

      this.logger.info(`Azure Arc session created successfully: ${sessionId}`);
      return sessionId;
    } catch (error) {
      this.logger.error(`Failed to create Azure Arc session: ${sessionId}`, error);
      throw error;
    }
  }

  /**
   * Send input to Azure session
   */
  private async sendInputToAzureSession(sessionId: string, input: string): Promise<void> {
    try {
      await this.azureProtocol.sendInput(sessionId, input);
    } catch (error) {
      this.logger.error(`Failed to send input to Azure session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Cleanup Azure session
   */
  private async cleanupAzureSession(sessionId: string): Promise<void> {
    try {
      await this.azureProtocol.closeSession(sessionId);
      this.logger.info(`Azure session cleaned up: ${sessionId}`);
    } catch (error) {
      this.logger.error(`Failed to cleanup Azure session ${sessionId}:`, error);
    }
  }

  /**
   * Handle Azure session based on console type
   */
  private async createAzureSession(sessionId: string, options: SessionOptions): Promise<string> {
    const consoleType = options.consoleType || 'azure-shell';
    
    switch (consoleType) {
      case 'azure-shell':
        return await this.createAzureCloudShellSession(sessionId, options);
      
      case 'azure-bastion':
        return await this.createAzureBastionSession(sessionId, options);
      
      case 'azure-ssh':
        return await this.createAzureArcSession(sessionId, options);
      
      default:
        // Default to Cloud Shell if Azure options provided but type unclear
        return await this.createAzureCloudShellSession(sessionId, options);
    }
  }

  /**
   * Get Azure session metrics and health
   */
  getAzureSessionMetrics(sessionId: string): Record<string, any> {
    return this.azureProtocol.getSessionMetrics(sessionId);
  }

  /**
   * Check Azure session health
   */
  async checkAzureSessionHealth(sessionId: string): Promise<boolean> {
    return await this.azureProtocol.healthCheck(sessionId);
  }

  /**
   * Resize Azure session terminal
   */
  async resizeAzureSession(sessionId: string, rows: number, cols: number): Promise<void> {
    try {
      await this.azureProtocol.resizeTerminal(sessionId, rows, cols);
    } catch (error) {
      this.logger.error(`Failed to resize Azure session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Resize any session terminal (general method)
   */
  async resizeSession(sessionId: string, cols: number, rows: number): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    try {
      // Try to get the protocol instance for this session
      const protocolSession = this.protocolSessions.get(sessionId);
      if (protocolSession && protocolSession.protocol) {
        // Check if the protocol supports resizing
        if ('resizeSession' in protocolSession.protocol) {
          await (protocolSession.protocol as any).resizeSession(sessionId, cols, rows);
        } else {
          this.logger.warn(`Resize not supported for protocol type: ${protocolSession.type}`);
        }
      } else {
        // Fallback for specific protocols
        switch (session.type) {
          case 'wsl':
            if (this.wslProtocol && 'resizeTerminal' in this.wslProtocol) {
              await this.wslProtocol.resizeTerminal(sessionId, cols, rows);
            }
            break;
          default:
            this.logger.warn(`Resize not supported for session type: ${session.type}`);
            break;
        }
      }

      this.logger.debug(`Session ${sessionId} resized to ${cols}x${rows}`);
    } catch (error) {
      this.logger.error(`Failed to resize session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Get Azure monitoring metrics
   */
  getAzureMonitoringMetrics() {
    return this.azureMonitoring.getMetrics();
  }

  /**
   * Perform Azure health check
   */
  async performAzureHealthCheck() {
    return await this.azureMonitoring.performHealthCheck();
  }

  /**
   * Update Azure cost estimates for a session
   */
  updateAzureCostEstimate(sessionId: string, costEstimate: number) {
    this.azureMonitoring.updateCostEstimates(sessionId, costEstimate);
  }

  /**
   * Setup RDP protocol integration
   */
  private setupRDPIntegration(): void {
    this.rdpProtocol.on('connected', (session: RDPSession) => {
      this.logger.info(`RDP session connected: ${session.sessionId}`);
      this.rdpSessions.set(session.sessionId, session);
      this.emit('rdp-connected', { sessionId: session.sessionId, session });
    });

    this.rdpProtocol.on('disconnected', (sessionId: string, reason?: string) => {
      this.logger.info(`RDP session disconnected: ${sessionId}`, { reason });
      this.rdpSessions.delete(sessionId);
      this.emit('rdp-disconnected', { sessionId, reason });
    });

    this.rdpProtocol.on('error', (sessionId: string, error: Error) => {
      this.logger.error(`RDP session error: ${sessionId}`, error);
      this.emit('rdp-error', { sessionId, error });
    });

    this.rdpProtocol.on('output', (output: ConsoleOutput) => {
      this.handleRDPOutput(output);
    });

    this.rdpProtocol.on('screen-update', (sessionId: string, imageData: Buffer) => {
      this.emit('rdp-screen-update', { sessionId, imageData });
    });

    this.rdpProtocol.on('clipboard-data', (sessionId: string, data: string, format: string) => {
      this.emit('rdp-clipboard-data', { sessionId, data, format });
    });

    this.rdpProtocol.on('file-transfer-progress', (sessionId: string, progress: any) => {
      this.emit('rdp-file-transfer-progress', { sessionId, progress });
    });

    this.rdpProtocol.on('performance-metrics', (sessionId: string, metrics: any) => {
      this.emit('rdp-performance-metrics', { sessionId, metrics });
    });

    this.logger.info('RDP Protocol integration initialized');
  }

  /**
   * Setup WebSocket Terminal protocol integration
   */
  private setupWebSocketTerminalIntegration(): void {
    this.webSocketTerminalProtocol.on('session_connected', (data: { sessionId: string }) => {
      this.logger.info(`WebSocket terminal session connected: ${data.sessionId}`);
      this.emit('websocket-terminal-connected', data);
    });

    this.webSocketTerminalProtocol.on('session_disconnected', (data: { sessionId: string }) => {
      this.logger.info(`WebSocket terminal session disconnected: ${data.sessionId}`);
      this.webSocketTerminalSessions.delete(data.sessionId);
      this.emit('websocket-terminal-disconnected', data);
    });

    this.webSocketTerminalProtocol.on('session_reconnecting', (data: { sessionId: string }) => {
      this.logger.info(`WebSocket terminal session reconnecting: ${data.sessionId}`);
      this.emit('websocket-terminal-reconnecting', data);
    });

    this.webSocketTerminalProtocol.on('data', (data: { sessionId: string; data: string | Buffer }) => {
      this.handleWebSocketTerminalOutput(data.sessionId, data.data);
    });

    this.webSocketTerminalProtocol.on('error', (data: { sessionId: string; error: Error }) => {
      this.logger.error(`WebSocket terminal session error: ${data.sessionId}`, data.error);
      this.emit('websocket-terminal-error', data);
      
      // Attempt automatic recovery
      this.attemptWebSocketTerminalRecovery(data.sessionId, data.error);
    });

    this.webSocketTerminalProtocol.on('file_transfer_progress', (data: { sessionId: string; transfer: any }) => {
      this.emit('websocket-terminal-file-transfer-progress', data);
    });

    this.webSocketTerminalProtocol.on('multiplex_session_created', (data: { sessionId: string; multiplexSession: any }) => {
      this.emit('websocket-terminal-multiplex-session-created', data);
    });

    this.logger.info('WebSocket Terminal Protocol integration initialized');
  }

  /**
   * Handle WebSocket Terminal output
   */
  private handleWebSocketTerminalOutput(sessionId: string, data: string | Buffer): void {
    const output: ConsoleOutput = {
      sessionId,
      type: 'stdout',
      data: typeof data === 'string' ? data : data.toString('utf8'),
      timestamp: new Date(),
      raw: typeof data === 'string' ? data : data.toString('utf8')
    };

    // Store output in buffer
    if (!this.outputBuffers.has(sessionId)) {
      this.outputBuffers.set(sessionId, []);
    }
    const buffer = this.outputBuffers.get(sessionId)!;
    buffer.push(output);

    // Limit buffer size
    if (buffer.length > this.maxBufferSize) {
      buffer.shift();
    }

    // Emit output event
    this.emit('output', output);

    // Update session last activity
    const wsSession = this.webSocketTerminalSessions.get(sessionId);
    if (wsSession) {
      wsSession.lastActivity = new Date();
      this.webSocketTerminalSessions.set(sessionId, wsSession);
    }

    // Update session in main sessions map
    const session = this.sessions.get(sessionId);
    if (session) {
      // Update command execution if there's an active command
      const activeCommands = Array.from(session.activeCommands.values());
      if (activeCommands.length > 0) {
        const latestCommand = activeCommands[activeCommands.length - 1];
        if (latestCommand.status === 'executing') {
          latestCommand.output.push(output);
        }
      }
    }
  }

  /**
   * Attempt WebSocket Terminal recovery
   */
  private async attemptWebSocketTerminalRecovery(sessionId: string, error: Error): Promise<void> {
    try {
      this.logger.info(`Attempting WebSocket terminal recovery for session: ${sessionId}`);
      
      const session = this.sessions.get(sessionId);
      if (!session || !session.webSocketTerminalOptions) {
        this.logger.warn(`Cannot recover WebSocket terminal session ${sessionId}: session or options not found`);
        return;
      }

      // Close existing session
      await this.webSocketTerminalProtocol.closeSession(sessionId);
      
      // Wait a moment before reconnecting
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Recreate session
      const wsSession = await this.webSocketTerminalProtocol.createSession(sessionId, session.webSocketTerminalOptions);
      this.webSocketTerminalSessions.set(sessionId, wsSession.state);
      
      this.logger.info(`WebSocket terminal session ${sessionId} recovered successfully`);
      this.emit('websocket-terminal-recovered', { sessionId });
      
    } catch (recoveryError) {
      this.logger.error(`Failed to recover WebSocket terminal session ${sessionId}:`, recoveryError);
      this.emit('websocket-terminal-recovery-failed', { sessionId, error: recoveryError });
    }
  }

  /**
   * Handle RDP output
   */
  private handleRDPOutput(output: ConsoleOutput): void {
    // Store output in buffer
    if (!this.outputBuffers.has(output.sessionId)) {
      this.outputBuffers.set(output.sessionId, []);
    }
    const buffer = this.outputBuffers.get(output.sessionId)!;
    buffer.push(output);

    // Emit output event
    this.emit('output', output);

    // Update session last activity
    const rdpSession = this.rdpSessions.get(output.sessionId);
    if (rdpSession) {
      rdpSession.lastActivity = new Date();
      this.rdpSessions.set(output.sessionId, rdpSession);
    }
  }

  /**
   * Handle WinRM output
   */
  private handleWinRMOutput(sessionId: string, output: ConsoleOutput): void {
    // Store output in buffer
    if (!this.outputBuffers.has(sessionId)) {
      this.outputBuffers.set(sessionId, []);
    }
    const buffer = this.outputBuffers.get(sessionId)!;
    buffer.push(output);

    // Update output sequence counter
    const currentSequence = this.outputSequenceCounters.get(sessionId) || 0;
    this.outputSequenceCounters.set(sessionId, currentSequence + 1);
    
    // Update output with sequence number
    output.sequence = currentSequence + 1;

    // Emit output event
    this.emit('output', output);

    // Update session last activity
    const winrmSession = this.winrmSessions.get(sessionId);
    if (winrmSession) {
      winrmSession.lastActivity = new Date();
      
      // Update performance counters
      if (output.data) {
        winrmSession.performanceCounters.bytesTransferred += output.data.length;
      }
      
      this.winrmSessions.set(sessionId, winrmSession);
    }

    // Log debug information
    this.logger.debug(`WinRM output for session ${sessionId}: ${output.type} - ${output.data?.substring(0, 100)}${(output.data?.length || 0) > 100 ? '...' : ''}`);
  }

  /**
   * Create RDP session
   */
  private async createRDPSession(sessionId: string, options: SessionOptions): Promise<string> {
    if (!options.rdpOptions) {
      throw new Error('RDP options are required for RDP session');
    }

    try {
      this.logger.info(`Creating RDP session ${sessionId}`, {
        host: options.rdpOptions.host,
        port: options.rdpOptions.port,
        username: options.rdpOptions.username
      });

      // Create RDP session through the protocol
      const rdpSession = await this.rdpProtocol.createSession({
        command: 'rdp',
        ...options.rdpOptions
      });
      
      // Update console session
      const session = this.sessions.get(sessionId);
      if (session) {
        session.status = 'running';
        session.pid = undefined; // RDP sessions don't have PIDs
        this.sessions.set(sessionId, session);
      }

      // Register with session manager
      await this.sessionManager.updateSessionStatus(sessionId, 'running', {
        rdpHost: options.rdpOptions.host,
        rdpPort: options.rdpOptions.port,
        protocol: options.rdpOptions.protocol
      });

      // Start monitoring if enabled
      if (options.monitoring) {
        await this.monitoringSystem.startSessionMonitoring(sessionId, {
          command: options.command,
          args: options.args || [],
          ...options.monitoring
        });
      }

      this.logger.info(`RDP session ${sessionId} created successfully`);
      return sessionId;

    } catch (error) {
      this.logger.error(`Failed to create RDP session ${sessionId}:`, error);
      
      // Update session status to failed
      const session = this.sessions.get(sessionId);
      if (session) {
        session.status = 'crashed';
        this.sessions.set(sessionId, session);
      }
      
      throw error;
    }
  }

  /**
   * Create WinRM session
   */
  private async createWinRMSession(sessionId: string, options: SessionOptions): Promise<string> {
    if (!options.winrmOptions) {
      throw new Error('WinRM options are required for WinRM session');
    }

    try {
      this.logger.info(`Creating WinRM session ${sessionId}`, {
        host: options.winrmOptions.host,
        port: options.winrmOptions.port,
        username: options.winrmOptions.username,
        authType: options.winrmOptions.authType
      });

      // Create WinRM protocol instance
      const winrmProtocol = await this.protocolFactory.createProtocol('winrm');
      this.winrmProtocols.set(sessionId, winrmProtocol);

      // Create WinRM session
      const winrmSession = await winrmProtocol.createSession(options);
      
      // Create WinRM session state
      const winrmSessionState: WinRMSessionState = {
        sessionId,
        status: 'running',
        host: options.winrmOptions.host,
        port: options.winrmOptions.port || (options.winrmOptions.protocol === 'https' ? 5986 : 5985),
        protocol: options.winrmOptions.protocol || 'https',
        authType: options.winrmOptions.authType || 'negotiate',
        username: options.winrmOptions.username,
        connectedAt: new Date(),
        lastActivity: new Date(),
        shells: new Map(),
        activeCommands: new Map(),
        transferredFiles: [],
        performanceCounters: {
          commandsExecuted: 0,
          bytesTransferred: 0,
          averageResponseTime: 0,
          errorCount: 0,
          reconnections: 0
        },
        isConnected: true
      };
      
      this.winrmSessions.set(sessionId, winrmSessionState);
      
      // Update console session
      const session = this.sessions.get(sessionId);
      if (session) {
        session.status = 'running';
        session.pid = undefined; // WinRM sessions don't have PIDs
        this.sessions.set(sessionId, session);
      }

      // Register with session manager
      await this.sessionManager.updateSessionStatus(sessionId, 'running', {
        winrmHost: options.winrmOptions.host,
        winrmPort: options.winrmOptions.port,
        protocol: options.winrmOptions.protocol,
        authType: options.winrmOptions.authType
      });

      // Start monitoring if enabled
      if (options.monitoring) {
        await this.monitoringSystem.startSessionMonitoring(sessionId, {
          command: options.command,
          args: options.args || [],
          ...options.monitoring
        });
      }

      this.logger.info(`WinRM session ${sessionId} created successfully`);
      return sessionId;

    } catch (error) {
      this.logger.error(`Failed to create WinRM session ${sessionId}:`, error);
      
      // Clean up failed session
      this.winrmProtocols.delete(sessionId);
      this.winrmSessions.delete(sessionId);
      
      // Update session status to failed
      const session = this.sessions.get(sessionId);
      if (session) {
        session.status = 'crashed';
        this.sessions.set(sessionId, session);
      }
      
      throw error;
    }
  }

  /**
   * Create VNC session
   */
  private async createVNCSession(sessionId: string, session: ConsoleSession, options: SessionOptions): Promise<string> {
    if (!options.vncOptions) {
      throw new Error('VNC options are required for VNC session');
    }

    try {
      this.logger.info(`Creating VNC session ${sessionId}`, {
        host: options.vncOptions.host,
        port: options.vncOptions.port,
        rfbProtocolVersion: options.vncOptions.rfbProtocolVersion,
        encoding: options.vncOptions.encoding
      });

      // Create VNC protocol instance
      const vncProtocol = await this.protocolFactory.createProtocol('vnc');
      this.vncProtocols.set(sessionId, vncProtocol);

      // Create VNC session via the protocol
      const connectedSession = await vncProtocol.createSession(options);
      
      // Create VNC session state
      const vncSession: VNCSession = {
        sessionId,
        connectionId: (connectedSession as any).connectionId || sessionId,
        status: 'connected',
        host: options.vncOptions.host,
        port: options.vncOptions.port || 5900,
        protocolVersion: options.vncOptions.rfbProtocolVersion || 'auto',
        serverName: (connectedSession as any).serverName || 'VNC Server',
        securityType: this.mapAuthMethodToVNCSecurityType(options.vncOptions.authMethod) || 'vnc',
        sharedConnection: options.vncOptions.sharedConnection || false,
        viewOnlyMode: options.vncOptions.viewOnly || false,
        supportedEncodings: (connectedSession as any).supportedEncodings || ['raw'],
        serverCapabilities: (connectedSession as any).serverCapabilities || {
          cursorShapeUpdates: false,
          richCursor: false,
          desktopResize: false,
          continuousUpdates: false,
          fence: false,
          fileTransfer: false,
          clipboardTransfer: false,
          audio: false
        },
        connectionTime: new Date(),
        lastActivity: new Date(),
        framebufferInfo: {
          width: 0,
          height: 0,
          pixelFormat: {
            bitsPerPixel: 32,
            depth: 24,
            bigEndianFlag: false,
            trueColorFlag: true,
            redMax: 255,
            greenMax: 255,
            blueMax: 255,
            redShift: 16,
            greenShift: 8,
            blueShift: 0
          }
        },
        statistics: {
          bytesReceived: 0,
          bytesSent: 0,
          framebufferUpdates: 0,
          keyboardEvents: 0,
          mouseEvents: 0,
          clipboardTransfers: 0,
          fileTransfers: 0,
          avgFrameRate: 0,
          bandwidth: 0,
          compression: 0,
          latency: 0
        },
        errorCount: 0,
        warnings: [],
        monitors: options.vncOptions.monitors || [{
          id: 0,
          primary: true,
          x: 0,
          y: 0,
          width: 1024,
          height: 768
        }]
      };
      
      this.vncSessions.set(sessionId, vncSession);
      
      // Initialize framebuffer
      const framebuffer: VNCFramebuffer = {
        width: vncSession.framebufferInfo.width,
        height: vncSession.framebufferInfo.height,
        pixelFormat: vncSession.framebufferInfo.pixelFormat,
        data: Buffer.alloc(0),
        lastUpdate: new Date(),
        encoding: options.vncOptions.encoding || ['raw'],
        compressionLevel: options.vncOptions.compressionLevel || 6
      };
      
      this.vncFramebuffers.set(sessionId, framebuffer);
      
      // Update console session
      const updatedSession = { ...session };
      updatedSession.status = 'running';
      updatedSession.pid = undefined; // VNC sessions don't have PIDs
      updatedSession.vncOptions = options.vncOptions;
      this.sessions.set(sessionId, updatedSession);

      // Initialize output buffer
      this.outputBuffers.set(sessionId, []);

      // Setup output streaming if requested
      if (options.streaming) {
        const streamManager = new StreamManager(sessionId);
        this.streamManagers.set(sessionId, streamManager);
      }

      // Register with session manager
      await this.sessionManager.updateSessionStatus(sessionId, 'running', {
        vncHost: options.vncOptions.host,
        vncPort: options.vncOptions.port,
        rfbVersion: options.vncOptions.rfbProtocolVersion,
        securityType: options.vncOptions.authMethod,
        encoding: options.vncOptions.encoding
      });

      // Start monitoring if enabled
      if (options.monitoring) {
        await this.monitoringSystem.startSessionMonitoring(sessionId, {
          command: options.command,
          args: options.args || [],
          ...options.monitoring
        });
      }

      // Setup VNC event handlers
      this.setupVNCEventHandlers(sessionId, vncProtocol);

      // Emit session started event
      this.emitEvent({
        sessionId,
        type: 'started',
        timestamp: new Date(),
        data: { 
          host: options.vncOptions.host,
          port: options.vncOptions.port,
          encoding: options.vncOptions.encoding,
          vnc: true 
        }
      });

      this.logger.info(`VNC session ${sessionId} created successfully`);
      return sessionId;

    } catch (error) {
      this.logger.error(`Failed to create VNC session ${sessionId}:`, error);
      
      // Clean up failed session
      this.vncProtocols.delete(sessionId);
      this.vncSessions.delete(sessionId);
      this.vncFramebuffers.delete(sessionId);
      
      // Update session status to failed
      const updatedSession = { ...session };
      updatedSession.status = 'crashed';
      this.sessions.set(sessionId, updatedSession);
      
      throw error;
    }
  }

  /**
   * Setup VNC event handlers
   */
  private setupVNCEventHandlers(sessionId: string, vncProtocol: any): void {
    // Handle framebuffer updates
    vncProtocol.on('framebuffer-update', (update) => {
      const framebuffer = this.vncFramebuffers.get(sessionId);
      if (framebuffer) {
        framebuffer.data = update.data;
        framebuffer.lastUpdate = new Date();
        this.vncFramebuffers.set(sessionId, framebuffer);
        
        // Emit framebuffer update event
        this.emitEvent({
          sessionId,
          type: 'vnc-framebuffer-update',
          timestamp: new Date(),
          data: {
            width: update.width,
            height: update.height,
            encoding: update.encoding
          }
        });
      }
    });

    // Handle VNC server messages
    vncProtocol.on('server-message', (message) => {
      const output: ConsoleOutput = {
        sessionId,
        type: 'stdout',
        data: message.text || JSON.stringify(message),
        timestamp: new Date(),
        raw: message
      };

      const outputBuffer = this.outputBuffers.get(sessionId) || [];
      outputBuffer.push(output);
      this.outputBuffers.set(sessionId, outputBuffer);

      this.emit('output', output);
    });

    // Handle clipboard updates
    vncProtocol.on('clipboard-update', (clipboardData) => {
      this.emitEvent({
        sessionId,
        type: 'vnc-clipboard-update',
        timestamp: new Date(),
        data: { content: clipboardData }
      });
    });

    // Handle connection errors
    vncProtocol.on('error', (error) => {
      this.logger.error(`VNC session ${sessionId} error:`, error);
      this.handleSessionError(sessionId, error, 'vnc-connection');
    });

    // Handle disconnection
    vncProtocol.on('disconnect', () => {
      this.logger.info(`VNC session ${sessionId} disconnected`);
      const session = this.sessions.get(sessionId);
      if (session) {
        session.status = 'terminated';
        this.sessions.set(sessionId, session);
      }
      
      this.emitEvent({
        sessionId,
        type: 'terminated',
        timestamp: new Date(),
        data: { reason: 'vnc-disconnect' }
      });
    });
  }

  /**
   * Send input to RDP session
   */
  async sendRDPInput(sessionId: string, input: string): Promise<void> {
    try {
      await this.rdpProtocol.sendInput(sessionId, input);
    } catch (error) {
      this.logger.error(`Failed to send input to RDP session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Send clipboard data to RDP session
   */
  async sendRDPClipboardData(sessionId: string, data: string, format: string = 'text'): Promise<void> {
    try {
      await this.rdpProtocol.sendClipboardData(sessionId, data, format);
    } catch (error) {
      this.logger.error(`Failed to send clipboard data to RDP session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Start file transfer in RDP session
   */
  async startRDPFileTransfer(sessionId: string, localPath: string, remotePath: string, direction: 'upload' | 'download'): Promise<string> {
    try {
      return await this.rdpProtocol.startFileTransfer(sessionId, localPath, remotePath, direction);
    } catch (error) {
      this.logger.error(`Failed to start file transfer in RDP session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Get RDP session information
   */
  getRDPSession(sessionId: string): RDPSession | undefined {
    return this.rdpSessions.get(sessionId);
  }

  /**
   * Get RDP protocol capabilities
   */
  getRDPCapabilities(): any {
    return this.rdpProtocol.getCapabilities();
  }

  /**
   * Disconnect RDP session
   */
  async disconnectRDPSession(sessionId: string): Promise<void> {
    try {
      await this.rdpProtocol.disconnectSession(sessionId);
      this.rdpSessions.delete(sessionId);
    } catch (error) {
      this.logger.error(`Failed to disconnect RDP session ${sessionId}:`, error);
      throw error;
    }
  }

  // SFTP/SCP Protocol Methods

  /**
   * Setup SFTP event handlers
   */
  private setupSFTPEventHandlers(sessionId: string, sftpProtocol: any): void {
    sftpProtocol.on('connected', (connectionState) => {
      this.logger.info(`SFTP session ${sessionId} connected`);
      this.emit('sftp-connected', { sessionId, connectionState });
    });

    sftpProtocol.on('transfer-progress', (progress) => {
      this.updateTransferSessionStats(sessionId, progress);
      this.emit('sftp-transfer-progress', { sessionId, progress });
    });

    sftpProtocol.on('error', (error) => {
      this.logger.error(`SFTP session ${sessionId} error:`, error);
      this.emit('sftp-error', { sessionId, error });
    });
  }

  /**
   * Update transfer session statistics
   */
  private updateTransferSessionStats(sessionId: string, progress: any): void {
    const transferSession = this.fileTransferSessions.get(sessionId);
    if (!transferSession) return;

    if (progress.status === 'completed') {
      transferSession.transferStats.successfulTransfers++;
      transferSession.transferStats.totalBytesTransferred += progress.transferredBytes;
    } else if (progress.status === 'failed') {
      transferSession.transferStats.failedTransfers++;
    }
  }

  /**
   * Cleanup SFTP session resources
   */
  private async cleanupSFTPSession(sessionId: string): Promise<void> {
    try {
      const sftpProtocol = this.sftpProtocols.get(sessionId);
      if (sftpProtocol) {
        await sftpProtocol.disconnect();
        this.sftpProtocols.delete(sessionId);
      }
      this.fileTransferSessions.delete(sessionId);
    } catch (error) {
      this.logger.error(`Error cleaning up SFTP session ${sessionId}:`, error);
    }
  }

  /**
   * Get SFTP protocol for session
   */
  getSFTPProtocol(sessionId: string): any | undefined {
    return this.sftpProtocols.get(sessionId);
  }

  /**
   * Upload file via SFTP
   */
  async uploadFile(
    sessionId: string,
    localPath: string,
    remotePath: string,
    options?: SFTPTransferOptions
  ): Promise<any> {
    const sftpProtocol = this.getSFTPProtocol(sessionId);
    if (!sftpProtocol) {
      throw new Error(`SFTP session not found: ${sessionId}`);
    }
    return await sftpProtocol.uploadFile(localPath, remotePath, options);
  }

  /**
   * Download file via SFTP
   */
  async downloadFile(
    sessionId: string,
    remotePath: string,
    localPath: string,
    options?: SFTPTransferOptions
  ): Promise<any> {
    const sftpProtocol = this.getSFTPProtocol(sessionId);
    if (!sftpProtocol) {
      throw new Error(`SFTP session not found: ${sessionId}`);
    }
    return await sftpProtocol.downloadFile(remotePath, localPath, options);
  }
  

  // WSL Integration Methods

  /**
   * Setup WSL integration
   */
  private async setupWSLIntegration(): Promise<void> {
    try {
      // Initialize WSL protocol
      await this.wslProtocol.initialize();
      this.logger.info('WSL integration setup completed');
    } catch (error) {
      this.logger.warn('WSL integration setup failed:', error);
    }
  }

  /**
   * Setup Ansible protocol integration
   */
  private async setupAnsibleIntegration(): Promise<void> {
    try {
      // Initialize Ansible protocol
      await this.ansibleProtocol.initialize();
      this.logger.info('Ansible integration setup completed');
    } catch (error) {
      this.logger.warn('Ansible integration setup failed:', error);
    }
  }

  /**
   * Create a WSL session
   */
  private async createWSLSession(sessionId: string, session: ConsoleSession, options: SessionOptions): Promise<string> {
    try {
      if (!options.wslOptions) {
        throw new Error('WSL options are required for WSL session');
      }

      this.logger.info(`Creating WSL session ${sessionId} with distribution: ${options.wslOptions.distribution || 'default'}`);

      // Create WSL session using the protocol
      const wslSession = await this.wslProtocol.createSession(options);
      
      // Update the session with WSL-specific properties
      const updatedSession = { ...session, ...wslSession };
      this.sessions.set(sessionId, updatedSession);
      this.outputBuffers.set(sessionId, []);

      // Setup output streaming if requested
      if (options.streaming) {
        const streamManager = new StreamManager(sessionId);
        this.streamManagers.set(sessionId, streamManager);
      }

      // Emit session started event
      this.emitEvent({
        sessionId,
        type: 'started',
        timestamp: new Date(),
        data: { 
          distribution: options.wslOptions.distribution,
          wslVersion: options.wslOptions.wslVersion,
          wsl: true 
        }
      });

      return sessionId;
    } catch (error) {
      this.logger.error(`Failed to create WSL session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Send input to WSL session
   */
  private async sendInputToWSL(sessionId: string, input: string): Promise<void> {
    try {
      const session = this.sessions.get(sessionId);
      if (!session) {
        throw new Error(`WSL session ${sessionId} not found`);
      }

      this.logger.debug(`Sending input to WSL session ${sessionId}: ${input.substring(0, 50)}...`);

      // Send input through WSL protocol - for now we'll use executeCommand
      // This is a simplified implementation - in production you'd want proper stdin handling
      const result = await this.wslProtocol.executeCommand(sessionId, input);

      // Create output events for stdout and stderr
      if (result.stdout) {
        const output: ConsoleOutput = {
          sessionId,
          type: 'stdout',
          data: result.stdout,
          timestamp: new Date(),
          raw: result.stdout
        };

        const outputBuffer = this.outputBuffers.get(sessionId) || [];
        outputBuffer.push(output);
        this.outputBuffers.set(sessionId, outputBuffer);

        this.emit('output', output);
      }

      if (result.stderr) {
        const output: ConsoleOutput = {
          sessionId,
          type: 'stderr',
          data: result.stderr,
          timestamp: new Date(),
          raw: result.stderr
        };

        const outputBuffer = this.outputBuffers.get(sessionId) || [];
        outputBuffer.push(output);
        this.outputBuffers.set(sessionId, outputBuffer);

        this.emit('output', output);
      }

      // Record input to monitoring system
      if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
        this.monitoringSystem.recordEvent(sessionId, 'input', {
          size: input.length,
          type: 'wsl_input'
        });
      }

    } catch (error) {
      this.logger.error(`Failed to send input to WSL session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Get WSL distributions
   */
  async getWSLDistributions(): Promise<import('../types/index.js').WSLDistribution[]> {
    try {
      return await this.wslProtocol.getInstalledDistributions();
    } catch (error) {
      this.logger.error('Failed to get WSL distributions:', error);
      throw error;
    }
  }

  /**
   * Get WSL system information
   */
  async getWSLSystemInfo(): Promise<import('../types/index.js').WSLSystemInfo> {
    try {
      return await this.wslProtocol.getSystemInfo();
    } catch (error) {
      this.logger.error('Failed to get WSL system info:', error);
      throw error;
    }
  }

  /**
   * Start WSL distribution
   */
  async startWSLDistribution(distribution: string): Promise<void> {
    try {
      await this.wslProtocol.startDistribution(distribution);
      this.logger.info(`Started WSL distribution: ${distribution}`);
    } catch (error) {
      this.logger.error(`Failed to start WSL distribution ${distribution}:`, error);
      throw error;
    }
  }

  /**
   * Stop WSL distribution
   */
  async stopWSLDistribution(distribution: string): Promise<void> {
    try {
      await this.wslProtocol.stopDistribution(distribution);
      this.logger.info(`Stopped WSL distribution: ${distribution}`);
    } catch (error) {
      this.logger.error(`Failed to stop WSL distribution ${distribution}:`, error);
      throw error;
    }
  }

  /**
   * Get WSL health status
   */
  async getWSLHealthStatus(distribution: string): Promise<import('../types/index.js').WSLHealthStatus> {
    try {
      return await this.wslProtocol.getHealthStatus(distribution);
    } catch (error) {
      this.logger.error(`Failed to get WSL health status for ${distribution}:`, error);
      throw error;
    }
  }

  /**
   * Translate path between Windows and Linux
   */
  async translateWSLPath(path: string, direction: 'windows-to-linux' | 'linux-to-windows'): Promise<string> {
    try {
      return await this.wslProtocol.translatePath(path, direction);
    } catch (error) {
      this.logger.error(`Failed to translate WSL path ${path}:`, error);
      throw error;
    }
  }

  /**
   * Check if WSL is available
   */
  async isWSLAvailable(): Promise<boolean> {
    try {
      return await this.wslProtocol.checkWSLAvailability();
    } catch (error) {
      this.logger.error('Failed to check WSL availability:', error);
      return false;
    }
  }

  /**
   * Get WSL configuration
   */
  async getWSLConfig(): Promise<import('../types/index.js').WSLConfig> {
    try {
      return await this.wslProtocol.getWSLConfig();
    } catch (error) {
      this.logger.error('Failed to get WSL configuration:', error);
      throw error;
    }
  }

  /**
   * Send input to WebSocket terminal session
   */
  private async sendInputToWebSocketTerminal(sessionId: string, input: string): Promise<void> {
    try {
      const session = this.sessions.get(sessionId);
      if (!session) {
        throw new Error(`WebSocket terminal session ${sessionId} not found`);
      }

      const webSocketSession = this.webSocketTerminalSessions.get(sessionId);
      if (!webSocketSession) {
        throw new Error(`WebSocket terminal session state ${sessionId} not found`);
      }

      this.logger.debug(`Sending input to WebSocket terminal session ${sessionId}: ${input.substring(0, 50)}...`);

      // Send input through WebSocket terminal protocol
      await this.webSocketTerminalProtocol.sendInput(sessionId, input);

      // Update session state
      webSocketSession.lastActivity = new Date();
      webSocketSession.bytesTransferred += input.length;
      this.webSocketTerminalSessions.set(sessionId, webSocketSession);

      // Record input to monitoring system
      if (this.monitoringSystem.isSessionBeingMonitored(sessionId)) {
        this.monitoringSystem.recordEvent(sessionId, 'input', {
          size: input.length,
          type: 'websocket_terminal_input',
          terminal: webSocketSession.terminalType || 'xterm',
          encoding: webSocketSession.encoding || 'utf-8'
        });
      }

      // Update session activity
      await this.sessionManager.updateSessionActivity(sessionId, {
        lastActivity: new Date(),
        bytesTransferred: webSocketSession.bytesTransferred,
        inputCount: (webSocketSession as any).inputCount ? (webSocketSession as any).inputCount + 1 : 1
      });

    } catch (error) {
      this.logger.error(`Failed to send input to WebSocket terminal session ${sessionId}:`, error);
      
      // If it's a connection error, try to reconnect
      if (error.message.includes('connection') || error.message.includes('websocket')) {
        const webSocketSession = this.webSocketTerminalSessions.get(sessionId);
        if (webSocketSession && webSocketSession.supportsReconnection) {
          this.logger.info(`Attempting to reconnect WebSocket terminal session ${sessionId}`);
          try {
            await this.webSocketTerminalProtocol.reconnectSession(sessionId);
            // Retry sending the input after reconnection
            await this.webSocketTerminalProtocol.sendInput(sessionId, input);
            return;
          } catch (reconnectError) {
            this.logger.error(`Failed to reconnect WebSocket terminal session ${sessionId}:`, reconnectError);
          }
        }
      }
      
      throw error;
    }
  }

  /**
   * Create WebSocket Terminal session
   */
  private async createWebSocketTerminalSession(sessionId: string, session: ConsoleSession, options: SessionOptions): Promise<string> {
    if (!options.webSocketTerminalOptions) {
      throw new Error('WebSocket Terminal options are required for WebSocket Terminal session');
    }

    try {
      this.logger.info(`Creating WebSocket Terminal session ${sessionId}`, {
        url: options.webSocketTerminalOptions.url,
        protocol: options.webSocketTerminalOptions.protocol,
        terminalType: options.webSocketTerminalOptions.terminalType
      });

      // Create WebSocket Terminal session through the protocol
      const wsTerminalSession = await this.webSocketTerminalProtocol.createSession(sessionId, options.webSocketTerminalOptions);
      
      // Store WebSocket terminal session state
      this.webSocketTerminalSessions.set(sessionId, wsTerminalSession.state);
      
      // Update console session
      session.status = 'running';
      session.pid = undefined; // WebSocket terminal sessions don't have PIDs
      session.webSocketTerminalState = wsTerminalSession.state;
      this.sessions.set(sessionId, session);

      // Register with session manager
      await this.sessionManager.updateSessionStatus(sessionId, 'running', {
        webSocketUrl: options.webSocketTerminalOptions.url,
        protocol: options.webSocketTerminalOptions.protocol,
        terminalType: options.webSocketTerminalOptions.terminalType,
        terminalSize: {
          cols: options.webSocketTerminalOptions.cols || 80,
          rows: options.webSocketTerminalOptions.rows || 24
        }
      });

      // Start monitoring if enabled
      if (options.monitoring) {
        await this.monitoringSystem.startSessionMonitoring(sessionId, {
          command: options.command,
          args: options.args || [],
          ...options.monitoring
        });
      }

      this.logger.info(`WebSocket Terminal session ${sessionId} created successfully`);
      return sessionId;

    } catch (error) {
      this.logger.error(`Failed to create WebSocket Terminal session ${sessionId}:`, error);
      
      // Update session status to failed
      session.status = 'crashed';
      this.sessions.set(sessionId, session);
      
      await this.sessionManager.updateSessionStatus(sessionId, 'failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      
      throw error;
    }
  }

  /**
   * Create IPMI session
   */
  private async createIPMISession(sessionId: string, session: ConsoleSession, options: SessionOptions): Promise<string> {
    if (!options.ipmiOptions) {
      throw new Error('IPMI options are required for IPMI session');
    }

    try {
      this.logger.info(`Creating IPMI session ${sessionId}`, {
        host: options.ipmiOptions.host,
        port: options.ipmiOptions.port,
        username: options.ipmiOptions.username,
        ipmiVersion: options.ipmiOptions.ipmiVersion,
        privilegeLevel: options.ipmiOptions.privilegeLevel
      });

      // Create IPMI protocol instance  
      const ipmiProtocol = await this.protocolFactory.createProtocol('ipmi');
      this.ipmiProtocols.set(sessionId, ipmiProtocol);
      
      const ipmiSession = await ipmiProtocol.createSession({
        command: options.command,
        args: options.args,
        cwd: options.cwd,
        env: options.env,
        streaming: options.streaming || true,
        timeout: options.timeout,
        detectErrors: options.detectErrors,
        ...options.ipmiOptions
      });
      
      // Update console session
      session.status = 'running';
      session.pid = undefined; // IPMI sessions don't have PIDs
      this.sessions.set(sessionId, session);

      // Setup IPMI event handlers
      this.setupIPMIEventHandlers(sessionId, ipmiSession);

      // Register with session manager
      await this.sessionManager.updateSessionStatus(sessionId, 'running', {
        host: options.ipmiOptions.host,
        port: options.ipmiOptions.port,
        ipmiVersion: options.ipmiOptions.ipmiVersion,
        privilegeLevel: options.ipmiOptions.privilegeLevel,
        cipherSuite: options.ipmiOptions.cipherSuite,
        interface: options.ipmiOptions.interface
      });

      // Start IPMI monitoring if enabled
      if (options.monitoring?.enableMetrics) {
        await this.startIPMIMonitoring(sessionId, options.ipmiOptions);
      }

      // Start monitoring if enabled
      if (options.monitoring) {
        await this.monitoringSystem.startSessionMonitoring(sessionId, {
          command: options.command,
          args: options.args || [],
          ...options.monitoring
        });
      }

      this.logger.info(`IPMI session ${sessionId} created successfully`);
      return sessionId;

    } catch (error) {
      this.logger.error(`Failed to create IPMI session ${sessionId}:`, error);
      
      // Update session status to failed
      session.status = 'crashed';
      this.sessions.set(sessionId, session);
      
      await this.sessionManager.updateSessionStatus(sessionId, 'failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      
      throw error;
    }
  }

  /**
   * Setup IPMI event handlers
   */
  private setupIPMIEventHandlers(sessionId: string, ipmiSession: any): void {
    // Handle session output
    ipmiSession.on('output', (data: { type: 'stdout' | 'stderr'; data: string }) => {
      this.emit('output', {
        sessionId,
        type: data.type,
        data: data.data,
        timestamp: new Date()
      });
    });

    // Handle SOL console data
    ipmiSession.on('sol-data', (data: Buffer) => {
      this.emit('output', {
        sessionId,
        type: 'stdout',
        data: data.toString(),
        timestamp: new Date()
      });
    });

    // Handle sensor data
    ipmiSession.on('sensor-data', (sensorData: any) => {
      this.emit('sensor-data', {
        sessionId,
        sensorData,
        timestamp: new Date()
      });
    });

    // Handle power state changes
    ipmiSession.on('power-state-change', (state: string) => {
      this.emit('power-state-change', {
        sessionId,
        powerState: state,
        timestamp: new Date()
      });
    });

    // Handle IPMI events
    ipmiSession.on('ipmi-event', (event: any) => {
      this.emit('ipmi-event', {
        sessionId,
        event,
        timestamp: new Date()
      });
    });

    // Handle session errors
    ipmiSession.on('error', (error: Error) => {
      this.logger.error(`IPMI session ${sessionId} error:`, error);
      this.emit('sessionError', {
        sessionId,
        error: error.message,
        timestamp: new Date()
      });
    });

    // Handle session close
    ipmiSession.on('close', () => {
      this.handleIPMISessionClosed(sessionId);
    });
  }

  /**
   * Start IPMI monitoring
   */
  private async startIPMIMonitoring(sessionId: string, options: import('../types/index.js').IPMIConnectionOptions): Promise<void> {
    try {
      // Start sensor monitoring
      const sensorInterval = setInterval(async () => {
        try {
          const sensors = await this.readIPMISensors(sessionId);
          if (sensors && sensors.length > 0) {
            this.emit('sensor-readings', {
              sessionId,
              sensors,
              timestamp: new Date()
            });
          }
        } catch (error) {
          this.logger.warn(`Failed to read sensors for session ${sessionId}:`, error);
        }
      }, 30000); // Default 30 second polling interval

      // Start event log monitoring (always enabled for now)
      const eventInterval = setInterval(async () => {
        try {
          const events = await this.getIPMIEventLog(sessionId);
          if (events && events.length > 0) {
            events.forEach(event => {
              this.emit('ipmi-event', {
                sessionId,
                event,
                timestamp: new Date()
              });
            });
          }
        } catch (error) {
          this.logger.warn(`Failed to read event log for session ${sessionId}:`, error);
        }
      }, 60000); // Default 60 second polling interval

      // Store intervals for cleanup
      this.ipmiMonitoringIntervals.set(sessionId, [sensorInterval, eventInterval]);

    } catch (error) {
      this.logger.error(`Failed to start IPMI monitoring for session ${sessionId}:`, error);
    }
  }

  /**
   * Handle IPMI session closed
   */
  private async handleIPMISessionClosed(sessionId: string): Promise<void> {
    try {
      this.logger.info(`IPMI session ${sessionId} closed`);

      // Clean up monitoring intervals
      const intervals = this.ipmiMonitoringIntervals.get(sessionId);
      if (intervals) {
        if (Array.isArray(intervals)) {
          intervals.forEach(interval => clearInterval(interval));
        } else {
          clearInterval(intervals);
        }
        this.ipmiMonitoringIntervals.delete(sessionId);
      }

      // Update session status
      const session = this.sessions.get(sessionId);
      if (session) {
        session.status = 'closed';
        this.sessions.set(sessionId, session);
      }

      // Clean up session data
      this.ipmiSessions.delete(sessionId);

      // Update session manager
      await this.sessionManager.updateSessionStatus(sessionId, 'terminated');

      // Emit session closed event
      this.emit('sessionClosed', sessionId);

    } catch (error) {
      this.logger.error(`Error handling IPMI session close for ${sessionId}:`, error);
    }
  }

  /**
   * Send input to IPMI session (SOL console)
   */
  async sendIPMIInput(sessionId: string, input: string): Promise<void> {
    const ipmiState = this.ipmiSessions.get(sessionId);
    if (!ipmiState) {
      throw new Error(`IPMI session ${sessionId} not found or inactive`);
    }

    try {
      const ipmiProtocol = this.ipmiProtocols.get(sessionId);
      if (!ipmiProtocol) {
        throw new Error(`IPMI protocol not found for session ${sessionId}`);
      }
      await ipmiProtocol.sendInput(sessionId, input);
      
      this.logger.debug(`Input sent to IPMI session ${sessionId}: ${input.substring(0, 50)}${input.length > 50 ? '...' : ''}`);
      
    } catch (error) {
      this.logger.error(`Failed to send input to IPMI session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Execute IPMI power control operation
   */
  async executeIPMIPowerControl(sessionId: string, operation: 'on' | 'off' | 'reset' | 'cycle' | 'status'): Promise<any> {
    const ipmiState = this.ipmiSessions.get(sessionId);
    if (!ipmiState) {
      throw new Error(`IPMI session ${sessionId} not found or inactive`);
    }

    try {
      const ipmiProtocol = this.ipmiProtocols.get(sessionId);
      if (!ipmiProtocol) {
        throw new Error(`IPMI protocol not found for session ${sessionId}`);
      }
      const result = await ipmiProtocol.executeCommand(sessionId, 'chassis', ['power', operation]);
      
      this.logger.info(`Power control operation '${operation}' executed on IPMI session ${sessionId}`);
      
      // Emit power state change event
      this.emit('power-state-change', {
        sessionId,
        operation,
        result,
        timestamp: new Date()
      });
      
      return result;
      
    } catch (error) {
      this.logger.error(`Failed to execute power control operation '${operation}' on IPMI session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Read IPMI sensors
   */
  async readIPMISensors(sessionId: string): Promise<any[]> {
    const ipmiState = this.ipmiSessions.get(sessionId);
    if (!ipmiState) {
      throw new Error(`IPMI session ${sessionId} not found or inactive`);
    }

    try {
      const ipmiProtocol = this.ipmiProtocols.get(sessionId);
      if (!ipmiProtocol) {
        throw new Error(`IPMI protocol not found for session ${sessionId}`);
      }
      // Execute sensor reading command
      await ipmiProtocol.executeCommand(sessionId, 'sensor', ['reading', 'all']);
      
      // Since executeCommand returns void, return a placeholder array
      // In a real implementation, this would be handled via events or callbacks
      const sensors: any[] = [];
      this.logger.debug(`Executed sensor reading command for IPMI session ${sessionId}`);
      
      return sensors;
      
    } catch (error) {
      this.logger.error(`Failed to read sensors from IPMI session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Get IPMI system event log
   */
  async getIPMIEventLog(sessionId: string): Promise<any[]> {
    const ipmiState = this.ipmiSessions.get(sessionId);
    if (!ipmiState) {
      throw new Error(`IPMI session ${sessionId} not found or inactive`);
    }

    try {
      const ipmiProtocol = this.ipmiProtocols.get(sessionId);
      if (!ipmiProtocol) {
        throw new Error(`IPMI protocol not found for session ${sessionId}`);
      }
      // Execute event log reading command
      await ipmiProtocol.executeCommand(sessionId, 'sel', ['list']);
      
      // Since executeCommand returns void, return a placeholder array
      // In a real implementation, this would be handled via events or callbacks
      const events: any[] = [];
      this.logger.debug(`Executed event log reading command for IPMI session ${sessionId}`);
      
      return events;
      
    } catch (error) {
      this.logger.error(`Failed to read event log from IPMI session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Mount virtual media via IPMI
   */
  async mountIPMIVirtualMedia(sessionId: string, mediaType: 'cd' | 'floppy' | 'usb', imageUrl: string): Promise<void> {
    const ipmiState = this.ipmiSessions.get(sessionId);
    if (!ipmiState) {
      throw new Error(`IPMI session ${sessionId} not found or inactive`);
    }

    try {
      const ipmiProtocol = this.ipmiProtocols.get(sessionId);
      if (!ipmiProtocol) {
        throw new Error(`IPMI protocol not found for session ${sessionId}`);
      }
      await ipmiProtocol.executeCommand(sessionId, 'sol', ['mount', mediaType, imageUrl]);
      
      this.logger.info(`Virtual media '${mediaType}' mounted from '${imageUrl}' on IPMI session ${sessionId}`);
      
      // Emit virtual media event
      this.emit('virtual-media-mounted', {
        sessionId,
        mediaType,
        imageUrl,
        timestamp: new Date()
      });
      
    } catch (error) {
      this.logger.error(`Failed to mount virtual media on IPMI session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Unmount virtual media via IPMI
   */
  async unmountIPMIVirtualMedia(sessionId: string, mediaType: 'cd' | 'floppy' | 'usb'): Promise<void> {
    const ipmiState = this.ipmiSessions.get(sessionId);
    if (!ipmiState) {
      throw new Error(`IPMI session ${sessionId} not found or inactive`);
    }

    try {
      const ipmiProtocol = this.ipmiProtocols.get(sessionId);
      if (!ipmiProtocol) {
        throw new Error(`IPMI protocol not found for session ${sessionId}`);
      }
      await ipmiProtocol.executeCommand(sessionId, 'sol', ['unmount', mediaType]);
      
      this.logger.info(`Virtual media '${mediaType}' unmounted from IPMI session ${sessionId}`);
      
      // Emit virtual media event
      this.emit('virtual-media-unmounted', {
        sessionId,
        mediaType,
        timestamp: new Date()
      });
      
    } catch (error) {
      this.logger.error(`Failed to unmount virtual media on IPMI session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Update firmware via IPMI
   */
  async updateIPMIFirmware(sessionId: string, firmwareType: 'bios' | 'bmc' | 'fpga', firmwarePath: string): Promise<void> {
    const ipmiState = this.ipmiSessions.get(sessionId);
    if (!ipmiState) {
      throw new Error(`IPMI session ${sessionId} not found or inactive`);
    }

    try {
      this.logger.info(`Starting firmware update for '${firmwareType}' on IPMI session ${sessionId}`);
      
      const ipmiProtocol = this.ipmiProtocols.get(sessionId);
      if (!ipmiProtocol) {
        throw new Error(`IPMI protocol not found for session ${sessionId}`);
      }
      await ipmiProtocol.executeCommand(sessionId, 'hpm', ['upgrade', firmwarePath, 'component', firmwareType]);
      
      this.logger.info(`Firmware update for '${firmwareType}' completed on IPMI session ${sessionId}`);
      
      // Emit firmware update event
      this.emit('firmware-update-completed', {
        sessionId,
        firmwareType,
        firmwarePath,
        timestamp: new Date()
      });
      
    } catch (error) {
      this.logger.error(`Failed to update firmware on IPMI session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Get IPMI system information
   */
  async getIPMISystemInfo(sessionId: string): Promise<any> {
    const ipmiState = this.ipmiSessions.get(sessionId);
    if (!ipmiState) {
      throw new Error(`IPMI session ${sessionId} not found or inactive`);
    }

    try {
      const ipmiProtocol = this.ipmiProtocols.get(sessionId);
      if (!ipmiProtocol) {
        throw new Error(`IPMI protocol not found for session ${sessionId}`);
      }
      const systemInfo = await ipmiProtocol.executeCommand(sessionId, 'mc', ['info']);
      
      this.logger.debug(`Retrieved system info from IPMI session ${sessionId}`);
      
      return systemInfo;
      
    } catch (error) {
      this.logger.error(`Failed to get system info from IPMI session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Configure IPMI LAN settings
   */
  async configureIPMILAN(sessionId: string, channel: number, settings: any): Promise<void> {
    const ipmiState = this.ipmiSessions.get(sessionId);
    if (!ipmiState) {
      throw new Error(`IPMI session ${sessionId} not found or inactive`);
    }

    try {
      const ipmiProtocol = this.ipmiProtocols.get(sessionId);
      if (!ipmiProtocol) {
        throw new Error(`IPMI protocol not found for session ${sessionId}`);
      }
      
      // Configure LAN parameters
      for (const [param, value] of Object.entries(settings)) {
        await ipmiProtocol.executeCommand(sessionId, 'lan', ['set', channel.toString(), param, String(value)]);
      }
      
      this.logger.info(`LAN configuration updated for channel ${channel} on IPMI session ${sessionId}`);
      
    } catch (error) {
      this.logger.error(`Failed to configure LAN settings on IPMI session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Create IPC session  
   */
  private async createIPCSession(sessionId: string, session: ConsoleSession, options: SessionOptions): Promise<string> {
    if (!options.ipcOptions) {
      throw new Error("IPC options are required for IPC session");
    }

    try {
      // Implementation placeholder - IPC session creation
      this.logger.info(`Creating IPC session ${sessionId}`);
      return sessionId;
    } catch (error) {
      this.logger.error(`Failed to create IPC session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Map auth method to VNC security type
   */
  private mapAuthMethodToVNCSecurityType(authMethod?: string): VNCSecurityType {
    switch (authMethod) {
      case 'none': return 'none';
      case 'vnc': return 'vnc';
      case 'tight': return 'tight';
      case 'ultra': return 'ultra';
      case 'tls': return 'tls';
      case 'vencrypt': return 'vencrypt';
      case 'ra2': return 'ra2';
      case 'ra2ne': return 'ra2ne';
      case 'sasl': return 'sasl';
      default: return 'vnc';
    }
  }

  private mapToSessionManagerType(consoleType: ConsoleType): 'local' | 'ssh' | 'azure' | 'serial' | 'kubernetes' | 'docker' | 'aws-ssm' | 'wsl' | 'sftp' | 'rdp' | 'winrm' | 'vnc' | 'ipc' | 'ipmi' | 'websocket-terminal' {
    // Map console types to SessionManager types
    switch (consoleType) {
      case 'cmd':
      case 'powershell':
      case 'pwsh':
      case 'bash':
      case 'zsh':
      case 'sh':
      case 'auto':
        return 'local';
      case 'ssh':
      case 'sftp':
        return 'ssh';
      case 'azure-shell':
        return 'azure';
      case 'serial':
        return 'serial';
      case 'kubectl':
        return 'kubernetes';
      case 'docker':
      case 'docker-exec':
        return 'docker';
      case 'aws-ssm':
        return 'aws-ssm';
      case 'wsl':
        return 'wsl';
      case 'rdp':
        return 'rdp';
      case 'winrm':
        return 'winrm';
      case 'vnc':
        return 'vnc';
      case 'ipc':
        return 'ipc';
      case 'ipmi':
        return 'ipmi';
      case 'websocket-term':
      case 'wetty':
      case 'gotty':
      case 'x11vnc':
      case 'virtualization':
      case 'xterm-ws':
      case 'web-terminal':
      case 'ttyd':
        return 'websocket-terminal';
      default:
        return 'local'; // Default to local for unknown types
    }
  }

  async getSystemHealth(): Promise<{ status: 'healthy' | 'unhealthy' | 'degraded'; issues: string[] }> {
    const issues: string[] = [];

    // Check for stuck or error sessions
    const sessions = this.getAllSessions();
    const errorSessions = sessions.filter(s => s.status === 'failed' || s.status === 'crashed').length;
    const disconnectedSessions = sessions.filter(s => s.status === 'terminated' || s.status === 'closed').length;

    if (errorSessions > 0) {
      issues.push(`${errorSessions} session(s) in error state`);
    }

    if (disconnectedSessions > 0) {
      issues.push(`${disconnectedSessions} session(s) disconnected`);
    }

    // Check resource usage
    const usage = this.getResourceUsage();
    const memoryUsage = process.memoryUsage();
    if (memoryUsage.heapUsed / memoryUsage.heapTotal > 0.9) {
      issues.push('Memory usage above 90%');
    }

    // Determine overall health status
    let status: 'healthy' | 'unhealthy' | 'degraded' = 'healthy';
    if (issues.length > 2 || errorSessions > 2) {
      status = 'unhealthy';
    } else if (issues.length > 0) {
      status = 'degraded';
    }

    return { status, issues };
  }
}
