/**
 * Tests for FlakeDetector
 */

import { FlakeDetector } from '../testing/FlakeDetector.js';
import { TestDefinition, TestResult } from '../types/test-framework.js';

describe('FlakeDetector', () => {
  let detector: FlakeDetector;

  beforeEach(() => {
    detector = new FlakeDetector();
  });

  describe('Flake Detection', () => {
    it('should detect flaky test with inconsistent results', async () => {
      let callCount = 0;

      const test: TestDefinition = {
        name: 'flaky-test',
        assertions: [],
        timeout: 100,
        retry: 0,
      };

      const executor = async (t: TestDefinition): Promise<TestResult> => {
        callCount++;
        const passed = callCount % 2 === 0; // Alternates pass/fail

        return {
          test: t,
          status: passed ? 'pass' : 'fail',
          duration: 10,
          startTime: Date.now(),
          endTime: Date.now() + 10,
          assertions: [],
          error: passed ? undefined : new Error('Flaky failure'),
        };
      };

      const report = await detector.detectFlake(test, executor, {
        runs: 10,
        threshold: 0.1,
        parallel: false,
      });

      expect(report.testName).toBe('flaky-test');
      expect(report.totalRuns).toBe(10);
      expect(report.passes).toBe(5);
      expect(report.failures).toBe(5);
      expect(report.flakeRate).toBe(0.5);
      expect(report.isFlaky).toBe(true);
    });

    it('should mark stable test as not flaky', async () => {
      const test: TestDefinition = {
        name: 'stable-test',
        assertions: [],
        timeout: 100,
        retry: 0,
      };

      const executor = async (t: TestDefinition): Promise<TestResult> => ({
        test: t,
        status: 'pass',
        duration: 10,
        startTime: Date.now(),
        endTime: Date.now() + 10,
        assertions: [],
      });

      const report = await detector.detectFlake(test, executor, {
        runs: 10,
        threshold: 0.1,
        parallel: false,
      });

      expect(report.isFlaky).toBe(false);
      expect(report.flakeRate).toBe(0);
    });

    it('should detect flaky test with occasional failures', async () => {
      let callCount = 0;

      const test: TestDefinition = {
        name: 'occasionally-flaky',
        assertions: [],
        timeout: 100,
        retry: 0,
      };

      const executor = async (t: TestDefinition): Promise<TestResult> => {
        callCount++;
        const passed = callCount !== 3 && callCount !== 7; // Fails on 3rd and 7th run

        return {
          test: t,
          status: passed ? 'pass' : 'fail',
          duration: 10,
          startTime: Date.now(),
          endTime: Date.now() + 10,
          assertions: [],
          error: passed ? undefined : new Error('Occasional failure'),
        };
      };

      const report = await detector.detectFlake(test, executor, {
        runs: 10,
        threshold: 0.1,
        parallel: false,
      });

      expect(report.totalRuns).toBe(10);
      expect(report.failures).toBe(2);
      expect(report.flakeRate).toBe(0.2);
      expect(report.isFlaky).toBe(true);
    });
  });

  describe('Failure Patterns', () => {
    it('should extract failure patterns', async () => {
      let callCount = 0;

      const test: TestDefinition = {
        name: 'pattern-test',
        assertions: [],
        timeout: 100,
        retry: 0,
      };

      const executor = async (t: TestDefinition): Promise<TestResult> => {
        callCount++;
        const errorType = callCount % 2 === 0 ? 'timeout' : 'assertion failed';

        return {
          test: t,
          status: 'fail',
          duration: 10,
          startTime: Date.now(),
          endTime: Date.now() + 10,
          assertions: [],
          error: new Error(errorType),
        };
      };

      const report = await detector.detectFlake(test, executor, {
        runs: 10,
        threshold: 0,
        parallel: false,
      });

      expect(report.failurePatterns).toBeDefined();
      expect(report.failurePatterns!.length).toBeGreaterThan(0);
    });
  });

  describe('Batch Flake Detection', () => {
    it('should detect multiple flaky tests', async () => {
      const tests: TestDefinition[] = [
        { name: 'stable', assertions: [], timeout: 100, retry: 0 },
        { name: 'flaky-1', assertions: [], timeout: 100, retry: 0 },
        { name: 'flaky-2', assertions: [], timeout: 100, retry: 0 },
      ];

      const executor = async (t: TestDefinition): Promise<TestResult> => {
        const isFlaky = t.name.includes('flaky');
        const passed = !isFlaky || Math.random() > 0.3;

        return {
          test: t,
          status: passed ? 'pass' : 'fail',
          duration: 10,
          startTime: Date.now(),
          endTime: Date.now() + 10,
          assertions: [],
          error: passed ? undefined : new Error('Flaky'),
        };
      };

      const reports = await detector.detectFlakyTests(tests, executor, {
        runs: 10,
        threshold: 0.2,
        parallel: false,
      });

      expect(reports.length).toBeGreaterThan(0);
      reports.forEach((r) => {
        expect(r.isFlaky).toBe(true);
      });
    });
  });

  describe('Flake Summary', () => {
    it('should generate summary for multiple tests', async () => {
      const reports = [
        {
          testName: 'test-1',
          totalRuns: 10,
          passes: 7,
          failures: 3,
          errors: 0,
          flakeRate: 0.3,
          isFlaky: true,
          threshold: 0.1,
        },
        {
          testName: 'test-2',
          totalRuns: 10,
          passes: 9,
          failures: 1,
          errors: 0,
          flakeRate: 0.1,
          isFlaky: false,
          threshold: 0.1,
        },
      ];

      const summary = detector.generateFlakeSummary(reports);

      expect(summary.totalTests).toBe(2);
      expect(summary.flakyTests).toBe(1);
      expect(summary.stableTests).toBe(1);
      expect(summary.flakeRate).toBe(0.5);
    });
  });

  describe('Recommendations', () => {
    it('should generate recommendations for flaky tests', () => {
      const report = {
        testName: 'timeout-test',
        totalRuns: 10,
        passes: 6,
        failures: 4,
        errors: 0,
        flakeRate: 0.4,
        isFlaky: true,
        threshold: 0.1,
        failurePatterns: ['Timeout (4 times)'],
      };

      const recommendations = detector.generateRecommendations(report);

      expect(recommendations.length).toBeGreaterThan(0);
      expect(recommendations.some((r) => r.includes('timeout'))).toBe(true);
    });
  });

  describe('Parallel vs Sequential Detection', () => {
    it('should run detection in parallel when configured', async () => {
      const test: TestDefinition = {
        name: 'parallel-test',
        assertions: [],
        timeout: 100,
        retry: 0,
      };

      const executor = async (t: TestDefinition): Promise<TestResult> => {
        const start = Date.now();
        // Actually wait 50ms to simulate async work
        await new Promise((resolve) => setTimeout(resolve, 50));
        const end = Date.now();
        return {
          test: t,
          status: Math.random() > 0.5 ? 'pass' : 'fail',
          duration: end - start,
          startTime: start,
          endTime: end,
          assertions: [],
        };
      };

      const startParallel = Date.now();
      await detector.detectFlake(test, executor, {
        runs: 10,
        threshold: 0.1,
        parallel: true,
      });
      const parallelDuration = Date.now() - startParallel;

      const startSequential = Date.now();
      await detector.detectFlake(test, executor, {
        runs: 10,
        threshold: 0.1,
        parallel: false,
      });
      const sequentialDuration = Date.now() - startSequential;

      // Parallel should be faster
      expect(parallelDuration).toBeLessThan(sequentialDuration);
    });
  });
});
