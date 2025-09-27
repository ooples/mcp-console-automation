#!/usr/bin/env node
import { spawn } from 'child_process';

async function simpleTest() {
  console.log('🔬 Starting simple diagnostic test...\n');
  
  // Start the server process with stdio
  const serverProcess = spawn('node', ['dist/mcp/server-with-diagnostics.js'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: 'C:\\Users\\yolan\\source\\repos\\mcp-console-automation'
  });

  // Capture server output
  serverProcess.stdout.on('data', (data) => {
    console.log(`[SERVER STDOUT]: ${data.toString()}`);
  });

  serverProcess.stderr.on('data', (data) => {
    console.error(`[SERVER STDERR]: ${data.toString()}`);
  });

  serverProcess.on('error', (error) => {
    console.error(`[SERVER ERROR]: ${error.message}`);
  });

  serverProcess.on('exit', (code) => {
    console.log(`[SERVER EXIT]: Process exited with code ${code}`);
  });

  // Send a simple request to test connection
  console.log('Sending initialize request...');
  const initRequest = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'test-client',
        version: '1.0.0'
      }
    }
  }) + '\n';

  serverProcess.stdin.write(initRequest);
  
  // Wait for response
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Send list tools request
  console.log('Sending list tools request...');
  const toolsRequest = JSON.stringify({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {}
  }) + '\n';

  serverProcess.stdin.write(toolsRequest);

  // Wait for response
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Send a test tool call
  console.log('Sending tool call to create session...');
  const toolCallRequest = JSON.stringify({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'console_create_session',
      arguments: {
        command: 'cmd',
        args: ['/c', 'echo', 'test'],
        consoleType: 'cmd'
      }
    }
  }) + '\n';

  serverProcess.stdin.write(toolCallRequest);

  // Wait for response
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Kill the server
  console.log('Stopping server...');
  serverProcess.kill();
  
  // Wait a bit before exiting
  await new Promise(resolve => setTimeout(resolve, 1000));
  process.exit(0);
}

// Run the test
simpleTest().catch(console.error);