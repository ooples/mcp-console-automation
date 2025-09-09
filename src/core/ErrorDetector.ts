import { ErrorPattern } from '../types/index.js';
import { ErrorPatterns, ExtendedErrorPattern, ParsedError, ErrorContext } from '../patterns/ErrorPatterns.js';

export interface ErrorAnalysis {
  totalErrors: number;
  criticalErrors: number;
  highErrors: number;
  mediumErrors: number;
  lowErrors: number;
  categories: Record<string, number>;
  languages: Record<string, number>;
  correlatedErrors: CorrelatedError[];
  rootCauseAnalysis: RootCauseAnalysis[];
  suggestions: string[];
  retryableErrors: ParsedError[];
}

export interface CorrelatedError {
  primaryError: ParsedError;
  relatedErrors: ParsedError[];
  confidence: number;
  description: string;
}

export interface RootCauseAnalysis {
  cause: string;
  affectedErrors: ParsedError[];
  severity: 'low' | 'medium' | 'high' | 'critical';
  remediation: string;
  confidence: number;
}

export interface ErrorReport {
  summary: {
    totalLines: number;
    errorsFound: number;
    severityBreakdown: Record<string, number>;
    categoryBreakdown: Record<string, number>;
  };
  errors: ParsedError[];
  analysis: ErrorAnalysis;
  recommendations: string[];
  structuredOutput: any;
}

export class ErrorDetector {
  private patterns: ExtendedErrorPattern[];
  private ansiRegex = /\x1b\[[0-9;]*m/g;
  
  constructor() {
    // Use the comprehensive patterns from ErrorPatterns
    this.patterns = ErrorPatterns.getAllPatterns();
  }

  /**
   * Strip ANSI escape codes from text for cleaner parsing
   */
  private stripAnsiCodes(text: string): string {
    return text.replace(this.ansiRegex, '');
  }

  /**
   * Enhanced error detection with comprehensive pattern matching
   */
  detect(text: string, customPatterns?: ExtendedErrorPattern[]): ParsedError[] {
    const cleanText = this.stripAnsiCodes(text);
    const patterns = customPatterns ? [...this.patterns, ...customPatterns] : this.patterns;
    const lines = cleanText.split('\n');
    const detectedErrors: ParsedError[] = [];

    lines.forEach((line, lineNumber) => {
      patterns.forEach(pattern => {
        const match = line.match(pattern.pattern);
        if (match) {
          const parsedError: ParsedError = {
            pattern,
            match: line.trim(),
            line: lineNumber + 1,
            extractedInfo: this.extractErrorInfo(line, pattern, lines, lineNumber)
          };

          // Add context if available
          parsedError.context = this.extractContext(lines, lineNumber);
          
          detectedErrors.push(parsedError);
        }
      });
    });

    return detectedErrors;
  }

  /**
   * Extract additional error information from matched lines
   */
  private extractErrorInfo(line: string, pattern: ExtendedErrorPattern, lines: string[], lineNumber: number): any {
    const info: any = {};

    // Extract file path if pattern supports it
    if (pattern.filePathPattern) {
      const fileMatch = line.match(pattern.filePathPattern);
      if (fileMatch) {
        info.filePath = fileMatch[1];
      }
    }

    // Extract line number if pattern supports it
    if (pattern.lineNumberPattern) {
      const lineMatch = line.match(pattern.lineNumberPattern);
      if (lineMatch) {
        info.lineNumber = parseInt(lineMatch[1]);
        if (lineMatch[2]) {
          info.columnNumber = parseInt(lineMatch[2]);
        }
      }
    }

    // Extract error codes
    const errorCodeMatch = line.match(/(?:error|ERROR)\s*[:\s]*([A-Z0-9]+)/);
    if (errorCodeMatch) {
      info.errorCode = errorCodeMatch[1];
    }

    // Extract stack trace for runtime errors
    if (pattern.category === 'runtime' && pattern.type === 'exception') {
      info.stackTrace = this.extractStackTrace(lines, lineNumber);
    }

    // Add suggestions based on pattern remediation
    if (pattern.remediation) {
      info.suggestion = pattern.remediation;
    }

    return info;
  }

  /**
   * Extract context around error lines
   */
  private extractContext(lines: string[], errorLineIndex: number, contextLines: number = 3): ErrorContext {
    const context: ErrorContext = {};

    const startIndex = Math.max(0, errorLineIndex - contextLines);
    const endIndex = Math.min(lines.length - 1, errorLineIndex + contextLines);

    context.beforeLines = lines.slice(startIndex, errorLineIndex);
    context.afterLines = lines.slice(errorLineIndex + 1, endIndex + 1);

    return context;
  }

  /**
   * Extract stack trace from surrounding lines
   */
  private extractStackTrace(lines: string[], startIndex: number): string[] {
    const stackTrace: string[] = [];
    
    // Look for stack trace patterns in following lines
    for (let i = startIndex + 1; i < lines.length && i < startIndex + 20; i++) {
      const line = lines[i];
      
      // Common stack trace patterns
      if (line.match(/^\s+at\s+/) || // JavaScript/Node.js
          line.match(/^\s+File\s+"/) || // Python
          line.match(/^\s+#\d+/) || // C/C++
          line.match(/^\s+\d+:/) // Rust
      ) {
        stackTrace.push(line.trim());
      } else if (stackTrace.length > 0) {
        // Stop if we've started collecting and hit a non-stack line
        break;
      }
    }

    return stackTrace;
  }

  /**
   * Perform intelligent error analysis
   */
  analyzeErrors(errors: ParsedError[]): ErrorAnalysis {
    const analysis: ErrorAnalysis = {
      totalErrors: errors.length,
      criticalErrors: 0,
      highErrors: 0,
      mediumErrors: 0,
      lowErrors: 0,
      categories: {},
      languages: {},
      correlatedErrors: [],
      rootCauseAnalysis: [],
      suggestions: [],
      retryableErrors: []
    };

    // Count by severity
    errors.forEach(error => {
      switch (error.pattern.severity) {
        case 'critical':
          analysis.criticalErrors++;
          break;
        case 'high':
          analysis.highErrors++;
          break;
        case 'medium':
          analysis.mediumErrors++;
          break;
        case 'low':
          analysis.lowErrors++;
          break;
      }

      // Count by category
      analysis.categories[error.pattern.category] = 
        (analysis.categories[error.pattern.category] || 0) + 1;

      // Count by language
      if (error.pattern.language) {
        analysis.languages[error.pattern.language] = 
          (analysis.languages[error.pattern.language] || 0) + 1;
      }

      // Collect retryable errors
      if (error.pattern.retryable) {
        analysis.retryableErrors.push(error);
      }
    });

    // Perform correlation analysis
    analysis.correlatedErrors = this.findCorrelatedErrors(errors);

    // Perform root cause analysis
    analysis.rootCauseAnalysis = this.performRootCauseAnalysis(errors);

    // Generate suggestions
    analysis.suggestions = this.generateSuggestions(errors, analysis);

    return analysis;
  }

  /**
   * Find correlated errors (errors that likely have the same root cause)
   */
  private findCorrelatedErrors(errors: ParsedError[]): CorrelatedError[] {
    const correlations: CorrelatedError[] = [];
    const processed = new Set<number>();

    for (let i = 0; i < errors.length; i++) {
      if (processed.has(i)) continue;

      const primaryError = errors[i];
      const relatedErrors: ParsedError[] = [];

      // Look for errors in the same category within a few lines
      for (let j = i + 1; j < errors.length; j++) {
        if (processed.has(j)) continue;

        const secondaryError = errors[j];
        const lineDifference = Math.abs(primaryError.line - secondaryError.line);

        if (primaryError.pattern.category === secondaryError.pattern.category && lineDifference <= 10) {
          relatedErrors.push(secondaryError);
          processed.add(j);
        }
      }

      if (relatedErrors.length > 0) {
        correlations.push({
          primaryError,
          relatedErrors,
          confidence: Math.min(0.9, 0.5 + (relatedErrors.length * 0.1)),
          description: `${relatedErrors.length + 1} related ${primaryError.pattern.category} errors`
        });
        processed.add(i);
      }
    }

    return correlations;
  }

  /**
   * Perform root cause analysis
   */
  private performRootCauseAnalysis(errors: ParsedError[]): RootCauseAnalysis[] {
    const rootCauses: RootCauseAnalysis[] = [];

    // Group errors by category
    const errorsByCategory = errors.reduce((groups, error) => {
      const category = error.pattern.category;
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(error);
      return groups;
    }, {} as Record<string, ParsedError[]>);

    // Analyze each category
    Object.entries(errorsByCategory).forEach(([category, categoryErrors]) => {
      if (categoryErrors.length < 2) return;

      let cause = '';
      let remediation = '';
      let severity: 'low' | 'medium' | 'high' | 'critical' = 'medium';

      switch (category) {
        case 'network':
          cause = 'Network connectivity or configuration issues';
          remediation = 'Check network connectivity, DNS settings, and firewall configuration';
          severity = 'high';
          break;
        case 'database':
          cause = 'Database connection or query issues';
          remediation = 'Verify database connectivity, check query syntax, and review connection pool settings';
          severity = 'high';
          break;
        case 'compilation':
          cause = 'Source code compilation errors';
          remediation = 'Fix syntax errors, resolve dependencies, and check compiler settings';
          severity = 'critical';
          break;
        case 'runtime':
          cause = 'Runtime execution errors';
          remediation = 'Debug application logic, check for null references, and handle exceptions properly';
          severity = 'high';
          break;
        case 'performance':
          cause = 'System resource constraints';
          remediation = 'Monitor resource usage, optimize code performance, and increase system resources';
          severity = 'medium';
          break;
        case 'security':
          cause = 'Security or authentication issues';
          remediation = 'Review authentication mechanisms, check permissions, and validate security tokens';
          severity = 'critical';
          break;
        case 'ssh':
          cause = 'SSH connection or authentication problems';
          remediation = 'Verify SSH credentials, check network connectivity, and review SSH configuration';
          severity = 'high';
          break;
        case 'aws-ssm':
          cause = 'AWS Systems Manager session or configuration issues';
          remediation = 'Check SSM agent status, IAM permissions, instance connectivity, and AWS credentials';
          severity = 'high';
          break;
        default:
          cause = `Multiple ${category} related issues`;
          remediation = 'Review logs and address individual error messages';
      }

      rootCauses.push({
        cause,
        affectedErrors: categoryErrors,
        severity,
        remediation,
        confidence: Math.min(0.9, 0.6 + (categoryErrors.length * 0.05))
      });
    });

    return rootCauses;
  }

  /**
   * Generate actionable suggestions based on error analysis
   */
  private generateSuggestions(errors: ParsedError[], analysis: ErrorAnalysis): string[] {
    const suggestions: string[] = [];

    // Critical errors get priority
    if (analysis.criticalErrors > 0) {
      suggestions.push(`⚠️ Address ${analysis.criticalErrors} critical error(s) immediately`);
    }

    // Category-specific suggestions
    Object.entries(analysis.categories).forEach(([category, count]) => {
      if (count >= 3) {
        switch (category) {
          case 'network':
            suggestions.push(`🌐 Multiple network errors detected - check connectivity and DNS settings`);
            break;
          case 'database':
            suggestions.push(`🗄️ Database issues found - verify connection and query syntax`);
            break;
          case 'compilation':
            suggestions.push(`🔨 Compilation errors present - fix syntax and dependency issues`);
            break;
          case 'performance':
            suggestions.push(`⚡ Performance issues detected - monitor resource usage`);
            break;
          case 'security':
            suggestions.push(`🔒 Security errors found - review authentication and permissions`);
            break;
          case 'aws-ssm':
            suggestions.push(`☁️ AWS SSM errors detected - check SSM agent, IAM permissions, and connectivity`);
            break;
        }
      }
    });

    // Retryable errors suggestion
    if (analysis.retryableErrors.length > 0) {
      suggestions.push(`🔄 ${analysis.retryableErrors.length} error(s) may be resolved by retrying`);
    }

    // Root cause suggestions
    analysis.rootCauseAnalysis.forEach(rootCause => {
      if (rootCause.confidence > 0.7) {
        suggestions.push(`🎯 Root cause identified: ${rootCause.cause}`);
      }
    });

    return suggestions;
  }

  /**
   * Generate comprehensive error report
   */
  generateReport(text: string, customPatterns?: ExtendedErrorPattern[]): ErrorReport {
    const lines = this.stripAnsiCodes(text).split('\n');
    const errors = this.detect(text, customPatterns);
    const analysis = this.analyzeErrors(errors);

    const severityBreakdown = {
      critical: analysis.criticalErrors,
      high: analysis.highErrors,
      medium: analysis.mediumErrors,
      low: analysis.lowErrors
    };

    const recommendations: string[] = [];
    
    // Add high-level recommendations
    if (analysis.criticalErrors > 0) {
      recommendations.push('Immediately address critical errors to prevent system instability');
    }
    
    if (analysis.correlatedErrors.length > 0) {
      recommendations.push('Focus on correlated errors which may share common root causes');
    }
    
    if (analysis.retryableErrors.length > 0) {
      recommendations.push('Consider implementing retry mechanisms for transient errors');
    }

    return {
      summary: {
        totalLines: lines.length,
        errorsFound: errors.length,
        severityBreakdown,
        categoryBreakdown: analysis.categories
      },
      errors,
      analysis,
      recommendations: [...recommendations, ...analysis.suggestions],
      structuredOutput: {
        timestamp: new Date().toISOString(),
        version: '2.0.0',
        platform: process.platform,
        errors: errors.map(error => ({
          type: error.pattern.type,
          category: error.pattern.category,
          severity: error.pattern.severity,
          message: error.match,
          line: error.line,
          file: error.extractedInfo?.filePath,
          suggestion: error.extractedInfo?.suggestion,
          retryable: error.pattern.retryable || false
        }))
      }
    };
  }

  /**
   * Add custom pattern
   */
  addPattern(pattern: ExtendedErrorPattern): void {
    this.patterns.push(pattern);
  }

  /**
   * Remove pattern by regex
   */
  removePattern(pattern: RegExp): void {
    this.patterns = this.patterns.filter(p => p.pattern.toString() !== pattern.toString());
  }

  /**
   * Get all patterns
   */
  getPatterns(): ExtendedErrorPattern[] {
    return [...this.patterns];
  }

  /**
   * Get patterns by category
   */
  getPatternsByCategory(category: string): ExtendedErrorPattern[] {
    return ErrorPatterns.getPatternsByCategory(category);
  }

  /**
   * Get patterns by language
   */
  getPatternsByLanguage(language: string): ExtendedErrorPattern[] {
    return ErrorPatterns.getPatternsByLanguage(language);
  }

  /**
   * Legacy method for backward compatibility
   */
  analyzeStackTrace(text: string): { language?: string; frames: string[] } {
    const cleanText = this.stripAnsiCodes(text);
    const result: { language?: string; frames: string[] } = { frames: [] };

    const pythonMatch = cleanText.match(/Traceback \(most recent call last\):([\s\S]*?)(?=\n\S|\n$)/);
    if (pythonMatch) {
      result.language = 'python';
      const frames = pythonMatch[1].split('\n').filter(line => line.trim().startsWith('File'));
      result.frames = frames.map(f => f.trim());
      return result;
    }

    const javaMatch = cleanText.match(/(?:Exception|Error) in thread[\s\S]*?\n((?:\s+at .*\n)+)/);
    if (javaMatch) {
      result.language = 'java';
      result.frames = javaMatch[1].split('\n').filter(line => line.trim().startsWith('at')).map(f => f.trim());
      return result;
    }

    const nodeMatch = cleanText.match(/at .*? \(.*?\)|\n\s+at .*?\n/g);
    if (nodeMatch && nodeMatch.length > 0) {
      result.language = 'javascript';
      result.frames = nodeMatch.map(f => f.trim());
      return result;
    }

    const genericStack = cleanText.match(/^\s*(#\d+|at|\d+:)\s+.*/gm);
    if (genericStack && genericStack.length > 0) {
      result.frames = genericStack.map(f => f.trim());
    }

    return result;
  }

  /**
   * Legacy method for backward compatibility
   */
  getSeverityScore(errors: Array<{ pattern: ErrorPattern; match: string; line: number }>): number {
    const severityWeights = {
      low: 1,
      medium: 2,
      high: 3,
      critical: 4
    };

    return errors.reduce((score, error) => {
      return score + severityWeights[error.pattern.severity];
    }, 0);
  }
}