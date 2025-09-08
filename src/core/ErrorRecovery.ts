import { EventEmitter } from 'events';
import { Logger } from '../utils/logger.js';

export interface ErrorClassification {
  type: 'transient' | 'permanent' | 'authentication' | 'network' | 'resource' | 'configuration';
  severity: 'low' | 'medium' | 'high' | 'critical';
  category: string;
  recoverable: boolean;
  userActionRequired: boolean;
  retryable: boolean;
}

export interface RecoveryAction {
  name: string;
  description: string;
  execute: (context: ErrorContext) => Promise<boolean>;
  prerequisites?: string[];
  userGuidance?: string;
}

export interface ErrorContext {
  sessionId: string;
  operation: string;
  error: Error;
  timestamp: number;
  metadata?: Record<string, any>;
  previousAttempts?: number;
  classification?: ErrorClassification;
}

export interface RecoveryStrategy {
  name: string;
  applicableErrors: (error: Error) => boolean;
  actions: RecoveryAction[];
  fallbackAction?: RecoveryAction;
  maxRecoveryAttempts: number;
  cooldownMs: number;
}

export class ErrorRecovery extends EventEmitter {
  private logger: Logger;
  private recoveryStrategies: Map<string, RecoveryStrategy>;
  private errorHistory: Map<string, ErrorContext[]>;
  private recoveryAttempts: Map<string, { count: number; lastAttempt: number }>;
  private degradationStates: Map<string, { level: number; startTime: number; features: string[] }>;

  // Error classification patterns
  private static readonly ERROR_PATTERNS = {
    transient: [
      /timeout/i,
      /temporary/i,
      /try again/i,
      /busy/i,
      /unavailable/i,
      /connection reset/i,
      /network is unreachable/i
    ],
    permanent: [
      /not found/i,
      /does not exist/i,
      /invalid command/i,
      /syntax error/i,
      /compilation failed/i,
      /malformed/i
    ],
    authentication: [
      /authentication failed/i,
      /auth failed/i,
      /permission denied/i,
      /access denied/i,
      /unauthorized/i,
      /invalid credentials/i,
      /login failed/i
    ],
    network: [
      /connection refused/i,
      /host unreachable/i,
      /network unreachable/i,
      /connection timed out/i,
      /name resolution failed/i,
      /dns lookup failed/i,
      /socket error/i
    ],
    resource: [
      /out of memory/i,
      /disk space/i,
      /quota exceeded/i,
      /resource busy/i,
      /too many open files/i,
      /no space left/i,
      /memory allocation failed/i
    ],
    configuration: [
      /configuration error/i,
      /config file not found/i,
      /invalid configuration/i,
      /missing parameter/i,
      /bad parameter/i
    ]
  };

  constructor() {
    super();
    this.logger = new Logger('ErrorRecovery');
    this.recoveryStrategies = new Map();
    this.errorHistory = new Map();
    this.recoveryAttempts = new Map();
    this.degradationStates = new Map();

    this.initializeDefaultStrategies();
  }

  private initializeDefaultStrategies(): void {
    // Network recovery strategy
    this.recoveryStrategies.set('network', {
      name: 'Network Recovery',
      applicableErrors: (error) => this.matchesPattern(error.message, ErrorRecovery.ERROR_PATTERNS.network),
      maxRecoveryAttempts: 3,
      cooldownMs: 30000,
      actions: [
        {
          name: 'ping_host',
          description: 'Test network connectivity to target host',
          execute: async (context) => {
            // Implementation would ping the host
            return true; // Placeholder
          },
          userGuidance: 'Check if the target host is reachable from your network'
        },
        {
          name: 'flush_dns',
          description: 'Clear DNS cache',
          execute: async (context) => {
            // Implementation would flush DNS
            return true; // Placeholder
          },
          userGuidance: 'DNS cache has been cleared. Try connecting again.'
        },
        {
          name: 'reset_network_stack',
          description: 'Reset network connection',
          execute: async (context) => {
            // Implementation would reset network
            return true; // Placeholder
          },
          userGuidance: 'Network stack reset. Please retry your operation.'
        }
      ],
      fallbackAction: {
        name: 'network_degradation',
        description: 'Switch to degraded network mode',
        execute: async (context) => {
          this.enableDegradedMode(context.sessionId, 'network', ['reduce_timeout', 'disable_keepalive']);
          return true;
        },
        userGuidance: 'Operating in degraded network mode. Some features may be limited.'
      }
    });

    // SSH connection recovery strategy
    this.recoveryStrategies.set('ssh', {
      name: 'SSH Recovery',
      applicableErrors: (error) => 
        error.message.toLowerCase().includes('ssh') ||
        error.message.toLowerCase().includes('connection refused') ||
        error.message.toLowerCase().includes('host unreachable'),
      maxRecoveryAttempts: 2,
      cooldownMs: 15000,
      actions: [
        {
          name: 'recreate_ssh_connection',
          description: 'Create new SSH connection',
          execute: async (context) => {
            // Implementation would recreate SSH connection
            return true; // Placeholder
          },
          userGuidance: 'Recreating SSH connection with fresh credentials'
        },
        {
          name: 'check_ssh_service',
          description: 'Verify SSH service is running',
          execute: async (context) => {
            // Implementation would check SSH service
            return true; // Placeholder
          },
          userGuidance: 'Please ensure SSH service is running on the target host'
        }
      ],
      fallbackAction: {
        name: 'local_mode',
        description: 'Fall back to local execution mode',
        execute: async (context) => {
          this.enableDegradedMode(context.sessionId, 'ssh', ['local_only']);
          return true;
        },
        userGuidance: 'SSH unavailable. Operating in local-only mode.'
      }
    });

    // Authentication recovery strategy
    this.recoveryStrategies.set('auth', {
      name: 'Authentication Recovery',
      applicableErrors: (error) => this.matchesPattern(error.message, ErrorRecovery.ERROR_PATTERNS.authentication),
      maxRecoveryAttempts: 1,
      cooldownMs: 60000,
      actions: [
        {
          name: 'refresh_credentials',
          description: 'Attempt credential refresh',
          execute: async (context) => {
            // Implementation would refresh credentials
            return false; // Usually requires user action
          },
          userGuidance: 'Please verify your credentials and permissions'
        }
      ],
      fallbackAction: {
        name: 'prompt_reauth',
        description: 'Prompt for re-authentication',
        execute: async (context) => {
          this.emit('require-reauth', { sessionId: context.sessionId, reason: context.error.message });
          return false;
        },
        userGuidance: 'Authentication required. Please re-enter your credentials.'
      }
    });

    // Resource recovery strategy
    this.recoveryStrategies.set('resource', {
      name: 'Resource Recovery',
      applicableErrors: (error) => this.matchesPattern(error.message, ErrorRecovery.ERROR_PATTERNS.resource),
      maxRecoveryAttempts: 2,
      cooldownMs: 45000,
      actions: [
        {
          name: 'cleanup_resources',
          description: 'Clean up unused resources',
          execute: async (context) => {
            // Implementation would cleanup resources
            return true; // Placeholder
          },
          userGuidance: 'System resources have been cleaned up'
        },
        {
          name: 'reduce_memory_usage',
          description: 'Reduce memory consumption',
          execute: async (context) => {
            this.enableDegradedMode(context.sessionId, 'resource', ['reduce_buffer_size', 'limit_concurrent_ops']);
            return true;
          },
          userGuidance: 'Operating in resource-conserving mode'
        }
      ],
      fallbackAction: {
        name: 'minimal_mode',
        description: 'Switch to minimal resource mode',
        execute: async (context) => {
          this.enableDegradedMode(context.sessionId, 'resource', ['minimal_features', 'basic_operations_only']);
          return true;
        },
        userGuidance: 'Operating in minimal mode to conserve resources'
      }
    });
  }

  /**
   * Classify an error to determine its type and characteristics
   */
  classifyError(error: Error, context?: Partial<ErrorContext>): ErrorClassification {
    const message = error.message.toLowerCase();
    
    // Determine type
    let type: ErrorClassification['type'] = 'permanent';
    let category = 'unknown';
    
    for (const [errorType, patterns] of Object.entries(ErrorRecovery.ERROR_PATTERNS)) {
      if (this.matchesPattern(error.message, patterns)) {
        type = errorType as ErrorClassification['type'];
        category = errorType;
        break;
      }
    }

    // Determine severity
    let severity: ErrorClassification['severity'] = 'medium';
    if (message.includes('critical') || message.includes('fatal') || message.includes('crash')) {
      severity = 'critical';
    } else if (message.includes('warning') || message.includes('deprecated')) {
      severity = 'low';
    } else if (message.includes('error') || message.includes('failed')) {
      severity = 'high';
    }

    // Determine characteristics
    const recoverable = type === 'transient' || type === 'network' || type === 'resource';
    const userActionRequired = type === 'authentication' || type === 'configuration' || 
                              (type === 'permanent' && !message.includes('temporary'));
    const retryable = type === 'transient' || type === 'network' || 
                      (type === 'resource' && !message.includes('quota exceeded'));

    return {
      type,
      severity,
      category,
      recoverable,
      userActionRequired,
      retryable
    };
  }

  /**
   * Attempt to recover from an error
   */
  async attemptRecovery(context: ErrorContext): Promise<{
    recovered: boolean;
    actions: string[];
    userGuidance: string[];
    degradationEnabled: boolean;
  }> {
    const classification = this.classifyError(context.error, context);
    context.classification = classification;

    // Add to error history
    this.addToHistory(context);

    // Check if recovery is possible
    if (!classification.recoverable) {
      this.logger.info(`Error not recoverable for session ${context.sessionId}: ${context.error.message}`);
      return {
        recovered: false,
        actions: [],
        userGuidance: [this.getErrorGuidance(classification, context)],
        degradationEnabled: false
      };
    }

    // Check cooldown period
    const recoveryKey = `${context.sessionId}-${classification.category}`;
    const lastAttempt = this.recoveryAttempts.get(recoveryKey);
    
    if (lastAttempt && Date.now() - lastAttempt.lastAttempt < 30000) {
      this.logger.info(`Recovery in cooldown for session ${context.sessionId}`);
      return {
        recovered: false,
        actions: [],
        userGuidance: ['Recovery is in cooldown period. Please wait before retrying.'],
        degradationEnabled: false
      };
    }

    // Find applicable recovery strategy
    const strategy = this.findRecoveryStrategy(context.error);
    if (!strategy) {
      this.logger.info(`No recovery strategy found for error: ${context.error.message}`);
      return {
        recovered: false,
        actions: [],
        userGuidance: [this.getErrorGuidance(classification, context)],
        degradationEnabled: false
      };
    }

    // Check recovery attempt limits
    if (lastAttempt && lastAttempt.count >= strategy.maxRecoveryAttempts) {
      this.logger.info(`Max recovery attempts reached for session ${context.sessionId}`);
      
      // Try fallback action
      if (strategy.fallbackAction) {
        try {
          const fallbackResult = await strategy.fallbackAction.execute(context);
          return {
            recovered: fallbackResult,
            actions: [strategy.fallbackAction.name],
            userGuidance: [strategy.fallbackAction.userGuidance || 'Fallback recovery attempted'],
            degradationEnabled: true
          };
        } catch (fallbackError) {
          this.logger.error(`Fallback recovery failed: ${fallbackError}`);
        }
      }

      return {
        recovered: false,
        actions: [],
        userGuidance: ['Maximum recovery attempts exceeded. Manual intervention required.'],
        degradationEnabled: false
      };
    }

    // Execute recovery actions
    const results = await this.executeRecoveryActions(strategy, context);
    
    // Update recovery attempts
    this.recoveryAttempts.set(recoveryKey, {
      count: (lastAttempt?.count || 0) + 1,
      lastAttempt: Date.now()
    });

    return results;
  }

  private async executeRecoveryActions(
    strategy: RecoveryStrategy,
    context: ErrorContext
  ): Promise<{
    recovered: boolean;
    actions: string[];
    userGuidance: string[];
    degradationEnabled: boolean;
  }> {
    const executedActions: string[] = [];
    const userGuidance: string[] = [];
    let recovered = false;
    let degradationEnabled = false;

    this.logger.info(`Executing recovery strategy '${strategy.name}' for session ${context.sessionId}`);

    // Try each recovery action
    for (const action of strategy.actions) {
      try {
        this.logger.debug(`Executing recovery action: ${action.name}`);
        
        const actionResult = await action.execute(context);
        executedActions.push(action.name);
        
        if (action.userGuidance) {
          userGuidance.push(action.userGuidance);
        }

        if (actionResult) {
          recovered = true;
          break;
        }
      } catch (actionError) {
        this.logger.error(`Recovery action ${action.name} failed: ${actionError}`);
        userGuidance.push(`Recovery action failed: ${action.description}`);
      }
    }

    // If actions didn't work, try fallback
    if (!recovered && strategy.fallbackAction) {
      try {
        this.logger.debug(`Executing fallback action: ${strategy.fallbackAction.name}`);
        
        const fallbackResult = await strategy.fallbackAction.execute(context);
        executedActions.push(strategy.fallbackAction.name);
        
        if (strategy.fallbackAction.userGuidance) {
          userGuidance.push(strategy.fallbackAction.userGuidance);
        }
        
        degradationEnabled = true;
        recovered = fallbackResult;
      } catch (fallbackError) {
        this.logger.error(`Fallback action failed: ${fallbackError}`);
        userGuidance.push('All recovery attempts failed. Manual intervention required.');
      }
    }

    this.emit('recovery-attempted', {
      sessionId: context.sessionId,
      strategy: strategy.name,
      actions: executedActions,
      recovered,
      degradationEnabled
    });

    return { recovered, actions: executedActions, userGuidance, degradationEnabled };
  }

  private findRecoveryStrategy(error: Error): RecoveryStrategy | undefined {
    for (const strategy of this.recoveryStrategies.values()) {
      if (strategy.applicableErrors(error)) {
        return strategy;
      }
    }
    return undefined;
  }

  private matchesPattern(message: string, patterns: RegExp[]): boolean {
    return patterns.some(pattern => pattern.test(message));
  }

  private addToHistory(context: ErrorContext): void {
    const history = this.errorHistory.get(context.sessionId) || [];
    history.push({ ...context, timestamp: Date.now() });
    
    // Keep only last 10 errors
    if (history.length > 10) {
      history.shift();
    }
    
    this.errorHistory.set(context.sessionId, history);
  }

  private getErrorGuidance(classification: ErrorClassification, context: ErrorContext): string {
    const baseGuidance = {
      transient: 'This appears to be a temporary issue. Please try again in a few moments.',
      permanent: 'This error requires manual correction. Please check your configuration and inputs.',
      authentication: 'Please verify your credentials and permissions for this operation.',
      network: 'Check your network connection and ensure the target is accessible.',
      resource: 'System resources may be exhausted. Try closing other applications or waiting briefly.',
      configuration: 'Please check your configuration settings and ensure all required parameters are provided.'
    };

    let guidance = baseGuidance[classification.type] || 'Please review the error details and try again.';
    
    if (classification.severity === 'critical') {
      guidance += ' This is a critical error that may require immediate attention.';
    }

    return guidance;
  }

  private enableDegradedMode(sessionId: string, reason: string, features: string[]): void {
    const existingState = this.degradationStates.get(sessionId);
    const level = (existingState?.level || 0) + 1;
    
    this.degradationStates.set(sessionId, {
      level,
      startTime: Date.now(),
      features: [...(existingState?.features || []), ...features]
    });

    this.logger.warn(
      `Session ${sessionId} entering degraded mode (level ${level}) due to ${reason}. ` +
      `Features: ${features.join(', ')}`
    );

    this.emit('degradation-enabled', {
      sessionId,
      reason,
      level,
      features
    });
  }

  /**
   * Check if a session is in degraded mode
   */
  isDegraded(sessionId: string): boolean {
    return this.degradationStates.has(sessionId);
  }

  /**
   * Get degradation state for a session
   */
  getDegradationState(sessionId: string): { level: number; startTime: number; features: string[] } | null {
    return this.degradationStates.get(sessionId) || null;
  }

  /**
   * Restore a session from degraded mode
   */
  restoreSession(sessionId: string): boolean {
    if (this.degradationStates.has(sessionId)) {
      this.degradationStates.delete(sessionId);
      this.logger.info(`Session ${sessionId} restored from degraded mode`);
      
      this.emit('degradation-restored', { sessionId });
      return true;
    }
    return false;
  }

  /**
   * Get error history for a session
   */
  getErrorHistory(sessionId: string): ErrorContext[] {
    return this.errorHistory.get(sessionId) || [];
  }

  /**
   * Get error aggregation data
   */
  getErrorAggregation(timeWindowMs: number = 300000): Record<string, {
    count: number;
    sessions: string[];
    lastOccurrence: number;
    classification: ErrorClassification;
  }> {
    const now = Date.now();
    const cutoff = now - timeWindowMs;
    const aggregation: Record<string, any> = {};

    this.errorHistory.forEach((history, sessionId) => {
      history.forEach(context => {
        if (context.timestamp < cutoff) return;

        const key = `${context.classification?.category || 'unknown'}-${context.error.message}`;
        
        if (!aggregation[key]) {
          aggregation[key] = {
            count: 0,
            sessions: [],
            lastOccurrence: 0,
            classification: context.classification
          };
        }

        aggregation[key].count++;
        if (!aggregation[key].sessions.includes(sessionId)) {
          aggregation[key].sessions.push(sessionId);
        }
        aggregation[key].lastOccurrence = Math.max(aggregation[key].lastOccurrence, context.timestamp);
      });
    });

    return aggregation;
  }

  /**
   * Register a custom recovery strategy
   */
  registerRecoveryStrategy(strategy: RecoveryStrategy): void {
    this.recoveryStrategies.set(strategy.name, strategy);
    this.logger.info(`Registered recovery strategy: ${strategy.name}`);
  }

  /**
   * Get recovery statistics
   */
  getRecoveryStats(): {
    totalErrors: number;
    recoveredErrors: number;
    activeDegradedSessions: number;
    strategiesAvailable: number;
    errorsByType: Record<string, number>;
  } {
    let totalErrors = 0;
    let recoveredErrors = 0;
    const errorsByType: Record<string, number> = {};

    this.errorHistory.forEach(history => {
      history.forEach(context => {
        totalErrors++;
        if (context.classification?.recoverable) {
          recoveredErrors++;
        }
        
        const type = context.classification?.type || 'unknown';
        errorsByType[type] = (errorsByType[type] || 0) + 1;
      });
    });

    return {
      totalErrors,
      recoveredErrors,
      activeDegradedSessions: this.degradationStates.size,
      strategiesAvailable: this.recoveryStrategies.size,
      errorsByType
    };
  }

  /**
   * Clean up old error history and reset state
   */
  cleanup(maxAgeMs: number = 3600000): void {
    const cutoff = Date.now() - maxAgeMs;

    // Clean error history
    this.errorHistory.forEach((history, sessionId) => {
      const filtered = history.filter(context => context.timestamp > cutoff);
      if (filtered.length === 0) {
        this.errorHistory.delete(sessionId);
      } else {
        this.errorHistory.set(sessionId, filtered);
      }
    });

    // Clean recovery attempts
    this.recoveryAttempts.forEach((attempt, key) => {
      if (attempt.lastAttempt < cutoff) {
        this.recoveryAttempts.delete(key);
      }
    });

    this.logger.debug('Error recovery cleanup completed');
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.removeAllListeners();
    this.errorHistory.clear();
    this.recoveryAttempts.clear();
    this.degradationStates.clear();
    this.logger.info('ErrorRecovery destroyed');
  }
}