/**
 * Markdown Reporter
 *
 * Generates Markdown test reports suitable for documentation and README files.
 */

import {
  TestReport,
  TestSuiteResult,
  TestResult,
} from '../../types/test-framework.js';
import { TestReporter } from '../TestReporter.js';

export class MarkdownReporter extends TestReporter {
  constructor() {
    super('markdown');
  }

  protected getFileExtension(): string {
    return '.md';
  }

  protected async formatReport(report: TestReport): Promise<string> {
    const { summary, suiteResults, generatedAt } = report;

    let markdown = '# Test Report\n\n';
    markdown += `**Generated:** ${new Date(generatedAt).toLocaleString()}\n\n`;

    // Summary section
    markdown += '## Summary\n\n';
    markdown += '| Metric | Value |\n';
    markdown += '|--------|-------|\n';
    markdown += `| Total Suites | ${summary.totalSuites} |\n`;
    markdown += `| Total Tests | ${summary.totalTests} |\n`;
    markdown += `| ✅ Passed | ${summary.passed} |\n`;
    markdown += `| ❌ Failed | ${summary.failed} |\n`;
    markdown += `| ⊝ Skipped | ${summary.skipped} |\n`;
    markdown += `| ⏱️ Duration | ${this.formatDuration(summary.duration)} |\n`;
    markdown += `| 📊 Pass Rate | ${(summary.passRate * 100).toFixed(1)}% |\n\n`;

    // Overall status badge
    const statusEmoji = summary.failed === 0 ? '✅' : '❌';
    const statusText = summary.failed === 0 ? 'PASSING' : 'FAILING';
    markdown += `**Status:** ${statusEmoji} **${statusText}**\n\n`;

    // Test suites section
    markdown += '## Test Suites\n\n';

    for (const suiteResult of suiteResults) {
      markdown += this.generateSuiteMarkdown(suiteResult);
    }

    return markdown;
  }

  private generateSuiteMarkdown(suiteResult: TestSuiteResult): string {
    const { suite, totalTests, passed, failed, skipped, duration } =
      suiteResult;

    const statusEmoji = failed > 0 ? '❌' : skipped > 0 ? '⚠️' : '✅';

    let md = `### ${statusEmoji} ${suite.name}\n\n`;
    md += `${suite.description}\n\n`;
    md += `**Stats:** ${passed}/${totalTests} passed | Duration: ${this.formatDuration(duration)}\n\n`;

    if (suite.tags && suite.tags.length > 0) {
      md += `**Tags:** ${suite.tags.map((t) => `\`${t}\``).join(', ')}\n\n`;
    }

    // Tests table
    md += '| Test | Status | Duration | Details |\n';
    md += '|------|--------|----------|----------|\n';

    for (const testResult of suiteResult.tests) {
      md += this.generateTestRow(testResult);
    }

    md += '\n';

    // Failed test details
    const failedTests = suiteResult.tests.filter(
      (t) => t.status === 'fail' || t.status === 'timeout'
    );
    if (failedTests.length > 0) {
      md += '#### Failed Tests\n\n';
      for (const testResult of failedTests) {
        md += this.generateFailedTestDetails(testResult);
      }
    }

    return md;
  }

  private generateTestRow(testResult: TestResult): string {
    const { test, status, duration, assertions } = testResult;

    const statusEmoji = this.getStatusEmoji(status);
    const statusText = status.toUpperCase();

    const passedAssertions = assertions.filter((a) => a.passed).length;
    const totalAssertions = assertions.length;
    const details =
      totalAssertions > 0
        ? `${passedAssertions}/${totalAssertions} assertions`
        : '-';

    return `| ${test.name} | ${statusEmoji} ${statusText} | ${this.formatDuration(duration)} | ${details} |\n`;
  }

  private generateFailedTestDetails(testResult: TestResult): string {
    const { test, error, assertions } = testResult;

    let md = `##### ❌ ${test.name}\n\n`;

    if (test.description) {
      md += `${test.description}\n\n`;
    }

    // Error message
    if (error) {
      md += '**Error:**\n```\n';
      md += error.message + '\n';
      if (error.stack) {
        md += '\n' + error.stack + '\n';
      }
      md += '```\n\n';
    }

    // Failed assertions
    const failedAssertions = assertions.filter((a) => !a.passed);
    if (failedAssertions.length > 0) {
      md += '**Failed Assertions:**\n\n';
      for (const assertion of failedAssertions) {
        md += `- ❌ ${assertion.message}\n`;
      }
      md += '\n';
    }

    return md;
  }

  private getStatusEmoji(status: string): string {
    switch (status) {
      case 'pass':
        return '✅';
      case 'fail':
        return '❌';
      case 'skip':
        return '⊝';
      case 'timeout':
        return '⏱️';
      default:
        return '❓';
    }
  }
}
