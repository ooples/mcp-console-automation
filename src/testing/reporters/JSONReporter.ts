/**
 * JSON Reporter
 *
 * Generates machine-readable JSON test reports.
 */

import { TestReport } from '../../types/test-framework.js';
import { TestReporter } from '../TestReporter.js';

export class JSONReporter extends TestReporter {
  constructor() {
    super('json');
  }

  protected getFileExtension(): string {
    return '.json';
  }

  protected async formatReport(report: TestReport): Promise<string> {
    // Create a clean, serializable version of the report
    const cleanReport = this.cleanReport(report);
    return JSON.stringify(cleanReport, null, 2);
  }

  /**
   * Clean the report for JSON serialization
   * Removes function references and circular dependencies
   */
  private cleanReport(report: TestReport): any {
    return {
      format: report.format,
      generatedAt: report.generatedAt,
      outputPath: report.outputPath,
      summary: report.summary,
      suiteResults: report.suiteResults.map((suiteResult) => ({
        suite: {
          name: suiteResult.suite.name,
          description: suiteResult.suite.description,
          config: suiteResult.suite.config,
          tags: suiteResult.suite.tags,
          testCount: suiteResult.suite.tests.length,
        },
        totalTests: suiteResult.totalTests,
        passed: suiteResult.passed,
        failed: suiteResult.failed,
        skipped: suiteResult.skipped,
        duration: suiteResult.duration,
        startTime: suiteResult.startTime,
        endTime: suiteResult.endTime,
        tests: suiteResult.tests.map((testResult) => ({
          test: {
            name: testResult.test.name,
            description: testResult.test.description,
            recording: testResult.test.recording,
            timeout: testResult.test.timeout,
            retry: testResult.test.retry,
            skip: testResult.test.skip,
            tags: testResult.test.tags,
            assertionCount: testResult.test.assertions.length,
          },
          status: testResult.status,
          duration: testResult.duration,
          startTime: testResult.startTime,
          endTime: testResult.endTime,
          retries: testResult.retries,
          output: testResult.output,
          assertions: testResult.assertions.map((assertion) => ({
            passed: assertion.passed,
            message: assertion.message,
            assertion: {
              type: assertion.assertion.type,
              expected: assertion.assertion.expected,
              actual: assertion.assertion.actual,
              operator: assertion.assertion.operator,
            },
          })),
          error: testResult.error
            ? {
                message: testResult.error.message,
                stack: testResult.error.stack,
                name: testResult.error.name,
              }
            : undefined,
        })),
      })),
    };
  }
}
