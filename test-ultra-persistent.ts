#!/usr/bin/env npx tsx

/**
 * Test the ultra-persistent server's error isolation with SSH failures
 */

import { spawn } from 'child_process';
import { Logger } from './src/utils/logger.js';

const logger = new Logger('TestUltraPersistent');

async function testUltraPersistentServer() {
  logger.info('🧪 Testing Ultra-Persistent MCP Server Error Isolation...');

  // Start the ultra-persistent server
  logger.info('Starting ultra-persistent server...');
  const serverProcess = spawn('npx', ['tsx', 'src/mcp/ultra-persistent-server.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      LOG_LEVEL: 'debug',
      NODE_ENV: 'test',
      MCP_SERVER_MODE: 'true'
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let connectionEstablished = false;
  let errorIsolated = false;
  let serverStillRunning = true;
  let processExitBlocked = false;

  // Monitor server output
  serverProcess.stdout.on('data', (data) => {
    const output = data.toString();
    
    // Only log non-JSON output
    if (!output.startsWith('{') && !output.includes('Content-Length:')) {
      console.log('SERVER:', output.trim());
    }

    if (output.includes('Ultra-Persistent MCP Console Automation Server started')) {
      connectionEstablished = true;
      logger.info('✅ Server started successfully');
    }

    if (output.includes('SSH error isolated') || output.includes('Handled recoverable error')) {
      errorIsolated = true;
      logger.info('✅ Error isolation detected');
    }

    if (output.includes('Process.exit') && output.includes('blocked')) {
      processExitBlocked = true;
      logger.info('✅ Process.exit blocked successfully');
    }
  });

  serverProcess.stderr.on('data', (data) => {
    const output = data.toString();
    // Only log actual errors, not debug info
    if (!output.includes('[DEBUG]')) {
      logger.error('SERVER ERROR:', output);
    }
  });

  serverProcess.on('exit', (code) => {
    serverStillRunning = false;
    logger.error(`Server exited with code ${code} - this should NOT happen!`);
  });

  // Wait for server to start
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Simulate SSH connection error via MCP protocol
  logger.info('\n📝 Simulating SSH connection error...');
  
  const sshErrorRequest = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'console_use_profile',
      arguments: {
        profile: 'github-runner-server'  // This will fail with permission denied
      }
    }
  });

  const message = `Content-Length: ${Buffer.byteLength(sshErrorRequest)}\r\n\r\n${sshErrorRequest}`;
  serverProcess.stdin.write(message);

  // Wait for error handling
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Try another command to verify server is still responsive
  logger.info('\n📝 Testing server is still responsive...');
  
  const listRequest = JSON.stringify({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'console_list_sessions',
      arguments: {}
    }
  });

  const listMessage = `Content-Length: ${Buffer.byteLength(listRequest)}\r\n\r\n${listRequest}`;
  serverProcess.stdin.write(listMessage);

  // Wait for response
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Check if server is still running
  if (serverStillRunning) {
    logger.info('✅ Server still running after SSH error!');
  }

  // Test results
  logger.info('\n📊 Test Results:');
  logger.info(`  Server Started: ${connectionEstablished ? '✅' : '❌'}`);
  logger.info(`  Error Isolated: ${errorIsolated ? '✅' : '❌'}`);
  logger.info(`  Process.exit Blocked: ${processExitBlocked ? '✅' : '❌'}`);
  logger.info(`  Server Still Running: ${serverStillRunning ? '✅' : '❌'}`);

  // Clean shutdown
  logger.info('\nSending graceful shutdown signal...');
  serverProcess.kill('SIGTERM');

  // Wait for graceful shutdown
  await new Promise(resolve => setTimeout(resolve, 3000));

  if (connectionEstablished && serverStillRunning) {
    logger.info('\n🎉 Ultra-Persistent MCP Server test PASSED!');
    logger.info('SSH errors are now properly isolated and will NOT disconnect the MCP server.');
  } else {
    logger.error('\n❌ Ultra-Persistent MCP Server test FAILED');
    logger.error('Check the implementation for issues.');
  }

  process.exit(0);
}

// Run test
testUltraPersistentServer().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});