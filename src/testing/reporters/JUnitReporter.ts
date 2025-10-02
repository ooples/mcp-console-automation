/**
 * JUnit Reporter
 *
 * Generates JUnit XML test reports for CI/CD integration.
 */

import { TestReport, TestSuiteResult, TestResult } from '../../types/test-framework.js';
import { TestReporter } from '../TestReporter.js';

export class JUnitReporter extends TestReporter {
  constructor() {
    super('junit');
  }

  protected getFileExtension(): string {
    return '.xml';
  }

  protected async formatReport(report: TestReport): Promise<string> {
    const { summary, suiteResults, generatedAt } = report;

    const testsuites: string[] = [];

    for (const suiteResult of suiteResults) {
      const testsuite = this.generateTestSuiteXml(suiteResult);
      testsuites.push(testsuite);
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="Console Automation Test Report" tests="${summary.totalTests}" failures="${summary.failed}" skipped="${summary.skipped}" time="${(summary.duration / 1000).toFixed(3)}" timestamp="${generatedAt}">
${testsuites.join('\n')}
</testsuites>`;

    return xml;
  }

  private generateTestSuiteXml(suiteResult: TestSuiteResult): string {
    const { suite, totalTests, passed, failed, skipped, duration, startTime } = suiteResult;

    const testcases = suiteResult.tests
      .map(testResult => this.generateTestCaseXml(testResult))
      .join('\n    ');

    return `  <testsuite name="${this.escapeXml(suite.name)}" tests="${totalTests}" failures="${failed}" skipped="${skipped}" time="${(duration / 1000).toFixed(3)}" timestamp="${new Date(startTime).toISOString()}">
    ${testcases}
  </testsuite>`;
  }

  private generateTestCaseXml(testResult: TestResult): string {
    const { test, status, duration, error, assertions, output } = testResult;

    let body = '';

    // Add failure information
    if (status === 'fail' && error) {
      const failedAssertions = assertions.filter(a => !a.passed);
      const message = failedAssertions.length > 0
        ? failedAssertions.map(a => a.message).join('; ')
        : error.message;

      body += `\n      <failure message="${this.escapeXml(message)}" type="${this.escapeXml(error.name || 'AssertionError')}">`;
      if (error.stack) {
        body += `\n${this.escapeXml(error.stack)}`;
      }
      body += `\n      </failure>`;
    }

    // Add timeout information
    if (status === 'timeout') {
      body += `\n      <failure message="Test timeout after ${test.timeout}ms" type="TimeoutError"/>`;
    }

    // Add skip information
    if (status === 'skip') {
      body += `\n      <skipped/>`;
    }

    // Add system-out with test output
    if (output) {
      body += `\n      <system-out><![CDATA[${output}]]></system-out>`;
    }

    // Add system-err with assertion details
    const failedAssertions = assertions.filter(a => !a.passed);
    if (failedAssertions.length > 0) {
      const assertionDetails = failedAssertions
        .map(a => `${a.message}${a.stack ? '\n' + a.stack : ''}`)
        .join('\n---\n');
      body += `\n      <system-err><![CDATA[${assertionDetails}]]></system-err>`;
    }

    const testName = this.escapeXml(test.name);
    const className = this.escapeXml(test.tags?.join('.') || 'default');
    const time = (duration / 1000).toFixed(3);

    if (body) {
      return `<testcase name="${testName}" classname="${className}" time="${time}">${body}\n    </testcase>`;
    } else {
      return `<testcase name="${testName}" classname="${className}" time="${time}"/>`;
    }
  }
}
