/**
 * AssertionEngine Test Suite
 * Tests assertion evaluation logic
 */

import { AssertionEngine } from '../testing/AssertionEngine';
import { Assertion } from '../types/test-framework';

describe('AssertionEngine', () => {
  let engine: AssertionEngine;

  beforeEach(() => {
    engine = new AssertionEngine();
  });

  describe('output_contains assertions', () => {
    it('should pass when output contains expected text', async () => {
      const assertion: Assertion = {
        type: 'output_contains',
        expected: 'success',
        actual: 'Test completed successfully',
      };

      const result = await engine.evaluate(assertion);
      expect(result.passed).toBe(true);
      expect(result.message).toContain('contains expected text');
    });

    it('should fail when output does not contain expected text', async () => {
      const assertion: Assertion = {
        type: 'output_contains',
        expected: 'error',
        actual: 'Test completed successfully',
      };

      const result = await engine.evaluate(assertion);
      expect(result.passed).toBe(false);
      expect(result.message).toContain('does not contain');
    });

    it('should throw on assert failure', async () => {
      const assertion: Assertion = {
        type: 'output_contains',
        expected: 'error',
        actual: 'Test completed successfully',
      };

      await expect(engine.assert(assertion)).rejects.toThrow('does not contain');
    });
  });

  describe('output_matches assertions', () => {
    it('should pass when output matches regex', async () => {
      const assertion: Assertion = {
        type: 'output_matches',
        expected: /Test \d+/,
        actual: 'Test 123 completed',
      };

      const result = await engine.evaluate(assertion);
      expect(result.passed).toBe(true);
    });

    it('should work with string regex', async () => {
      const assertion: Assertion = {
        type: 'output_matches',
        expected: 'Test \\d+',
        actual: 'Test 123 completed',
      };

      const result = await engine.evaluate(assertion);
      expect(result.passed).toBe(true);
    });

    it('should fail when output does not match regex', async () => {
      const assertion: Assertion = {
        type: 'output_matches',
        expected: /Error \d+/,
        actual: 'Test completed successfully',
      };

      const result = await engine.evaluate(assertion);
      expect(result.passed).toBe(false);
      expect(result.message).toContain('does not match');
    });
  });

  describe('exit_code assertions', () => {
    it('should pass when exit codes match', async () => {
      const assertion: Assertion = {
        type: 'exit_code',
        expected: 0,
        actual: 0,
      };

      const result = await engine.evaluate(assertion);
      expect(result.passed).toBe(true);
    });

    it('should fail when exit codes do not match', async () => {
      const assertion: Assertion = {
        type: 'exit_code',
        expected: 0,
        actual: 1,
      };

      const result = await engine.evaluate(assertion);
      expect(result.passed).toBe(false);
      expect(result.message).toContain('does not match');
    });

    it('should validate types', async () => {
      const assertion: Assertion = {
        type: 'exit_code',
        expected: 0,
        actual: 'not a number' as any,
      };

      const result = await engine.evaluate(assertion);
      expect(result.passed).toBe(false);
      expect(result.message).toContain('failed');
    });
  });

  describe('no_errors assertions', () => {
    it('should pass when output has no errors', async () => {
      const assertion: Assertion = {
        type: 'no_errors',
        expected: null,
        actual: 'Test completed successfully. All checks passed.',
      };

      const result = await engine.evaluate(assertion);
      expect(result.passed).toBe(true);
    });

    it('should fail when output contains error keywords', async () => {
      const assertion: Assertion = {
        type: 'no_errors',
        expected: null,
        actual: 'Error: Test failed with exception',
      };

      const result = await engine.evaluate(assertion);
      expect(result.passed).toBe(false);
    });

    it('should detect various error patterns', async () => {
      const errorOutputs = [
        'Error: something went wrong',
        'Exception occurred',
        'Fatal: system crash',
        'Command failed',
        'Cannot access file',
        'Unable to connect',
        'Permission denied',
        'Command not found',
        'No such file or directory',
        'Syntax error detected',
      ];

      for (const output of errorOutputs) {
        const assertion: Assertion = {
          type: 'no_errors',
          expected: null,
          actual: output,
        };

        const result = await engine.evaluate(assertion);
        expect(result.passed).toBe(false);
      }
    });
  });

  describe('state_equals assertions', () => {
    it('should pass when states are deeply equal', async () => {
      const assertion: Assertion = {
        type: 'state_equals',
        expected: { status: 'success', count: 5 },
        actual: { status: 'success', count: 5 },
      };

      const result = await engine.evaluate(assertion);
      expect(result.passed).toBe(true);
    });

    it('should fail when states differ', async () => {
      const assertion: Assertion = {
        type: 'state_equals',
        expected: { status: 'success', count: 5 },
        actual: { status: 'success', count: 6 },
      };

      const result = await engine.evaluate(assertion);
      expect(result.passed).toBe(false);
    });

    it('should handle nested objects', async () => {
      const assertion: Assertion = {
        type: 'state_equals',
        expected: { a: { b: { c: 1 } } },
        actual: { a: { b: { c: 1 } } },
      };

      const result = await engine.evaluate(assertion);
      expect(result.passed).toBe(true);
    });
  });

  describe('custom assertions', () => {
    it('should register and use custom matcher', async () => {
      engine.registerMatcher({
        name: 'isEven',
        fn: (actual, expected) => actual % 2 === 0,
        description: 'Checks if number is even',
      });

      const assertion: Assertion = {
        type: 'custom',
        operator: 'isEven',
        expected: null,
        actual: 4,
      };

      const result = await engine.evaluate(assertion);
      expect(result.passed).toBe(true);
    });

    it('should fail with unknown custom matcher', async () => {
      const assertion: Assertion = {
        type: 'custom',
        operator: 'unknownMatcher',
        expected: null,
        actual: 5,
      };

      const result = await engine.evaluate(assertion);
      expect(result.passed).toBe(false);
      expect(result.message).toContain('Unknown custom matcher');
    });

    it('should require operator for custom assertions', async () => {
      const assertion: Assertion = {
        type: 'custom',
        expected: null,
        actual: 5,
      };

      const result = await engine.evaluate(assertion);
      expect(result.passed).toBe(false);
      expect(result.message).toContain('requires operator');
    });
  });

  describe('evaluateAll', () => {
    it('should evaluate multiple assertions', async () => {
      const assertions: Assertion[] = [
        { type: 'output_contains', expected: 'success', actual: 'success message' },
        { type: 'exit_code', expected: 0, actual: 0 },
        { type: 'no_errors', expected: null, actual: 'all good' },
      ];

      const results = await engine.evaluateAll(assertions);
      expect(results).toHaveLength(3);
      expect(results.every(r => r.passed)).toBe(true);
    });

    it('should continue evaluating after failures', async () => {
      const assertions: Assertion[] = [
        { type: 'output_contains', expected: 'error', actual: 'success message' },
        { type: 'exit_code', expected: 0, actual: 0 },
        { type: 'no_errors', expected: null, actual: 'all good' },
      ];

      const results = await engine.evaluateAll(assertions);
      expect(results).toHaveLength(3);
      expect(results[0].passed).toBe(false);
      expect(results[1].passed).toBe(true);
      expect(results[2].passed).toBe(true);
    });
  });

  describe('assertAll', () => {
    it('should pass when all assertions pass', async () => {
      const assertions: Assertion[] = [
        { type: 'output_contains', expected: 'success', actual: 'success message' },
        { type: 'exit_code', expected: 0, actual: 0 },
      ];

      await expect(engine.assertAll(assertions)).resolves.not.toThrow();
    });

    it('should throw on first failure', async () => {
      const assertions: Assertion[] = [
        { type: 'output_contains', expected: 'error', actual: 'success message' },
        { type: 'exit_code', expected: 0, actual: 0 },
      ];

      await expect(engine.assertAll(assertions)).rejects.toThrow();
    });
  });

  describe('checkAll', () => {
    it('should return passed status and results', async () => {
      const assertions: Assertion[] = [
        { type: 'output_contains', expected: 'success', actual: 'success message' },
        { type: 'exit_code', expected: 0, actual: 0 },
      ];

      const { passed, results } = await engine.checkAll(assertions);
      expect(passed).toBe(true);
      expect(results).toHaveLength(2);
    });

    it('should indicate failure without throwing', async () => {
      const assertions: Assertion[] = [
        { type: 'output_contains', expected: 'error', actual: 'success message' },
        { type: 'exit_code', expected: 0, actual: 0 },
      ];

      const { passed, results } = await engine.checkAll(assertions);
      expect(passed).toBe(false);
      expect(results[0].passed).toBe(false);
    });
  });

  describe('error messages', () => {
    it('should provide clear error messages for failures', async () => {
      const assertion: Assertion = {
        type: 'output_contains',
        expected: 'error',
        actual: 'success message',
      };

      const result = await engine.evaluate(assertion);
      expect(result.message).toMatch(/does not contain/i);
      expect(result.message).toContain('error');
    });

    it('should truncate long output in messages', async () => {
      const longOutput = 'a'.repeat(500);
      const assertion: Assertion = {
        type: 'output_contains',
        expected: 'xyz',
        actual: longOutput,
      };

      const result = await engine.evaluate(assertion);
      expect(result.message.length).toBeLessThan(longOutput.length + 100);
      expect(result.message).toContain('truncated');
    });
  });

  describe('getCustomMatchers', () => {
    it('should return all registered matchers', () => {
      engine.registerMatcher({
        name: 'test1',
        fn: () => true,
        description: 'Test matcher 1',
      });
      engine.registerMatcher({
        name: 'test2',
        fn: () => true,
        description: 'Test matcher 2',
      });

      const matchers = engine.getCustomMatchers();
      expect(matchers).toHaveLength(2);
      expect(matchers.map(m => m.name)).toContain('test1');
      expect(matchers.map(m => m.name)).toContain('test2');
    });
  });
});
