/**
 * ParallelExecutor - Executes tests in parallel using worker threads
 */

import { WorkerPool, WorkerTask } from './WorkerPool.js';
import {
  TestDefinition,
  TestResult,
  ParallelExecutionConfig,
  ParallelExecutionResult,
} from '../types/test-framework.js';
import { ExecutionMetricsCollector } from './ExecutionMetrics.js';

export class ParallelExecutor {
  private workerPool?: WorkerPool;
  private metricsCollector: ExecutionMetricsCollector;

  constructor() {
    this.metricsCollector = new ExecutionMetricsCollector();
  }

  /**
   * Execute tests in parallel
   */
  async executeTests(
    tests: TestDefinition[],
    config: ParallelExecutionConfig
  ): Promise<ParallelExecutionResult> {
    if (tests.length === 0) {
      return {
        config,
        totalTests: 0,
        results: [],
        duration: 0,
        workersUsed: 0,
      };
    }

    const startTime = Date.now();

    // Initialize worker pool
    this.workerPool = new WorkerPool({
      maxWorkers: config.maxWorkers,
      workerTimeout: config.workerTimeout || config.timeout,
    });

    await this.workerPool.initialize();

    try {
      // Execute tests
      const results = await this.runTests(tests, config);

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Calculate speedup (if we have sequential benchmark)
      const speedup = this.calculateSpeedup(results, duration);

      return {
        config,
        totalTests: tests.length,
        results,
        duration,
        workersUsed: Math.min(config.maxWorkers, tests.length),
        speedup,
      };
    } finally {
      // Cleanup worker pool
      await this.workerPool.shutdown();
      this.workerPool = undefined;
    }
  }

  /**
   * Run tests using worker pool
   */
  private async runTests(
    tests: TestDefinition[],
    config: ParallelExecutionConfig
  ): Promise<TestResult[]> {
    if (!this.workerPool) {
      throw new Error('Worker pool not initialized');
    }

    const results: TestResult[] = [];
    const failFast = config.failFast || false;
    let firstFailure: Error | null = null;

    // Create tasks
    const tasks: Promise<TestResult>[] = tests.map(async (test, index) => {
      // Check fail-fast condition
      if (failFast && firstFailure) {
        return this.createSkippedResult(test, 'Skipped due to fail-fast');
      }

      // Skip tests marked as skip
      if (test.skip) {
        return this.createSkippedResult(test, 'Test marked as skip');
      }

      try {
        const workerTask: WorkerTask = {
          id: `test-${index}-${Date.now()}`,
          test,
          timeout: test.timeout || config.timeout,
        };

        // Execute on worker
        const workerResult = await this.workerPool!.executeTask(workerTask);
        const result = workerResult.result as TestResult;

        // Track metrics
        this.metricsCollector.recordTest(test.name, result);

        // Check for failure in fail-fast mode
        if (failFast && result.status === 'fail' && !firstFailure) {
          firstFailure = result.error || new Error('Test failed');
        }

        return result;
      } catch (error) {
        // Handle task execution error
        const errorResult = this.createErrorResult(
          test,
          error instanceof Error ? error : new Error(String(error))
        );

        if (failFast && !firstFailure) {
          firstFailure = error instanceof Error ? error : new Error(String(error));
        }

        return errorResult;
      }
    });

    // Wait for all tasks to complete
    results.push(...(await Promise.all(tasks)));

    return results;
  }

  /**
   * Create a skipped test result
   */
  private createSkippedResult(test: TestDefinition, reason: string): TestResult {
    return {
      test,
      status: 'skip',
      duration: 0,
      startTime: Date.now(),
      endTime: Date.now(),
      assertions: [],
      output: reason,
    };
  }

  /**
   * Create an error test result
   */
  private createErrorResult(test: TestDefinition, error: Error): TestResult {
    const now = Date.now();
    return {
      test,
      status: 'fail',
      duration: 0,
      startTime: now,
      endTime: now,
      assertions: [],
      error,
      output: error.message,
    };
  }

  /**
   * Calculate speedup compared to sequential execution
   */
  private calculateSpeedup(results: TestResult[], parallelDuration: number): number {
    // Estimate sequential duration as sum of all test durations
    const sequentialDuration = results.reduce((sum, r) => sum + r.duration, 0);

    if (sequentialDuration === 0 || parallelDuration === 0) {
      return 1;
    }

    return sequentialDuration / parallelDuration;
  }

  /**
   * Get execution metrics
   */
  getMetrics() {
    return this.metricsCollector.getMetrics();
  }

  /**
   * Execute tests sequentially (for comparison)
   */
  async executeSequential(tests: TestDefinition[]): Promise<TestResult[]> {
    const results: TestResult[] = [];

    for (const test of tests) {
      const startTime = Date.now();

      try {
        // Simple sequential execution (stub)
        const result = await this.executeTestSequential(test);
        results.push(result);
      } catch (error) {
        results.push(
          this.createErrorResult(
            test,
            error instanceof Error ? error : new Error(String(error))
          )
        );
      }
    }

    return results;
  }

  /**
   * Execute a single test sequentially
   */
  private async executeTestSequential(test: TestDefinition): Promise<TestResult> {
    const startTime = Date.now();

    // Skip tests
    if (test.skip) {
      return this.createSkippedResult(test, 'Test marked as skip');
    }

    // Execute setup
    if (test.setup) {
      await Promise.resolve(test.setup.fn());
    }

    // Execute assertions (stub - would integrate with Phase 2)
    const assertionResults = test.assertions.map((assertion) => ({
      assertion,
      passed: true,
      message: 'Assertion passed',
    }));

    // Execute teardown
    if (test.teardown) {
      try {
        await Promise.resolve(test.teardown.fn());
      } catch (error) {
        console.error('Teardown error:', error);
      }
    }

    const endTime = Date.now();

    return {
      test,
      status: 'pass',
      duration: endTime - startTime,
      startTime,
      endTime,
      assertions: assertionResults,
    };
  }

  /**
   * Get worker pool statistics
   */
  getPoolStatistics() {
    return this.workerPool?.getStatistics() || null;
  }
}
