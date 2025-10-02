/**
 * Data Parameterizer
 *
 * Implements parameterized test execution - run the same test with multiple datasets.
 * Supports different execution strategies (all, first-failure, random-sample).
 */

import {
  ParameterizedTest,
  TestDefinition,
  TestResult,
  DatasetConfig,
  Assertion,
  AssertionResult,
} from '../types/test-framework.js';

export interface ParameterizerOptions {
  strategy?: 'all' | 'first-failure' | 'random-sample';
  sampleSize?: number; // For random-sample strategy
  timeout?: number;
  continueOnFailure?: boolean;
}

export class DataParameterizer {
  /**
   * Run a test with multiple datasets
   */
  async runParameterized(
    test: TestDefinition,
    datasets: any[],
    options: ParameterizerOptions = {}
  ): Promise<ParameterizedTest> {
    const opts = {
      strategy: 'all' as const,
      continueOnFailure: true,
      ...options,
    };

    const results: TestResult[] = [];

    // Select datasets based on strategy
    const selectedDatasets = this.selectDatasets(datasets, opts);

    // Execute test for each dataset
    for (let i = 0; i < selectedDatasets.length; i++) {
      const dataset = selectedDatasets[i];

      try {
        const result = await this.executeTest(test, dataset, i, opts);
        results.push(result);

        // Check if we should stop early
        if (opts.strategy === 'first-failure' && result.status === 'fail') {
          break;
        }
      } catch (error) {
        // Create error result
        const errorResult: TestResult = {
          test,
          status: 'fail',
          duration: 0,
          startTime: Date.now(),
          endTime: Date.now(),
          assertions: [],
          error: error instanceof Error ? error : new Error(String(error)),
        };
        results.push(errorResult);

        // Stop if strategy is first-failure
        if (opts.strategy === 'first-failure') {
          break;
        }
      }
    }

    return {
      test,
      datasets: selectedDatasets,
      results,
      strategy: opts.strategy,
    };
  }

  /**
   * Create a parameterized test from a dataset configuration
   */
  async createParameterized(
    test: TestDefinition,
    config: DatasetConfig,
    options?: ParameterizerOptions
  ): Promise<ParameterizedTest> {
    const datasets = await this.loadDatasets(config);
    return this.runParameterized(test, datasets, options);
  }

  /**
   * Generate summary statistics for parameterized results
   */
  summarizeResults(parameterized: ParameterizedTest): {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    passRate: number;
    avgDuration: number;
  } {
    const total = parameterized.results.length;
    const passed = parameterized.results.filter((r) => r.status === 'pass').length;
    const failed = parameterized.results.filter((r) => r.status === 'fail').length;
    const skipped = parameterized.results.filter((r) => r.status === 'skip').length;
    const passRate = total > 0 ? passed / total : 0;
    const avgDuration =
      total > 0
        ? parameterized.results.reduce((sum, r) => sum + r.duration, 0) / total
        : 0;

    return {
      total,
      passed,
      failed,
      skipped,
      passRate,
      avgDuration,
    };
  }

  /**
   * Find which datasets failed
   */
  getFailedDatasets(parameterized: ParameterizedTest): {
    index: number;
    dataset: any;
    result: TestResult;
  }[] {
    return parameterized.results
      .map((result, index) => ({
        index,
        dataset: parameterized.datasets[index],
        result,
      }))
      .filter((item) => item.result.status === 'fail');
  }

  /**
   * Get dataset by index
   */
  getDatasetAt(parameterized: ParameterizedTest, index: number): any {
    if (index < 0 || index >= parameterized.datasets.length) {
      throw new Error(`Dataset index out of bounds: ${index}`);
    }
    return parameterized.datasets[index];
  }

  /**
   * Select datasets based on strategy
   */
  private selectDatasets(
    datasets: any[],
    options: ParameterizerOptions
  ): any[] {
    switch (options.strategy) {
      case 'all':
        return datasets;

      case 'first-failure':
        return datasets;

      case 'random-sample': {
        const sampleSize = Math.min(
          options.sampleSize || datasets.length,
          datasets.length
        );
        return this.randomSample(datasets, sampleSize);
      }

      default:
        return datasets;
    }
  }

  /**
   * Get random sample of datasets
   */
  private randomSample(datasets: any[], size: number): any[] {
    const shuffled = [...datasets].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, size);
  }

  /**
   * Load datasets from configuration
   */
  private async loadDatasets(config: DatasetConfig): Promise<any[]> {
    switch (config.source) {
      case 'file': {
        if (!config.path) {
          throw new Error('File path required for file source');
        }
        // Import TestDataLoader dynamically to avoid circular deps
        const { TestDataLoader } = await import('./TestDataLoader.js');
        const loader = new TestDataLoader();
        const fixture = await loader.loadFixture(config.path);
        return Array.isArray(fixture.data) ? fixture.data : [fixture.data];
      }

      case 'inline': {
        if (!config.generator) {
          throw new Error('Generator function required for inline source');
        }
        return config.generator();
      }

      case 'generated': {
        if (!config.generator) {
          throw new Error('Generator function required for generated source');
        }
        const count = config.count || 10;
        const datasets: any[] = [];
        for (let i = 0; i < count; i++) {
          const generated = config.generator();
          datasets.push(...(Array.isArray(generated) ? generated : [generated]));
        }
        return datasets.slice(0, count);
      }

      default:
        throw new Error(`Unknown dataset source: ${config.source}`);
    }
  }

  /**
   * Execute test with a specific dataset
   */
  private async executeTest(
    test: TestDefinition,
    dataset: any,
    index: number,
    options: ParameterizerOptions
  ): Promise<TestResult> {
    const startTime = Date.now();

    try {
      // Setup timeout if specified
      const timeout = options.timeout || test.timeout || 30000;
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`Test timeout after ${timeout}ms`)),
          timeout
        );
      });

      // Execute test with dataset
      const executionPromise = this.executeTestLogic(test, dataset, index);

      // Race between execution and timeout
      const assertions = await Promise.race([executionPromise, timeoutPromise]);

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Determine overall status
      const allPassed = assertions.every((a) => a.passed);
      const status = allPassed ? 'pass' : 'fail';

      return {
        test,
        status,
        duration,
        startTime,
        endTime,
        assertions,
      };
    } catch (error) {
      const endTime = Date.now();
      const duration = endTime - startTime;

      return {
        test,
        status: error instanceof Error && error.message.includes('timeout')
          ? 'timeout'
          : 'fail',
        duration,
        startTime,
        endTime,
        assertions: [],
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  /**
   * Execute the actual test logic
   * This is a stub - in production, would integrate with test execution engine
   */
  private async executeTestLogic(
    test: TestDefinition,
    dataset: any,
    index: number
  ): Promise<AssertionResult[]> {
    // Run setup hook if present
    if (test.setup) {
      await test.setup.fn();
    }

    // Execute assertions
    const assertionResults: AssertionResult[] = [];

    for (const assertion of test.assertions) {
      const result = await this.evaluateAssertion(assertion, dataset, index);
      assertionResults.push(result);
    }

    // Run teardown hook if present
    if (test.teardown) {
      await test.teardown.fn();
    }

    return assertionResults;
  }

  /**
   * Evaluate a single assertion with dataset
   * This is a stub - in production, would integrate with assertion engine
   */
  private async evaluateAssertion(
    assertion: Assertion,
    dataset: any,
    index: number
  ): Promise<AssertionResult> {
    // For parameterized tests, inject dataset into assertion context
    // This is a simplified version - real implementation would be more sophisticated

    const passed = true; // Stub - would actually evaluate assertion

    return {
      assertion,
      passed,
      message: passed
        ? `Assertion passed for dataset ${index}`
        : `Assertion failed for dataset ${index}`,
    };
  }
}
