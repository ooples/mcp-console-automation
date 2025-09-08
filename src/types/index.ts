export type ConsoleType = 'cmd' | 'powershell' | 'pwsh' | 'bash' | 'zsh' | 'sh' | 'auto' | 'ssh';

export interface ConsoleSession {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  createdAt: Date;
  pid?: number;
  status: 'running' | 'stopped' | 'crashed';
  exitCode?: number;
  type?: ConsoleType;
  streaming?: boolean;
}

export interface ConsoleOutput {
  sessionId: string;
  type: 'stdout' | 'stderr';
  data: string;
  timestamp: Date;
  raw?: string;
}

export interface ErrorPattern {
  pattern: RegExp;
  type: 'error' | 'warning' | 'exception';
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

// Extended error pattern for advanced error detection
export interface ExtendedErrorPattern extends ErrorPattern {
  category: string;
  language?: string;
  remediation?: string;
  tags?: string[];
  contexts?: string[];
  retryable?: boolean;
  filePathPattern?: RegExp;
  lineNumberPattern?: RegExp;
}

// Error analysis and reporting types
export interface ErrorContext {
  beforeLines?: string[];
  afterLines?: string[];
  fullStackTrace?: string;
  environment?: Record<string, string>;
  workingDirectory?: string;
}

export interface ParsedError {
  pattern: ExtendedErrorPattern;
  match: string;
  line: number;
  context?: ErrorContext;
  extractedInfo?: {
    filePath?: string;
    lineNumber?: number;
    columnNumber?: number;
    errorCode?: string;
    stackTrace?: string[];
    suggestion?: string;
  };
}

export interface ErrorAnalysis {
  totalErrors: number;
  criticalErrors: number;
  highErrors: number;
  mediumErrors: number;
  lowErrors: number;
  categories: Record<string, number>;
  languages: Record<string, number>;
  correlatedErrors: CorrelatedError[];
  rootCauseAnalysis: RootCauseAnalysis[];
  suggestions: string[];
  retryableErrors: ParsedError[];
}

export interface CorrelatedError {
  primaryError: ParsedError;
  relatedErrors: ParsedError[];
  confidence: number;
  description: string;
}

export interface RootCauseAnalysis {
  cause: string;
  affectedErrors: ParsedError[];
  severity: 'low' | 'medium' | 'high' | 'critical';
  remediation: string;
  confidence: number;
}

export interface ErrorReport {
  summary: {
    totalLines: number;
    errorsFound: number;
    severityBreakdown: Record<string, number>;
    categoryBreakdown: Record<string, number>;
  };
  errors: ParsedError[];
  analysis: ErrorAnalysis;
  recommendations: string[];
  structuredOutput: any;
}

export interface ReportingOptions {
  includeStackTraces?: boolean;
  includeContext?: boolean;
  includeRemediation?: boolean;
  maxContextLines?: number;
  format?: 'json' | 'markdown' | 'html' | 'plain';
  severity?: 'low' | 'medium' | 'high' | 'critical';
  categories?: string[];
  languages?: string[];
}

export interface MonitoringIntegration {
  type: 'webhook' | 'file' | 'console' | 'custom';
  endpoint?: string;
  filePath?: string;
  customHandler?: (report: ErrorReport) => Promise<void>;
  threshold?: {
    criticalErrors?: number;
    totalErrors?: number;
    severityScore?: number;
  };
}

export interface AlertConfig {
  enabled: boolean;
  channels: ('email' | 'slack' | 'webhook' | 'console')[];
  threshold: {
    critical: number;
    high: number;
    total: number;
  };
  cooldownMinutes: number;
}

export interface ConsoleEvent {
  sessionId: string;
  type: 'started' | 'stopped' | 'error' | 'input' | 'output';
  timestamp: Date;
  data?: any;
}

export interface SessionOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  rows?: number;
  cols?: number;
  detectErrors?: boolean;
  patterns?: ErrorPattern[];
  timeout?: number;
  shell?: boolean | string;
  consoleType?: ConsoleType;
  streaming?: boolean;
  maxBuffer?: number;
  monitoring?: MonitoringOptions;
  sshOptions?: SSHConnectionOptions;
  connectionPooling?: ConnectionPoolingOptions;
}

// Connection Pooling Configuration
export interface ConnectionPoolingOptions {
  maxConnectionsPerHost?: number;
  connectionIdleTimeout?: number;
  keepAliveInterval?: number;
  connectionRetryAttempts?: number;
  enableHealthChecks?: boolean;
  poolingStrategy?: 'round-robin' | 'least-connections' | 'random';
}

// SSH Connection Options
export interface SSHConnectionOptions {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
  privateKeyPath?: string;
  passphrase?: string;
  strictHostKeyChecking?: boolean;
  knownHostsFile?: string;
  timeout?: number;
  keepAliveCountMax?: number;
  keepAliveInterval?: number;
  readyTimeout?: number;
  serverAliveInterval?: number;
  serverAliveCountMax?: number;
}

// Connection Pool Types
export interface PooledConnection {
  id: string;
  host: string;
  port: number;
  username: string;
  connection: any; // SSH2 Client instance
  createdAt: Date;
  lastUsed: Date;
  activeSessionCount: number;
  isHealthy: boolean;
  healthCheckAt?: Date;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
  metadata?: Record<string, any>;
}

export interface ConnectionPoolStats {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  healthyConnections: number;
  unhealthyConnections: number;
  connectionsByHost: Record<string, number>;
  averageConnectionAge: number;
  totalReconnectAttempts: number;
  lastHealthCheckAt: Date;
}

export interface ConnectionPoolConfig {
  maxConnectionsPerHost: number;
  connectionIdleTimeout: number;
  keepAliveInterval: number;
  connectionRetryAttempts: number;
  healthCheckInterval: number;
  cleanupInterval: number;
  enableMetrics: boolean;
  enableLogging: boolean;
  poolingStrategy: 'round-robin' | 'least-connections' | 'random';
  connectionTimeout: number;
  maxReconnectAttempts: number;
  circuitBreakerThreshold: number;
}

// Session Management Types
export interface SessionState {
  id: string;
  status: 'initializing' | 'running' | 'paused' | 'stopped' | 'failed' | 'recovering';
  type: 'local' | 'ssh';
  createdAt: Date;
  lastActivity: Date;
  recoveryAttempts: number;
  maxRecoveryAttempts: number;
  persistentData?: Record<string, any>;
  connectionId?: string; // For SSH sessions
  pid?: number; // For local sessions
  healthScore: number;
  metadata?: Record<string, any>;
}

export interface SessionRecoveryOptions {
  enableAutoRecovery: boolean;
  maxRecoveryAttempts: number;
  recoveryDelay: number;
  backoffMultiplier: number;
  persistSessionData: boolean;
  healthCheckInterval: number;
}

export interface SessionManagerConfig {
  maxSessions: number;
  sessionTimeout: number;
  cleanupInterval: number;
  persistenceEnabled: boolean;
  persistencePath?: string;
  recoveryOptions: SessionRecoveryOptions;
  enableMetrics: boolean;
  enableLogging: boolean;
  heartbeatInterval: number;
}

export interface SessionManagerStats {
  totalSessions: number;
  activeSessions: number;
  pausedSessions: number;
  failedSessions: number;
  recoveringSessions: number;
  sessionsByType: Record<string, number>;
  averageSessionAge: number;
  totalRecoveryAttempts: number;
  successfulRecoveries: number;
  failedRecoveries: number;
  lastCleanupAt: Date;
}

// Monitoring and Observability Types
export interface MonitoringOptions {
  enableMetrics?: boolean;
  enableTracing?: boolean;
  enableProfiling?: boolean;
  enableAuditing?: boolean;
  enableAnomalyDetection?: boolean;
  customTags?: Record<string, string>;
  slaConfig?: SLAConfig;
}

export interface SLAConfig {
  responseTime?: number;
  availabilityThreshold?: number;
  errorRateThreshold?: number;
  notifications?: NotificationConfig[];
}

export interface NotificationConfig {
  type: 'email' | 'webhook' | 'slack' | 'console';
  config: Record<string, any>;
  triggers: NotificationTrigger[];
}

export interface NotificationTrigger {
  event: 'sla_breach' | 'error_threshold' | 'anomaly_detected' | 'session_failure';
  condition?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface SystemMetrics {
  timestamp: Date;
  cpu: {
    usage: number;
    cores: number;
    load: number[];
  };
  memory: {
    total: number;
    used: number;
    free: number;
    percentage: number;
  };
  disk: {
    total: number;
    used: number;
    free: number;
    percentage: number;
  };
  network: {
    bytesIn: number;
    bytesOut: number;
    packetsIn: number;
    packetsOut: number;
  };
  processes: ProcessMetrics[];
}

export interface ProcessMetrics {
  pid: number;
  sessionId?: string;
  name: string;
  cpu: number;
  memory: number;
  disk: {
    read: number;
    write: number;
  };
  network: {
    bytesIn: number;
    bytesOut: number;
  };
  uptime: number;
  status: string;
}

export interface PerformanceProfile {
  sessionId: string;
  command: string;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  metrics: {
    avgCpuUsage: number;
    peakMemoryUsage: number;
    totalDiskIO: number;
    totalNetworkIO: number;
  };
  bottlenecks: Bottleneck[];
}

export interface Bottleneck {
  type: 'cpu' | 'memory' | 'disk' | 'network';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  timestamp: Date;
  duration: number;
  impact: number;
}

export interface LogEntry {
  timestamp: Date;
  level: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  message: string;
  sessionId?: string;
  userId?: string;
  source: string;
  metadata?: Record<string, any>;
  traceId?: string;
  spanId?: string;
}

export interface AuditEvent {
  timestamp: Date;
  eventType: 'session_created' | 'session_stopped' | 'command_executed' | 'error_detected' | 'sla_breach';
  sessionId?: string;
  userId?: string;
  details: Record<string, any>;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  compliance?: ComplianceInfo;
}

export interface ComplianceInfo {
  standards: string[];
  classification: 'public' | 'internal' | 'confidential' | 'restricted';
  retention: number;
  encrypted: boolean;
}

export interface Alert {
  id: string;
  timestamp: Date;
  type: 'performance' | 'error' | 'security' | 'compliance' | 'anomaly';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  sessionId?: string;
  source: string;
  resolved: boolean;
  resolvedAt?: Date;
  metadata?: Record<string, any>;
}

export interface Dashboard {
  id: string;
  name: string;
  widgets: DashboardWidget[];
  filters: DashboardFilter[];
  refreshInterval: number;
  permissions: string[];
}

export interface DashboardWidget {
  id: string;
  type: 'metric' | 'chart' | 'table' | 'alert' | 'log';
  title: string;
  config: Record<string, any>;
  position: { x: number; y: number; width: number; height: number };
  query?: string;
}

export interface DashboardFilter {
  name: string;
  type: 'select' | 'multiselect' | 'daterange' | 'text';
  options?: string[];
  defaultValue?: any;
}

export interface TraceSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  operationName: string;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  tags: Record<string, any>;
  logs: TraceLog[];
  status: 'ok' | 'error' | 'timeout';
}

export interface TraceLog {
  timestamp: Date;
  fields: Record<string, any>;
}

export interface Anomaly {
  id: string;
  timestamp: Date;
  type: 'statistical' | 'pattern' | 'threshold';
  metric: string;
  value: number;
  expectedValue: number;
  deviation: number;
  confidence: number;
  sessionId?: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

// Re-export workflow types for easy access
export * from './workflow.js';