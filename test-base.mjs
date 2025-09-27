import { spawn } from 'child_process';

console.log('Testing base server...');

const proc = spawn('node', ['dist/mcp/server.js'], {
  env: { ...process.env, MCP_SERVER_MODE: 'true' },
  stdio: ['pipe', 'pipe', 'pipe']
});

proc.stdout.on('data', (data) => {
  console.log('BASE STDOUT:', data.toString());
});

proc.on('exit', (code) => {
  console.log('Base server exited with code', code);
});

setTimeout(() => {
  proc.kill();
  process.exit(0);
}, 2000);
