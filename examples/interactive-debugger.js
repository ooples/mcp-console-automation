// Example: Interactive debugger automation
// This example shows how to automate debugging sessions

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function automatedDebugging(client) {
  console.log('Starting automated debugging session...');

  // Start Python debugger
  const session = await client.callTool({
    name: 'console_create_session',
    arguments: {
      command: 'python',
      args: ['-m', 'pdb', 'buggy_script.py'],
      detectErrors: true,
    },
  });

  const sessionId = JSON.parse(session.content[0].text).sessionId;
  console.log('Debugger session started:', sessionId);

  // Helper function to run debugger command and get output
  async function runDebugCommand(command) {
    await client.callTool({
      name: 'console_send_input',
      arguments: {
        sessionId,
        input: command + '\n',
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 500));

    const output = await client.callTool({
      name: 'console_get_output',
      arguments: {
        sessionId,
        limit: 20,
      },
    });

    return output.content[0].text;
  }

  // Set breakpoints
  console.log('\nSetting breakpoints...');
  let output = await runDebugCommand('b main');
  console.log('Breakpoint set at main function');

  output = await runDebugCommand('b 42');
  console.log('Breakpoint set at line 42');

  // Start execution
  console.log('\nStarting execution...');
  output = await runDebugCommand('c');

  // Check if we hit a breakpoint
  if (output.includes('->')) {
    console.log('Hit breakpoint!');

    // Inspect variables
    console.log('\nInspecting variables...');
    output = await runDebugCommand('pp locals()');
    console.log('Local variables:', output);

    // Step through code
    console.log('\nStepping through code...');
    for (let i = 0; i < 5; i++) {
      output = await runDebugCommand('n');
      console.log(`Step ${i + 1}:`, output.split('\n')[0]);

      // Check for errors
      const errors = await client.callTool({
        name: 'console_detect_errors',
        arguments: { text: output },
      });

      const errorData = JSON.parse(errors.content[0].text);
      if (errorData.hasErrors) {
        console.log('Error detected during execution!');
        console.log('Stack trace analysis:', errorData.stackTrace);

        // Get more context
        output = await runDebugCommand('where');
        console.log('Call stack:', output);

        break;
      }
    }

    // Continue or quit
    output = await runDebugCommand('q');
  }

  // Stop the session
  await client.callTool({
    name: 'console_stop_session',
    arguments: { sessionId },
  });

  console.log('\nDebugging session completed.');
}

async function interactiveRepl(client) {
  console.log('Starting interactive REPL session...');

  // Start Node.js REPL
  const session = await client.callTool({
    name: 'console_create_session',
    arguments: {
      command: 'node',
      detectErrors: true,
    },
  });

  const sessionId = JSON.parse(session.content[0].text).sessionId;

  // Example REPL interactions
  const commands = [
    'const data = [1, 2, 3, 4, 5]',
    'data.map(x => x * 2)',
    'const sum = data.reduce((a, b) => a + b, 0)',
    'console.log("Sum:", sum)',
    'undefined_function()', // This will cause an error
  ];

  for (const cmd of commands) {
    console.log(`\n> ${cmd}`);

    await client.callTool({
      name: 'console_send_input',
      arguments: {
        sessionId,
        input: cmd + '\n',
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 500));

    const output = await client.callTool({
      name: 'console_get_output',
      arguments: {
        sessionId,
        limit: 10,
      },
    });

    console.log(output.content[0].text);

    // Check for errors
    const errors = await client.callTool({
      name: 'console_detect_errors',
      arguments: { sessionId },
    });

    const errorData = JSON.parse(errors.content[0].text);
    if (errorData.hasErrors) {
      console.log('⚠️  Error detected:', errorData.errors[0].match);
    }
  }

  // Exit REPL
  await client.callTool({
    name: 'console_send_key',
    arguments: {
      sessionId,
      key: 'ctrl+d',
    },
  });

  await client.callTool({
    name: 'console_stop_session',
    arguments: { sessionId },
  });

  console.log('\nREPL session ended.');
}

async function main() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.resolve(__dirname, '../dist/mcp/server.js')],
  });

  const client = new Client({
    name: 'interactive-debugger',
    version: '1.0.0',
  });

  await client.connect(transport);

  try {
    // Run automated debugging
    await automatedDebugging(client);

    // Run interactive REPL
    await interactiveRepl(client);
  } catch (error) {
    console.error('Error:', error);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
