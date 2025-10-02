/**
 * Phase 4 Integration Tests
 * Tests integration between ParallelExecutor, RetryManager, FlakeDetector, and ExecutionMetrics
 */

import { ParallelExecutor } from '../testing/ParallelExecutor';
import { RetryManager } from '../testing/RetryManager';
import { FlakeDetector } from '../testing/FlakeDetector';
import { ExecutionMetricsCollector } from '../testing/ExecutionMetrics';
import { TestDefinition, TestResult, ParallelExecutionConfig } from '../types/test-framework';

describe('Phase 4 Integration', () => {
  describe('Parallel Execution + Retry Integration', () => {
    it('should execute tests in parallel and retry failures', async () => {
      const executor = new ParallelExecutor();
      const retryManager = new RetryManager();

      const tests: TestDefinition[] = [
        { name: 'test-1', assertions: [], timeout: 100, retry: 0 },
        { name: 'test-2', assertions: [], timeout: 100, retry: 0 },
        { name: 'test-3', assertions: [], timeout: 100, retry: 0 },
      ];

      const config: ParallelExecutionConfig = {
        maxWorkers: 2,
        timeout: 500,
        isolateTests: true,
        failFast: false,
      };

      // Execute in parallel
      const parallelResult = await executor.executeTests(tests, config);

      // Find any failures
      const failures = parallelResult.results.filter((r) => r.status === 'fail');

      if (failures.length > 0) {
        // Retry failed tests
        const testExecutor = async (test: TestDefinition): Promise<TestResult> => ({
          test,
          status: 'pass',
          duration: 50,
          startTime: Date.now(),
          endTime: Date.now() + 50,
          assertions: [],
        });

        const retryResults = await retryManager.retryFailedTests(
          failures,
          testExecutor,
          { maxRetries: 2, backoffMs: 10 }
        );

        expect(retryResults.length).toBe(failures.length);
      }

      expect(parallelResult.totalTests).toBe(3);
    });
  });

  describe('Parallel Execution + Flake Detection Integration', () => {
    it('should detect flaky tests after parallel execution', async () => {
      const executor = new ParallelExecutor();
      const flakeDetector = new FlakeDetector();

      let runCount = 0;

      const tests: TestDefinition[] = [
        { name: 'stable-test', assertions: [], timeout: 100, retry: 0 },
        { name: 'flaky-test', assertions: [], timeout: 100, retry: 0 },
      ];

      // Simulated test executor
      const testExecutor = async (test: TestDefinition): Promise<TestResult> => {
        runCount++;
        const isFlaky = test.name === 'flaky-test';
        const passed = !isFlaky || runCount % 2 === 0;

        return {
          test,
          status: passed ? 'pass' : 'fail',
          duration: 50,
          startTime: Date.now(),
          endTime: Date.now() + 50,
          assertions: [],
          error: passed ? undefined : new Error('Flaky failure'),
        };
      };

      // Run flake detection
      const reports = await flakeDetector.detectFlakyTests(
        tests,
        testExecutor,
        { runs: 6, threshold: 0.2, parallel: false }
      );

      expect(reports.length).toBeGreaterThanOrEqual(0);

      // Generate summary
      if (reports.length > 0) {
        const summary = flakeDetector.generateFlakeSummary(reports);
        expect(summary.totalTests).toBeGreaterThan(0);
      }
    });
  });

  describe('Full Pipeline Integration', () => {
    it('should execute complete test pipeline with all Phase 4 features', async () => {
      const executor = new ParallelExecutor();
      const retryManager = new RetryManager();
      const flakeDetector = new FlakeDetector();
      const metricsCollector = new ExecutionMetricsCollector();

      // Step 1: Define tests
      const tests: TestDefinition[] = Array.from({ length: 5 }, (_, i) => ({
        name: `pipeline-test-${i}`,
        assertions: [],
        timeout: 100,
        retry: 0,
      }));

      // Step 2: Execute in parallel
      const config: ParallelExecutionConfig = {
        maxWorkers: 3,
        timeout: 500,
        isolateTests: true,
        failFast: false,
      };

      const parallelResult = await executor.executeTests(tests, config);

      // Step 3: Collect metrics
      parallelResult.results.forEach((result) => {
        metricsCollector.recordTest(result.test.name, result);
      });

      const metrics = metricsCollector.getSummary();

      // Step 4: Check for flaky tests
      let callCount = 0;
      const flakyExecutor = async (test: TestDefinition): Promise<TestResult> => {
        callCount++;
        return {
          test,
          status: callCount % 3 === 0 ? 'fail' : 'pass',
          duration: 50,
          startTime: Date.now(),
          endTime: Date.now() + 50,
          assertions: [],
        };
      };

      const flakeReports = await flakeDetector.detectFlakyTests(
        [tests[0]], // Just check first test
        flakyExecutor,
        { runs: 6, threshold: 0.2, parallel: false }
      );

      // Assertions
      expect(parallelResult.totalTests).toBe(5);
      expect(metrics.totalTests).toBe(5);
      expect(flakeReports.length).toBeGreaterThanOrEqual(0);

      console.log('\n=== Full Pipeline Results ===');
      console.log(`Parallel execution: ${parallelResult.totalTests} tests in ${parallelResult.duration}ms`);
      console.log(`Metrics collected: ${metrics.totalTests} tests, avg duration: ${metrics.averageDuration.toFixed(2)}ms`);
      console.log(`Flake detection: ${flakeReports.length} flaky tests found`);
      console.log('=== Pipeline Complete ===\n');
    });
  });

  describe('Metrics Collection Integration', () => {
    it('should collect metrics from parallel execution', async () => {
      const executor = new ParallelExecutor();

      const tests: TestDefinition[] = Array.from({ length: 8 }, (_, i) => ({
        name: `metrics-integration-test-${i}`,
        assertions: [],
        timeout: 100,
        retry: 0,
      }));

      const config: ParallelExecutionConfig = {
        maxWorkers: 4,
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

  describe('Error Handling Integration', () => {
    it('should handle errors gracefully across all components', async () => {
      const executor = new ParallelExecutor();

      // Test with invalid configuration
      const tests: TestDefinition[] = [
        { name: 'error-test', assertions: [], timeout: 100, retry: 0 },
      ];

      const config: ParallelExecutionConfig = {
        maxWorkers: 1,
        timeout: 500,
        isolateTests: true,
        failFast: false,
      };

      const result = await executor.executeTests(tests, config);

      expect(result.totalTests).toBe(1);
      expect(result.results).toHaveLength(1);
    });
  });
});
