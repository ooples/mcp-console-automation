/**
 * Tests for RetryManager
 */

import { RetryManager, CircuitBreaker } from '../testing/RetryManager';
import { TestDefinition, TestResult, RetryConfig } from '../types/test-framework';

describe('RetryManager', () => {
  let retryManager: RetryManager;

  beforeEach(() => {
    retryManager = new RetryManager();
  });

  describe('Basic Retry Logic', () => {
    it('should retry failed tests up to maxRetries', async () => {
      let attemptCount = 0;

      const test: TestDefinition = {
        name: 'flaky-test',
        assertions: [],
        timeout: 100,
        retry: 0,
      };

      const executor = async (t: TestDefinition): Promise<TestResult> => {
        attemptCount++;
        return {
          test: t,
          status: attemptCount < 3 ? 'fail' : 'pass',
          duration: 10,
          startTime: Date.now(),
          endTime: Date.now() + 10,
          assertions: [],
          error: attemptCount < 3 ? new Error('Simulated failure') : undefined,
        };
      };

      const config: RetryConfig = {
        maxRetries: 3,
        backoffMs: 10,
      };

      const result = await retryManager.executeWithRetry(test, executor, config);

      expect(result.attempts).toBe(3);
      expect(result.finalResult.status).toBe('pass');
      expect(result.results).toHaveLength(3);
    });

    it('should stop retrying after success', async () => {
      let attemptCount = 0;

      const test: TestDefinition = {
        name: 'test',
        assertions: [],
        timeout: 100,
        retry: 0,
      };

      const executor = async (t: TestDefinition): Promise<TestResult> => {
        attemptCount++;
        return {
          test: t,
          status: 'pass',
          duration: 10,
          startTime: Date.now(),
          endTime: Date.now() + 10,
          assertions: [],
        };
      };

      const result = await retryManager.executeWithRetry(test, executor, { maxRetries: 5, backoffMs: 10 });

      expect(result.attempts).toBe(1);
      expect(result.finalResult.status).toBe('pass');
    });
  });

  describe('Exponential Backoff', () => {
    it('should apply exponential backoff between retries', async () => {
      const timestamps: number[] = [];

      const test: TestDefinition = {
        name: 'test',
        assertions: [],
        timeout: 100,
        retry: 0,
      };

      const executor = async (t: TestDefinition): Promise<TestResult> => {
        timestamps.push(Date.now());
        return {
          test: t,
          status: 'fail',
          duration: 0,
          startTime: Date.now(),
          endTime: Date.now(),
          assertions: [],
          error: new Error('fail'),
        };
      };

      const config: RetryConfig = {
        maxRetries: 3,
        backoffMs: 100,
        backoffMultiplier: 2,
      };

      await retryManager.executeWithRetry(test, executor, config);

      expect(timestamps).toHaveLength(4); // Initial + 3 retries

      // Check delays are increasing (with some tolerance for timing)
      const delay1 = timestamps[1] - timestamps[0];
      const delay2 = timestamps[2] - timestamps[1];
      const delay3 = timestamps[3] - timestamps[2];

      expect(delay1).toBeGreaterThanOrEqual(90);
      expect(delay2).toBeGreaterThanOrEqual(180);
      expect(delay3).toBeGreaterThanOrEqual(360);
    });
  });

  describe('Selective Retry', () => {
    it('should only retry on specific error types', async () => {
      let attemptCount = 0;

      const test: TestDefinition = {
        name: 'test',
        assertions: [],
        timeout: 100,
        retry: 0,
      };

      const executor = async (t: TestDefinition): Promise<TestResult> => {
        attemptCount++;
        return {
          test: t,
          status: 'fail',
          duration: 0,
          startTime: Date.now(),
          endTime: Date.now(),
          assertions: [],
          error: new Error('ASSERTION_FAILED'),
        };
      };

      const config: RetryConfig = {
        maxRetries: 3,
        backoffMs: 10,
        retryOnErrors: ['NETWORK', 'TIMEOUT'],
      };

      const result = await retryManager.executeWithRetry(test, executor, config);

      // Should not retry because error doesn't match pattern
      expect(result.attempts).toBe(1);
    });

    it('should retry on timeout if configured', async () => {
      let attemptCount = 0;

      const test: TestDefinition = {
        name: 'test',
        assertions: [],
        timeout: 100,
        retry: 0,
      };

      const executor = async (t: TestDefinition): Promise<TestResult> => {
        attemptCount++;
        return {
          test: t,
          status: 'timeout',
          duration: 0,
          startTime: Date.now(),
          endTime: Date.now(),
          assertions: [],
        };
      };

      const config: RetryConfig = {
        maxRetries: 2,
        backoffMs: 10,
        retryOnTimeout: true,
      };

      const result = await retryManager.executeWithRetry(test, executor, config);

      expect(result.attempts).toBe(3);
    });
  });

  describe('Retry Statistics', () => {
    it('should generate statistics for retry results', async () => {
      const failedTests: TestResult[] = [
        {
          test: { name: 'test-1', assertions: [], timeout: 100, retry: 0 },
          status: 'fail',
          duration: 0,
          startTime: Date.now(),
          endTime: Date.now(),
          assertions: [],
        },
        {
          test: { name: 'test-2', assertions: [], timeout: 100, retry: 0 },
          status: 'fail',
          duration: 0,
          startTime: Date.now(),
          endTime: Date.now(),
          assertions: [],
        },
      ];

      const executor = async (t: TestDefinition): Promise<TestResult> => ({
        test: t,
        status: 'pass',
        duration: 10,
        startTime: Date.now(),
        endTime: Date.now() + 10,
        assertions: [],
      });

      const results = await retryManager.retryFailedTests(failedTests, executor, { maxRetries: 2, backoffMs: 10 });
      const stats = retryManager.getRetryStatistics(results);

      expect(stats.totalTests).toBe(2);
      expect(stats.successAfterRetry).toBe(2);
      expect(stats.successRate).toBe(1);
    });
  });
});

describe('CircuitBreaker', () => {
  it('should open circuit after threshold failures', () => {
    const breaker = new CircuitBreaker(3, 60000, 30000);

    expect(breaker.isOpen()).toBe(false);

    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(false);

    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(true);
  });

  it('should close circuit after successful execution', () => {
    const breaker = new CircuitBreaker(2, 60000, 30000);

    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(true);

    breaker.recordSuccess();
    expect(breaker.isOpen()).toBe(false);
  });
});
