# Enhanced Error Detection System

The mcp-console-automation project now includes a comprehensive error detection and analysis system that can intelligently identify, categorize, and provide actionable insights for errors across multiple programming languages, platforms, and system components.

## 🎯 Key Features

### Multi-Language Error Detection
- **JavaScript/Node.js**: TypeError, ReferenceError, SyntaxError, Promise rejections
- **Python**: Traceback analysis, IndexError, AttributeError, ImportError
- **Java**: NullPointerException, OutOfMemoryError, compilation errors
- **Go**: Panic detection, runtime errors
- **Rust**: Compilation errors, panic handling
- **C/C++**: Segmentation faults, compilation errors

### Comprehensive Error Categories
- **Runtime Errors**: Exception handling with stack trace parsing
- **Compilation Errors**: Build-time errors with file/line extraction
- **Network Errors**: Connection issues, timeouts, DNS problems
- **SSH Errors**: Authentication, connection, and configuration issues
- **Database Errors**: Connection pools, query errors, deadlocks
- **Performance Issues**: Memory leaks, CPU spikes, resource exhaustion
- **Security Errors**: Authentication failures, permission issues
- **Build Tool Errors**: npm, Maven, Gradle, Cargo, Make failures

### Intelligent Analysis
- **Error Correlation**: Groups related errors that share common causes
- **Root Cause Analysis**: Identifies primary vs cascading failures
- **Suggested Fixes**: Provides context-aware remediation suggestions
- **Severity Classification**: Critical/High/Medium/Low prioritization
- **Retry Detection**: Identifies transient errors that can be retried

## 📁 Project Structure

```
src/
├── core/
│   ├── ErrorDetector.ts       # Enhanced error detection engine
│   └── ErrorReporting.ts      # Reporting and monitoring utilities
├── patterns/
│   └── ErrorPatterns.ts       # Comprehensive error pattern library
├── examples/
│   └── ErrorDetectionDemo.ts  # Usage examples and demonstrations
└── types/
    └── index.ts               # Enhanced type definitions
```

## 🚀 Quick Start

### Basic Usage

```typescript
import { ErrorDetector } from './core/ErrorDetector.js';

const detector = new ErrorDetector();

// Analyze error logs
const errorLogs = `
2024-01-15 14:23:45 [ERROR] TypeError: Cannot read property 'length' of undefined
    at processData (/app/src/utils.js:42:15)
    at main (/app/src/index.js:18:5)
`;

const report = detector.generateReport(errorLogs);
console.log(`Found ${report.summary.errorsFound} errors`);
console.log(`Critical errors: ${report.summary.severityBreakdown.critical}`);
```

### Advanced Analysis with Reporting

```typescript
import { ErrorDetector } from './core/ErrorDetector.js';
import { ErrorReporter, ReportingOptions } from './core/ErrorReporting.js';

const detector = new ErrorDetector();
const reporter = new ErrorReporter();

const report = detector.generateReport(errorLogs);

// Generate formatted console output
const options: ReportingOptions = {
  includeRemediation: true,
  includeContext: true,
  includeStackTraces: true
};

console.log(reporter.formatForConsole(report, options));

// Generate structured JSON for APIs
const jsonReport = reporter.formatAsJson(report, options);

// Generate Markdown for documentation
const markdownReport = reporter.formatAsMarkdown(report, options);
```

## 🔍 Error Pattern Categories

### Runtime Errors
Detects exceptions and runtime failures across multiple languages:

```typescript
// JavaScript/Node.js
"TypeError: Cannot read property 'foo' of undefined"
"ReferenceError: undefinedVariable is not defined"
"UnhandledPromiseRejectionWarning"

// Python
"Traceback (most recent call last):"
"IndexError: list index out of range"
"AttributeError: 'NoneType' object has no attribute"

// Java
"java.lang.NullPointerException"
"java.lang.OutOfMemoryError"
"Exception in thread 'main'"

// Go
"panic: runtime error: index out of range"
"panic: interface conversion"

// C/C++
"Segmentation fault"
"Aborted (core dumped)"
```

### Network & SSH Errors
Comprehensive network troubleshooting:

```typescript
// Network Issues
"Connection refused"
"Connection timed out" 
"Host not found"
"SSL certificate verify failed"
"Connection reset by peer"

// SSH Specific
"Permission denied (publickey)"
"Host key verification failed"
"ssh: Could not resolve hostname"
"Connection to host closed by remote host"
```

### Database Errors
Multi-database error detection:

```typescript
// MySQL
"ERROR 1045 (28000): Access denied"
"Can't connect to MySQL server"

// PostgreSQL  
"ERROR: relation does not exist"
"could not connect to server"

// MongoDB
"MongoError: connection timed out"

// Redis
"WRONGTYPE Operation against wrong key type"

// Generic
"Connection pool exhausted"
"Deadlock found when trying to get lock"
```

### Build Tool Errors
Support for major build systems:

```typescript
// npm
"npm ERR! Cannot resolve dependency"
"Module not found: Error: Can't resolve"

// Maven
"[ERROR] Failed to execute goal"
"[ERROR] compilation failure"

// Gradle
"> Task :app:compileKotlin FAILED"

// Cargo (Rust)
"error[E0425]: cannot find value"

// Make
"make: *** [target] Error 1"
```

## 📊 Analysis Features

### Error Correlation
The system automatically identifies related errors:

```typescript
const analysis = detector.analyzeErrors(parsedErrors);
console.log(`Found ${analysis.correlatedErrors.length} error correlations`);

analysis.correlatedErrors.forEach(correlation => {
  console.log(`Primary: ${correlation.primaryError.match}`);
  console.log(`Related: ${correlation.relatedErrors.length} errors`);
  console.log(`Confidence: ${correlation.confidence * 100}%`);
});
```

### Root Cause Analysis
Identifies underlying causes across error categories:

```typescript
analysis.rootCauseAnalysis.forEach(rootCause => {
  console.log(`Cause: ${rootCause.cause}`);
  console.log(`Affected: ${rootCause.affectedErrors.length} errors`);
  console.log(`Remediation: ${rootCause.remediation}`);
  console.log(`Confidence: ${rootCause.confidence * 100}%`);
});
```

### Intelligent Suggestions
Context-aware recommendations:

```typescript
console.log('Recommendations:');
report.recommendations.forEach(rec => console.log(`• ${rec}`));

console.log('Analysis Suggestions:');
report.analysis.suggestions.forEach(sug => console.log(`• ${sug}`));
```

## 🔧 Monitoring Integration

### Webhook Integration
Send error reports to monitoring systems:

```typescript
import { MonitoringIntegration } from './core/ErrorReporting.js';

const integrations: MonitoringIntegration[] = [
  {
    type: 'webhook',
    endpoint: 'https://monitoring.company.com/webhooks/errors',
    threshold: {
      criticalErrors: 1,
      totalErrors: 10
    }
  },
  {
    type: 'file',
    filePath: '/var/log/error-reports/report.json',
    threshold: {
      severityScore: 15
    }
  }
];

await reporter.sendToMonitoring(report, integrations);
```

### Alert Configuration
Set up intelligent alerting:

```typescript
const alertConfig = {
  enabled: true,
  channels: ['console', 'webhook', 'email'],
  threshold: {
    critical: 1,    // Alert on any critical error
    high: 3,        // Alert on 3+ high severity errors
    total: 10       // Alert on 10+ total errors
  },
  cooldownMinutes: 15  // Prevent alert spam
};

const reporter = new ErrorReporter(alertConfig);
await reporter.sendAlert(report);
```

## 🎨 Output Formats

### Console Output
Rich, colored console formatting with emojis and context:

```
═══════════════════════════════════════════════════════════
🔍 ERROR ANALYSIS REPORT
📅 Generated: 2024-01-15T14:23:45.123Z
═══════════════════════════════════════════════════════════

📊 SUMMARY
───────────────────────────────────────────────────────────
Total Lines Analyzed: 1,247
Errors Found: 15

⚠️  SEVERITY BREAKDOWN
   Critical: 3
   High:     7
   Medium:   4
   Low:      1

💡 RECOMMENDATIONS
───────────────────────────────────────────────────────────
• ⚠️ Address 3 critical error(s) immediately
• 🌐 Multiple network errors detected - check connectivity
• 🎯 Root cause identified: Network connectivity issues
```

### JSON Output
Structured data for API integration:

```json
{
  "meta": {
    "version": "2.0.0",
    "timestamp": "2024-01-15T14:23:45.123Z",
    "platform": "win32"
  },
  "summary": {
    "totalLines": 1247,
    "errorsFound": 15,
    "severityBreakdown": {
      "critical": 3,
      "high": 7,
      "medium": 4,
      "low": 1
    }
  },
  "analysis": {
    "rootCauseAnalysis": [...],
    "correlatedErrors": [...],
    "retryableErrors": [...]
  }
}
```

### Markdown Output
Documentation-ready format:

```markdown
# Error Analysis Report

**Generated:** 2024-01-15T14:23:45.123Z  
**Total Lines Analyzed:** 1,247  
**Errors Found:** 15  

## Summary

| Severity | Count |
|----------|-------|
| Critical | 3     |
| High     | 7     |
| Medium   | 4     |
| Low      | 1     |

## Recommendations

- Address 3 critical error(s) immediately
- Multiple network errors detected - check connectivity
- Root cause identified: Network connectivity issues
```

## 🔨 Custom Patterns

Add your own error patterns:

```typescript
import { ExtendedErrorPattern } from './patterns/ErrorPatterns.js';

const customPattern: ExtendedErrorPattern = {
  pattern: /MYAPP_ERROR: (.+)/,
  type: 'error',
  category: 'application',
  language: 'custom',
  description: 'Custom Application Error',
  severity: 'high',
  remediation: 'Check application logs and configuration',
  tags: ['custom', 'myapp'],
  retryable: false,
  contexts: ['production', 'staging']
};

detector.addPattern(customPattern);
```

## 🌍 Cross-Platform Compatibility

The system handles platform-specific differences:

- **ANSI Escape Codes**: Automatically stripped for clean parsing
- **Line Endings**: Handles Windows (CRLF), Unix (LF), and Mac (CR)
- **File Paths**: Works with Windows and Unix path separators
- **Character Encoding**: Supports UTF-8 and other common encodings

## 📈 Performance Optimizations

- **Pattern Caching**: Compiled regex patterns are cached for reuse
- **Streaming Support**: Process large log files without loading everything in memory
- **Selective Analysis**: Filter by category, language, or severity for faster processing
- **Parallel Processing**: Analyze multiple error types concurrently

## 🧪 Testing

Run the comprehensive demo to see all features in action:

```typescript
import { runErrorDetectionDemo } from './examples/ErrorDetectionDemo.js';

await runErrorDetectionDemo();
```

This will demonstrate:
- Multi-language error detection
- Category-specific pattern matching
- Intelligent analysis features
- Various output formats
- Monitoring integration
- Custom pattern creation

## 📚 API Reference

### ErrorDetector Class

#### Methods
- `detect(text: string, customPatterns?: ExtendedErrorPattern[]): ParsedError[]`
- `analyzeErrors(errors: ParsedError[]): ErrorAnalysis`
- `generateReport(text: string, customPatterns?: ExtendedErrorPattern[]): ErrorReport`
- `addPattern(pattern: ExtendedErrorPattern): void`
- `removePattern(pattern: RegExp): void`
- `getPatterns(): ExtendedErrorPattern[]`
- `getPatternsByCategory(category: string): ExtendedErrorPattern[]`
- `getPatternsByLanguage(language: string): ExtendedErrorPattern[]`

### ErrorReporter Class

#### Methods
- `formatForConsole(report: ErrorReport, options?: ReportingOptions): string`
- `formatAsJson(report: ErrorReport, options?: ReportingOptions): string`
- `formatAsMarkdown(report: ErrorReport, options?: ReportingOptions): string`
- `sendToMonitoring(report: ErrorReport, integrations: MonitoringIntegration[]): Promise<void>`
- `sendAlert(report: ErrorReport): Promise<void>`
- `generateMcpResponse(report: ErrorReport, options?: ReportingOptions): any`

### ErrorPatterns Static Class

#### Methods
- `getAllPatterns(): ExtendedErrorPattern[]`
- `getPatternsByCategory(category: string): ExtendedErrorPattern[]`
- `getPatternsByLanguage(language: string): ExtendedErrorPattern[]`
- `getPatternsBySeverity(severity: 'low' | 'medium' | 'high' | 'critical'): ExtendedErrorPattern[]`
- `getRetryablePatterns(): ExtendedErrorPattern[]`

## 🤝 Contributing

When adding new error patterns:

1. **Categorize Properly**: Use existing categories or create new ones
2. **Include Remediation**: Provide actionable suggestions
3. **Test Thoroughly**: Verify patterns work across platforms
4. **Document Examples**: Include sample error messages
5. **Set Appropriate Severity**: Follow existing severity guidelines

## 🔮 Future Enhancements

Planned features for future versions:

- **Machine Learning**: Pattern learning from historical data
- **Real-time Monitoring**: Live log streaming and analysis
- **Custom Dashboards**: Visual error analytics
- **Integration APIs**: Direct integration with popular monitoring tools
- **Anomaly Detection**: Statistical analysis of error patterns
- **Performance Metrics**: Detailed timing and resource usage analysis