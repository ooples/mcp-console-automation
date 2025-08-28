// Example: Basic usage of MCP Console Automation Server
// This example demonstrates how to interact with the server using MCP client

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn } from 'child_process';

async function main() {
  // Start the MCP server
  const serverProcess = spawn('node', ['../dist/index.js']);
  
  // Create MCP client
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['../dist/index.js']
  });
  
  const client = new Client({
    name: 'console-automation-example',
    version: '1.0.0'
  });

  await client.connect(transport);

  try {
    // Example 1: Run a simple command
    console.log('Example 1: Running a simple command');
    const result1 = await client.callTool('console_execute_command', {
      command: 'echo',
      args: ['Hello from MCP Console Automation!']
    });
    console.log('Output:', result1.content[0].text);

    // Example 2: Create an interactive session
    console.log('\nExample 2: Interactive Python session');
    const session = await client.callTool('console_create_session', {
      command: 'python',
      args: ['-i'],
      detectErrors: true
    });
    
    const sessionId = JSON.parse(session.content[0].text).sessionId;
    console.log('Session created:', sessionId);

    // Send Python code
    await client.callTool('console_send_input', {
      sessionId,
      input: 'print("Hello from Python!")\n'
    });

    // Wait for output
    await new Promise(resolve => setTimeout(resolve, 500));

    // Get output
    const output = await client.callTool('console_get_output', {
      sessionId,
      limit: 10
    });
    console.log('Python output:', output.content[0].text);

    // Example 3: Error detection
    console.log('\nExample 3: Error detection');
    await client.callTool('console_send_input', {
      sessionId,
      input: 'undefined_variable\n'
    });

    await new Promise(resolve => setTimeout(resolve, 500));

    const errors = await client.callTool('console_detect_errors', {
      sessionId
    });
    console.log('Errors detected:', errors.content[0].text);

    // Clean up
    await client.callTool('console_stop_session', {
      sessionId
    });

    // Example 4: Running tests with error monitoring
    console.log('\nExample 4: Running tests');
    const testResult = await client.callTool('console_execute_command', {
      command: 'npm',
      args: ['test'],
      cwd: '../',
      timeout: 30000
    });
    
    const testErrors = await client.callTool('console_detect_errors', {
      text: JSON.parse(testResult.content[0].text).output
    });
    
    console.log('Test errors:', testErrors.content[0].text);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
    serverProcess.kill();
  }
}

main().catch(console.error);