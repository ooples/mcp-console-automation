import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn } from 'child_process';

async function testSSHConnection() {
  console.log('Starting SSH connection test...');
  
  // Create transport
  const proc = spawn('node', ['dist/index.js'], {
    cwd: process.cwd(),
    env: process.env
  });
  
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js']
  });
  
  const client = new Client({
    name: 'ssh-test-client',
    version: '1.0.0'
  }, {
    capabilities: {}
  });
  
  try {
    // Connect to the MCP server
    await client.connect(transport);
    console.log('Connected to MCP server');
    
    // List available tools
    const tools = await client.listTools();
    console.log('Available tools:', tools.tools.map(t => t.name));
    
    // Create SSH session
    console.log('\nCreating SSH session...');
    const createResult = await client.callTool('console_create_session', {
      type: 'ssh',
      ssh: {
        host: '51.81.109.208',
        username: 'ubuntu',
        password: process.env.SSH_PASSWORD || '0hbTMtqW0D4oH0fv',
        port: 22
      },
      options: {
        detectErrors: true,
        enableMonitoring: true
      }
    });
    
    console.log('Session created:', createResult);
    const sessionId = createResult.content[0].text;
    
    // Execute a test command
    console.log('\nExecuting test command...');
    const execResult = await client.callTool('console_execute_command', {
      sessionId,
      command: 'uname -a'
    });
    
    console.log('Command result:', execResult);
    
    // Get output
    console.log('\nGetting session output...');
    const outputResult = await client.callTool('console_get_output', {
      sessionId,
      includeRaw: false
    });
    
    console.log('Session output:', outputResult);
    
    // Stop session
    console.log('\nStopping session...');
    const stopResult = await client.callTool('console_stop_session', {
      sessionId
    });
    
    console.log('Session stopped:', stopResult);
    
  } catch (error) {
    console.error('Error during SSH test:', error);
  } finally {
    await client.close();
    proc.kill();
  }
}

// Run the test
testSSHConnection().catch(console.error);