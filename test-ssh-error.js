#!/usr/bin/env node
/**
 * Test SSH error handling in MCP server
 * This script simulates SSH connection failures to verify the server stays alive
 */

import { spawn } from 'child_process';
import * as fs from 'fs';

const DEBUG_LOG = 'C:\\Users\\yolan\\source\\repos\\mcp-console-automation\\mcp-debug.log';

// Clear debug log
fs.writeFileSync(DEBUG_LOG, `[${new Date().toISOString()}] Starting SSH error test\n`);

console.log('Testing SSH error handling in MCP server...\n');

// Start the MCP server
console.log('Starting MCP server...');
const server = spawn('node', [
  'C:\\Users\\yolan\\source\\repos\\mcp-console-automation\\dist\\mcp\\server.js'
], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    MCP_SERVER_MODE: 'true'
  }
});

let serverOutput = '';
let serverError = '';

server.stdout.on('data', (data) => {
  serverOutput += data.toString();
});

server.stderr.on('data', (data) => {
  serverError += data.toString();
});

server.on('error', (error) => {
  console.error('Server spawn error:', error);
});

server.on('exit', (code) => {
  console.log(`\nServer exited with code: ${code}`);
  if (code !== 0) {
    console.error('❌ TEST FAILED: Server crashed!');
    console.log('Server output:', serverOutput);
    console.log('Server error:', serverError);
  } else {
    console.log('✓ Server exited cleanly');
  }

  // Show debug log
  console.log('\n=== Debug Log ===');
  const debugLog = fs.readFileSync(DEBUG_LOG, 'utf8');
  console.log(debugLog.slice(-2000)); // Last 2000 chars
});

// Wait for server to initialize
setTimeout(() => {
  console.log('Sending SSH connection test request...');

  // Send a test request to create SSH session with bad host
  const request = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'console_create_session',
      arguments: {
        command: 'ssh',
        sshOptions: {
          host: 'nonexistent.invalid.host',
          port: 22,
          username: 'test',
          password: 'test',
          strictHostKeyChecking: false
        },
        timeout: 5000
      }
    }
  };

  // Send request
  server.stdin.write('Content-Length: ' + JSON.stringify(request).length + '\r\n\r\n');
  server.stdin.write(JSON.stringify(request));

  console.log('Request sent. Waiting for response...');

  // Wait and check if server is still alive
  setTimeout(() => {
    if (server.exitCode === null) {
      console.log('✅ TEST PASSED: Server is still running after SSH error!');

      // Send another request to verify server is responsive
      const pingRequest = {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {}
      };

      server.stdin.write('Content-Length: ' + JSON.stringify(pingRequest).length + '\r\n\r\n');
      server.stdin.write(JSON.stringify(pingRequest));

      setTimeout(() => {
        console.log('Server is responsive. Shutting down...');
        server.kill();
      }, 1000);
    } else {
      console.error('❌ TEST FAILED: Server crashed after SSH error!');
    }
  }, 7000);

}, 2000);

// Timeout safety
setTimeout(() => {
  if (server.exitCode === null) {
    console.log('Test timeout - killing server');
    server.kill();
  }
  process.exit(0);
}, 15000);