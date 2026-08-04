// Example: Basic usage of MCP Console Automation Server
// This example demonstrates how to interact with the server using MCP client

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  // Create MCP client
  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.resolve(__dirname, '../dist/mcp/server.js')],
  });

  const client = new Client({
    name: 'console-automation-example',
    version: '1.0.0',
  });

  await client.connect(transport);

  try {
    // Example 1: Run a simple command
    console.log('Example 1: Running a simple command');
    const result1 = await client.callTool({
      name: 'console_execute_command',
      arguments: {
        command: 'echo',
        args: ['Hello from MCP Console Automation!'],
      },
    });
    console.log('Output:', result1.content[0].text);

    // Example 2: Create an interactive session
    console.log('\nExample 2: Interactive Python session');
    const session = await client.callTool({
      name: 'console_create_session',
      arguments: {
        command: 'python',
        args: ['-i'],
        detectErrors: true,
      },
    });

    const sessionId = JSON.parse(session.content[0].text).sessionId;
    console.log('Session created:', sessionId);

    try {
      // Send Python code
      await client.callTool({
        name: 'console_send_input',
        arguments: {
          sessionId,
          input: 'print("Hello from Python!")\n',
        },
      });

      // Wait for output
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Get output
      const output = await client.callTool({
        name: 'console_get_output',
        arguments: {
          sessionId,
          limit: 10,
        },
      });
      console.log('Python output:', output.content[0].text);

      // Example 3: Error detection
      console.log('\nExample 3: Error detection');
      await client.callTool({
        name: 'console_send_input',
        arguments: {
          sessionId,
          input: 'undefined_variable\n',
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      const errors = await client.callTool({
        name: 'console_detect_errors',
        arguments: { sessionId },
      });
      console.log('Errors detected:', errors.content[0].text);
    } finally {
      if (sessionId) {
        try {
          await client.callTool({
            name: 'console_stop_session',
            arguments: { sessionId },
          });
        } catch (cleanupError) {
          console.error('Failed to stop session:', cleanupError);
        }
      }
    }

    // Example 4: Running tests with error monitoring
    console.log('\nExample 4: Running tests');
    const testResult = await client.callTool({
      name: 'console_execute_command',
      arguments: {
        command: 'npm',
        args: ['test'],
        cwd: path.resolve(__dirname, '..'),
        timeout: 30000,
      },
    });

    const testErrors = await client.callTool({
      name: 'console_detect_errors',
      arguments: {
        text: JSON.parse(testResult.content[0].text).output,
      },
    });

    console.log('Test errors:', testErrors.content[0].text);
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
  }
}

main().catch(console.error);
