import { ErrorReport, ErrorAnalysis } from './ErrorDetector.js';
import { ParsedError } from '../types/index.js';
import { ExtendedErrorPattern } from '../patterns/ErrorPatterns.js';

export interface ReportingOptions {
  includeStackTraces?: boolean;
  includeContext?: boolean;
  includeRemediation?: boolean;
  maxContextLines?: number;
  format?: 'json' | 'markdown' | 'html' | 'plain';
  severity?: 'low' | 'medium' | 'high' | 'critical';
  categories?: string[];
  languages?: string[];
}

export interface MonitoringIntegration {
  type: 'webhook' | 'file' | 'console' | 'custom';
  endpoint?: string;
  filePath?: string;
  customHandler?: (report: ErrorReport) => Promise<void>;
  threshold?: {
    criticalErrors?: number;
    totalErrors?: number;
    severityScore?: number;
  };
}

export interface AlertConfig {
  enabled: boolean;
  channels: ('email' | 'slack' | 'webhook' | 'console')[];
  threshold: {
    critical: number;
    high: number;
    total: number;
  };
  cooldownMinutes: number;
}

/**
 * Error reporting and formatting utilities for structured output and monitoring integration
 */
export class ErrorReporter {
  private alertConfig: AlertConfig;
  private lastAlertTime = new Map<string, Date>();

  constructor(alertConfig?: AlertConfig) {
    this.alertConfig = alertConfig || {
      enabled: false,
      channels: ['console'],
      threshold: {
        critical: 1,
        high: 3,
        total: 10,
      },
      cooldownMinutes: 15,
    };
  }

  /**
   * Format error report for console output
   */
  formatForConsole(
    report: ErrorReport,
    options: ReportingOptions = {}
  ): string {
    const lines: string[] = [];
    const { includeContext = false, includeRemediation = true } = options;

    // Header
    lines.push('═══════════════════════════════════════════════════════════');
    lines.push(`🔍 ERROR ANALYSIS REPORT`);
    lines.push(`📅 Generated: ${new Date().toISOString()}`);
    lines.push('═══════════════════════════════════════════════════════════');
    lines.push('');

    // Summary
    lines.push('📊 SUMMARY');
    lines.push('───────────────────────────────────────────────────────────');
    lines.push(`Total Lines Analyzed: ${report.summary.totalLines}`);
    lines.push(`Errors Found: ${report.summary.errorsFound}`);
    lines.push('');

    // Severity breakdown
    lines.push('⚠️  SEVERITY BREAKDOWN');
    lines.push(`   Critical: ${report.summary.severityBreakdown.critical}`);
    lines.push(`   High:     ${report.summary.severityBreakdown.high}`);
    lines.push(`   Medium:   ${report.summary.severityBreakdown.medium}`);
    lines.push(`   Low:      ${report.summary.severityBreakdown.low}`);
    lines.push('');

    // Category breakdown
    if (Object.keys(report.summary.categoryBreakdown).length > 0) {
      lines.push('📂 CATEGORY BREAKDOWN');
      Object.entries(report.summary.categoryBreakdown).forEach(
        ([category, count]) => {
          lines.push(
            `   ${this.getCategoryIcon(category)} ${category}: ${count}`
          );
        }
      );
      lines.push('');
    }

    // Recommendations
    if (report.recommendations.length > 0) {
      lines.push('💡 RECOMMENDATIONS');
      lines.push('───────────────────────────────────────────────────────────');
      report.recommendations.forEach((rec) => lines.push(`• ${rec}`));
      lines.push('');
    }

    // Root cause analysis
    if (report.analysis.rootCauseAnalysis.length > 0) {
      lines.push('🎯 ROOT CAUSE ANALYSIS');
      lines.push('───────────────────────────────────────────────────────────');
      report.analysis.rootCauseAnalysis.forEach((root) => {
        lines.push(`Cause: ${root.cause}`);
        lines.push(`Confidence: ${(root.confidence * 100).toFixed(1)}%`);
        lines.push(`Severity: ${root.severity.toUpperCase()}`);
        lines.push(`Affected Errors: ${root.affectedErrors.length}`);
        if (includeRemediation && root.remediation) {
          lines.push(`Remediation: ${root.remediation}`);
        }
        lines.push('');
      });
    }

    // Individual errors
    if (report.errors.length > 0) {
      lines.push('🔥 DETAILED ERRORS');
      lines.push('───────────────────────────────────────────────────────────');

      const filteredErrors = this.filterErrors(report.errors, options);
      filteredErrors.forEach((error, index) => {
        lines.push(
          `[${index + 1}] Line ${error.line}: ${this.getSeverityIcon(error.pattern.severity)} ${error.pattern.severity.toUpperCase()}`
        );
        lines.push(`    Category: ${error.pattern.category}`);
        if (error.pattern.language) {
          lines.push(`    Language: ${error.pattern.language}`);
        }
        lines.push(`    Message: ${error.match}`);

        if (error.extractedInfo?.filePath) {
          lines.push(
            `    File: ${error.extractedInfo.filePath}:${error.extractedInfo.lineNumber || '?'}`
          );
        }

        if (includeRemediation && error.extractedInfo?.suggestion) {
          lines.push(`    💡 Suggestion: ${error.extractedInfo.suggestion}`);
        }

        if (includeContext && error.context) {
          if (
            error.context.beforeLines &&
            error.context.beforeLines.length > 0
          ) {
            lines.push('    Context (before):');
            error.context.beforeLines.slice(-2).forEach((line, i) => {
              lines.push(`      ${error.line - 2 + i}: ${line}`);
            });
          }
          if (error.context.afterLines && error.context.afterLines.length > 0) {
            lines.push('    Context (after):');
            error.context.afterLines.slice(0, 2).forEach((line, i) => {
              lines.push(`      ${error.line + 1 + i}: ${line}`);
            });
          }
        }

        if (
          error.extractedInfo?.stackTrace &&
          error.extractedInfo.stackTrace.length > 0
        ) {
          lines.push('    Stack Trace:');
          error.extractedInfo.stackTrace.slice(0, 5).forEach((frame) => {
            lines.push(`      ${frame}`);
          });
          if (error.extractedInfo.stackTrace.length > 5) {
            lines.push(
              `      ... (${error.extractedInfo.stackTrace.length - 5} more frames)`
            );
          }
        }

        lines.push('');
      });
    }

    // Retryable errors
    if (report.analysis.retryableErrors.length > 0) {
      lines.push('🔄 RETRYABLE ERRORS');
      lines.push('───────────────────────────────────────────────────────────');
      report.analysis.retryableErrors.forEach((error, index) => {
        lines.push(`[${index + 1}] Line ${error.line}: ${error.match}`);
        lines.push(`    Category: ${error.pattern.category}`);
        if (error.extractedInfo?.suggestion) {
          lines.push(`    💡 Suggestion: ${error.extractedInfo.suggestion}`);
        }
        lines.push('');
      });
    }

    return lines.join('\n');
  }

  /**
   * Format error report as JSON for API responses
   */
  formatAsJson(report: ErrorReport, options: ReportingOptions = {}): string {
    const filteredErrors = this.filterErrors(report.errors, options);

    const jsonReport = {
      meta: {
        version: '2.0.0',
        timestamp: new Date().toISOString(),
        platform: process.platform,
        options,
      },
      summary: report.summary,
      analysis: {
        ...report.analysis,
        errors: filteredErrors.map((error) => ({
          line: error.line,
          type: error.pattern.type,
          category: error.pattern.category,
          severity: error.pattern.severity,
          language: error.pattern.language,
          message: error.match,
          description: error.pattern.description,
          file: error.extractedInfo?.filePath,
          lineNumber: error.extractedInfo?.lineNumber,
          columnNumber: error.extractedInfo?.columnNumber,
          errorCode: error.extractedInfo?.errorCode,
          suggestion: error.extractedInfo?.suggestion,
          retryable: error.pattern.retryable || false,
          tags: error.pattern.tags || [],
          context: options.includeContext ? error.context : undefined,
          stackTrace: options.includeStackTraces
            ? error.extractedInfo?.stackTrace
            : undefined,
        })),
      },
      recommendations: report.recommendations,
    };

    return JSON.stringify(jsonReport, null, 2);
  }

  /**
   * Format error report as Markdown for documentation
   */
  formatAsMarkdown(
    report: ErrorReport,
    options: ReportingOptions = {}
  ): string {
    const lines: string[] = [];
    const { includeContext = false, includeRemediation = true } = options;

    // Header
    lines.push('# Error Analysis Report');
    lines.push('');
    lines.push(`**Generated:** ${new Date().toISOString()}`);
    lines.push(`**Total Lines Analyzed:** ${report.summary.totalLines}`);
    lines.push(`**Errors Found:** ${report.summary.errorsFound}`);
    lines.push('');

    // Summary table
    lines.push('## Summary');
    lines.push('');
    lines.push('| Severity | Count |');
    lines.push('|----------|-------|');
    lines.push(`| Critical | ${report.summary.severityBreakdown.critical} |`);
    lines.push(`| High | ${report.summary.severityBreakdown.high} |`);
    lines.push(`| Medium | ${report.summary.severityBreakdown.medium} |`);
    lines.push(`| Low | ${report.summary.severityBreakdown.low} |`);
    lines.push('');

    // Category breakdown
    if (Object.keys(report.summary.categoryBreakdown).length > 0) {
      lines.push('### Categories');
      lines.push('');
      lines.push('| Category | Count |');
      lines.push('|----------|-------|');
      Object.entries(report.summary.categoryBreakdown).forEach(
        ([category, count]) => {
          lines.push(`| ${category} | ${count} |`);
        }
      );
      lines.push('');
    }

    // Recommendations
    if (report.recommendations.length > 0) {
      lines.push('## Recommendations');
      lines.push('');
      report.recommendations.forEach((rec) => {
        lines.push(`- ${rec.replace(/[🔥⚠️💡🌐🗄️🔨⚡🔒🔄🎯]/g, '').trim()}`);
      });
      lines.push('');
    }

    // Root cause analysis
    if (report.analysis.rootCauseAnalysis.length > 0) {
      lines.push('## Root Cause Analysis');
      lines.push('');
      report.analysis.rootCauseAnalysis.forEach((root, index) => {
        lines.push(`### ${index + 1}. ${root.cause}`);
        lines.push('');
        lines.push(`**Confidence:** ${(root.confidence * 100).toFixed(1)}%`);
        lines.push(`**Severity:** ${root.severity.toUpperCase()}`);
        lines.push(`**Affected Errors:** ${root.affectedErrors.length}`);
        if (includeRemediation && root.remediation) {
          lines.push(`**Remediation:** ${root.remediation}`);
        }
        lines.push('');
      });
    }

    // Detailed errors
    if (report.errors.length > 0) {
      lines.push('## Detailed Errors');
      lines.push('');

      const filteredErrors = this.filterErrors(report.errors, options);
      filteredErrors.forEach((error, index) => {
        lines.push(
          `### ${index + 1}. ${error.pattern.description} (Line ${error.line})`
        );
        lines.push('');
        lines.push(`**Severity:** ${error.pattern.severity.toUpperCase()}`);
        lines.push(`**Category:** ${error.pattern.category}`);
        if (error.pattern.language) {
          lines.push(`**Language:** ${error.pattern.language}`);
        }
        lines.push(`**Message:** \`${error.match}\``);

        if (error.extractedInfo?.filePath) {
          lines.push(
            `**File:** ${error.extractedInfo.filePath}:${error.extractedInfo.lineNumber || '?'}`
          );
        }

        if (includeRemediation && error.extractedInfo?.suggestion) {
          lines.push(`**Suggestion:** ${error.extractedInfo.suggestion}`);
        }

        if (includeContext && error.context) {
          lines.push('');
          lines.push('**Context:**');
          lines.push('```');
          if (error.context.beforeLines) {
            error.context.beforeLines.forEach((line, i) => {
              lines.push(
                `${error.line - error.context.beforeLines!.length + i}: ${line}`
              );
            });
          }
          lines.push(`${error.line}: ${error.match}`);
          if (error.context.afterLines) {
            error.context.afterLines.forEach((line, i) => {
              lines.push(`${error.line + 1 + i}: ${line}`);
            });
          }
          lines.push('```');
        }

        lines.push('');
      });
    }

    return lines.join('\n');
  }

  /**
   * Send error report to monitoring systems
   */
  async sendToMonitoring(
    report: ErrorReport,
    integrations: MonitoringIntegration[]
  ): Promise<void> {
    const promises = integrations.map(async (integration) => {
      try {
        // Check if thresholds are met
        if (integration.threshold) {
          const meetsThreshold = this.checkThreshold(
            report,
            integration.threshold
          );
          if (!meetsThreshold) return;
        }

        switch (integration.type) {
          case 'webhook':
            await this.sendWebhook(report, integration.endpoint!);
            break;
          case 'file':
            await this.writeToFile(report, integration.filePath!);
            break;
          case 'console':
            console.log(this.formatForConsole(report));
            break;
          case 'custom':
            if (integration.customHandler) {
              await integration.customHandler(report);
            }
            break;
        }
      } catch (error) {
        console.error(`Failed to send report to ${integration.type}:`, error);
      }
    });

    await Promise.all(promises);
  }

  /**
   * Send alert if thresholds are exceeded
   */
  async sendAlert(report: ErrorReport): Promise<void> {
    if (!this.alertConfig.enabled) return;

    const alertKey = `${report.analysis.criticalErrors}-${report.analysis.highErrors}-${report.analysis.totalErrors}`;
    const lastAlert = this.lastAlertTime.get(alertKey);
    const now = new Date();

    // Check cooldown
    if (
      lastAlert &&
      now.getTime() - lastAlert.getTime() <
        this.alertConfig.cooldownMinutes * 60 * 1000
    ) {
      return;
    }

    // Check thresholds
    const shouldAlert =
      report.analysis.criticalErrors >= this.alertConfig.threshold.critical ||
      report.analysis.highErrors >= this.alertConfig.threshold.high ||
      report.analysis.totalErrors >= this.alertConfig.threshold.total;

    if (!shouldAlert) return;

    this.lastAlertTime.set(alertKey, now);

    const alertMessage = this.formatAlert(report);

    for (const channel of this.alertConfig.channels) {
      try {
        switch (channel) {
          case 'console':
            console.error('🚨 ERROR ALERT 🚨');
            console.error(alertMessage);
            break;
          case 'webhook':
            // Implementation depends on webhook configuration
            break;
          case 'email':
            // Implementation depends on email configuration
            break;
          case 'slack':
            // Implementation depends on Slack configuration
            break;
        }
      } catch (error) {
        console.error(`Failed to send alert to ${channel}:`, error);
      }
    }
  }

  /**
   * Generate structured output for MCP responses
   */
  generateMcpResponse(
    report: ErrorReport,
    options: ReportingOptions = {}
  ): any {
    const filteredErrors = this.filterErrors(report.errors, options);

    return {
      type: 'error_analysis',
      timestamp: new Date().toISOString(),
      summary: {
        total_lines: report.summary.totalLines,
        errors_found: report.summary.errorsFound,
        severity: {
          critical: report.summary.severityBreakdown.critical,
          high: report.summary.severityBreakdown.high,
          medium: report.summary.severityBreakdown.medium,
          low: report.summary.severityBreakdown.low,
        },
        categories: report.summary.categoryBreakdown,
      },
      analysis: {
        root_causes: report.analysis.rootCauseAnalysis.map((root) => ({
          cause: root.cause,
          confidence: root.confidence,
          severity: root.severity,
          affected_count: root.affectedErrors.length,
          remediation: root.remediation,
        })),
        correlated_errors: report.analysis.correlatedErrors.map((corr) => ({
          primary_error: {
            line: corr.primaryError.line,
            message: corr.primaryError.match,
            category: corr.primaryError.pattern.category,
          },
          related_count: corr.relatedErrors.length,
          confidence: corr.confidence,
        })),
        retryable_count: report.analysis.retryableErrors.length,
      },
      errors: filteredErrors.map((error) => ({
        line: error.line,
        severity: error.pattern.severity,
        category: error.pattern.category,
        type: error.pattern.type,
        message: error.match,
        file: error.extractedInfo?.filePath,
        suggestion: error.extractedInfo?.suggestion,
        retryable: error.pattern.retryable || false,
      })),
      recommendations: report.recommendations.map((rec) =>
        rec.replace(/[🔥⚠️💡🌐🗄️🔨⚡🔒🔄🎯]/g, '').trim()
      ),
      actionable_insights: this.generateActionableInsights(report),
    };
  }

  /**
   * Filter errors based on reporting options
   */
  private filterErrors(
    errors: ParsedError[],
    options: ReportingOptions
  ): ParsedError[] {
    let filtered = errors;

    if (options.severity) {
      filtered = filtered.filter(
        (error) => error.pattern.severity === options.severity
      );
    }

    if (options.categories && options.categories.length > 0) {
      filtered = filtered.filter((error) =>
        options.categories!.includes(error.pattern.category)
      );
    }

    if (options.languages && options.languages.length > 0) {
      filtered = filtered.filter(
        (error) =>
          error.pattern.language &&
          options.languages!.includes(error.pattern.language)
      );
    }

    return filtered;
  }

  /**
   * Check if report meets monitoring threshold
   */
  private checkThreshold(report: ErrorReport, threshold: any): boolean {
    if (
      threshold.criticalErrors &&
      report.analysis.criticalErrors < threshold.criticalErrors
    ) {
      return false;
    }
    if (
      threshold.totalErrors &&
      report.analysis.totalErrors < threshold.totalErrors
    ) {
      return false;
    }
    if (threshold.severityScore) {
      const score = this.calculateSeverityScore(report);
      if (score < threshold.severityScore) {
        return false;
      }
    }
    return true;
  }

  /**
   * Calculate overall severity score
   */
  private calculateSeverityScore(report: ErrorReport): number {
    return (
      report.analysis.criticalErrors * 4 +
      report.analysis.highErrors * 3 +
      report.analysis.mediumErrors * 2 +
      report.analysis.lowErrors * 1
    );
  }

  /**
   * Send webhook notification
   */
  private async sendWebhook(
    report: ErrorReport,
    endpoint: string
  ): Promise<void> {
    const payload = this.generateMcpResponse(report);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Webhook request failed: ${response.status}`);
      }
    } catch (error) {
      console.error('Failed to send webhook:', error);
      throw error;
    }
  }

  /**
   * Write report to file
   */
  private async writeToFile(
    report: ErrorReport,
    filePath: string
  ): Promise<void> {
    const fs = await import('fs/promises');
    const content = this.formatAsJson(report);
    await fs.writeFile(filePath, content, 'utf8');
  }

  /**
   * Format alert message
   */
  private formatAlert(report: ErrorReport): string {
    const lines = [
      `🚨 ERROR THRESHOLD EXCEEDED`,
      `Time: ${new Date().toISOString()}`,
      `Total Errors: ${report.analysis.totalErrors}`,
      `Critical: ${report.analysis.criticalErrors}`,
      `High: ${report.analysis.highErrors}`,
      `Categories: ${Object.keys(report.summary.categoryBreakdown).join(', ')}`,
    ];

    if (report.analysis.rootCauseAnalysis.length > 0) {
      lines.push('Root Causes:');
      report.analysis.rootCauseAnalysis.forEach((root) => {
        lines.push(
          `- ${root.cause} (confidence: ${(root.confidence * 100).toFixed(0)}%)`
        );
      });
    }

    return lines.join('\n');
  }

  /**
   * Generate actionable insights
   */
  private generateActionableInsights(report: ErrorReport): string[] {
    const insights: string[] = [];

    // Priority insights based on severity
    if (report.analysis.criticalErrors > 0) {
      insights.push(
        `IMMEDIATE ACTION: ${report.analysis.criticalErrors} critical errors need immediate attention`
      );
    }

    // Category-specific insights
    const categoryCount = Object.keys(report.summary.categoryBreakdown).length;
    if (categoryCount > 3) {
      insights.push(
        `SYSTEMIC ISSUES: Errors span ${categoryCount} categories, indicating broader system problems`
      );
    }

    // Root cause insights
    const highConfidenceRootCauses = report.analysis.rootCauseAnalysis.filter(
      (r) => r.confidence > 0.8
    );
    if (highConfidenceRootCauses.length > 0) {
      insights.push(
        `ROOT CAUSE IDENTIFIED: ${highConfidenceRootCauses[0].cause} with ${(highConfidenceRootCauses[0].confidence * 100).toFixed(0)}% confidence`
      );
    }

    // Retry insights
    if (report.analysis.retryableErrors.length > 0) {
      insights.push(
        `RETRY OPPORTUNITY: ${report.analysis.retryableErrors.length} errors may be resolved by retrying`
      );
    }

    return insights;
  }

  /**
   * Get category icon for display
   */
  private getCategoryIcon(category: string): string {
    const icons: Record<string, string> = {
      runtime: '🔥',
      compilation: '🔨',
      network: '🌐',
      database: '🗄️',
      performance: '⚡',
      security: '🔒',
      ssh: '🔑',
      'build-tool': '🛠️',
      configuration: '⚙️',
    };
    return icons[category] || '❓';
  }

  /**
   * Get severity icon for display
   */
  private getSeverityIcon(severity: string): string {
    const icons: Record<string, string> = {
      critical: '🔴',
      high: '🟠',
      medium: '🟡',
      low: '🟢',
    };
    return icons[severity] || '⚪';
  }
}
