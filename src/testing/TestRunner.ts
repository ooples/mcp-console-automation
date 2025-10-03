/**
 * Test Runner
 *
 * Executes test suites and collects results.
 */

import {
  TestSuite,
  TestDefinition,
  TestResult,
  TestSuiteResult,
  AssertionResult,
  Assertion,
} from '../types/test-framework.js';

export class TestRunner {
  /**
   * Run a complete test suite
   */
  async runSuite(suite: TestSuite): Promise<TestSuiteResult> {
    const startTime = Date.now();
    const results: TestResult[] = [];

    console.log(`\n🏃 Running test suite: ${suite.name}`);
    console.log(`Description: ${suite.description}`);

    try {
      // Run suite setup hook if present
      if (suite.setup) {
        await this.runHook(suite.setup, 'Suite Setup');
      }

      // Run each test
      for (const test of suite.tests) {
        if (test.skip) {
          results.push(this.createSkippedResult(test));
          continue;
        }

        const result = await this.runTest(test, suite);
        results.push(result);

        // Bail on first failure if configured
        if (suite.config.bail && result.status === 'fail') {
          console.log('\n⚠️  Bail mode: Stopping on first failure');
          break;
        }
      }

      // Run suite teardown hook if present
      if (suite.teardown) {
        await this.runHook(suite.teardown, 'Suite Teardown');
      }
    } catch (error) {
      console.error('❌ Suite execution error:', error);
    }

    const endTime = Date.now();
    const duration = endTime - startTime;

    // Calculate statistics
    const passed = results.filter(r => r.status === 'pass').length;
    const failed = results.filter(r => r.status === 'fail').length;
    const skipped = results.filter(r => r.status === 'skip').length;

    const suiteResult: TestSuiteResult = {
      suite,
      totalTests: suite.tests.length,
      passed,
      failed,
      skipped,
      duration,
      startTime,
      endTime,
      tests: results,
    };

    this.printSummary(suiteResult);
    return suiteResult;
  }

  /**
   * Run a single test with retries
   */
  private async runTest(test: TestDefinition, suite: TestSuite): Promise<TestResult> {
    const maxAttempts = test.retry + 1;
    let lastResult: TestResult | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        console.log(`  🔄 Retry attempt ${attempt}/${test.retry} for "${test.name}"`);
      }

      lastResult = await this.runTestOnce(test, attempt);

      // Break on success
      if (lastResult.status === 'pass') {
        break;
      }
    }

    return lastResult!;
  }

  /**
   * Run a single test once
   */
  private async runTestOnce(test: TestDefinition, retryCount: number = 0): Promise<TestResult> {
    const startTime = Date.now();
    const assertions: AssertionResult[] = [];
    let status: TestResult['status'] = 'pass';
    let error: Error | undefined;
    let output = '';

    console.log(`\n  ▶️  ${test.name}`);
    if (test.description) {
      console.log(`     ${test.description}`);
    }

    try {
      // Run test setup hook if present
      if (test.setup) {
        await this.runHook(test.setup, 'Test Setup');
      }

      // Execute test with timeout
      const testPromise = this.executeTest(test);
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Test timeout')), test.timeout);
      });

      const result = await Promise.race([testPromise, timeoutPromise]);
      output = result.output;
      assertions.push(...result.assertions);

      // Check if any assertions failed
      const failedAssertions = assertions.filter(a => !a.passed);
      if (failedAssertions.length > 0) {
        status = 'fail';
        error = new Error(`${failedAssertions.length} assertion(s) failed`);
      }

      // Run test teardown hook if present
      if (test.teardown) {
        await this.runHook(test.teardown, 'Test Teardown');
      }
    } catch (err) {
      status = (err as Error).message === 'Test timeout' ? 'timeout' : 'fail';
      error = err as Error;
      console.log(`     ❌ ${error.message}`);
    }

    const endTime = Date.now();
    const duration = endTime - startTime;

    // Print result
    if (status === 'pass') {
      console.log(`     ✅ PASS (${duration}ms)`);
    } else if (status === 'timeout') {
      console.log(`     ⏱️  TIMEOUT after ${test.timeout}ms`);
    } else {
      console.log(`     ❌ FAIL (${duration}ms)`);
    }

    return {
      test,
      status,
      duration,
      startTime,
      endTime,
      assertions,
      error,
      retries: retryCount,
      output,
    };
  }

  /**
   * Execute the actual test logic
   * For Phase 3, this is a stub that simulates test execution
   */
  private async executeTest(test: TestDefinition): Promise<{
    output: string;
    assertions: AssertionResult[];
  }> {
    const assertions: AssertionResult[] = [];

    // Simulate test execution
    // In a real implementation, this would:
    // 1. Replay the recording if present
    // 2. Execute the test assertions
    // 3. Capture output

    for (const assertion of test.assertions) {
      const result = await this.executeAssertion(assertion);
      assertions.push(result);
    }

    return {
      output: `Test output for ${test.name}`,
      assertions,
    };
  }

  /**
   * Execute a single assertion
   * For Phase 3, this is a stub that simulates assertion execution
   */
  private async executeAssertion(assertion: Assertion): Promise<AssertionResult> {
    // Stub implementation - Phase 2 will provide the real assertion engine
    // For now, randomly pass/fail to simulate test execution

    const passed = Math.random() > 0.2; // 80% pass rate for simulation

    return {
      assertion,
      passed,
      message: passed
        ? `Assertion passed: ${assertion.type}`
        : `Assertion failed: ${assertion.type} - expected ${JSON.stringify(assertion.expected)}`,
      stack: passed ? undefined : new Error().stack,
    };
  }

  /**
   * Run a test hook (setup/teardown)
   */
  private async runHook(hook: { type: string; fn: () => Promise<void> | void; timeout?: number }, label: string): Promise<void> {
    try {
      const timeout = hook.timeout ?? 10000;
      const hookPromise = Promise.resolve(hook.fn());
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`${label} timeout`)), timeout);
      });

      await Promise.race([hookPromise, timeoutPromise]);
    } catch (error) {
      console.error(`❌ ${label} failed:`, error);
      throw error;
    }
  }

  /**
   * Create a skipped test result
   */
  private createSkippedResult(test: TestDefinition): TestResult {
    console.log(`\n  ⊝  ${test.name} (SKIPPED)`);

    return {
      test,
      status: 'skip',
      duration: 0,
      startTime: Date.now(),
      endTime: Date.now(),
      assertions: [],
    };
  }

  /**
   * Print test suite summary
   */
  private printSummary(result: TestSuiteResult): void {
    console.log('\n' + '='.repeat(60));
    console.log('Test Suite Summary');
    console.log('='.repeat(60));
    console.log(`Suite: ${result.suite.name}`);
    console.log(`Total: ${result.totalTests} tests`);
    console.log(`✅ Passed: ${result.passed}`);
    console.log(`❌ Failed: ${result.failed}`);
    console.log(`⊝  Skipped: ${result.skipped}`);
    console.log(`⏱️  Duration: ${result.duration}ms`);

    const passRate = result.totalTests > 0 ? (result.passed / result.totalTests) * 100 : 0;
    console.log(`📊 Pass Rate: ${passRate.toFixed(1)}%`);
    console.log('='.repeat(60) + '\n');
  }
}
