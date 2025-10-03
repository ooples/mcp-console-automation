/**
 * Test Reporter Base Class
 *
 * Abstract base class for generating test reports in various formats.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import {
  TestReport,
  TestSuiteResult,
  TestSummary,
} from '../types/test-framework.js';

export abstract class TestReporter {
  protected format: TestReport['format'];

  constructor(format: TestReport['format']) {
    this.format = format;
  }

  /**
   * Generate a test report
   */
  async generateReport(
    suiteResults: TestSuiteResult[],
    outputPath?: string
  ): Promise<TestReport> {
    const summary = this.calculateSummary(suiteResults);
    const generatedAt = new Date().toISOString();

    const report: TestReport = {
      format: this.format,
      suiteResults,
      summary,
      generatedAt,
      outputPath,
    };

    if (outputPath) {
      const content = await this.formatReport(report);
      await this.saveReport(content, outputPath);
      report.outputPath = outputPath;
    }

    return report;
  }

  /**
   * Format the report content (to be implemented by subclasses)
   */
  protected abstract formatReport(report: TestReport): Promise<string>;

  /**
   * Get the file extension for this report format
   */
  protected abstract getFileExtension(): string;

  /**
   * Calculate summary statistics from suite results
   */
  protected calculateSummary(suiteResults: TestSuiteResult[]): TestSummary {
    let totalTests = 0;
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    let duration = 0;

    for (const result of suiteResults) {
      totalTests += result.totalTests;
      passed += result.passed;
      failed += result.failed;
      skipped += result.skipped;
      duration += result.duration;
    }

    const passRate = totalTests > 0 ? passed / totalTests : 0;

    return {
      totalSuites: suiteResults.length,
      totalTests,
      passed,
      failed,
      skipped,
      duration,
      passRate,
    };
  }

  /**
   * Save report content to file
   */
  protected async saveReport(content: string, outputPath: string): Promise<void> {
    const dir = path.dirname(outputPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(outputPath, content, 'utf-8');
  }

  /**
   * Format duration in human-readable format
   */
  protected formatDuration(ms: number): string {
    if (ms < 1000) {
      return `${ms}ms`;
    } else if (ms < 60000) {
      return `${(ms / 1000).toFixed(2)}s`;
    } else {
      const minutes = Math.floor(ms / 60000);
      const seconds = ((ms % 60000) / 1000).toFixed(0);
      return `${minutes}m ${seconds}s`;
    }
  }

  /**
   * Format timestamp
   */
  protected formatTimestamp(timestamp: number): string {
    return new Date(timestamp).toLocaleString();
  }

  /**
   * Escape HTML special characters
   */
  protected escapeHtml(text: string): string {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }

  /**
   * Escape XML special characters
   */
  protected escapeXml(text: string): string {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&apos;',
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }
}
