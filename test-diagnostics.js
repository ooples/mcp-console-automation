#!/usr/bin/env node
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn } from 'child_process';

async function testDiagnostics() {
  console.log('🔬 Starting diagnostic test of Console Automation MCP Server...\n');
  
  // Start the server process
  const serverProcess = spawn('node', ['dist/mcp/server-with-diagnostics.js'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: 'C:\\Users\\yolan\\source\\repos\\mcp-console-automation'
  });

  // Create transport
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/mcp/server-with-diagnostics.js'],
    cwd: 'C:\\Users\\yolan\\source\\repos\\mcp-console-automation'
  });

  // Create client
  const client = new Client({
    name: 'diagnostic-test-client',
    version: '1.0.0',
  }, {
    capabilities: {}
  });

  try {
    // Connect to server
    await client.connect(transport);
    console.log('✅ Connected to server\n');

    // List available tools
    const tools = await client.listTools();
    console.log(`📋 Available tools: ${tools.tools.length}`);
    console.log(tools.tools.map(t => `  - ${t.name}`).join('\n'));
    console.log();

    // Test 1: Create a session
    console.log('🧪 Test 1: Creating a PowerShell session...');
    const createResult = await client.callTool('console_create_session', {
      command: 'powershell',
      args: ['-NoProfile', '-NoExit'],
      consoleType: 'powershell'
    });
    
    const sessionData = JSON.parse(createResult.content[0].text);
    const sessionId = sessionData.sessionId;
    console.log(`✅ Session created: ${sessionId}\n`);

    // Wait a bit for session to stabilize
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Test 2: Send input
    console.log('🧪 Test 2: Sending input to session...');
    await client.callTool('console_send_input', {
      sessionId: sessionId,
      input: 'echo "Hello from diagnostics test"'
    });
    console.log('✅ Input sent\n');

    // Wait for output
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Test 3: Get output
    console.log('🧪 Test 3: Getting output from session...');
    const outputResult = await client.callTool('console_get_output', {
      sessionId: sessionId,
      limit: 10
    });
    console.log('✅ Output retrieved:', outputResult.content[0].text.substring(0, 100), '...\n');

    // Test 4: Get diagnostics
    console.log('🧪 Test 4: Getting diagnostic information...');
    const diagResult = await client.callTool('console_get_diagnostics', {
      verbose: true
    });
    const diagnostics = JSON.parse(diagResult.content[0].text);
    console.log('✅ Diagnostics retrieved:');
    console.log(`  - Total sessions: ${diagnostics.metrics.totalSessions}`);
    console.log(`  - Success rate: ${diagnostics.metrics.successRate}%`);
    console.log(`  - Recent events: ${diagnostics.recentEvents.length}`);
    console.log();

    // Test 5: Get session-specific diagnostics
    console.log('🧪 Test 5: Getting session-specific diagnostics...');
    const sessionDiagResult = await client.callTool('console_get_session_diagnostics', {
      sessionId: sessionId
    });
    const sessionDiag = JSON.parse(sessionDiagResult.content[0].text);
    console.log('✅ Session diagnostics:');
    console.log(`  - State: ${sessionDiag.state}`);
    console.log(`  - Operations: ${sessionDiag.operations.length}`);
    console.log(`  - Errors: ${sessionDiag.errors.length}`);
    console.log();

    // Test 6: List sessions
    console.log('🧪 Test 6: Listing all sessions...');
    const sessionsResult = await client.callTool('console_list_sessions');
    const sessions = JSON.parse(sessionsResult.content[0].text);
    console.log(`✅ Active sessions: ${sessions.sessions.length}`);
    sessions.sessions.forEach(s => {
      console.log(`  - ${s.id}: ${s.consoleType} (${s.status})`);
    });
    console.log();

    // Test 7: Execute command (creates and destroys session)
    console.log('🧪 Test 7: Executing a single command...');
    const execResult = await client.callTool('console_execute_command', {
      command: 'echo',
      args: ['Test complete'],
      consoleType: 'cmd'
    });
    console.log('✅ Command executed:', JSON.parse(execResult.content[0].text).output);
    console.log();

    // Test 8: Generate diagnostic report
    console.log('🧪 Test 8: Generating diagnostic report...');
    const reportResult = await client.callTool('console_generate_diagnostic_report');
    const report = JSON.parse(reportResult.content[0].text);
    console.log('✅ Report generated:');
    console.log(`  - Report ID: ${report.reportId}`);
    console.log(`  - Total events: ${report.events.length}`);
    console.log(`  - Recommendations: ${report.recommendations.length}`);
    report.recommendations.forEach(r => console.log(`    • ${r}`));
    console.log();

    // Test 9: Check for recent errors
    console.log('🧪 Test 9: Checking for recent errors...');
    const errorsResult = await client.callTool('console_get_recent_errors', {
      count: 5
    });
    const errors = JSON.parse(errorsResult.content[0].text);
    console.log(`✅ Recent errors: ${errors.errors.length}`);
    if (errors.errors.length > 0) {
      errors.errors.forEach(e => {
        console.log(`  - ${e.timestamp}: ${e.message}`);
      });
    } else {
      console.log('  No recent errors found');
    }
    console.log();

    // Test 10: Get active alerts
    console.log('🧪 Test 10: Checking active alerts...');
    const alertsResult = await client.callTool('console_get_active_alerts');
    const alerts = JSON.parse(alertsResult.content[0].text);
    console.log(`✅ Active alerts: ${alerts.alerts.length}`);
    if (alerts.alerts.length > 0) {
      alerts.alerts.forEach(a => {
        console.log(`  - [${a.severity}] ${a.message}`);
      });
    } else {
      console.log('  No active alerts');
    }
    console.log();

    // Clean up: Stop the session
    console.log('🧹 Cleaning up: Stopping session...');
    await client.callTool('console_stop_session', {
      sessionId: sessionId
    });
    console.log('✅ Session stopped\n');

    // Final diagnostics
    console.log('📊 Final diagnostic summary:');
    const finalDiagResult = await client.callTool('console_get_diagnostics', {
      verbose: false
    });
    const finalDiag = JSON.parse(finalDiagResult.content[0].text);
    console.log(`  - Total sessions created: ${finalDiag.metrics.totalSessions}`);
    console.log(`  - Failed sessions: ${finalDiag.metrics.failedSessions}`);
    console.log(`  - Average response time: ${finalDiag.metrics.averageResponseTime}ms`);
    console.log(`  - Overall success rate: ${finalDiag.metrics.successRate}%`);
    console.log();

    console.log('✅ All diagnostic tests completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error('Error details:', error.stack);
    
    // Try to get diagnostic info even on error
    try {
      const errorDiag = await client.callTool('console_get_diagnostics', { verbose: true });
      console.error('Diagnostic info at time of error:', errorDiag.content[0].text);
    } catch (diagError) {
      console.error('Could not retrieve diagnostics:', diagError.message);
    }
  } finally {
    // Disconnect
    await client.close();
    
    // Kill server process
    serverProcess.kill();
    
    process.exit(0);
  }
}

// Run the test
testDiagnostics().catch(console.error);