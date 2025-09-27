#!/usr/bin/env node
/**
 * SSH Crash Test Scenarios for MCP Console Automation Server
 *
 * This test harness systematically reproduces SSH errors that can cause
 * the MCP server to crash, and verifies that our fixes work correctly.
 *
 * Test Categories:
 * 1. SSH Connection with invalid host (should fail fast)
 * 2. SSH Connection with wrong credentials (should fail fast)
 * 3. SSH executable not found (ENOENT error)
 * 4. SSH process dying unexpectedly
 * 5. Multiple simultaneous SSH errors
 */

import { spawn, ChildProcess } from 'child_process';
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'fs';
import { join } from 'path';

interface TestResult {
  testName: string;
  success: boolean;
  error?: string;
  serverCrashed: boolean;
  debugLogOutput: string[];
  mcpResponseReceived: boolean;
  processPid?: number;
  executionTimeMs: number;
}

interface TestScenario {
  name: string;
  description: string;
  sshOptions: any;
  expectedBehavior: string;
  expectedInDebugLog: string[];
  shouldServerSurvive: boolean;
}

export class SSHCrashTestHarness {
  private serverProcess?: ChildProcess;
  private serverPid?: number;
  private debugLogFile = 'C:\\Users\\yolan\\source\\repos\\mcp-console-automation\\mcp-debug.log';
  private testLogFile = 'C:\\Users\\yolan\\source\\repos\\mcp-console-automation\\ssh-crash-test.log';
  private testResults: TestResult[] = [];
  private startTime = Date.now();

  constructor() {
    this.initializeTestEnvironment();
  }

  private initializeTestEnvironment() {
    // Clear previous test logs
    if (existsSync(this.debugLogFile)) {
      writeFileSync(this.debugLogFile, '');
    }
    writeFileSync(this.testLogFile, `SSH Crash Test Started: ${new Date().toISOString()}\n`);
    console.log('🔧 Initializing SSH Crash Test Environment...');
  }

  private log(message: string) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    appendFileSync(this.testLogFile, logMessage);
    console.log(message);
  }

  /**
   * Test Scenario 1: SSH Connection with Invalid Host
   */
  private getInvalidHostScenario(): TestScenario {
    return {
      name: 'invalid_host',
      description: 'SSH connection to non-existent host',
      sshOptions: {
        host: 'invalid-host-that-does-not-exist-12345.local',
        username: 'testuser',
        password: 'testpass',
        port: 22
      },
      expectedBehavior: 'Should fail fast with connection timeout, server must continue running',
      expectedInDebugLog: [
        'SSH connection attempt',
        'Connection timeout',
        'SSH/Network error isolated',
        'Server MUST continue'
      ],
      shouldServerSurvive: true
    };
  }

  /**
   * Test Scenario 2: SSH Connection with Wrong Credentials
   */
  private getWrongCredentialsScenario(): TestScenario {
    return {
      name: 'wrong_credentials',
      description: 'SSH connection with invalid credentials',
      sshOptions: {
        host: 'localhost',
        username: 'invalid_user_999',
        password: 'wrong_password_999',
        port: 22
      },
      expectedBehavior: 'Should fail fast with authentication error, server must continue',
      expectedInDebugLog: [
        'SSH authentication',
        'Authentication failed',
        'SSH/Network error isolated',
        'Check SSH credentials'
      ],
      shouldServerSurvive: true
    };
  }

  /**
   * Test Scenario 3: SSH Executable Not Found (ENOENT)
   */
  private getExecutableNotFoundScenario(): TestScenario {
    return {
      name: 'ssh_enoent',
      description: 'SSH executable not found error',
      sshOptions: {
        host: 'localhost',
        username: 'testuser',
        password: 'testpass',
        sshExecutable: '/non/existent/ssh/path' // Force ENOENT
      },
      expectedBehavior: 'Should handle ENOENT gracefully, server must continue',
      expectedInDebugLog: [
        'ENOENT',
        'SSH client not found',
        'trying alternative',
        'SSH/Network error isolated'
      ],
      shouldServerSurvive: true
    };
  }

  /**
   * Test Scenario 4: SSH Process Dies Unexpectedly
   */
  private getProcessDiesScenario(): TestScenario {
    return {
      name: 'ssh_process_dies',
      description: 'SSH process terminates unexpectedly',
      sshOptions: {
        host: 'localhost',
        username: 'testuser',
        password: 'testpass',
        killAfterConnect: true // Custom flag for test
      },
      expectedBehavior: 'Should recover from process death, server must continue',
      expectedInDebugLog: [
        'SSH process terminated',
        'Connection lost',
        'Recovery attempt',
        'SSH/Network error isolated'
      ],
      shouldServerSurvive: true
    };
  }

  /**
   * Test Scenario 5: Multiple Simultaneous SSH Errors
   */
  private getMultipleErrorsScenario(): TestScenario {
    return {
      name: 'multiple_ssh_errors',
      description: 'Multiple SSH errors happening simultaneously',
      sshOptions: {
        concurrent: true,
        sessions: [
          { host: 'invalid1.local', username: 'user1' },
          { host: 'invalid2.local', username: 'user2' },
          { host: 'invalid3.local', username: 'user3' }
        ]
      },
      expectedBehavior: 'Should handle multiple errors without crashing',
      expectedInDebugLog: [
        'Multiple SSH errors',
        'Error isolation active',
        'SSH/Network error isolated',
        'Server MUST continue'
      ],
      shouldServerSurvive: true
    };
  }

  /**
   * Start the MCP server process
   */
  private async startMCPServer(): Promise<boolean> {
    return new Promise((resolve) => {
      this.log('🚀 Starting MCP Server...');

      const serverScript = 'C:\\Users\\yolan\\source\\repos\\mcp-console-automation\\dist\\mcp\\server.js';

      this.serverProcess = spawn('node', [serverScript], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          MCP_SERVER_MODE: 'true',
          DEBUG_MODE: 'true'
        }
      });

      this.serverPid = this.serverProcess.pid;
      this.log(`📌 Server PID: ${this.serverPid}`);

      // Give server time to start
      setTimeout(() => {
        if (this.serverProcess && !this.serverProcess.killed) {
          this.log('✅ MCP Server started successfully');
          resolve(true);
        } else {
          this.log('❌ MCP Server failed to start');
          resolve(false);
        }
      }, 2000);

      this.serverProcess.on('error', (error) => {
        this.log(`❌ Server Error: ${error.message}`);
      });

      this.serverProcess.on('exit', (code, signal) => {
        this.log(`⚠️  Server Exited: code=${code}, signal=${signal}`);
      });
    });
  }

  /**
   * Check if MCP server is still running
   */
  private isServerRunning(): boolean {
    if (!this.serverProcess || !this.serverPid) return false;

    try {
      // Check if process exists
      process.kill(this.serverPid, 0);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Send MCP request to create SSH session
   */
  private async sendSSHSessionRequest(scenario: TestScenario): Promise<{ success: boolean; response?: any; error?: string }> {
    return new Promise((resolve) => {
      if (!this.serverProcess) {
        resolve({ success: false, error: 'Server not running' });
        return;
      }

      const request = {
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: {
          name: 'console_create_session',
          arguments: {
            command: 'echo "test"',
            consoleType: 'ssh',
            sshOptions: scenario.sshOptions,
            timeout: 5000
          }
        }
      };

      const requestStr = JSON.stringify(request) + '\n';
      this.log(`📤 Sending request for ${scenario.name}: ${requestStr}`);

      let responseReceived = false;
      const timeout = setTimeout(() => {
        if (!responseReceived) {
          resolve({ success: false, error: 'Request timeout' });
        }
      }, 10000);

      // Listen for response
      const responseHandler = (data: Buffer) => {
        if (responseReceived) return;
        responseReceived = true;
        clearTimeout(timeout);

        const response = data.toString();
        this.log(`📥 Response received: ${response}`);
        resolve({ success: true, response });
      };

      this.serverProcess.stdout?.once('data', responseHandler);

      // Send request
      this.serverProcess.stdin?.write(requestStr);
    });
  }

  /**
   * Read and analyze debug log
   */
  private readDebugLog(): string[] {
    try {
      if (!existsSync(this.debugLogFile)) return [];
      const content = readFileSync(this.debugLogFile, 'utf8');
      return content.split('\n').filter(line => line.trim());
    } catch (error) {
      this.log(`⚠️  Could not read debug log: ${error}`);
      return [];
    }
  }

  /**
   * Execute a single test scenario
   */
  private async executeTestScenario(scenario: TestScenario): Promise<TestResult> {
    const testStartTime = Date.now();
    this.log(`\n🧪 Executing Test: ${scenario.name}`);
    this.log(`📝 Description: ${scenario.description}`);
    this.log(`🎯 Expected: ${scenario.expectedBehavior}`);

    const result: TestResult = {
      testName: scenario.name,
      success: false,
      serverCrashed: false,
      debugLogOutput: [],
      mcpResponseReceived: false,
      processPid: this.serverPid,
      executionTimeMs: 0
    };

    try {
      // Clear debug log before test
      writeFileSync(this.debugLogFile, '');

      // Check server is running before test
      const serverRunningBefore = this.isServerRunning();
      if (!serverRunningBefore) {
        throw new Error('Server not running before test');
      }

      // Send SSH request
      const requestResult = await this.sendSSHSessionRequest(scenario);
      result.mcpResponseReceived = requestResult.success;

      // Wait a bit for logs to be written
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Check server is still running after test
      const serverRunningAfter = this.isServerRunning();
      result.serverCrashed = !serverRunningAfter;

      // Read debug log
      result.debugLogOutput = this.readDebugLog();

      // Analyze results
      const expectedLogsFound = scenario.expectedInDebugLog.every(expected =>
        result.debugLogOutput.some(line => line.toLowerCase().includes(expected.toLowerCase()))
      );

      result.success =
        result.mcpResponseReceived &&
        !result.serverCrashed &&
        expectedLogsFound &&
        scenario.shouldServerSurvive;

      this.log(`📊 Test Results:`);
      this.log(`   ✅ Response Received: ${result.mcpResponseReceived}`);
      this.log(`   ✅ Server Survived: ${!result.serverCrashed}`);
      this.log(`   ✅ Expected Logs Found: ${expectedLogsFound}`);
      this.log(`   🎯 Overall Success: ${result.success}`);

    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      this.log(`❌ Test Error: ${result.error}`);
    }

    result.executionTimeMs = Date.now() - testStartTime;
    return result;
  }

  /**
   * Execute multiple error scenario (special case)
   */
  private async executeMultipleErrorsTest(): Promise<TestResult> {
    const testStartTime = Date.now();
    this.log(`\n🧪 Executing Multiple SSH Errors Test`);

    const result: TestResult = {
      testName: 'multiple_ssh_errors',
      success: false,
      serverCrashed: false,
      debugLogOutput: [],
      mcpResponseReceived: false,
      processPid: this.serverPid,
      executionTimeMs: 0
    };

    try {
      writeFileSync(this.debugLogFile, '');

      // Send multiple concurrent SSH requests
      const scenarios = [
        this.getInvalidHostScenario(),
        this.getWrongCredentialsScenario(),
        this.getExecutableNotFoundScenario()
      ];

      const promises = scenarios.map(scenario => this.sendSSHSessionRequest(scenario));
      const results = await Promise.allSettled(promises);

      result.mcpResponseReceived = results.some(r => r.status === 'fulfilled');

      // Wait for all processing
      await new Promise(resolve => setTimeout(resolve, 5000));

      result.serverCrashed = !this.isServerRunning();
      result.debugLogOutput = this.readDebugLog();

      const hasErrorIsolation = result.debugLogOutput.some(line =>
        line.includes('SSH/Network error isolated')
      );

      result.success = result.mcpResponseReceived && !result.serverCrashed && hasErrorIsolation;

      this.log(`📊 Multiple Errors Test Results:`);
      this.log(`   ✅ Some Responses: ${result.mcpResponseReceived}`);
      this.log(`   ✅ Server Survived: ${!result.serverCrashed}`);
      this.log(`   ✅ Error Isolation: ${hasErrorIsolation}`);
      this.log(`   🎯 Overall Success: ${result.success}`);

    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      this.log(`❌ Multiple Errors Test Error: ${result.error}`);
    }

    result.executionTimeMs = Date.now() - testStartTime;
    return result;
  }

  /**
   * Stop the MCP server
   */
  private stopMCPServer() {
    if (this.serverProcess) {
      this.log('🛑 Stopping MCP Server...');
      this.serverProcess.kill('SIGTERM');

      setTimeout(() => {
        if (this.serverProcess && !this.serverProcess.killed) {
          this.log('🔨 Force killing server...');
          this.serverProcess.kill('SIGKILL');
        }
      }, 5000);
    }
  }

  /**
   * Generate detailed test report
   */
  private generateTestReport() {
    const totalTime = Date.now() - this.startTime;
    const passedTests = this.testResults.filter(r => r.success).length;
    const failedTests = this.testResults.length - passedTests;
    const serverCrashes = this.testResults.filter(r => r.serverCrashed).length;

    const report = `
=== SSH Crash Test Report ===
Generated: ${new Date().toISOString()}
Total Execution Time: ${totalTime}ms

📊 Summary:
- Total Tests: ${this.testResults.length}
- Passed: ${passedTests}
- Failed: ${failedTests}
- Server Crashes: ${serverCrashes}

🧪 Individual Test Results:
${this.testResults.map(result => `
Test: ${result.testName}
Success: ${result.success ? '✅' : '❌'}
Server Crashed: ${result.serverCrashed ? '💥' : '✅'}
Response Received: ${result.mcpResponseReceived ? '✅' : '❌'}
Execution Time: ${result.executionTimeMs}ms
${result.error ? `Error: ${result.error}` : ''}
Debug Log Entries: ${result.debugLogOutput.length}
---`).join('\n')}

🔍 Debug Log Analysis:
${this.testResults.map(result => `
${result.testName} Debug Output:
${result.debugLogOutput.slice(-10).map(line => `  ${line}`).join('\n')}
---`).join('\n')}

✅ Recommendations:
${serverCrashes === 0 ?
  '- All tests passed! Server properly isolates SSH errors.' :
  `- ${serverCrashes} tests caused server crashes. Fix error isolation.`}
${passedTests === this.testResults.length ?
  '- Error handling is working correctly.' :
  '- Some tests failed. Review error classification and recovery.'}
`;

    writeFileSync('C:\\Users\\yolan\\source\\repos\\mcp-console-automation\\ssh-crash-test-report.txt', report);
    this.log(report);
  }

  /**
   * Run all SSH crash test scenarios
   */
  public async runAllTests(): Promise<void> {
    this.log('🎬 Starting SSH Crash Test Suite...');

    try {
      // Start server
      const serverStarted = await this.startMCPServer();
      if (!serverStarted) {
        this.log('❌ Could not start MCP server. Aborting tests.');
        return;
      }

      // Test scenarios
      const scenarios = [
        this.getInvalidHostScenario(),
        this.getWrongCredentialsScenario(),
        this.getExecutableNotFoundScenario(),
        this.getProcessDiesScenario()
      ];

      // Execute individual tests
      for (const scenario of scenarios) {
        const result = await this.executeTestScenario(scenario);
        this.testResults.push(result);

        // If server crashed, restart it
        if (result.serverCrashed) {
          this.log('💥 Server crashed! Restarting for next test...');
          this.stopMCPServer();
          await new Promise(resolve => setTimeout(resolve, 2000));
          await this.startMCPServer();
        }
      }

      // Execute multiple errors test
      const multipleErrorsResult = await this.executeMultipleErrorsTest();
      this.testResults.push(multipleErrorsResult);

    } finally {
      this.stopMCPServer();
      this.generateTestReport();
    }
  }
}

// Main execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const testHarness = new SSHCrashTestHarness();
  testHarness.runAllTests().catch(console.error);
}