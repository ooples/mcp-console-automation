#!/usr/bin/env node
/**
 * Debug Logging Verification Test Suite
 *
 * This test verifies that the MCP server properly logs SSH errors
 * and debug information to the mcp-debug.log file. It ensures:
 *
 * 1. All SSH errors are properly logged
 * 2. Error classification is working
 * 3. Server isolation messages appear
 * 4. No sensitive data is logged
 * 5. Log format is consistent and parseable
 */

import { spawn, ChildProcess } from 'child_process';
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'fs';

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  data?: any;
  sessionId?: string;
  errorType?: string;
}

interface LogAnalysisResult {
  totalEntries: number;
  errorEntries: number;
  sshEntries: number;
  isolationMessages: number;
  sensitiveDataLeaks: string[];
  missingExpectedLogs: string[];
  unexpectedLogs: string[];
  formatErrors: number;
  timelineCorrect: boolean;
}

interface DebugTestResult {
  testName: string;
  success: boolean;
  logAnalysis: LogAnalysisResult;
  expectedLogs: string[];
  actualLogs: LogEntry[];
  sensitiveDataFound: boolean;
  logFormatValid: boolean;
}

export class DebugLoggingVerificationTest {
  private serverProcess?: ChildProcess;
  private serverPid?: number;
  private debugLogFile = 'C:\\Users\\yolan\\source\\repos\\mcp-console-automation\\mcp-debug.log';
  private testLogFile = 'C:\\Users\\yolan\\source\\repos\\mcp-console-automation\\debug-logging-test.log';
  private testResults: DebugTestResult[] = [];

  constructor() {
    this.initializeLoggingTest();
  }

  private initializeLoggingTest() {
    console.log('🔧 Initializing Debug Logging Verification...');
    if (existsSync(this.testLogFile)) {
      writeFileSync(this.testLogFile, '');
    }
    appendFileSync(this.testLogFile, `Debug logging test started: ${new Date().toISOString()}\n`);
  }

  private log(message: string) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;
    appendFileSync(this.testLogFile, logMessage + '\n');
    console.log(logMessage);
  }

  /**
   * Start MCP server with debug logging
   */
  private async startMCPServer(): Promise<boolean> {
    return new Promise((resolve) => {
      this.log('🚀 Starting MCP Server for debug logging test...');

      // Clear previous debug log
      if (existsSync(this.debugLogFile)) {
        writeFileSync(this.debugLogFile, '');
      }

      const serverScript = 'C:\\Users\\yolan\\source\\repos\\mcp-console-automation\\dist\\mcp\\server.js';

      this.serverProcess = spawn('node', [serverScript], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          MCP_SERVER_MODE: 'true',
          DEBUG_MODE: 'true',
          LOG_LEVEL: 'debug'
        }
      });

      this.serverPid = this.serverProcess.pid;
      this.log(`📌 Server PID: ${this.serverPid}`);

      setTimeout(() => {
        if (this.serverProcess && !this.serverProcess.killed) {
          this.log('✅ MCP Server started for logging test');
          resolve(true);
        } else {
          this.log('❌ MCP Server failed to start');
          resolve(false);
        }
      }, 3000);
    });
  }

  /**
   * Parse debug log entries
   */
  private parseDebugLog(): LogEntry[] {
    try {
      if (!existsSync(this.debugLogFile)) {
        this.log('⚠️  Debug log file does not exist');
        return [];
      }

      const content = readFileSync(this.debugLogFile, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());

      return lines.map(line => {
        try {
          // Expected format: [timestamp] message or JSON
          const timestampMatch = line.match(/^\\[([^\\]]+)\\]/);
          if (!timestampMatch) {
            return {
              timestamp: '',
              level: 'unknown',
              message: line,
              data: null
            };
          }

          const timestamp = timestampMatch[1];
          const messageContent = line.substring(timestampMatch[0].length).trim();

          // Try to parse as JSON
          if (messageContent.startsWith('{')) {
            try {
              const data = JSON.parse(messageContent);
              return {
                timestamp,
                level: data.level || 'info',
                message: data.message || '',
                data: data,
                sessionId: data.sessionId,
                errorType: data.errorType
              };
            } catch (e) {
              // Not JSON, treat as plain message
            }
          }

          return {
            timestamp,
            level: 'info',
            message: messageContent
          };
        } catch (error) {
          return {
            timestamp: '',
            level: 'error',
            message: line
          };
        }
      });
    } catch (error) {
      this.log(`❌ Error parsing debug log: ${error}`);
      return [];
    }
  }

  /**
   * Analyze log entries for completeness and correctness
   */
  private analyzeLogEntries(entries: LogEntry[], expectedLogs: string[]): LogAnalysisResult {
    const analysis: LogAnalysisResult = {
      totalEntries: entries.length,
      errorEntries: 0,
      sshEntries: 0,
      isolationMessages: 0,
      sensitiveDataLeaks: [],
      missingExpectedLogs: [],
      unexpectedLogs: [],
      formatErrors: 0,
      timelineCorrect: true
    };

    // Count different types of entries
    entries.forEach(entry => {
      if (entry.level === 'error' || entry.message.toLowerCase().includes('error')) {
        analysis.errorEntries++;
      }

      if (entry.message.toLowerCase().includes('ssh')) {
        analysis.sshEntries++;
      }

      if (entry.message.includes('SSH/Network error isolated') ||
          entry.message.includes('Server MUST continue')) {
        analysis.isolationMessages++;
      }

      // Check for sensitive data leaks
      const sensitivePatterns = [
        /password['":\\s]*[^\\s'"]+/i,
        /private.*key.*-----BEGIN/i,
        /passphrase['":\\s]*[^\\s'"]+/i,
        /secret['":\\s]*[^\\s'"]+/i
      ];

      sensitivePatterns.forEach(pattern => {
        if (pattern.test(entry.message)) {
          analysis.sensitiveDataLeaks.push(entry.message);
        }
      });

      // Check format
      if (!entry.timestamp) {
        analysis.formatErrors++;
      }
    });

    // Check for expected log messages
    expectedLogs.forEach(expected => {
      const found = entries.some(entry =>
        entry.message.toLowerCase().includes(expected.toLowerCase())
      );
      if (!found) {
        analysis.missingExpectedLogs.push(expected);
      }
    });

    // Check timeline (timestamps should be in order)
    for (let i = 1; i < entries.length; i++) {
      if (entries[i].timestamp && entries[i-1].timestamp) {
        const current = new Date(entries[i].timestamp);
        const previous = new Date(entries[i-1].timestamp);
        if (current < previous) {
          analysis.timelineCorrect = false;
          break;
        }
      }
    }

    return analysis;
  }

  /**
   * Send SSH request and wait for logs
   */
  private async triggerSSHErrorAndWaitForLogs(
    errorType: string,
    sshOptions: any,
    expectedLogs: string[]
  ): Promise<void> {
    if (!this.serverProcess) return;

    this.log(`🔥 Triggering SSH error: ${errorType}`);

    const request = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: 'console_create_session',
        arguments: {
          command: 'echo "test"',
          consoleType: 'ssh',
          sshOptions: sshOptions,
          timeout: 5000
        }
      }
    };

    // Send request
    this.serverProcess.stdin?.write(JSON.stringify(request) + '\n');

    // Wait for logs to be written
    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;

      const currentLogs = this.parseDebugLog();
      const hasExpectedLogs = expectedLogs.some(expected =>
        currentLogs.some(log => log.message.toLowerCase().includes(expected.toLowerCase()))
      );

      if (hasExpectedLogs) {
        this.log(`✅ Expected logs found after ${attempts} seconds`);
        break;
      }
    }

    // Give extra time for all logs to be written
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  /**
   * Test SSH invalid host logging
   */
  private async testInvalidHostLogging(): Promise<DebugTestResult> {
    this.log('\\n🧪 Testing Invalid Host SSH Error Logging...');

    const expectedLogs = [
      'handleCreateSession START',
      'SSH connection attempt',
      'invalid-host-test',
      'Connection timeout',
      'SSH/Network error isolated',
      'Server MUST continue'
    ];

    const sshOptions = {
      host: 'invalid-host-test.local',
      username: 'testuser',
      password: 'testpass'
    };

    await this.triggerSSHErrorAndWaitForLogs('invalid_host', sshOptions, expectedLogs);

    const logEntries = this.parseDebugLog();
    const analysis = this.analyzeLogEntries(logEntries, expectedLogs);

    const result: DebugTestResult = {
      testName: 'invalid_host_logging',
      success: analysis.missingExpectedLogs.length === 0 &&
               analysis.sensitiveDataLeaks.length === 0 &&
               analysis.isolationMessages > 0,
      logAnalysis: analysis,
      expectedLogs,
      actualLogs: logEntries,
      sensitiveDataFound: analysis.sensitiveDataLeaks.length > 0,
      logFormatValid: analysis.formatErrors === 0
    };

    this.log(`📊 Invalid Host Test Results:`);
    this.log(`   ✅ Expected logs found: ${analysis.missingExpectedLogs.length === 0}`);
    this.log(`   ✅ No sensitive data: ${analysis.sensitiveDataLeaks.length === 0}`);
    this.log(`   ✅ Isolation messages: ${analysis.isolationMessages}`);
    this.log(`   ✅ Format valid: ${analysis.formatErrors === 0}`);

    return result;
  }

  /**
   * Test SSH authentication failure logging
   */
  private async testAuthFailureLogging(): Promise<DebugTestResult> {
    this.log('\\n🧪 Testing Auth Failure SSH Error Logging...');

    const expectedLogs = [
      'SSH authentication',
      'Authentication failed',
      'SSH/Network error isolated',
      'Check SSH credentials'
    ];

    const sshOptions = {
      host: 'localhost',
      username: 'invalid_user_test',
      password: 'wrong_password_test'
    };

    await this.triggerSSHErrorAndWaitForLogs('auth_failure', sshOptions, expectedLogs);

    const logEntries = this.parseDebugLog();
    const analysis = this.analyzeLogEntries(logEntries, expectedLogs);

    // Should NOT contain the actual password
    const passwordLeaks = logEntries.filter(entry =>
      entry.message.includes('wrong_password_test')
    );

    const result: DebugTestResult = {
      testName: 'auth_failure_logging',
      success: analysis.missingExpectedLogs.length === 0 &&
               passwordLeaks.length === 0 &&
               analysis.isolationMessages > 0,
      logAnalysis: analysis,
      expectedLogs,
      actualLogs: logEntries,
      sensitiveDataFound: passwordLeaks.length > 0,
      logFormatValid: analysis.formatErrors === 0
    };

    this.log(`📊 Auth Failure Test Results:`);
    this.log(`   ✅ Expected logs found: ${analysis.missingExpectedLogs.length === 0}`);
    this.log(`   ✅ Password not leaked: ${passwordLeaks.length === 0}`);
    this.log(`   ✅ Isolation messages: ${analysis.isolationMessages}`);

    return result;
  }

  /**
   * Test ENOENT error logging
   */
  private async testEnoentLogging(): Promise<DebugTestResult> {
    this.log('\\n🧪 Testing ENOENT SSH Error Logging...');

    const expectedLogs = [
      'ENOENT',
      'SSH client not found',
      'trying alternative',
      'SSH/Network error isolated'
    ];

    const sshOptions = {
      host: 'localhost',
      username: 'testuser',
      sshExecutable: '/non/existent/ssh/path'
    };

    await this.triggerSSHErrorAndWaitForLogs('enoent', sshOptions, expectedLogs);

    const logEntries = this.parseDebugLog();
    const analysis = this.analyzeLogEntries(logEntries, expectedLogs);

    const result: DebugTestResult = {
      testName: 'enoent_logging',
      success: analysis.missingExpectedLogs.length === 0 &&
               analysis.isolationMessages > 0,
      logAnalysis: analysis,
      expectedLogs,
      actualLogs: logEntries,
      sensitiveDataFound: analysis.sensitiveDataLeaks.length > 0,
      logFormatValid: analysis.formatErrors === 0
    };

    this.log(`📊 ENOENT Test Results:`);
    this.log(`   ✅ Expected logs found: ${analysis.missingExpectedLogs.length === 0}`);
    this.log(`   ✅ No sensitive data: ${analysis.sensitiveDataLeaks.length === 0}`);
    this.log(`   ✅ Isolation messages: ${analysis.isolationMessages}`);

    return result;
  }

  /**
   * Generate debug logging test report
   */
  private generateDebugReport() {
    const passedTests = this.testResults.filter(r => r.success).length;
    const sensitiveLeaks = this.testResults.filter(r => r.sensitiveDataFound).length;
    const formatErrors = this.testResults.reduce((sum, r) => sum + r.logAnalysis.formatErrors, 0);

    const report = `
=== Debug Logging Verification Report ===
Generated: ${new Date().toISOString()}

📊 Test Summary:
- Total Tests: ${this.testResults.length}
- Passed: ${passedTests}
- Failed: ${this.testResults.length - passedTests}
- Sensitive Data Leaks: ${sensitiveLeaks}
- Format Errors: ${formatErrors}

🧪 Individual Test Results:
${this.testResults.map(result => `
Test: ${result.testName}
Success: ${result.success ? '✅' : '❌'}
Expected Logs: ${result.expectedLogs.length}
Missing Logs: ${result.logAnalysis.missingExpectedLogs.length}
Sensitive Data Found: ${result.sensitiveDataFound ? '⚠️' : '✅'}
Format Valid: ${result.logFormatValid ? '✅' : '❌'}
Total Log Entries: ${result.logAnalysis.totalEntries}
SSH Entries: ${result.logAnalysis.sshEntries}
Isolation Messages: ${result.logAnalysis.isolationMessages}

Missing Expected Logs:
${result.logAnalysis.missingExpectedLogs.map(log => `  - ${log}`).join('\\n')}

Sensitive Data Leaks:
${result.logAnalysis.sensitiveDataLeaks.map(leak => `  - ${leak}`).join('\\n')}
---`).join('\\n')}

🔍 Log Quality Analysis:
${this.testResults.every(r => r.success) ?
  '- All logging tests passed! Debug output is comprehensive and secure.' :
  '- Some logging tests failed. Review debug output completeness.'}
${sensitiveLeaks === 0 ?
  '- No sensitive data leaks detected. Security is good.' :
  `- ${sensitiveLeaks} tests had sensitive data leaks. Review log sanitization.`}
${formatErrors === 0 ?
  '- All log entries properly formatted.' :
  `- ${formatErrors} format errors found. Review log formatting.`}

✅ Recommendations:
- Ensure all SSH errors are logged with proper classification
- Verify error isolation messages appear for all SSH failures
- Sanitize sensitive data (passwords, keys) from logs
- Maintain consistent log format with timestamps
- Include session IDs for better traceability
`;

    writeFileSync('C:\\Users\\yolan\\source\\repos\\mcp-console-automation\\debug-logging-report.txt', report);
    this.log(report);
  }

  /**
   * Stop MCP server
   */
  private stopServer() {
    if (this.serverProcess) {
      this.log('🛑 Stopping MCP server...');
      this.serverProcess.kill('SIGTERM');
      setTimeout(() => {
        if (this.serverProcess && !this.serverProcess.killed) {
          this.serverProcess.kill('SIGKILL');
        }
      }, 5000);
    }
  }

  /**
   * Run all debug logging verification tests
   */
  public async runDebugLoggingTests(): Promise<void> {
    this.log('🎬 Starting Debug Logging Verification Test Suite...');

    try {
      // Start server
      const serverStarted = await this.startMCPServer();
      if (!serverStarted) {
        this.log('❌ Could not start MCP server. Aborting tests.');
        return;
      }

      // Run logging tests
      const results = await Promise.all([
        this.testInvalidHostLogging(),
        this.testAuthFailureLogging(),
        this.testEnoentLogging()
      ]);

      this.testResults.push(...results);

    } finally {
      this.stopServer();
      this.generateDebugReport();
    }
  }
}

// Main execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const debugTest = new DebugLoggingVerificationTest();
  debugTest.runDebugLoggingTests().catch(console.error);
}