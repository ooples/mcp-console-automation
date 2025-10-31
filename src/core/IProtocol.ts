import { EventEmitter } from 'events';
import {
  ConsoleSession,
  ConsoleOutput,
  SessionOptions,
  ConsoleType,
  HealthCheckResult,
} from '../types/index.js';

/**
 * Core protocol interface that all console protocols must implement
 */
export interface IProtocol extends EventEmitter {
  readonly type: ConsoleType;
  readonly capabilities: ProtocolCapabilities;

  // Lifecycle methods
  initialize(): Promise<void>;
  dispose(): Promise<void>;

  // Session management
  createSession(options: SessionOptions): Promise<ConsoleSession>;
  closeSession(sessionId: string): Promise<void>;
  getAllSessions(): ConsoleSession[];
  getActiveSessions(): ConsoleSession[];
  getSessionCount(): number;

  // Command execution
  executeCommand(
    sessionId: string,
    command: string,
    args?: string[]
  ): Promise<void>;
  sendInput(sessionId: string, input: string): Promise<void>;
  getOutput(sessionId: string, since?: Date): Promise<ConsoleOutput[]>;

  // Session state management
  getSessionState(sessionId: string): Promise<SessionState>;

  // Health and monitoring
  getHealthStatus(): Promise<ProtocolHealthStatus>;

  // Error handling and recovery
  handleError(
    error: Error,
    context: ErrorContext
  ): Promise<ErrorRecoveryResult>;
  recoverSession(sessionId: string): Promise<boolean>;

  // Resource management
  getResourceUsage(): ResourceUsage;
  cleanup(): Promise<void>;
}

/**
 * Protocol capabilities and configuration
 */
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

/**
 * Protocol health status
 */
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

/**
 * Session state information
 */
export interface SessionState {
  sessionId: string;
  status:
    | 'running'
    | 'stopped'
    | 'crashed'
    | 'terminated'
    | 'failed'
    | 'paused'
    | 'initializing'
    | 'recovering'
    | 'closed';
  isOneShot: boolean;
  isPersistent: boolean;
  createdAt: Date;
  lastActivity?: Date;
  pid?: number;
  exitCode?: number;
  metadata?: Record<string, any>;
}

/**
 * Command execution options
 */
export interface CommandExecutionOptions {
  timeout?: number;
  workingDirectory?: string;
  environment?: Record<string, string>;
  encoding?: string;
  shell?: boolean;
  detached?: boolean;
  uid?: number;
  gid?: number;
  windowsVerbatimArguments?: boolean;
  windowsHide?: boolean;
  signal?: AbortSignal;
}

/**
 * Wait operation configuration
 */
export interface WaitOptions {
  timeout?: number;
  interval?: number;
  condition?: (output: string) => boolean;
  pattern?: RegExp;
  maxAttempts?: number;
}

/**
 * Wait operation result
 */
export interface WaitResult {
  success: boolean;
  output?: string;
  timeout: boolean;
  attempts: number;
  duration: number;
  error?: string;
}

// Note: HealthCheckResult is imported from types/index.ts

/**
 * Error Context and Recovery
 */
export interface ErrorContext {
  sessionId?: string;
  command?: string;
  timestamp: Date;
  operation?: string;
  stack?: string;
  metadata?: Record<string, any>;
}

export interface ErrorRecoveryResult {
  recovered: boolean;
  strategy: string;
  attempts: number;
  duration: number;
  newSessionId?: string;
  error?: string;
}

/**
 * Resource usage information
 */
export interface ResourceUsage {
  memory: {
    used: number;
    available: number;
    peak: number;
  };
  cpu: {
    usage: number;
    load: number[];
  };
  network: {
    bytesIn: number;
    bytesOut: number;
    connectionsActive: number;
  };
  storage: {
    bytesRead: number;
    bytesWritten: number;
  };
  sessions: {
    active: number;
    total: number;
    peak: number;
  };
}
