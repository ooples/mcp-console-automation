#!/usr/bin/env node
/**
 * Test script to reproduce and diagnose session management issues
 * This will use the console automation MCP to create sessions and capture failures
 */

import { ConsoleManager } from './dist/core/ConsoleManager.js';
import { DiagnosticsManager } from './dist/core/DiagnosticsManager.js';
import { writeFileSync } from 'fs';

// Initialize diagnostics
const diagnostics = DiagnosticsManager.getInstance({
  enableDiagnostics: true,
  verboseLogging: true,
  persistDiagnostics: true,
  diagnosticsPath: './diagnostic-output',
  maxEventHistory: 10000,
  metricsIntervalMs: 1000
});

// Initialize console manager
const consoleManager = new ConsoleManager();

async function testSessionCreation() {
  console.log('🔬 Testing Session Creation Issues\n');
  const results = {
    tests: [],
    errors: [],
    diagnosticEvents: []
  };

  // Test 1: Basic session creation
  console.log('Test 1: Basic CMD session creation');
  try {
    const sessionId = await consoleManager.createSession({
      command: 'cmd',
      args: ['/c', 'echo', 'hello'],
      consoleType: 'cmd'
    });
    
    console.log(`  ✅ Session created: ${sessionId}`);
    
    // Immediately try to use the session
    const output = await consoleManager.getOutput(sessionId);
    console.log(`  ✅ Output retrieved: ${output.length} items`);
    
    results.tests.push({
      test: 'basic_cmd_session',
      status: 'success',
      sessionId
    });
  } catch (error) {
    console.error(`  ❌ Failed: ${error.message}`);
    results.tests.push({
      test: 'basic_cmd_session',
      status: 'failed',
      error: error.message
    });
    results.errors.push(error);
  }

  // Test 2: Rapid session creation (reproduce "session not found")
  console.log('\nTest 2: Rapid session creation');
  const rapidSessions = [];
  for (let i = 0; i < 5; i++) {
    try {
      console.log(`  Creating session ${i + 1}...`);
      const sessionId = await consoleManager.createSession({
        command: 'cmd',
        args: ['/c', 'echo', `test${i}`],
        consoleType: 'cmd'
      });
      
      rapidSessions.push(sessionId);
      
      // Immediately try to send input (this often causes "session not found")
      await consoleManager.sendInput(sessionId, `echo session${i}`);
      console.log(`  ✅ Session ${i + 1} created and used`);
      
    } catch (error) {
      console.error(`  ❌ Session ${i + 1} failed: ${error.message}`);
      results.errors.push({
        test: 'rapid_creation',
        index: i,
        error: error.message,
        stack: error.stack
      });
    }
  }

  // Test 3: PowerShell session with immediate operations
  console.log('\nTest 3: PowerShell session with immediate operations');
  try {
    const sessionId = await consoleManager.createSession({
      command: 'powershell',
      args: ['-NoProfile', '-NoExit'],
      consoleType: 'powershell'
    });
    
    console.log(`  Session created: ${sessionId}`);
    
    // Try multiple operations quickly
    await consoleManager.sendInput(sessionId, 'Get-Date');
    console.log('  ✅ Sent first command');
    
    await consoleManager.sendInput(sessionId, 'Get-Process | Select-Object -First 5');
    console.log('  ✅ Sent second command');
    
    const output = await consoleManager.getOutput(sessionId);
    console.log(`  ✅ Retrieved output: ${output.length} items`);
    
    results.tests.push({
      test: 'powershell_immediate_ops',
      status: 'success',
      sessionId
    });
  } catch (error) {
    console.error(`  ❌ Failed: ${error.message}`);
    results.tests.push({
      test: 'powershell_immediate_ops',
      status: 'failed',
      error: error.message
    });
  }

  // Test 4: Session limit stress test
  console.log('\nTest 4: Session limit stress test');
  const stressSessions = [];
  const maxAttempts = 10;
  
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const sessionId = await consoleManager.createSession({
        command: 'cmd',
        args: ['/c', 'timeout', '/t', '1'],
        consoleType: 'cmd'
      });
      stressSessions.push(sessionId);
      console.log(`  ✅ Created session ${i + 1}/${maxAttempts}`);
    } catch (error) {
      console.error(`  ❌ Session ${i + 1} failed: ${error.message}`);
      if (error.message.includes('Maximum session limit')) {
        console.log('  ⚠️  Hit session limit');
        results.errors.push({
          test: 'session_limit',
          sessionCount: i,
          error: error.message
        });
        break;
      }
    }
  }

  // Test 5: Get all sessions
  console.log('\nTest 5: Checking all sessions');
  const allSessions = consoleManager.getAllSessions();
  console.log(`  Total sessions: ${allSessions.length}`);
  const sessionsByStatus = {};
  allSessions.forEach(session => {
    sessionsByStatus[session.status] = (sessionsByStatus[session.status] || 0) + 1;
  });
  console.log('  Sessions by status:', sessionsByStatus);

  // Get diagnostic data
  console.log('\n📊 Collecting Diagnostic Data...');
  const diagnosticReport = diagnostics.generateReport();
  const metrics = diagnostics.getMetrics();
  const recentErrors = diagnostics.getRecentErrors(20);
  const healthStatus = await diagnostics.getHealthStatus();

  // Add diagnostic data to results
  results.diagnosticEvents = diagnostics.getRecentEvents(100);
  results.metrics = metrics;
  results.health = healthStatus;
  results.sessionCount = allSessions.length;
  results.sessionsByStatus = sessionsByStatus;

  // Display summary
  console.log('\n📈 Diagnostic Summary:');
  console.log(`  Total sessions: ${metrics.totalSessions}`);
  console.log(`  Failed sessions: ${metrics.failedSessions}`);
  console.log(`  Success rate: ${metrics.successRate.toFixed(1)}%`);
  console.log(`  Average response time: ${metrics.averageResponseTime.toFixed(0)}ms`);
  console.log(`  Health status: ${healthStatus.healthy ? '✅ Healthy' : '❌ Unhealthy'}`);
  
  if (recentErrors.length > 0) {
    console.log(`\n⚠️  Recent Errors (${recentErrors.length}):`);
    recentErrors.slice(0, 5).forEach(error => {
      console.log(`  - ${error.message}`);
    });
  }

  // Save detailed results
  const outputPath = './diagnostic-output/test-results.json';
  writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`\n💾 Detailed results saved to: ${outputPath}`);

  // Save full diagnostic report
  const reportPath = './diagnostic-output/full-report.json';
  writeFileSync(reportPath, JSON.stringify(diagnosticReport, null, 2));
  console.log(`💾 Full diagnostic report saved to: ${reportPath}`);

  // Cleanup sessions
  console.log('\n🧹 Cleaning up sessions...');
  for (const sessionId of [...rapidSessions, ...stressSessions]) {
    try {
      await consoleManager.stopSession(sessionId);
    } catch (error) {
      // Ignore cleanup errors
    }
  }

  return results;
}

// Run the test
console.log('========================================');
console.log('Console Automation MCP Diagnostic Test');
console.log('========================================\n');

testSessionCreation()
  .then(results => {
    console.log('\n✅ Tests completed');
    
    // Display error summary if any
    if (results.errors.length > 0) {
      console.log(`\n❌ ${results.errors.length} errors encountered`);
      console.log('Common error patterns:');
      const errorPatterns = {};
      results.errors.forEach(err => {
        const pattern = err.error || err.message || err;
        if (pattern.includes('Session not found')) {
          errorPatterns['Session not found'] = (errorPatterns['Session not found'] || 0) + 1;
        } else if (pattern.includes('Maximum session limit')) {
          errorPatterns['Maximum session limit'] = (errorPatterns['Maximum session limit'] || 0) + 1;
        } else {
          errorPatterns['Other'] = (errorPatterns['Other'] || 0) + 1;
        }
      });
      Object.entries(errorPatterns).forEach(([pattern, count]) => {
        console.log(`  - ${pattern}: ${count} occurrences`);
      });
    }
    
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  });