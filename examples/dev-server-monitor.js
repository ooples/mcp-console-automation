// Example: Monitoring a development server for errors
// This example shows how to start a dev server and monitor it for errors

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function monitorDevServer(client) {
  console.log('Starting development server monitor...');
  
  // Start the dev server
  const session = await client.callTool('console_create_session', {
    command: 'npm',
    args: ['run', 'dev'],
    cwd: '/path/to/your/project',
    detectErrors: true
  });
  
  const sessionId = JSON.parse(session.content[0].text).sessionId;
  console.log('Dev server session started:', sessionId);

  // Wait for server to start
  try {
    await client.callTool('console_wait_for_output', {
      sessionId,
      pattern: 'Server running on|Listening on|Ready on',
      timeout: 10000
    });
    console.log('Dev server is running!');
  } catch (error) {
    console.error('Server failed to start:', error);
    return;
  }

  // Monitor for errors
  let errorCount = 0;
  const checkInterval = setInterval(async () => {
    try {
      const output = await client.callTool('console_get_output', {
        sessionId,
        limit: 50
      });

      const errors = await client.callTool('console_detect_errors', {
        text: output.content[0].text
      });

      const errorData = JSON.parse(errors.content[0].text);
      if (errorData.hasErrors && errorData.errors.length > errorCount) {
        console.log('\n⚠️  New errors detected:');
        errorData.errors.slice(errorCount).forEach(error => {
          console.log(`  - Line ${error.line}: ${error.match}`);
          console.log(`    Type: ${error.pattern.type}, Severity: ${error.pattern.severity}`);
        });
        errorCount = errorData.errors.length;

        // If critical errors, you might want to restart the server
        if (errorData.severityScore >= 8) {
          console.log('Critical errors detected! Consider restarting the server.');
        }
      }
    } catch (error) {
      console.error('Error checking output:', error);
    }
  }, 2000);

  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down dev server...');
    clearInterval(checkInterval);
    
    // Send Ctrl+C to the dev server
    await client.callTool('console_send_key', {
      sessionId,
      key: 'ctrl+c'
    });
    
    // Stop the session
    await client.callTool('console_stop_session', {
      sessionId
    });
    
    console.log('Dev server stopped.');
    process.exit(0);
  });

  console.log('Monitoring dev server. Press Ctrl+C to stop.');
}

async function main() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['../dist/index.js']
  });
  
  const client = new Client({
    name: 'dev-server-monitor',
    version: '1.0.0'
  });

  await client.connect(transport);
  
  try {
    await monitorDevServer(client);
    
    // Keep the process running
    await new Promise(() => {});
  } catch (error) {
    console.error('Error:', error);
    await client.close();
  }
}

main().catch(console.error);