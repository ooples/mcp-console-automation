/**
 * AssertionEngine - Evaluates assertions for test framework
 * Phase 2: Assertion Framework
 */

import { Assertion, AssertionResult } from '../types/test-framework.js';
import { Matchers } from './Matchers.js';

export interface CustomMatcher {
  name: string;
  fn: (actual: any, expected: any) => boolean;
  description: string;
}

export class AssertionEngine {
  private customMatchers: Map<string, CustomMatcher> = new Map();
  private matchers = new Matchers();

  /**
   * Register a custom matcher
   */
  registerMatcher(matcher: CustomMatcher): void {
    this.customMatchers.set(matcher.name, matcher);
  }

  /**
   * Get all registered custom matchers
   */
  getCustomMatchers(): CustomMatcher[] {
    return Array.from(this.customMatchers.values());
  }

  /**
   * Evaluate an assertion and return the result
   */
  async evaluate(assertion: Assertion): Promise<AssertionResult> {
    try {
      const passed = await this.evaluateAssertion(assertion);

      return {
        assertion,
        passed,
        message: passed
          ? this.getSuccessMessage(assertion)
          : this.getFailureMessage(assertion),
      };
    } catch (error: any) {
      return {
        assertion,
        passed: false,
        message: `Assertion evaluation failed: ${error.message}`,
        stack: error.stack,
      };
    }
  }

  /**
   * Evaluate assertion and throw on failure
   */
  async assert(assertion: Assertion): Promise<void> {
    const result = await this.evaluate(assertion);
    if (!result.passed) {
      const error = new Error(result.message);
      error.stack = result.stack || error.stack;
      throw error;
    }
  }

  /**
   * Core assertion evaluation logic
   */
  private async evaluateAssertion(assertion: Assertion): Promise<boolean> {
    const { type, expected, actual, operator } = assertion;

    switch (type) {
      case 'output_contains':
        return this.evaluateOutputContains(actual, expected);

      case 'output_matches':
        return this.evaluateOutputMatches(actual, expected);

      case 'exit_code':
        return this.evaluateExitCode(actual, expected);

      case 'no_errors':
        return this.evaluateNoErrors(actual);

      case 'state_equals':
        return this.evaluateStateEquals(actual, expected);

      case 'custom':
        return this.evaluateCustom(actual, expected, operator);

      default:
        throw new Error(`Unknown assertion type: ${type}`);
    }
  }

  /**
   * Evaluate output_contains assertion
   */
  private evaluateOutputContains(actual: any, expected: any): boolean {
    if (typeof actual !== 'string') {
      throw new Error(`Expected actual to be string, got ${typeof actual}`);
    }
    if (typeof expected !== 'string') {
      throw new Error(`Expected expected to be string, got ${typeof expected}`);
    }
    return this.matchers.toContain(actual, expected);
  }

  /**
   * Evaluate output_matches assertion (regex)
   */
  private evaluateOutputMatches(actual: any, expected: any): boolean {
    if (typeof actual !== 'string') {
      throw new Error(`Expected actual to be string, got ${typeof actual}`);
    }

    let pattern: RegExp;
    if (expected instanceof RegExp) {
      pattern = expected;
    } else if (typeof expected === 'string') {
      pattern = new RegExp(expected);
    } else {
      throw new Error(
        `Expected pattern to be string or RegExp, got ${typeof expected}`
      );
    }

    return this.matchers.toMatch(actual, pattern);
  }

  /**
   * Evaluate exit_code assertion
   */
  private evaluateExitCode(actual: any, expected: any): boolean {
    if (typeof actual !== 'number') {
      throw new Error(
        `Expected actual exit code to be number, got ${typeof actual}`
      );
    }
    if (typeof expected !== 'number') {
      throw new Error(
        `Expected expected exit code to be number, got ${typeof expected}`
      );
    }
    return this.matchers.toEqual(actual, expected);
  }

  /**
   * Evaluate no_errors assertion
   */
  private evaluateNoErrors(actual: any): boolean {
    if (typeof actual !== 'string') {
      throw new Error(`Expected actual to be string, got ${typeof actual}`);
    }

    // Check for common error patterns
    const errorPatterns = [
      /error\b/i,
      /exception\b/i,
      /fatal\b/i,
      /failed\b/i,
      /cannot/i,
      /unable to/i,
      /permission denied/i,
      /command not found/i,
      /no such file/i,
      /syntax error/i,
      /segmentation fault/i,
      /core dumped/i,
    ];

    for (const pattern of errorPatterns) {
      if (pattern.test(actual)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Evaluate state_equals assertion
   */
  private evaluateStateEquals(actual: any, expected: any): boolean {
    return this.matchers.toDeepEqual(actual, expected);
  }

  /**
   * Evaluate custom assertion using operator
   */
  private evaluateCustom(
    actual: any,
    expected: any,
    operator?: string
  ): boolean {
    if (!operator) {
      throw new Error('Custom assertion requires operator');
    }

    const matcher = this.customMatchers.get(operator);
    if (!matcher) {
      throw new Error(`Unknown custom matcher: ${operator}`);
    }

    return matcher.fn(actual, expected);
  }

  /**
   * Generate success message
   */
  private getSuccessMessage(assertion: Assertion): string {
    const { type, expected } = assertion;

    switch (type) {
      case 'output_contains':
        return `Output contains expected text: "${expected}"`;

      case 'output_matches':
        return `Output matches pattern: ${expected}`;

      case 'exit_code':
        return `Exit code equals expected value: ${expected}`;

      case 'no_errors':
        return 'No errors detected in output';

      case 'state_equals':
        return 'State equals expected value';

      case 'custom':
        return `Custom assertion passed: ${assertion.operator}`;

      default:
        return 'Assertion passed';
    }
  }

  /**
   * Generate detailed failure message
   */
  private getFailureMessage(assertion: Assertion): string {
    const { type, expected, actual, operator } = assertion;

    switch (type) {
      case 'output_contains':
        return this.formatFailureMessage(
          'Output does not contain expected text',
          `Expected to contain: "${expected}"`,
          `Actual output: "${this.truncate(actual)}"`
        );

      case 'output_matches':
        return this.formatFailureMessage(
          'Output does not match expected pattern',
          `Expected pattern: ${expected}`,
          `Actual output: "${this.truncate(actual)}"`
        );

      case 'exit_code':
        return this.formatFailureMessage(
          'Exit code does not match expected value',
          `Expected: ${expected}`,
          `Actual: ${actual}`
        );

      case 'no_errors':
        return this.formatFailureMessage(
          'Errors detected in output',
          'Expected: No errors',
          `Actual output: "${this.truncate(actual)}"`
        );

      case 'state_equals':
        return this.formatFailureMessage(
          'State does not equal expected value',
          `Expected: ${JSON.stringify(expected, null, 2)}`,
          `Actual: ${JSON.stringify(actual, null, 2)}`
        );

      case 'custom':
        return this.formatFailureMessage(
          `Custom assertion failed: ${operator}`,
          `Expected: ${JSON.stringify(expected)}`,
          `Actual: ${JSON.stringify(actual)}`
        );

      default:
        return 'Assertion failed';
    }
  }

  /**
   * Format failure message with consistent structure
   */
  private formatFailureMessage(
    title: string,
    expected: string,
    actual: string
  ): string {
    return `${title}

${expected}
${actual}`;
  }

  /**
   * Truncate long strings for error messages
   */
  private truncate(value: any, maxLength: number = 200): string {
    const str = String(value);
    if (str.length <= maxLength) {
      return str;
    }
    return str.substring(0, maxLength) + '... (truncated)';
  }

  /**
   * Batch evaluate multiple assertions
   */
  async evaluateAll(assertions: Assertion[]): Promise<AssertionResult[]> {
    const results: AssertionResult[] = [];

    for (const assertion of assertions) {
      const result = await this.evaluate(assertion);
      results.push(result);
    }

    return results;
  }

  /**
   * Assert all assertions pass, or throw on first failure
   */
  async assertAll(assertions: Assertion[]): Promise<void> {
    for (const assertion of assertions) {
      await this.assert(assertion);
    }
  }

  /**
   * Check if all assertions pass without throwing
   */
  async checkAll(
    assertions: Assertion[]
  ): Promise<{ passed: boolean; results: AssertionResult[] }> {
    const results = await this.evaluateAll(assertions);
    const passed = results.every((r) => r.passed);
    return { passed, results };
  }
}
