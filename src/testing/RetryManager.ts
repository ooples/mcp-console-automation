/**
 * RetryManager - Manages test retry logic with configurable strategies
 */

import {
  TestDefinition,
  TestResult,
  RetryConfig,
  RetryResult,
} from '../types/test-framework.js';

export class RetryManager {
  private defaultConfig: RetryConfig = {
    maxRetries: 3,
    backoffMs: 1000,
    backoffMultiplier: 2,
    retryOnTimeout: true,
  };

  /**
   * Execute a test with retry logic
   */
  async executeWithRetry(
    test: TestDefinition,
    executor: (test: TestDefinition) => Promise<TestResult>,
    config?: Partial<RetryConfig>
  ): Promise<RetryResult> {
    const retryConfig = { ...this.defaultConfig, ...config };
    const results: TestResult[] = [];
    let attempt = 0;

    while (attempt <= retryConfig.maxRetries) {
      const result = await executor(test);
      results.push(result);

      // Check if test passed
      if (result.status === 'pass') {
        return {
          test,
          attempts: attempt + 1,
          results,
          finalResult: result,
          totalDuration: results.reduce((sum, r) => sum + r.duration, 0),
        };
      }

      // Check if we should retry
      const shouldRetry = this.shouldRetry(result, retryConfig, attempt);

      if (!shouldRetry) {
        break;
      }

      // Calculate backoff delay
      const delay = this.calculateBackoff(attempt, retryConfig);

      // Wait before retrying
      if (delay > 0) {
        await this.sleep(delay);
      }

      attempt++;
    }

    // All retries exhausted
    return {
      test,
      attempts: results.length,
      results,
      finalResult: results[results.length - 1],
      totalDuration: results.reduce((sum, r) => sum + r.duration, 0),
    };
  }

  /**
   * Retry a batch of failed tests
   */
  async retryFailedTests(
    failedTests: TestResult[],
    executor: (test: TestDefinition) => Promise<TestResult>,
    config?: Partial<RetryConfig>
  ): Promise<RetryResult[]> {
    const retryResults: RetryResult[] = [];

    for (const failedResult of failedTests) {
      const retryResult = await this.executeWithRetry(
        failedResult.test,
        executor,
        config
      );
      retryResults.push(retryResult);
    }

    return retryResults;
  }

  /**
   * Determine if test should be retried
   */
  private shouldRetry(
    result: TestResult,
    config: RetryConfig,
    currentAttempt: number
  ): boolean {
    // Don't retry if max retries reached
    if (currentAttempt >= config.maxRetries) {
      return false;
    }

    // Don't retry skipped tests
    if (result.status === 'skip') {
      return false;
    }

    // Retry timeouts if configured
    if (result.status === 'timeout') {
      return config.retryOnTimeout || false;
    }

    // Check if error matches retry criteria
    if (result.error && config.retryOnErrors) {
      const errorMessage = result.error.message.toLowerCase();
      return config.retryOnErrors.some((pattern) =>
        errorMessage.includes(pattern.toLowerCase())
      );
    }

    // Retry all failures by default if no specific criteria
    if (!config.retryOnErrors) {
      return result.status === 'fail';
    }

    return false;
  }

  /**
   * Calculate backoff delay
   */
  protected calculateBackoff(attempt: number, config: RetryConfig): number {
    const multiplier = config.backoffMultiplier || 1;
    return config.backoffMs * Math.pow(multiplier, attempt);
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get retry statistics from results
   */
  getRetryStatistics(retryResults: RetryResult[]) {
    const totalTests = retryResults.length;
    const successAfterRetry = retryResults.filter(
      (r) => r.finalResult.status === 'pass' && r.attempts >= 1
    ).length;
    const failedAfterRetry = retryResults.filter(
      (r) => r.finalResult.status !== 'pass'
    ).length;
    const totalAttempts = retryResults.reduce((sum, r) => sum + r.attempts, 0);

    return {
      totalTests,
      successAfterRetry,
      failedAfterRetry,
      successRate: totalTests > 0 ? successAfterRetry / totalTests : 0,
      averageAttempts: totalTests > 0 ? totalAttempts / totalTests : 0,
      totalDuration: retryResults.reduce((sum, r) => sum + r.totalDuration, 0),
    };
  }

  /**
   * Create a retry strategy based on common patterns
   */
  static createStrategy(
    type: 'aggressive' | 'conservative' | 'network'
  ): RetryConfig {
    switch (type) {
      case 'aggressive':
        return {
          maxRetries: 5,
          backoffMs: 500,
          backoffMultiplier: 1.5,
          retryOnTimeout: true,
        };

      case 'conservative':
        return {
          maxRetries: 2,
          backoffMs: 2000,
          backoffMultiplier: 2,
          retryOnTimeout: false,
        };

      case 'network':
        return {
          maxRetries: 3,
          backoffMs: 1000,
          backoffMultiplier: 2,
          retryOnTimeout: true,
          retryOnErrors: [
            'ECONNREFUSED',
            'ETIMEDOUT',
            'ENOTFOUND',
            'network',
            'timeout',
          ],
        };

      default:
        throw new Error(`Unknown retry strategy: ${type}`);
    }
  }
}

/**
 * Circuit breaker for preventing excessive retries
 */
export class CircuitBreaker {
  private failureCount = 0;
  private lastFailureTime = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  constructor(
    private threshold: number = 5,
    private timeout: number = 60000,
    private resetTime: number = 30000
  ) {}

  /**
   * Check if circuit is open (should not retry)
   */
  isOpen(): boolean {
    // Check if we should transition to half-open
    if (this.state === 'open') {
      const timeSinceFailure = Date.now() - this.lastFailureTime;
      if (timeSinceFailure > this.resetTime) {
        this.state = 'half-open';
        return false;
      }
      return true;
    }

    return false;
  }

  /**
   * Record a successful execution
   */
  recordSuccess(): void {
    this.failureCount = 0;
    this.state = 'closed';
  }

  /**
   * Record a failed execution
   */
  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.threshold) {
      this.state = 'open';
    }
  }

  /**
   * Get current state
   */
  getState() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
    };
  }

  /**
   * Reset the circuit breaker
   */
  reset(): void {
    this.failureCount = 0;
    this.lastFailureTime = 0;
    this.state = 'closed';
  }
}

/**
 * Retry with jitter to prevent thundering herd
 */
export class JitteredRetryManager extends RetryManager {
  /**
   * Calculate backoff with jitter
   */
  protected calculateBackoff(attempt: number, config: RetryConfig): number {
    const baseDelay = super.calculateBackoff(attempt, config);
    // Add random jitter (0-25% of base delay)
    const jitter = Math.random() * 0.25 * baseDelay;
    return Math.floor(baseDelay + jitter);
  }
}
