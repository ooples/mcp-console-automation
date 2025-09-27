import { spawn } from 'child_process';

async function testServer(name, path) {
  return new Promise((resolve) => {
    console.log(`\n=== Testing ${name} ===`);
    
    const proc = spawn('node', [path], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let hasOutput = false;
    
    proc.stdout.on('data', (data) => {
      hasOutput = true;
      console.log(`${name} STDOUT:`, data.toString().substring(0, 100));
    });
    
    proc.stderr.on('data', (data) => {
      hasOutput = true;
      console.log(`${name} STDERR:`, data.toString().substring(0, 100));
    });
    
    proc.on('exit', (code) => {
      console.log(`${name} exited with code`, code);
      resolve({ name, code, hasOutput });
    });
    
    // Send MCP initialize
    setTimeout(() => {
      const init = JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {} },
        id: 1
      }) + '\n';
      proc.stdin.write(init);
    }, 500);
    
    // Kill after 2 seconds
    setTimeout(() => {
      proc.kill();
    }, 2000);
  });
}

async function main() {
  const base = await testServer('Base Server', 'dist/mcp/server.js');
  const ultra = await testServer('Ultra-Persistent', 'dist/mcp/ultra-persistent-server.js');
  
  console.log('\n=== Results ===');
  console.log(`Base Server: Exit code ${base.code}, Has output: ${base.hasOutput}`);
  console.log(`Ultra-Persistent: Exit code ${ultra.code}, Has output: ${ultra.hasOutput}`);
}

main();
