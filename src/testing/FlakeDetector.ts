/**
 * FlakeDetector - Detects flaky tests by running them multiple times
 */

import {
  TestDefinition,
  TestResult,
  FlakeReport,
} from '../types/test-framework.js';

export interface FlakeDetectionConfig {
  runs: number;
  threshold: number; // Flake rate threshold (0-1)
  parallel: boolean;
  stopOnStable?: boolean; // Stop if test is consistently passing/failing
}

export class FlakeDetector {
  private defaultConfig: FlakeDetectionConfig = {
    runs: 10,
    threshold: 0.1, // 10% flake rate
    parallel: true,
    stopOnStable: false,
  };

  /**
   * Detect if a test is flaky
   */
  async detectFlake(
    test: TestDefinition,
    executor: (test: TestDefinition) => Promise<TestResult>,
    config?: Partial<FlakeDetectionConfig>
  ): Promise<FlakeReport> {
    const detectionConfig = { ...this.defaultConfig, ...config };
    const results: TestResult[] = [];

    // Run test multiple times
    if (detectionConfig.parallel) {
      // Run in parallel
      const promises = Array.from({ length: detectionConfig.runs }, () =>
        executor(test)
      );
      results.push(...(await Promise.all(promises)));
    } else {
      // Run sequentially
      for (let i = 0; i < detectionConfig.runs; i++) {
        const result = await executor(test);
        results.push(result);

        // Early exit if test is stable
        if (detectionConfig.stopOnStable && i >= 4) {
          const stable = this.isStable(results);
          if (stable) {
            break;
          }
        }
      }
    }

    // Analyze results
    return this.analyzeResults(test.name, results, detectionConfig.threshold);
  }

  /**
   * Detect flaky tests in a batch
   */
  async detectFlakyTests(
    tests: TestDefinition[],
    executor: (test: TestDefinition) => Promise<TestResult>,
    config?: Partial<FlakeDetectionConfig>
  ): Promise<FlakeReport[]> {
    const reports: FlakeReport[] = [];

    for (const test of tests) {
      const report = await this.detectFlake(test, executor, config);
      if (report.isFlaky) {
        reports.push(report);
      }
    }

    return reports;
  }

  /**
   * Analyze test results and generate flake report
   */
  private analyzeResults(
    testName: string,
    results: TestResult[],
    threshold: number
  ): FlakeReport {
    const totalRuns = results.length;
    const passes = results.filter((r) => r.status === 'pass').length;
    const failures = results.filter((r) => r.status === 'fail').length;
    const errors = results.filter(
      (r) => r.status === 'timeout' || r.error !== undefined
    ).length;

    // Calculate flake rate
    const flakeRate = this.calculateFlakeRate(results);

    // Extract failure patterns
    const failurePatterns = this.extractFailurePatterns(results);

    return {
      testName,
      totalRuns,
      passes,
      failures,
      errors,
      flakeRate,
      isFlaky: flakeRate > threshold,
      threshold,
      failurePatterns,
    };
  }

  /**
   * Calculate flake rate
   */
  private calculateFlakeRate(results: TestResult[]): number {
    if (results.length === 0) return 0;

    const passes = results.filter((r) => r.status === 'pass').length;
    const failures = results.length - passes;

    // Flake rate is the percentage of runs that differ from the majority
    const minority = Math.min(passes, failures);

    return minority / results.length;
  }

  /**
   * Check if test results are stable (all same outcome)
   */
  private isStable(results: TestResult[]): boolean {
    if (results.length < 3) return false;

    const firstStatus = results[0].status;
    return results.every((r) => r.status === firstStatus);
  }

  /**
   * Extract common failure patterns
   */
  private extractFailurePatterns(results: TestResult[]): string[] {
    const patterns = new Map<string, number>();

    for (const result of results) {
      if (result.status === 'fail' && result.error) {
        const pattern = this.categorizeError(result.error);
        patterns.set(pattern, (patterns.get(pattern) || 0) + 1);
      }
    }

    // Return patterns sorted by frequency
    return Array.from(patterns.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([pattern, count]) => `${pattern} (${count} times)`);
  }

  /**
   * Categorize error into pattern
   */
  private categorizeError(error: Error): string {
    const message = error.message.toLowerCase();

    if (message.includes('timeout')) return 'Timeout';
    if (message.includes('connection')) return 'Connection Error';
    if (message.includes('network')) return 'Network Error';
    if (message.includes('assertion')) return 'Assertion Failure';
    if (message.includes('undefined') || message.includes('null'))
      return 'Null/Undefined Error';
    if (message.includes('race') || message.includes('concurrent'))
      return 'Race Condition';

    return 'Unknown Error';
  }

  /**
   * Generate flake summary for multiple tests
   */
  generateFlakeSummary(reports: FlakeReport[]) {
    const totalTests = reports.length;
    const flakyTests = reports.filter((r) => r.isFlaky).length;
    const stableTests = totalTests - flakyTests;

    // Calculate average flake rate
    const averageFlakeRate =
      reports.reduce((sum, r) => sum + r.flakeRate, 0) / totalTests || 0;

    // Group by flake rate severity
    const severe = reports.filter((r) => r.flakeRate > 0.3).length; // >30% flake
    const moderate = reports.filter(
      (r) => r.flakeRate > 0.1 && r.flakeRate <= 0.3
    ).length; // 10-30%
    const mild = reports.filter(
      (r) => r.flakeRate > 0 && r.flakeRate <= 0.1
    ).length; // <10%

    return {
      totalTests,
      flakyTests,
      stableTests,
      flakeRate: flakyTests / totalTests || 0,
      averageFlakeRate,
      severity: {
        severe,
        moderate,
        mild,
      },
      mostFlakyTest: this.getMostFlakyTest(reports),
      commonPatterns: this.getCommonPatterns(reports),
    };
  }

  /**
   * Get the most flaky test
   */
  private getMostFlakyTest(reports: FlakeReport[]): string | null {
    if (reports.length === 0) return null;

    const sorted = [...reports].sort((a, b) => b.flakeRate - a.flakeRate);
    return sorted[0].testName;
  }

  /**
   * Get common failure patterns across all tests
   */
  private getCommonPatterns(reports: FlakeReport[]): string[] {
    const allPatterns = new Map<string, number>();

    for (const report of reports) {
      if (report.failurePatterns) {
        for (const pattern of report.failurePatterns) {
          // Extract pattern name (before the count)
          const patternName = pattern.split(' (')[0];
          allPatterns.set(patternName, (allPatterns.get(patternName) || 0) + 1);
        }
      }
    }

    return Array.from(allPatterns.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5) // Top 5
      .map(([pattern, count]) => `${pattern} (${count} tests)`);
  }

  /**
   * Generate recommendations based on flake analysis
   */
  generateRecommendations(report: FlakeReport): string[] {
    const recommendations: string[] = [];

    if (report.flakeRate > 0.5) {
      recommendations.push(
        'Test is highly unstable - consider major refactoring or removal'
      );
    } else if (report.flakeRate > 0.3) {
      recommendations.push(
        'Test shows significant instability - investigate root cause'
      );
    }

    // Check failure patterns
    if (report.failurePatterns) {
      for (const pattern of report.failurePatterns) {
        if (pattern.includes('Timeout')) {
          recommendations.push('Add explicit waits or increase timeout values');
        }
        if (pattern.includes('Race Condition')) {
          recommendations.push(
            'Add synchronization or use proper locking mechanisms'
          );
        }
        if (pattern.includes('Network Error')) {
          recommendations.push('Add network retry logic or use mocking');
        }
        if (pattern.includes('Connection Error')) {
          recommendations.push('Ensure proper connection pooling and cleanup');
        }
      }
    }

    if (recommendations.length === 0) {
      recommendations.push('Monitor test over time to identify patterns');
    }

    return recommendations;
  }
}

/**
 * Flake detector with statistical analysis
 */
export class StatisticalFlakeDetector extends FlakeDetector {
  /**
   * Calculate statistical confidence in flake detection
   */
  calculateConfidence(report: FlakeReport): {
    confidence: number;
    sampleSizeAdequate: boolean;
  } {
    const sampleSize = report.totalRuns;
    const flakeRate = report.flakeRate;

    // Simple confidence calculation based on sample size
    // More runs = higher confidence
    const confidence = Math.min(sampleSize / 20, 1); // Max confidence at 20 runs

    // Check if sample size is adequate for the flake rate
    // Need more runs for low flake rates
    const minSampleSize = flakeRate < 0.1 ? 20 : 10;
    const sampleSizeAdequate = sampleSize >= minSampleSize;

    return {
      confidence,
      sampleSizeAdequate,
    };
  }

  /**
   * Recommend optimal number of runs for a test
   */
  recommendRuns(previousReport?: FlakeReport): number {
    if (!previousReport) {
      return 10; // Default
    }

    // More flaky tests need more runs
    if (previousReport.flakeRate > 0.3) {
      return 20;
    } else if (previousReport.flakeRate > 0.1) {
      return 15;
    } else {
      return 10;
    }
  }
}
