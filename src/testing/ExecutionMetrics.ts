/**
 * ExecutionMetrics - Collects and tracks test execution metrics
 */

import { ExecutionMetrics, TestResult } from '../types/test-framework.js';

export class ExecutionMetricsCollector {
  private metrics: Map<string, ExecutionMetrics> = new Map();
  private sessionCounts: Map<string, number> = new Map();

  /**
   * Record test execution metrics
   */
  recordTest(testName: string, result: TestResult): void {
    const memoryUsage = process.memoryUsage();

    const metrics: ExecutionMetrics = {
      testName,
      duration: result.duration,
      memoryUsed: memoryUsage.heapUsed,
      cpuTime: this.getCpuTime(),
      peakMemory: memoryUsage.heapUsed, // Would track max over time in real impl
      sessionCount: this.sessionCounts.get(testName) || 0,
    };

    this.metrics.set(testName, metrics);
  }

  /**
   * Record session creation
   */
  recordSessionCreated(testName: string): void {
    const count = this.sessionCounts.get(testName) || 0;
    this.sessionCounts.set(testName, count + 1);
  }

  /**
   * Get CPU time (approximation)
   */
  private getCpuTime(): number {
    const usage = process.cpuUsage();
    return (usage.user + usage.system) / 1000; // Convert to milliseconds
  }

  /**
   * Get all metrics
   */
  getMetrics(): ExecutionMetrics[] {
    return Array.from(this.metrics.values());
  }

  /**
   * Get metrics for a specific test
   */
  getTestMetrics(testName: string): ExecutionMetrics | undefined {
    return this.metrics.get(testName);
  }

  /**
   * Get summary statistics
   */
  getSummary() {
    const metrics = this.getMetrics();

    if (metrics.length === 0) {
      return {
        totalTests: 0,
        totalDuration: 0,
        averageDuration: 0,
        totalMemory: 0,
        averageMemory: 0,
        peakMemory: 0,
        totalSessions: 0,
      };
    }

    return {
      totalTests: metrics.length,
      totalDuration: metrics.reduce((sum, m) => sum + m.duration, 0),
      averageDuration:
        metrics.reduce((sum, m) => sum + m.duration, 0) / metrics.length,
      totalMemory: metrics.reduce((sum, m) => sum + m.memoryUsed, 0),
      averageMemory:
        metrics.reduce((sum, m) => sum + m.memoryUsed, 0) / metrics.length,
      peakMemory: Math.max(...metrics.map((m) => m.peakMemory)),
      totalSessions: metrics.reduce((sum, m) => sum + m.sessionCount, 0),
    };
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics.clear();
    this.sessionCounts.clear();
  }

  /**
   * Export metrics to JSON
   */
  toJSON(): any {
    return {
      metrics: Array.from(this.metrics.entries()).map(
        ([testName, metrics]) => ({
          testName,
          ...metrics,
        })
      ),
      summary: this.getSummary(),
    };
  }
}

/**
 * Performance monitor for tracking metrics during test execution
 */
export class PerformanceMonitor {
  private startTime: number = 0;
  private startMemory: NodeJS.MemoryUsage | null = null;
  private peakMemory: number = 0;
  private intervalId?: NodeJS.Timeout;

  /**
   * Start monitoring
   */
  start(): void {
    this.startTime = Date.now();
    this.startMemory = process.memoryUsage();
    this.peakMemory = this.startMemory.heapUsed;

    // Track peak memory
    this.intervalId = setInterval(() => {
      const current = process.memoryUsage().heapUsed;
      if (current > this.peakMemory) {
        this.peakMemory = current;
      }
    }, 100);
  }

  /**
   * Stop monitoring and get metrics
   */
  stop(): {
    duration: number;
    memoryUsed: number;
    peakMemory: number;
    cpuTime: number;
  } {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }

    const endTime = Date.now();
    const endMemory = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    return {
      duration: endTime - this.startTime,
      memoryUsed: endMemory.heapUsed - (this.startMemory?.heapUsed || 0),
      peakMemory: this.peakMemory,
      cpuTime: (cpuUsage.user + cpuUsage.system) / 1000,
    };
  }
}

/**
 * Metrics aggregator for combining metrics from multiple sources
 */
export class MetricsAggregator {
  private collectors: ExecutionMetricsCollector[] = [];

  /**
   * Add a metrics collector
   */
  addCollector(collector: ExecutionMetricsCollector): void {
    this.collectors.push(collector);
  }

  /**
   * Get aggregated metrics
   */
  getAggregatedMetrics(): ExecutionMetrics[] {
    const metricsMap = new Map<string, ExecutionMetrics>();

    for (const collector of this.collectors) {
      const metrics = collector.getMetrics();
      for (const metric of metrics) {
        const existing = metricsMap.get(metric.testName);
        if (existing) {
          // Merge metrics (sum durations, max memory, etc.)
          metricsMap.set(metric.testName, {
            testName: metric.testName,
            duration: existing.duration + metric.duration,
            memoryUsed: Math.max(existing.memoryUsed, metric.memoryUsed),
            cpuTime: existing.cpuTime + metric.cpuTime,
            peakMemory: Math.max(existing.peakMemory, metric.peakMemory),
            sessionCount: existing.sessionCount + metric.sessionCount,
          });
        } else {
          metricsMap.set(metric.testName, metric);
        }
      }
    }

    return Array.from(metricsMap.values());
  }

  /**
   * Get aggregated summary
   */
  getAggregatedSummary() {
    const metrics = this.getAggregatedMetrics();

    if (metrics.length === 0) {
      return {
        totalTests: 0,
        totalDuration: 0,
        averageDuration: 0,
        totalMemory: 0,
        averageMemory: 0,
        peakMemory: 0,
        totalSessions: 0,
      };
    }

    return {
      totalTests: metrics.length,
      totalDuration: metrics.reduce((sum, m) => sum + m.duration, 0),
      averageDuration:
        metrics.reduce((sum, m) => sum + m.duration, 0) / metrics.length,
      totalMemory: metrics.reduce((sum, m) => sum + m.memoryUsed, 0),
      averageMemory:
        metrics.reduce((sum, m) => sum + m.memoryUsed, 0) / metrics.length,
      peakMemory: Math.max(...metrics.map((m) => m.peakMemory)),
      totalSessions: metrics.reduce((sum, m) => sum + m.sessionCount, 0),
    };
  }
}
