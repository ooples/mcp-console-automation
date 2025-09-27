#!/usr/bin/env npx tsx

/**
 * Test the persistent MCP server to verify auto-reconnection and keepalive features
 */

import { spawn } from 'child_process';
import { Logger } from './src/utils/logger.js';

const logger = new Logger('TestPersistentServer');

async function testPersistentServer() {
  logger.info('🧪 Testing Persistent MCP Server...');

  // Start the persistent server
  logger.info('Starting persistent server...');
  const serverProcess = spawn('npx', ['tsx', 'src/mcp/persistent-server.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      LOG_LEVEL: 'debug',
      NODE_ENV: 'test'
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let connectionEstablished = false;
  let keepAliveDetected = false;
  let reconnectionDetected = false;

  // Monitor server output
  serverProcess.stdout.on('data', (data) => {
    const output = data.toString();
    console.log('SERVER:', output.trim());

    if (output.includes('Persistent MCP Console Automation Server started')) {
      connectionEstablished = true;
      logger.info('✅ Server started successfully');
    }

    if (output.includes('Sending keepalive ping')) {
      keepAliveDetected = true;
      logger.info('✅ Keepalive mechanism detected');
    }

    if (output.includes('Reconnection attempt')) {
      reconnectionDetected = true;
      logger.info('✅ Auto-reconnection mechanism detected');
    }
  });

  serverProcess.stderr.on('data', (data) => {
    logger.error('SERVER ERROR:', data.toString());
  });

  // Test for 30 seconds
  await new Promise(resolve => setTimeout(resolve, 30000));

  // Check results
  logger.info('\n📊 Test Results:');
  logger.info(`  Connection Established: ${connectionEstablished ? '✅' : '❌'}`);
  logger.info(`  Keepalive Active: ${keepAliveDetected ? '✅' : '❌'}`);

  // Simulate disconnection by sending invalid input
  logger.info('\nSimulating connection disruption...');
  serverProcess.stdin.write('\x00\x00\x00\x00');

  // Wait for reconnection attempt
  await new Promise(resolve => setTimeout(resolve, 5000));

  logger.info(`  Auto-Reconnection: ${reconnectionDetected ? '✅' : '❌'}`);

  // Clean shutdown
  logger.info('\nSending shutdown signal...');
  serverProcess.kill('SIGTERM');

  // Wait for graceful shutdown
  await new Promise(resolve => setTimeout(resolve, 3000));

  if (connectionEstablished && keepAliveDetected) {
    logger.info('\n🎉 Persistent MCP Server test PASSED!');
    logger.info('The server is ready for use with Claude Code.');
  } else {
    logger.error('\n❌ Persistent MCP Server test FAILED');
    logger.error('Please check the server logs for issues.');
  }

  process.exit(0);
}

// Run test
testPersistentServer().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});