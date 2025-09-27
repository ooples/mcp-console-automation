#!/usr/bin/env node
/**
 * MCP Server Resilience Test Suite
 *
 * This test suite verifies that the MCP server remains operational
 * and responsive after various SSH error conditions. It monitors:
 *
 * 1. Server process health
 * 2. MCP protocol responsiveness
 * 3. Memory and resource usage
 * 4. Error recovery mechanisms
 * 5. Tool availability after errors
 */

import { spawn, ChildProcess, exec } from 'child_process';
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'fs';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface HealthCheckResult {
  timestamp: number;
  processRunning: boolean;
  memoryUsageMB: number;
  cpuUsagePercent: number;
  mcpResponseTime: number;
  toolsAvailable: number;
  errorsInLog: number;
  lastErrorTime?: number;
}

interface ResilienceTestResult {
  testName: string;
  preTestHealth: HealthCheckResult;
  postTestHealth: HealthCheckResult;
  recovered: boolean;
  recoveryTimeMs: number;
  mcpStillResponsive: boolean;
  errorPropagation: 'none' | 'partial' | 'complete';
  memoryLeakDetected: boolean;
}

export class MCPServerResilienceTest {
  private serverProcess?: ChildProcess;
  private serverPid?: number;
  private debugLogFile = 'C:\\Users\\yolan\\source\\repos\\mcp-console-automation\\mcp-debug.log';
  private healthLogFile = 'C:\\Users\\yolan\\source\\repos\\mcp-console-automation\\health-monitoring.log';
  private testResults: ResilienceTestResult[] = [];
  private healthHistory: HealthCheckResult[] = [];

  constructor() {
    this.initializeHealthMonitoring();
  }

  private initializeHealthMonitoring() {
    console.log('🔧 Initializing MCP Server Health Monitoring...');
    if (existsSync(this.healthLogFile)) {
      writeFileSync(this.healthLogFile, '');
    }
    appendFileSync(this.healthLogFile, `Health monitoring started: ${new Date().toISOString()}\n`);
  }

  private log(message: string) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;
    appendFileSync(this.healthLogFile, logMessage + '\n');
    console.log(logMessage);
  }

  /**
   * Start MCP server with monitoring
   */
  private async startMCPServer(): Promise<boolean> {
    return new Promise((resolve) => {
      this.log('🚀 Starting MCP Server with monitoring...');

      const serverScript = 'C:\\Users\\yolan\\source\\repos\\mcp-console-automation\\dist\\mcp\\server.js';

      this.serverProcess = spawn('node', [serverScript], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          MCP_SERVER_MODE: 'true',
          DEBUG_MODE: 'true',
          HEALTH_MONITORING: 'true'
        }
      });

      this.serverPid = this.serverProcess.pid;
      this.log(`📌 Server PID: ${this.serverPid}`);

      // Monitor server output
      this.serverProcess.stdout?.on('data', (data) => {
        const output = data.toString();
        if (output.includes('error') || output.includes('crash')) {
          this.log(`⚠️  Server Error Output: ${output}`);
        }
      });

      this.serverProcess.stderr?.on('data', (data) => {
        this.log(`❌ Server Error: ${data.toString()}`);
      });

      // Give server time to start
      setTimeout(() => {
        if (this.serverProcess && !this.serverProcess.killed) {
          this.log('✅ MCP Server started successfully');
          resolve(true);
        } else {
          this.log('❌ MCP Server failed to start');
          resolve(false);
        }
      }, 3000);
    });
  }

  /**
   * Perform comprehensive health check
   */
  private async performHealthCheck(): Promise<HealthCheckResult> {
    const timestamp = Date.now();
    const healthCheck: HealthCheckResult = {
      timestamp,
      processRunning: false,
      memoryUsageMB: 0,
      cpuUsagePercent: 0,
      mcpResponseTime: 0,
      toolsAvailable: 0,
      errorsInLog: 0
    };

    try {
      // Check if process is running
      if (this.serverPid) {
        try {
          process.kill(this.serverPid, 0);
          healthCheck.processRunning = true;
        } catch (error) {
          healthCheck.processRunning = false;
        }
      }

      // Get memory and CPU usage (Windows specific)
      if (this.serverPid && healthCheck.processRunning) {
        try {
          const { stdout } = await execAsync(`wmic process where processid=${this.serverPid} get WorkingSetSize,PageFileUsage /format:csv`);
          const lines = stdout.split('\n').filter(line => line.trim() && !line.startsWith('Node'));
          if (lines.length > 0) {
            const data = lines[0].split(',');
            if (data.length >= 3) {
              healthCheck.memoryUsageMB = parseInt(data[2] || '0') / (1024 * 1024);
            }
          }
        } catch (error) {
          this.log(`⚠️  Could not get process info: ${error}`);
        }
      }

      // Test MCP responsiveness
      healthCheck.mcpResponseTime = await this.testMCPResponseTime();

      // Count available tools
      healthCheck.toolsAvailable = await this.countAvailableTools();

      // Count errors in debug log
      healthCheck.errorsInLog = this.countErrorsInDebugLog();

    } catch (error) {
      this.log(`⚠️  Health check error: ${error}`);
    }

    return healthCheck;
  }

  /**
   * Test MCP protocol response time
   */
  private async testMCPResponseTime(): Promise<number> {
    return new Promise((resolve) => {
      if (!this.serverProcess) {
        resolve(-1);
        return;
      }

      const startTime = Date.now();
      const request = {
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/list'
      };

      const timeout = setTimeout(() => {
        resolve(-1);
      }, 5000);

      const responseHandler = (data: Buffer) => {
        clearTimeout(timeout);
        const responseTime = Date.now() - startTime;
        resolve(responseTime);
      };

      this.serverProcess.stdout?.once('data', responseHandler);
      this.serverProcess.stdin?.write(JSON.stringify(request) + '\n');
    });
  }

  /**
   * Count available MCP tools
   */
  private async countAvailableTools(): Promise<number> {
    return new Promise((resolve) => {
      if (!this.serverProcess) {
        resolve(0);
        return;
      }

      const request = {
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/list'
      };

      const timeout = setTimeout(() => {
        resolve(0);
      }, 5000);

      const responseHandler = (data: Buffer) => {
        clearTimeout(timeout);
        try {
          const response = JSON.parse(data.toString());
          const toolCount = response.result?.tools?.length || 0;
          resolve(toolCount);
        } catch (error) {
          resolve(0);
        }
      };

      this.serverProcess.stdout?.once('data', responseHandler);
      this.serverProcess.stdin?.write(JSON.stringify(request) + '\n');
    });
  }

  /**
   * Count errors in debug log
   */
  private countErrorsInDebugLog(): number {
    try {
      if (!existsSync(this.debugLogFile)) return 0;
      const content = readFileSync(this.debugLogFile, 'utf8');
      const errorLines = content.split('\n').filter(line =>
        line.toLowerCase().includes('error') ||
        line.toLowerCase().includes('crash') ||
        line.toLowerCase().includes('exception')
      );
      return errorLines.length;
    } catch (error) {
      return -1;
    }
  }

  /**
   * Trigger SSH error condition
   */
  private async triggerSSHError(errorType: string): Promise<void> {
    if (!this.serverProcess) return;

    const errorScenarios = {
      'invalid_host': {
        host: 'invalid-host-12345.test',
        username: 'test',
        password: 'test'
      },
      'auth_failure': {
        host: 'localhost',
        username: 'invalid_user',
        password: 'wrong_password'
      },
      'connection_timeout': {
        host: '192.168.999.999',
        username: 'test',
        password: 'test',
        timeout: 1000
      },
      'enoent_error': {
        host: 'localhost',
        username: 'test',
        sshExecutable: '/non/existent/ssh'
      }
    };

    const scenario = errorScenarios[errorType as keyof typeof errorScenarios];
    if (!scenario) return;

    const request = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: 'console_create_session',
        arguments: {
          command: 'echo "test"',
          consoleType: 'ssh',
          sshOptions: scenario
        }
      }
    };

    this.log(`💥 Triggering SSH error: ${errorType}`);
    this.serverProcess.stdin?.write(JSON.stringify(request) + '\n');

    // Wait for error to propagate
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  /**
   * Test server resilience against specific error type
   */
  private async testResilience(errorType: string): Promise<ResilienceTestResult> {
    this.log(`\n🧪 Testing resilience against: ${errorType}`);

    // Take pre-test health snapshot
    const preTestHealth = await this.performHealthCheck();
    this.log(`📊 Pre-test health: Process=${preTestHealth.processRunning}, Memory=${preTestHealth.memoryUsageMB.toFixed(1)}MB, ResponseTime=${preTestHealth.mcpResponseTime}ms`);

    // Trigger error
    const errorStartTime = Date.now();
    await this.triggerSSHError(errorType);

    // Wait for recovery
    let recovered = false;
    let attempts = 0;
    const maxAttempts = 10;

    while (!recovered && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;

      const currentHealth = await this.performHealthCheck();
      if (currentHealth.processRunning && currentHealth.mcpResponseTime > 0) {
        recovered = true;
        this.log(`✅ Server recovered after ${attempts} seconds`);
      }
    }

    const recoveryTimeMs = Date.now() - errorStartTime;

    // Take post-test health snapshot
    const postTestHealth = await this.performHealthCheck();
    this.log(`📊 Post-test health: Process=${postTestHealth.processRunning}, Memory=${postTestHealth.memoryUsageMB.toFixed(1)}MB, ResponseTime=${postTestHealth.mcpResponseTime}ms`);

    // Analyze results
    const memoryLeakDetected = postTestHealth.memoryUsageMB > preTestHealth.memoryUsageMB * 1.5;
    const mcpStillResponsive = postTestHealth.mcpResponseTime > 0 && postTestHealth.mcpResponseTime < 10000;

    let errorPropagation: 'none' | 'partial' | 'complete' = 'none';
    if (!postTestHealth.processRunning) {
      errorPropagation = 'complete';
    } else if (postTestHealth.mcpResponseTime < 0 || postTestHealth.toolsAvailable === 0) {
      errorPropagation = 'partial';
    }

    const result: ResilienceTestResult = {
      testName: errorType,
      preTestHealth,
      postTestHealth,
      recovered,
      recoveryTimeMs,
      mcpStillResponsive,
      errorPropagation,
      memoryLeakDetected
    };

    this.log(`🎯 Resilience test result: ${recovered ? 'PASSED' : 'FAILED'}`);
    return result;
  }

  /**
   * Run continuous health monitoring
   */
  private async runContinuousHealthMonitoring(durationMs: number): Promise<void> {
    this.log(`📈 Starting continuous health monitoring for ${durationMs / 1000} seconds...`);

    const startTime = Date.now();
    const interval = 2000; // Check every 2 seconds

    while (Date.now() - startTime < durationMs) {
      const health = await this.performHealthCheck();
      this.healthHistory.push(health);

      this.log(`📊 Health: Process=${health.processRunning}, Memory=${health.memoryUsageMB.toFixed(1)}MB, Response=${health.mcpResponseTime}ms, Tools=${health.toolsAvailable}, Errors=${health.errorsInLog}`);

      await new Promise(resolve => setTimeout(resolve, interval));
    }
  }

  /**
   * Generate comprehensive resilience report
   */
  private generateResilienceReport() {
    const report = `
=== MCP Server Resilience Test Report ===
Generated: ${new Date().toISOString()}

📊 Test Summary:
Total Tests: ${this.testResults.length}
Successful Recoveries: ${this.testResults.filter(r => r.recovered).length}
Memory Leaks Detected: ${this.testResults.filter(r => r.memoryLeakDetected).length}
Complete Failures: ${this.testResults.filter(r => r.errorPropagation === 'complete').length}

🧪 Individual Test Results:
${this.testResults.map(result => `
Test: ${result.testName}
- Recovered: ${result.recovered ? '✅' : '❌'}
- Recovery Time: ${result.recoveryTimeMs}ms
- MCP Responsive: ${result.mcpStillResponsive ? '✅' : '❌'}
- Error Propagation: ${result.errorPropagation}
- Memory Leak: ${result.memoryLeakDetected ? '⚠️' : '✅'}
- Pre-test Memory: ${result.preTestHealth.memoryUsageMB.toFixed(1)}MB
- Post-test Memory: ${result.postTestHealth.memoryUsageMB.toFixed(1)}MB
- Tools Available Before: ${result.preTestHealth.toolsAvailable}
- Tools Available After: ${result.postTestHealth.toolsAvailable}
---`).join('\n')}

📈 Health History Analysis:
Total Health Checks: ${this.healthHistory.length}
Average Memory Usage: ${(this.healthHistory.reduce((sum, h) => sum + h.memoryUsageMB, 0) / this.healthHistory.length).toFixed(1)}MB
Average Response Time: ${(this.healthHistory.reduce((sum, h) => sum + Math.max(0, h.mcpResponseTime), 0) / this.healthHistory.length).toFixed(1)}ms
Uptime Percentage: ${(this.healthHistory.filter(h => h.processRunning).length / this.healthHistory.length * 100).toFixed(1)}%

✅ Recommendations:
${this.testResults.every(r => r.recovered) ?
  '- Excellent! All error scenarios handled gracefully.' :
  '- Some scenarios caused failures. Review error isolation and recovery.'}
${this.testResults.some(r => r.memoryLeakDetected) ?
  '- Memory leaks detected. Review resource cleanup.' :
  '- No memory leaks detected. Good resource management.'}
${this.testResults.every(r => r.errorPropagation === 'none') ?
  '- Perfect error isolation achieved.' :
  '- Some error propagation detected. Strengthen error boundaries.'}
`;

    writeFileSync('C:\\Users\\yolan\\source\\repos\\mcp-console-automation\\mcp-resilience-report.txt', report);
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
   * Run comprehensive resilience test suite
   */
  public async runResilienceTests(): Promise<void> {
    this.log('🎬 Starting MCP Server Resilience Test Suite...');

    try {
      // Start server
      const serverStarted = await this.startMCPServer();
      if (!serverStarted) {
        this.log('❌ Could not start MCP server. Aborting tests.');
        return;
      }

      // Initial health check
      await new Promise(resolve => setTimeout(resolve, 2000));
      const initialHealth = await this.performHealthCheck();
      this.log(`📊 Initial server health: ${JSON.stringify(initialHealth, null, 2)}`);

      // Test error scenarios
      const errorTypes = ['invalid_host', 'auth_failure', 'connection_timeout', 'enoent_error'];

      for (const errorType of errorTypes) {
        const result = await this.testResilience(errorType);
        this.testResults.push(result);

        // If server died, restart it
        if (!result.recovered || result.errorPropagation === 'complete') {
          this.log('💥 Server failed to recover. Restarting...');
          this.stopServer();
          await new Promise(resolve => setTimeout(resolve, 3000));
          await this.startMCPServer();
        }
      }

      // Run continuous monitoring
      await this.runContinuousHealthMonitoring(30000); // 30 seconds

    } finally {
      this.stopServer();
      this.generateResilienceReport();
    }
  }
}

// Main execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const resilienceTest = new MCPServerResilienceTest();
  resilienceTest.runResilienceTests().catch(console.error);
}