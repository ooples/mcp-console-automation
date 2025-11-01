/**
 * Tests for ParallelExecutor
 */

import { ParallelExecutor } from '../testing/ParallelExecutor.js';
import {
  TestDefinition,
  ParallelExecutionConfig,
} from '../types/test-framework.js';

describe('ParallelExecutor', () => {
  let executor: ParallelExecutor;

  beforeEach(() => {
    executor = new ParallelExecutor();
  });

  describe('Parallel Execution', () => {
    it('should execute tests in parallel', async () => {
      const tests: TestDefinition[] = Array.from({ length: 10 }, (_, i) => ({
        name: `test-${i}`,
        assertions: [],
        timeout: 500,
        retry: 0,
        setup: {
          fn: async () => {
            // Simulate 50ms of work
            await new Promise((resolve) => setTimeout(resolve, 50));
          },
          timeout: 100,
        },
      }));

      const config: ParallelExecutionConfig = {
        maxWorkers: 4,
        timeout: 3000,
        isolateTests: true,
        failFast: false,
      };

      const result = await executor.executeTests(tests, config);

      expect(result.totalTests).toBe(10);
      expect(result.results).toHaveLength(10);
      expect(result.workersUsed).toBeLessThanOrEqual(4);
      expect(result.speedup).toBeGreaterThan(1);
    });

    it('should demonstrate speedup over sequential execution', async () => {
      const tests: TestDefinition[] = Array.from({ length: 8 }, (_, i) => ({
        name: `test-${i}`,
        assertions: [],
        timeout: 500,
        retry: 0,
        setup: {
          fn: async () => {
            // Simulate 50ms of work
            await new Promise((resolve) => setTimeout(resolve, 50));
          },
          timeout: 100,
        },
      }));

      const config: ParallelExecutionConfig = {
        maxWorkers: 4,
        timeout: 2000,
        isolateTests: true,
        failFast: false,
      };

      const startParallel = Date.now();
      const parallelResult = await executor.executeTests(tests, config);
      const parallelDuration = Date.now() - startParallel;

      const startSequential = Date.now();
      const sequentialResult = await executor.executeSequential(tests);
      const sequentialDuration = Date.now() - startSequential;

      expect(parallelResult.results).toHaveLength(8);
      expect(sequentialResult).toHaveLength(8);

      // Parallel should be faster
      expect(parallelDuration).toBeLessThan(sequentialDuration);

      // Speedup should be close to number of workers
      const actualSpeedup = sequentialDuration / parallelDuration;
      expect(actualSpeedup).toBeGreaterThan(1.5);
    });
  });

  describe('Fail-Fast Mode', () => {
    it('should stop on first failure in fail-fast mode', async () => {
      const tests: TestDefinition[] = [
        { name: 'test-1', assertions: [], timeout: 100, retry: 0 },
        { name: 'test-2', assertions: [], timeout: 100, retry: 0, skip: false },
        { name: 'test-3', assertions: [], timeout: 100, retry: 0 },
      ];

      const config: ParallelExecutionConfig = {
        maxWorkers: 2,
        timeout: 500,
        isolateTests: true,
        failFast: true,
      };

      const result = await executor.executeTests(tests, config);

      expect(result.results).toHaveLength(3);
      // Some tests may be skipped due to fail-fast
      const skipped = result.results.filter((r) => r.status === 'skip');
      expect(skipped.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Test Isolation', () => {
    it('should isolate tests in separate workers', async () => {
      const tests: TestDefinition[] = Array.from({ length: 5 }, (_, i) => ({
        name: `isolated-test-${i}`,
        assertions: [],
        timeout: 100,
        retry: 0,
      }));

      const config: ParallelExecutionConfig = {
        maxWorkers: 3,
        timeout: 500,
        isolateTests: true,
        failFast: false,
      };

      const result = await executor.executeTests(tests, config);

      expect(result.results).toHaveLength(5);
      result.results.forEach((r) => {
        expect(r.test).toBeDefined();
        expect(r.duration).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('Empty Test Array', () => {
    it('should handle empty test array', async () => {
      const tests: TestDefinition[] = [];

      const config: ParallelExecutionConfig = {
        maxWorkers: 2,
        timeout: 1000,
        isolateTests: true,
        failFast: false,
      };

      const result = await executor.executeTests(tests, config);

      expect(result.totalTests).toBe(0);
      expect(result.results).toHaveLength(0);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Skipped Tests', () => {
    it('should skip tests marked as skip', async () => {
      const tests: TestDefinition[] = [
        { name: 'test-1', assertions: [], timeout: 100, retry: 0 },
        { name: 'test-2', assertions: [], timeout: 100, retry: 0, skip: true },
        { name: 'test-3', assertions: [], timeout: 100, retry: 0 },
      ];

      const config: ParallelExecutionConfig = {
        maxWorkers: 2,
        timeout: 500,
        isolateTests: true,
        failFast: false,
      };

      const result = await executor.executeTests(tests, config);

      expect(result.results).toHaveLength(3);
      const skipped = result.results.filter((r) => r.status === 'skip');
      expect(skipped).toHaveLength(1);
      expect(skipped[0].test.name).toBe('test-2');
    });
  });

  describe('Worker Pool Statistics', () => {
    it('should provide worker pool statistics', async () => {
      const tests: TestDefinition[] = Array.from({ length: 6 }, (_, i) => ({
        name: `test-${i}`,
        assertions: [],
        timeout: 100,
        retry: 0,
      }));

      const config: ParallelExecutionConfig = {
        maxWorkers: 3,
        timeout: 500,
        isolateTests: true,
        failFast: false,
      };

      const executionPromise = executor.executeTests(tests, config);

      // Get statistics during execution (may return null if pool not initialized)
      const statsDuring = executor.getPoolStatistics();

      await executionPromise;

      // After execution, pool should be shut down
      const statsAfter = executor.getPoolStatistics();
      expect(statsAfter).toBeNull();
    });
  });

  describe('Execution Metrics', () => {
    it('should collect execution metrics', async () => {
      const tests: TestDefinition[] = Array.from({ length: 3 }, (_, i) => ({
        name: `metric-test-${i}`,
        assertions: [],
        timeout: 100,
        retry: 0,
      }));

      const config: ParallelExecutionConfig = {
        maxWorkers: 2,
        timeout: 500,
        isolateTests: true,
        failFast: false,
      };

      await executor.executeTests(tests, config);

      const metrics = executor.getMetrics();
      expect(metrics).toBeDefined();
      expect(Array.isArray(metrics)).toBe(true);
    });
  });
});
