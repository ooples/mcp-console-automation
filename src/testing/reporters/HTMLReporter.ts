/**
 * HTML Reporter
 *
 * Generates beautiful HTML test reports with interactive features.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { TestReport } from '../../types/test-framework.js';
import { TestReporter } from '../TestReporter.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class HTMLReporter extends TestReporter {
  constructor() {
    super('html');
  }

  protected getFileExtension(): string {
    return '.html';
  }

  protected async formatReport(report: TestReport): Promise<string> {
    const { summary, suiteResults, generatedAt } = report;

    // Try to load template, fall back to inline if not available
    let template: string;
    try {
      const templatePath = path.join(__dirname, '../templates/report-template.html');
      template = await fs.readFile(templatePath, 'utf-8');
    } catch {
      template = this.getInlineTemplate();
    }

    // Generate suite HTML
    const suitesHtml = suiteResults
      .map(suiteResult => this.generateSuiteHtml(suiteResult))
      .join('\n');

    // Replace template variables
    const html = template
      .replace('{{TITLE}}', 'Test Report')
      .replace('{{GENERATED_AT}}', new Date(generatedAt).toLocaleString())
      .replace('{{TOTAL_SUITES}}', summary.totalSuites.toString())
      .replace('{{TOTAL_TESTS}}', summary.totalTests.toString())
      .replace('{{PASSED}}', summary.passed.toString())
      .replace('{{FAILED}}', summary.failed.toString())
      .replace('{{SKIPPED}}', summary.skipped.toString())
      .replace('{{DURATION}}', this.formatDuration(summary.duration))
      .replace('{{PASS_RATE}}', (summary.passRate * 100).toFixed(1))
      .replace('{{PASS_RATE_CLASS}}', summary.passRate >= 0.8 ? 'success' : summary.passRate >= 0.5 ? 'warning' : 'error')
      .replace('{{SUITES}}', suitesHtml);

    return html;
  }

  private generateSuiteHtml(suiteResult: any): string {
    const statusClass = suiteResult.failed > 0 ? 'error' : suiteResult.skipped > 0 ? 'warning' : 'success';

    const testsHtml = suiteResult.tests
      .map((testResult: any) => this.generateTestHtml(testResult))
      .join('\n');

    return `
      <div class="suite ${statusClass}">
        <div class="suite-header" onclick="toggleSuite(this)">
          <div class="suite-title">
            <span class="status-icon">${this.getStatusIcon(statusClass)}</span>
            <strong>${this.escapeHtml(suiteResult.suite.name)}</strong>
            <span class="suite-stats">
              ${suiteResult.passed}/${suiteResult.totalTests} passed
            </span>
          </div>
          <div class="suite-meta">
            ${this.formatDuration(suiteResult.duration)}
            <span class="toggle-icon">▼</span>
          </div>
        </div>
        <div class="suite-description">
          ${this.escapeHtml(suiteResult.suite.description || '')}
        </div>
        <div class="suite-body">
          ${testsHtml}
        </div>
      </div>
    `;
  }

  private generateTestHtml(testResult: any): string {
    const statusClass = this.getTestStatusClass(testResult.status);
    const statusIcon = this.getStatusIcon(statusClass);

    const assertionsHtml = testResult.assertions
      .map((assertion: any) => this.generateAssertionHtml(assertion))
      .join('\n');

    const errorHtml = testResult.error
      ? `
        <div class="error-box">
          <strong>Error:</strong> ${this.escapeHtml(testResult.error.message)}
          ${testResult.error.stack ? `<pre>${this.escapeHtml(testResult.error.stack)}</pre>` : ''}
        </div>
      `
      : '';

    return `
      <div class="test ${statusClass}">
        <div class="test-header" onclick="toggleTest(this)">
          <div class="test-title">
            <span class="status-icon">${statusIcon}</span>
            ${this.escapeHtml(testResult.test.name)}
            ${testResult.retries ? `<span class="retry-badge">↻${testResult.retries}</span>` : ''}
          </div>
          <div class="test-meta">
            ${this.formatDuration(testResult.duration)}
            ${assertionsHtml ? '<span class="toggle-icon">▼</span>' : ''}
          </div>
        </div>
        ${testResult.test.description ? `<div class="test-description">${this.escapeHtml(testResult.test.description)}</div>` : ''}
        ${assertionsHtml || errorHtml ? `
          <div class="test-body">
            ${assertionsHtml}
            ${errorHtml}
          </div>
        ` : ''}
      </div>
    `;
  }

  private generateAssertionHtml(assertion: any): string {
    const statusClass = assertion.passed ? 'success' : 'error';
    const statusIcon = assertion.passed ? '✓' : '✗';

    return `
      <div class="assertion ${statusClass}">
        <span class="status-icon">${statusIcon}</span>
        <span class="assertion-message">${this.escapeHtml(assertion.message)}</span>
      </div>
    `;
  }

  private getTestStatusClass(status: string): string {
    switch (status) {
      case 'pass':
        return 'success';
      case 'fail':
        return 'error';
      case 'skip':
        return 'skipped';
      case 'timeout':
        return 'timeout';
      default:
        return 'unknown';
    }
  }

  private getStatusIcon(statusClass: string): string {
    switch (statusClass) {
      case 'success':
        return '✓';
      case 'error':
        return '✗';
      case 'warning':
        return '⚠';
      case 'skipped':
        return '○';
      case 'timeout':
        return '⏱';
      default:
        return '?';
    }
  }

  private getInlineTemplate(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{TITLE}}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background: #f5f5f5; padding: 20px; }
        .container { max-width: 1200px; margin: 0 auto; }
        .header { background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); margin-bottom: 20px; }
        h1 { color: #333; margin-bottom: 10px; }
        .meta { color: #666; font-size: 14px; }
        .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin-top: 20px; }
        .summary-card { background: #f8f9fa; padding: 15px; border-radius: 4px; border-left: 4px solid #ddd; }
        .summary-card.success { border-left-color: #28a745; }
        .summary-card.error { border-left-color: #dc3545; }
        .summary-card.warning { border-left-color: #ffc107; }
        .summary-card .value { font-size: 32px; font-weight: bold; color: #333; }
        .summary-card .label { font-size: 12px; color: #666; text-transform: uppercase; margin-top: 5px; }
        .suite { background: white; margin-bottom: 15px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); overflow: hidden; }
        .suite.success { border-left: 4px solid #28a745; }
        .suite.error { border-left: 4px solid #dc3545; }
        .suite.warning { border-left: 4px solid #ffc107; }
        .suite-header { padding: 20px; cursor: pointer; background: #fafafa; display: flex; justify-content: space-between; align-items: center; }
        .suite-header:hover { background: #f0f0f0; }
        .suite-title { display: flex; align-items: center; gap: 10px; flex: 1; }
        .suite-stats { color: #666; font-size: 14px; margin-left: auto; margin-right: 20px; }
        .suite-meta { display: flex; align-items: center; gap: 10px; color: #666; font-size: 14px; }
        .suite-description { padding: 0 20px 10px 20px; color: #666; font-size: 14px; background: #fafafa; }
        .suite-body { padding: 15px; display: none; }
        .suite.open .suite-body { display: block; }
        .suite.open .toggle-icon { transform: rotate(180deg); }
        .toggle-icon { transition: transform 0.3s; display: inline-block; }
        .test { border: 1px solid #e0e0e0; margin-bottom: 10px; border-radius: 4px; overflow: hidden; }
        .test.success { border-left: 3px solid #28a745; }
        .test.error { border-left: 3px solid #dc3545; }
        .test.skipped { border-left: 3px solid #6c757d; opacity: 0.7; }
        .test.timeout { border-left: 3px solid #ff9800; }
        .test-header { padding: 12px 15px; cursor: pointer; background: #fafafa; display: flex; justify-content: space-between; align-items: center; }
        .test-header:hover { background: #f0f0f0; }
        .test-title { display: flex; align-items: center; gap: 8px; }
        .test-meta { display: flex; align-items: center; gap: 10px; color: #666; font-size: 13px; }
        .test-description { padding: 8px 15px; background: #f9f9f9; color: #666; font-size: 13px; border-top: 1px solid #e0e0e0; }
        .test-body { padding: 15px; background: #f9f9f9; display: none; border-top: 1px solid #e0e0e0; }
        .test.open .test-body { display: block; }
        .test.open .toggle-icon { transform: rotate(180deg); }
        .status-icon { font-size: 16px; font-weight: bold; }
        .success .status-icon { color: #28a745; }
        .error .status-icon { color: #dc3545; }
        .warning .status-icon { color: #ffc107; }
        .skipped .status-icon { color: #6c757d; }
        .timeout .status-icon { color: #ff9800; }
        .retry-badge { background: #ff9800; color: white; padding: 2px 6px; border-radius: 3px; font-size: 11px; font-weight: bold; }
        .assertion { padding: 8px; margin-bottom: 5px; border-radius: 4px; display: flex; align-items: center; gap: 8px; }
        .assertion.success { background: #d4edda; }
        .assertion.error { background: #f8d7da; }
        .assertion-message { font-size: 13px; }
        .error-box { background: #f8d7da; border: 1px solid #f5c6cb; padding: 12px; border-radius: 4px; margin-top: 10px; }
        .error-box strong { color: #721c24; display: block; margin-bottom: 8px; }
        .error-box pre { background: white; padding: 10px; border-radius: 4px; overflow-x: auto; font-size: 12px; margin-top: 8px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>{{TITLE}}</h1>
            <div class="meta">Generated: {{GENERATED_AT}}</div>
            <div class="summary">
                <div class="summary-card">
                    <div class="value">{{TOTAL_SUITES}}</div>
                    <div class="label">Test Suites</div>
                </div>
                <div class="summary-card">
                    <div class="value">{{TOTAL_TESTS}}</div>
                    <div class="label">Total Tests</div>
                </div>
                <div class="summary-card success">
                    <div class="value">{{PASSED}}</div>
                    <div class="label">Passed</div>
                </div>
                <div class="summary-card error">
                    <div class="value">{{FAILED}}</div>
                    <div class="label">Failed</div>
                </div>
                <div class="summary-card warning">
                    <div class="value">{{SKIPPED}}</div>
                    <div class="label">Skipped</div>
                </div>
                <div class="summary-card">
                    <div class="value">{{DURATION}}</div>
                    <div class="label">Duration</div>
                </div>
                <div class="summary-card {{PASS_RATE_CLASS}}">
                    <div class="value">{{PASS_RATE}}%</div>
                    <div class="label">Pass Rate</div>
                </div>
            </div>
        </div>
        <div class="suites">
            {{SUITES}}
        </div>
    </div>
    <script>
        function toggleSuite(header) {
            const suite = header.closest('.suite');
            suite.classList.toggle('open');
        }
        function toggleTest(header) {
            const test = header.closest('.test');
            test.classList.toggle('open');
        }
        // Auto-open failed suites
        document.addEventListener('DOMContentLoaded', function() {
            document.querySelectorAll('.suite.error').forEach(suite => {
                suite.classList.add('open');
            });
        });
    </script>
</body>
</html>`;
  }
}
