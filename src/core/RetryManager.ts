import { EventEmitter } from 'events';
import { Logger } from '../utils/logger.js';

export interface RetryContext {
  sessionId: string;
  operation: string;
  attemptNumber: number;
  maxAttempts: number;
  error?: Error;
  startTime: number;
  metadata?: Record<string, any>;
}

export interface RetryStrategy {
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  jitterMax: number;
  circuitBreakerThreshold: number;
  circuitBreakerWindow: number;
  shouldRetry: (error: Error, context: RetryContext) => boolean;
}

export interface CircuitBreakerState {
  state: 'closed' | 'open' | 'half-open';
  failures: number;
  lastFailureTime: number;
  nextAttemptTime: number;
  successCount: number;
}

export class RetryManager extends EventEmitter {
  private logger: Logger;
  private circuitBreakers: Map<string, CircuitBreakerState>;
  private retryStrategies: Map<string, RetryStrategy>;
  private activeRetries: Map<string, RetryContext>;

  // Default strategies for different error types
  private static readonly DEFAULT_STRATEGIES: Record<string, RetryStrategy> = {
    network: {
      maxAttempts: 5,
      baseDelay: 1000,
      maxDelay: 16000,
      backoffMultiplier: 2,
      jitterMax: 1000,
      circuitBreakerThreshold: 5,
      circuitBreakerWindow: 60000,
      shouldRetry: (error: Error) => {
        const networkErrors = [
          'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENETDOWN', 'ENETUNREACH',
          'EHOSTDOWN', 'EHOSTUNREACH', 'ENOTFOUND', 'EAI_AGAIN'
        ];
        return networkErrors.some(code => error.message.includes(code)) ||
               error.message.toLowerCase().includes('network') ||
               error.message.toLowerCase().includes('connection');
      }
    },
    authentication: {
      maxAttempts: 2,
      baseDelay: 2000,
      maxDelay: 8000,
      backoffMultiplier: 2,
      jitterMax: 500,
      circuitBreakerThreshold: 3,
      circuitBreakerWindow: 120000,
      shouldRetry: (error: Error) => {
        // Check for explicit non-retryable flag
        if ((error as any).nonRetryable) {
          return false;
        }
        const authErrors = [
          'authentication failed', 'auth failed', 'invalid credentials',
          'access denied', 'permission denied', 'unauthorized'
        ];
        const errorMsg = error.message.toLowerCase();
        return authErrors.some(msg => errorMsg.includes(msg)) &&
               !errorMsg.includes('invalid password') &&
               !errorMsg.includes('invalid username'); // Don't retry bad credentials
      }
    },
    resource: {
      maxAttempts: 4,
      baseDelay: 2000,
      maxDelay: 32000,
      backoffMultiplier: 2,
      jitterMax: 2000,
      circuitBreakerThreshold: 5,
      circuitBreakerWindow: 180000,
      shouldRetry: (error: Error) => {
        const resourceErrors = [
          'out of memory', 'resource temporarily unavailable',
          'too many open files', 'no space left', 'quota exceeded',
          'rate limit', 'throttled'
        ];
        return resourceErrors.some(msg => error.message.toLowerCase().includes(msg));
      }
    },
    ssh: {
      maxAttempts: 3,
      baseDelay: 1500,
      maxDelay: 12000,
      backoffMultiplier: 2,
      jitterMax: 1000,
      circuitBreakerThreshold: 4,
      circuitBreakerWindow: 90000,
      shouldRetry: (error: Error) => {
        // Check for explicit non-retryable flag first
        if ((error as any).nonRetryable) {
          return false;
        }
        const sshErrors = [
          'connection refused', 'connection reset', 'connection timeout',
          'host unreachable', 'network unreachable', 'ssh connection lost'
        ];
        const errorMsg = error.message.toLowerCase();
        return sshErrors.some(msg => errorMsg.includes(msg)) &&
               !errorMsg.includes('permission denied') &&
               !errorMsg.includes('authentication failed') &&
               !errorMsg.includes('ssh password authentication is not supported');
      }
    },
    generic: {
      maxAttempts: 3,
      baseDelay: 1000,
      maxDelay: 8000,
      backoffMultiplier: 2,
      jitterMax: 500,
      circuitBreakerThreshold: 5,
      circuitBreakerWindow: 60000,
      shouldRetry: (error: Error) => {
        // Check for explicit non-retryable flag
        if ((error as any).nonRetryable) {
          return false;
        }
        // Generic transient errors
        const transientErrors = [
          'timeout', 'temporary', 'busy', 'unavailable', 'try again'
        ];
        return transientErrors.some(msg => error.message.toLowerCase().includes(msg));
      }
    }
  };

  constructor() {
    super();
    this.logger = new Logger('RetryManager');
    this.circuitBreakers = new Map();
    this.retryStrategies = new Map();
    this.activeRetries = new Map();

    // Initialize default strategies
    Object.entries(RetryManager.DEFAULT_STRATEGIES).forEach(([name, strategy]) => {
      this.retryStrategies.set(name, strategy);
    });
  }

  /**
   * Execute an operation with retry logic
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    options: {
      sessionId: string;
      operationName: string;
      strategyName?: string;
      context?: Record<string, any>;
      onRetry?: (context: RetryContext) => void;
    }
  ): Promise<T> {
    const strategyName = options.strategyName || this.classifyOperation(options.operationName);
    const strategy = this.retryStrategies.get(strategyName) || this.retryStrategies.get('generic')!;
    
    const circuitBreakerKey = `${options.sessionId}-${strategyName}`;
    
    // Check circuit breaker
    if (this.isCircuitOpen(circuitBreakerKey)) {
      const breaker = this.circuitBreakers.get(circuitBreakerKey)!;
      const timeUntilNextAttempt = Math.max(0, breaker.nextAttemptTime - Date.now());
      
      throw new Error(
        `Circuit breaker is OPEN for ${strategyName}. ` +
        `Please wait ${Math.ceil(timeUntilNextAttempt / 1000)}s before retrying. ` +
        `This typically indicates repeated failures that require manual intervention.`
      );
    }

    const retryKey = `${options.sessionId}-${options.operationName}`;
    const context: RetryContext = {
      sessionId: options.sessionId,
      operation: options.operationName,
      attemptNumber: 0,
      maxAttempts: strategy.maxAttempts,
      startTime: Date.now(),
      metadata: options.context
    };

    this.activeRetries.set(retryKey, context);

    try {
      return await this.attemptOperation(operation, strategy, context, circuitBreakerKey, options.onRetry);
    } finally {
      this.activeRetries.delete(retryKey);
    }
  }

  private async attemptOperation<T>(
    operation: () => Promise<T>,
    strategy: RetryStrategy,
    context: RetryContext,
    circuitBreakerKey: string,
    onRetry?: (context: RetryContext) => void
  ): Promise<T> {
    while (context.attemptNumber < strategy.maxAttempts) {
      context.attemptNumber++;
      
      try {
        this.logger.debug(
          `Attempting ${context.operation} for session ${context.sessionId} ` +
          `(attempt ${context.attemptNumber}/${context.maxAttempts})`
        );

        const result = await operation();
        
        // Success - reset circuit breaker
        this.recordSuccess(circuitBreakerKey);
        
        if (context.attemptNumber > 1) {
          this.logger.info(
            `${context.operation} succeeded after ${context.attemptNumber} attempts ` +
            `for session ${context.sessionId}`
          );
          
          this.emit('retry-success', {
            ...context,
            totalDuration: Date.now() - context.startTime
          });
        }

        return result;

      } catch (error) {
        context.error = error as Error;
        
        // Record failure for circuit breaker
        this.recordFailure(circuitBreakerKey);
        
        // Check if we should retry this error
        if (!strategy.shouldRetry(context.error, context)) {
          this.logger.warn(
            `${context.operation} failed with non-retryable error for session ${context.sessionId}: ${context.error.message}`
          );
          
          this.emit('retry-failed', {
            ...context,
            reason: 'non-retryable-error',
            totalDuration: Date.now() - context.startTime
          });
          
          throw this.enhanceError(context.error, context, 'This error type cannot be automatically retried');
        }

        // Check if we've exhausted retries
        if (context.attemptNumber >= strategy.maxAttempts) {
          this.logger.error(
            `${context.operation} failed after ${context.attemptNumber} attempts ` +
            `for session ${context.sessionId}: ${context.error.message}`
          );
          
          this.emit('retry-exhausted', {
            ...context,
            totalDuration: Date.now() - context.startTime
          });
          
          throw this.enhanceError(
            context.error, 
            context,
            `Operation failed after ${context.maxAttempts} retry attempts. ` +
            `Consider checking your configuration or waiting before retrying manually.`
          );
        }

        // Calculate delay for next attempt
        const delay = this.calculateDelay(context.attemptNumber, strategy);
        
        this.logger.info(
          `${context.operation} attempt ${context.attemptNumber} failed for session ${context.sessionId}. ` +
          `Retrying in ${delay}ms. Error: ${context.error.message}`
        );

        this.emit('retry-attempt', {
          ...context,
          delay,
          nextAttempt: context.attemptNumber + 1
        });

        if (onRetry) {
          onRetry(context);
        }

        // Wait before next attempt
        await this.delay(delay);
      }
    }

    // This should never be reached, but TypeScript needs it
    throw context.error!;
  }

  private classifyOperation(operationName: string): string {
    const networkOps = ['connect', 'send', 'receive', 'request', 'fetch'];
    const authOps = ['authenticate', 'login', 'auth', 'credential'];
    const sshOps = ['ssh', 'shell', 'terminal'];
    const resourceOps = ['spawn', 'create', 'allocate', 'memory'];

    const opLower = operationName.toLowerCase();

    if (sshOps.some(op => opLower.includes(op))) return 'ssh';
    if (networkOps.some(op => opLower.includes(op))) return 'network';
    if (authOps.some(op => opLower.includes(op))) return 'authentication';
    if (resourceOps.some(op => opLower.includes(op))) return 'resource';

    return 'generic';
  }

  private calculateDelay(attemptNumber: number, strategy: RetryStrategy): number {
    // Exponential backoff: baseDelay * (backoffMultiplier ^ (attemptNumber - 1))
    const exponentialDelay = Math.min(
      strategy.baseDelay * Math.pow(strategy.backoffMultiplier, attemptNumber - 1),
      strategy.maxDelay
    );

    // Add jitter to avoid thundering herd
    const jitter = Math.random() * strategy.jitterMax;
    
    return Math.floor(exponentialDelay + jitter);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private isCircuitOpen(key: string): boolean {
    const breaker = this.circuitBreakers.get(key);
    if (!breaker) return false;

    const now = Date.now();

    if (breaker.state === 'open') {
      if (now >= breaker.nextAttemptTime) {
        // Transition to half-open
        breaker.state = 'half-open';
        breaker.successCount = 0;
        this.logger.info(`Circuit breaker ${key} transitioning to HALF-OPEN`);
        return false;
      }
      return true;
    }

    if (breaker.state === 'half-open') {
      // Allow limited attempts in half-open state
      return false;
    }

    return false;
  }

  private recordSuccess(key: string): void {
    const breaker = this.circuitBreakers.get(key);
    if (!breaker) return;

    if (breaker.state === 'half-open') {
      breaker.successCount++;
      if (breaker.successCount >= 3) {
        // Transition back to closed
        breaker.state = 'closed';
        breaker.failures = 0;
        this.logger.info(`Circuit breaker ${key} transitioning to CLOSED`);
      }
    } else if (breaker.state === 'closed') {
      // Reset failure count on success
      breaker.failures = Math.max(0, breaker.failures - 1);
    }
  }

  private recordFailure(key: string): void {
    const strategy = this.getStrategyForKey(key);
    let breaker = this.circuitBreakers.get(key);
    
    if (!breaker) {
      breaker = {
        state: 'closed',
        failures: 0,
        lastFailureTime: Date.now(),
        nextAttemptTime: 0,
        successCount: 0
      };
      this.circuitBreakers.set(key, breaker);
    }

    breaker.failures++;
    breaker.lastFailureTime = Date.now();

    if (breaker.state === 'closed' && breaker.failures >= strategy.circuitBreakerThreshold) {
      // Transition to open
      breaker.state = 'open';
      breaker.nextAttemptTime = Date.now() + strategy.circuitBreakerWindow;
      
      this.logger.warn(
        `Circuit breaker ${key} is now OPEN due to ${breaker.failures} consecutive failures. ` +
        `Will remain open for ${strategy.circuitBreakerWindow / 1000}s`
      );
      
      this.emit('circuit-breaker-open', { key, failures: breaker.failures, windowMs: strategy.circuitBreakerWindow });
    } else if (breaker.state === 'half-open') {
      // Transition back to open
      breaker.state = 'open';
      breaker.nextAttemptTime = Date.now() + strategy.circuitBreakerWindow;
      
      this.logger.warn(`Circuit breaker ${key} returning to OPEN state after failure in half-open`);
    }
  }

  private getStrategyForKey(key: string): RetryStrategy {
    // Extract strategy name from key format: sessionId-strategyName
    const parts = key.split('-');
    if (parts.length >= 2) {
      const strategyName = parts[parts.length - 1];
      return this.retryStrategies.get(strategyName) || this.retryStrategies.get('generic')!;
    }
    return this.retryStrategies.get('generic')!;
  }

  private enhanceError(originalError: Error, context: RetryContext, userGuidance: string): Error {
    const enhancedError = new Error(
      `${originalError.message}\n\n` +
      `Operation: ${context.operation}\n` +
      `Session: ${context.sessionId}\n` +
      `Attempts: ${context.attemptNumber}/${context.maxAttempts}\n` +
      `Duration: ${Date.now() - context.startTime}ms\n\n` +
      `Guidance: ${userGuidance}\n\n` +
      `To resolve this issue:\n` +
      `1. Check your network connection and firewall settings\n` +
      `2. Verify credentials and permissions\n` +
      `3. Check if the target system is accessible and responsive\n` +
      `4. Consider waiting a few minutes before retrying manually\n` +
      `5. Review the system logs for additional error details`
    );
    
    enhancedError.name = originalError.name;
    enhancedError.stack = originalError.stack;
    
    return enhancedError;
  }

  /**
   * Register a custom retry strategy
   */
  registerStrategy(name: string, strategy: RetryStrategy): void {
    this.retryStrategies.set(name, strategy);
    this.logger.info(`Registered retry strategy: ${name}`);
  }

  /**
   * Get current circuit breaker states
   */
  getCircuitBreakerStates(): Record<string, CircuitBreakerState> {
    const states: Record<string, CircuitBreakerState> = {};
    this.circuitBreakers.forEach((state, key) => {
      states[key] = { ...state };
    });
    return states;
  }

  /**
   * Get active retry operations
   */
  getActiveRetries(): RetryContext[] {
    return Array.from(this.activeRetries.values());
  }

  /**
   * Manually reset a circuit breaker
   */
  resetCircuitBreaker(key: string): boolean {
    const breaker = this.circuitBreakers.get(key);
    if (breaker) {
      breaker.state = 'closed';
      breaker.failures = 0;
      breaker.successCount = 0;
      this.logger.info(`Manually reset circuit breaker: ${key}`);
      return true;
    }
    return false;
  }

  /**
   * Reset all circuit breakers
   */
  resetAllCircuitBreakers(): void {
    this.circuitBreakers.forEach((breaker, key) => {
      breaker.state = 'closed';
      breaker.failures = 0;
      breaker.successCount = 0;
    });
    this.logger.info('Reset all circuit breakers');
  }

  /**
   * Get retry statistics
   */
  getRetryStats(): {
    activeRetries: number;
    circuitBreakers: { closed: number; open: number; halfOpen: number };
    strategies: string[];
  } {
    const circuitBreakers = { closed: 0, open: 0, halfOpen: 0 };
    
    this.circuitBreakers.forEach(breaker => {
      if (breaker.state === 'closed') circuitBreakers.closed++;
      else if (breaker.state === 'open') circuitBreakers.open++;
      else circuitBreakers.halfOpen++;
    });

    return {
      activeRetries: this.activeRetries.size,
      circuitBreakers,
      strategies: Array.from(this.retryStrategies.keys())
    };
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.removeAllListeners();
    this.circuitBreakers.clear();
    this.activeRetries.clear();
    this.logger.info('RetryManager destroyed');
  }
}