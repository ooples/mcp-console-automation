/**
 * Tests for ExecutionMetrics
 */

import { ExecutionMetricsCollector, PerformanceMonitor, MetricsAggregator } from '../testing/ExecutionMetrics.js';
import { TestResult } from '../types/test-framework.js';

describe('ExecutionMetricsCollector', () => {
  let collector: ExecutionMetricsCollector;

  beforeEach(() => {
    collector = new ExecutionMetricsCollector();
  });

  describe('Recording Metrics', () => {
    it('should record test execution metrics', () => {
      const result: TestResult = {
        test: { name: 'test-1', assertions: [], timeout: 100, retry: 0 },
        status: 'pass',
        duration: 150,
        startTime: Date.now(),
        endTime: Date.now() + 150,
        assertions: [],
      };

      collector.recordTest('test-1', result);

      const metrics = collector.getTestMetrics('test-1');
      expect(metrics).toBeDefined();
      expect(metrics!.testName).toBe('test-1');
      expect(metrics!.duration).toBe(150);
    });

    it('should track session counts', () => {
      collector.recordSessionCreated('test-1');
      collector.recordSessionCreated('test-1');
      collector.recordSessionCreated('test-2');

      const result: TestResult = {
        test: { name: 'test-1', assertions: [], timeout: 100, retry: 0 },
        status: 'pass',
        duration: 100,
        startTime: Date.now(),
        endTime: Date.now() + 100,
        assertions: [],
      };

      collector.recordTest('test-1', result);

      const metrics = collector.getTestMetrics('test-1');
      expect(metrics!.sessionCount).toBe(2);
    });
  });

  describe('Metrics Summary', () => {
    it('should generate summary statistics', () => {
      const tests = [
        { name: 'test-1', duration: 100 },
        { name: 'test-2', duration: 200 },
        { name: 'test-3', duration: 150 },
      ];

      tests.forEach((t) => {
        const result: TestResult = {
          test: { name: t.name, assertions: [], timeout: 500, retry: 0 },
          status: 'pass',
          duration: t.duration,
          startTime: Date.now(),
          endTime: Date.now() + t.duration,
          assertions: [],
        };
        collector.recordTest(t.name, result);
      });

      const summary = collector.getSummary();

      expect(summary.totalTests).toBe(3);
      expect(summary.totalDuration).toBe(450);
      expect(summary.averageDuration).toBe(150);
    });

    it('should handle empty metrics', () => {
      const summary = collector.getSummary();

      expect(summary.totalTests).toBe(0);
      expect(summary.totalDuration).toBe(0);
      expect(summary.averageDuration).toBe(0);
    });
  });

  describe('Metrics Export', () => {
    it('should export metrics to JSON', () => {
      const result: TestResult = {
        test: { name: 'test-1', assertions: [], timeout: 100, retry: 0 },
        status: 'pass',
        duration: 100,
        startTime: Date.now(),
        endTime: Date.now() + 100,
        assertions: [],
      };

      collector.recordTest('test-1', result);

      const json = collector.toJSON();

      expect(json.metrics).toBeDefined();
      expect(json.summary).toBeDefined();
      expect(json.metrics.length).toBe(1);
    });
  });

  describe('Clear Metrics', () => {
    it('should clear all metrics', () => {
      const result: TestResult = {
        test: { name: 'test-1', assertions: [], timeout: 100, retry: 0 },
        status: 'pass',
        duration: 100,
        startTime: Date.now(),
        endTime: Date.now() + 100,
        assertions: [],
      };

      collector.recordTest('test-1', result);
      expect(collector.getMetrics()).toHaveLength(1);

      collector.clear();
      expect(collector.getMetrics()).toHaveLength(0);
    });
  });
});

describe('PerformanceMonitor', () => {
  it('should track performance metrics', async () => {
    const monitor = new PerformanceMonitor();

    monitor.start();

    // Simulate some work
    await new Promise((resolve) => setTimeout(resolve, 100));

    const metrics = monitor.stop();

    expect(metrics.duration).toBeGreaterThanOrEqual(90);
    expect(metrics.memoryUsed).toBeDefined();
    expect(metrics.peakMemory).toBeDefined();
    expect(metrics.cpuTime).toBeGreaterThanOrEqual(0);
  });
});

describe('MetricsAggregator', () => {
  it('should aggregate metrics from multiple collectors', () => {
    const aggregator = new MetricsAggregator();

    const collector1 = new ExecutionMetricsCollector();
    const collector2 = new ExecutionMetricsCollector();

    const result1: TestResult = {
      test: { name: 'test-1', assertions: [], timeout: 100, retry: 0 },
      status: 'pass',
      duration: 100,
      startTime: Date.now(),
      endTime: Date.now() + 100,
      assertions: [],
    };

    const result2: TestResult = {
      test: { name: 'test-2', assertions: [], timeout: 100, retry: 0 },
      status: 'pass',
      duration: 150,
      startTime: Date.now(),
      endTime: Date.now() + 150,
      assertions: [],
    };

    collector1.recordTest('test-1', result1);
    collector2.recordTest('test-2', result2);

    aggregator.addCollector(collector1);
    aggregator.addCollector(collector2);

    const aggregated = aggregator.getAggregatedMetrics();
    expect(aggregated).toHaveLength(2);

    const summary = aggregator.getAggregatedSummary();
    expect(summary.totalTests).toBe(2);
    expect(summary.totalDuration).toBe(250);
  });
});
