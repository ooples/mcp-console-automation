#!/usr/bin/env node

/**
 * Test script to reproduce the hang issue and capture detailed logs
 *
 * This script will:
 * 1. Start the MCP server
 * 2. Execute a simple command that might hang
 * 3. Capture both stdout/stderr and the debug log file
 * 4. Provide detailed timing and sequencing information
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const CONFIG = {
  TEST_TIMEOUT: 30000, // 30 seconds
  LOG_FILE: 'C:\\Users\\yolan\\source\\repos\\mcp-console-automation\\mcp-debug.log',
  TEST_COMMAND: 'echo "Hello World"',
  CONSOLE_TYPE: 'auto' // or 'cmd', 'powershell', etc.
};

class HangDebugger {
  constructor() {
    this.logs = [];
    this.startTime = Date.now();
    this.serverProcess = null;
    this.testData = {
      serverStdout: '',
      serverStderr: '',
      debugLogContent: '',
      timeline: []
    };
  }

  log(message, type = 'INFO') {
    const timestamp = Date.now() - this.startTime;
    const logEntry = `[${timestamp}ms] [${type}] ${message}`;
    console.log(logEntry);
    this.logs.push(logEntry);
    this.testData.timeline.push({
      timestamp,
      type,
      message
    });
  }

  async readDebugLog() {
    try {
      if (fs.existsSync(CONFIG.LOG_FILE)) {
        const content = fs.readFileSync(CONFIG.LOG_FILE, 'utf8');
        this.testData.debugLogContent = content;
        this.log(`Debug log file exists with ${content.length} characters`);
        return content;
      } else {
        this.log('Debug log file does not exist yet', 'WARN');
        return '';
      }
    } catch (error) {
      this.log(`Error reading debug log: ${error.message}`, 'ERROR');
      return '';
    }
  }

  async startServer() {
    return new Promise((resolve, reject) => {
      this.log('Starting MCP Console Automation server...');

      // Clear any existing debug log
      if (fs.existsSync(CONFIG.LOG_FILE)) {
        fs.unlinkSync(CONFIG.LOG_FILE);
        this.log('Cleared existing debug log file');
      }

      const serverPath = path.join(__dirname, 'dist', 'mcp', 'server.js');
      this.log(`Server path: ${serverPath}`);

      if (!fs.existsSync(serverPath)) {
        this.log('Server file does not exist. Running npm run build first...', 'WARN');
        reject(new Error(`Server file not found: ${serverPath}`));
        return;
      }

      this.serverProcess = spawn('node', [serverPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: __dirname
      });

      this.serverProcess.stdout.on('data', (data) => {
        const text = data.toString();
        this.testData.serverStdout += text;
        this.log(`Server stdout: ${text.trim()}`, 'SERVER');
      });

      this.serverProcess.stderr.on('data', (data) => {
        const text = data.toString();
        this.testData.serverStderr += text;
        this.log(`Server stderr: ${text.trim()}`, 'SERVER');
      });

      this.serverProcess.on('close', (code, signal) => {
        this.log(`Server process closed with code ${code}, signal ${signal}`, 'SERVER');
      });

      this.serverProcess.on('error', (error) => {
        this.log(`Server process error: ${error.message}`, 'ERROR');
        reject(error);
      });

      // Send initialize request first to establish MCP connection
      setTimeout(async () => {
        try {
          this.log('Server started, sending initialize request...');

          const initRequest = {
            jsonrpc: "2.0",
            id: 0,
            method: "initialize",
            params: {
              protocolVersion: "2024-11-05",
              capabilities: {},
              clientInfo: { name: "hang-debugger", version: "1.0.0" }
            }
          };

          // Send initialize and wait for response
          await this.sendRequest(initRequest);
          this.log('Initialize completed, server ready');
          resolve();
        } catch (error) {
          this.log(`Initialize failed: ${error.message}`, 'ERROR');
          reject(error);
        }
      }, 1000);
    });
  }

  async sendRequest(request) {
    return new Promise((resolve, reject) => {
      this.log(`Sending request: ${JSON.stringify(request).substring(0, 200)}...`);

      const requestStr = JSON.stringify(request) + '\\n';

      let responseData = '';
      const timeout = setTimeout(() => {
        this.log('REQUEST TIMEOUT - This is where the hang likely occurs!', 'ERROR');
        reject(new Error('Request timeout - hang detected!'));
      }, CONFIG.TEST_TIMEOUT);

      const dataHandler = (data) => {
        const text = data.toString();
        responseData += text;
        this.log(`Response data received: ${text.length} chars`);

        try {
          // Try to parse as JSON - MCP responses are JSON
          const response = JSON.parse(text);
          clearTimeout(timeout);
          this.serverProcess.stdout.removeListener('data', dataHandler);
          this.log('Response parsed successfully');
          resolve(response);
        } catch (e) {
          // Not complete JSON yet, keep waiting
          this.log('Partial response received, waiting for more...', 'DEBUG');
        }
      };

      this.serverProcess.stdout.on('data', dataHandler);

      try {
        this.serverProcess.stdin.write(requestStr);
        this.log('Request written to server stdin');
      } catch (error) {
        clearTimeout(timeout);
        this.log(`Error writing request: ${error.message}`, 'ERROR');
        reject(error);
      }
    });
  }

  async testExecuteCommand() {
    this.log('=== Testing executeCommand - This is likely where the hang occurs ===');

    const request = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "console_execute_command",
        arguments: {
          command: CONFIG.TEST_COMMAND,
          consoleType: CONFIG.CONSOLE_TYPE,
          timeout: 10000
        }
      }
    };

    try {
      this.log('About to send execute command request...');
      const response = await this.sendRequest(request);
      this.log(`Execute command completed: ${JSON.stringify(response).substring(0, 200)}...`);
      return response;
    } catch (error) {
      this.log(`Execute command failed: ${error.message}`, 'ERROR');
      throw error;
    }
  }

  async generateReport() {
    this.log('=== GENERATING FINAL REPORT ===');

    // Read final debug log
    await this.readDebugLog();

    const report = {
      testConfig: CONFIG,
      totalDuration: Date.now() - this.startTime,
      timeline: this.testData.timeline,
      serverOutput: {
        stdout: this.testData.serverStdout,
        stderr: this.testData.serverStderr
      },
      debugLog: this.testData.debugLogContent,
      analysis: {
        hangDetected: false,
        lastSuccessfulStep: '',
        possibleHangPoint: '',
        recommendations: []
      }
    };

    // Simple analysis
    const lastLogEntry = this.logs[this.logs.length - 1];
    if (lastLogEntry && lastLogEntry.includes('TIMEOUT')) {
      report.analysis.hangDetected = true;
      report.analysis.possibleHangPoint = 'Request timeout during execute command';
      report.analysis.recommendations.push('Check console.error logs for the last [DEBUG-HANG] message');
      report.analysis.recommendations.push('Verify that all event listeners are properly set up');
      report.analysis.recommendations.push('Check if the spawned process is actually running');
    }

    // Find last successful step
    for (let i = this.logs.length - 1; i >= 0; i--) {
      if (this.logs[i].includes('successfully') || this.logs[i].includes('completed')) {
        report.analysis.lastSuccessfulStep = this.logs[i];
        break;
      }
    }

    const reportPath = path.join(__dirname, 'hang-debug-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    this.log(`\\n=== FINAL REPORT SAVED TO: ${reportPath} ===`);
    this.log(`Total test duration: ${report.totalDuration}ms`);
    this.log(`Hang detected: ${report.analysis.hangDetected}`);
    this.log(`Last successful step: ${report.analysis.lastSuccessfulStep}`);

    console.log('\\n=== IMPORTANT: Check the console.error output above for [DEBUG-HANG] messages ===');
    console.log('The hang likely occurs right after the last [DEBUG-HANG] message you see.');

    return report;
  }

  async cleanup() {
    this.log('Cleaning up...');

    if (this.serverProcess && !this.serverProcess.killed) {
      this.serverProcess.kill('SIGTERM');
      setTimeout(() => {
        if (!this.serverProcess.killed) {
          this.serverProcess.kill('SIGKILL');
        }
      }, 5000);
    }
  }

  async run() {
    try {
      this.log('=== Starting Hang Debug Test ===');

      await this.startServer();
      await this.testExecuteCommand();

      this.log('=== Test completed successfully - no hang detected ===');

    } catch (error) {
      this.log(`=== Test failed with error: ${error.message} ===`, 'ERROR');

      // This is actually what we expect if there's a hang
      if (error.message.includes('timeout') || error.message.includes('hang')) {
        this.log('=== HANG CONFIRMED - Collecting debug information ===', 'ERROR');
      }

    } finally {
      await this.generateReport();
      await this.cleanup();
    }
  }
}

// Handle process termination
process.on('SIGINT', async () => {
  console.log('\\nTest interrupted by user');
  process.exit(1);
});

process.on('SIGTERM', async () => {
  console.log('\\nTest terminated');
  process.exit(1);
});

// Run the test
const hangDebugger = new HangDebugger();
hangDebugger.run().then(() => {
  console.log('\\nTest completed. Check hang-debug-report.json for detailed analysis.');
  process.exit(0);
}).catch((error) => {
  console.error('Test runner error:', error);
  process.exit(1);
});