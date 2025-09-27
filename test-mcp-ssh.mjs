#!/usr/bin/env node
/**
 * Test MCP SSH error handling using the actual SDK
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn } from 'child_process';

console.log('Testing MCP SSH error handling...\n');

async function testSSHError() {
  // Spawn the MCP server
  const serverProcess = spawn('node', [
    'dist/mcp/server.js'
  ], {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: 'C:\\Users\\yolan\\source\\repos\\mcp-console-automation'
  });

  // Create MCP client
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/mcp/server.js'],
    cwd: 'C:\\Users\\yolan\\source\\repos\\mcp-console-automation'
  });

  const client = new Client({
    name: 'test-client',
    version: '1.0.0'
  }, {
    capabilities: {}
  });

  try {
    // Connect to server
    await client.connect(transport);
    console.log('✓ Connected to MCP server');

    // List available tools
    const tools = await client.listTools();
    console.log('✓ Server is responsive, tools:', tools.tools.map(t => t.name).join(', '));

    // Try to create an SSH session that will fail
    console.log('\nAttempting SSH connection to invalid host...');

    try {
      const result = await client.callTool('console_create_session', {
        command: 'ssh',
        sshOptions: {
          host: 'nonexistent.invalid.host',
          port: 22,
          username: 'test',
          password: 'test',
          strictHostKeyChecking: false
        },
        timeout: 5000
      });
      console.log('SSH session result:', result);
    } catch (sshError) {
      console.log('✓ SSH error handled gracefully:', sshError.message);
    }

    // Verify server is still responsive after SSH error
    console.log('\nVerifying server is still responsive...');
    const toolsAfterError = await client.listTools();
    console.log('✓ Server still responsive after SSH error!');
    console.log('✅ TEST PASSED: MCP server survived SSH errors!');

  } catch (error) {
    console.error('❌ TEST FAILED:', error);
  } finally {
    // Clean up
    await client.close();
    serverProcess.kill();
  }
}

testSSHError().catch(console.error);