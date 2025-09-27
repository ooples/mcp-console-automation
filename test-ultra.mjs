import { spawn } from 'child_process';
import fs from 'fs';

console.log('Testing ultra-persistent server...');

// Clear log
const logPath = './logs/test-ultra.log';
fs.writeFileSync(logPath, 'Test started\n');

// Start the server
const proc = spawn('node', ['dist/mcp/ultra-persistent-server.js'], {
  env: { ...process.env, MCP_SERVER_MODE: 'true', LOG_LEVEL: 'debug' },
  stdio: ['pipe', 'pipe', 'pipe']
});

proc.stdout.on('data', (data) => {
  console.log('STDOUT:', data.toString());
});

proc.stderr.on('data', (data) => {
  console.log('STDERR:', data.toString());
});

proc.on('error', (error) => {
  console.error('Failed to start:', error);
});

proc.on('exit', (code) => {
  console.log('Process exited with code', code);
});

// Send initial MCP handshake
setTimeout(() => {
  console.log('Sending initialize request...');
  const initRequest = JSON.stringify({
    jsonrpc: '2.0',
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {}
    },
    id: 1
  }) + '\n';
  
  proc.stdin.write(initRequest);
}, 1000);

// Wait and kill after 3 seconds
setTimeout(() => {
  console.log('Killing process...');
  proc.kill();
  process.exit(0);
}, 3000);
