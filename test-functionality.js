#!/usr/bin/env node

// Quick functionality test for MCP Console Automation Server
import { spawn } from 'child_process';
import { ConsoleManager } from './dist/core/ConsoleManager.js';

console.log('Testing MCP Console Automation Server functionality...\n');

async function runTests() {
  const manager = new ConsoleManager();
  let testsPassed = 0;
  let testsFailed = 0;

  // Test 1: Basic command execution
  console.log('Test 1: Basic command execution');
  try {
    const result = await manager.executeCommand('echo', ['Hello World']);
    if (result.output.includes('Hello World')) {
      console.log('✓ Basic command execution works');
      testsPassed++;
    } else {
      console.log('✗ Basic command execution failed');
      testsFailed++;
    }
  } catch (error) {
    console.log('✗ Basic command execution error:', error.message);
    testsFailed++;
  }

  // Test 2: Different console types (Windows)
  if (process.platform === 'win32') {
    console.log('\nTest 2: PowerShell execution');
    try {
      const result = await manager.executeCommand('Get-Date', [], {
        consoleType: 'powershell'
      });
      if (result.output && result.exitCode === 0) {
        console.log('✓ PowerShell execution works');
        testsPassed++;
      } else {
        console.log('✗ PowerShell execution failed');
        testsFailed++;
      }
    } catch (error) {
      console.log('✗ PowerShell execution error:', error.message);
      testsFailed++;
    }
  }

  // Test 3: Error detection
  console.log('\nTest 3: Error detection');
  try {
    const sessionId = await manager.createSession({
      command: 'node',
      args: ['-e', 'console.error("ERROR: Test error"); process.exit(1)']
    });
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const output = manager.getLastOutput(sessionId);
    if (output.includes('ERROR')) {
      console.log('✓ Error detection works');
      testsPassed++;
    } else {
      console.log('✗ Error detection failed');
      testsFailed++;
    }
    
    await manager.stopSession(sessionId);
  } catch (error) {
    console.log('✗ Error detection error:', error.message);
    testsFailed++;
  }

  // Test 4: Session management
  console.log('\nTest 4: Session management');
  try {
    const sessionId = await manager.createSession({
      command: process.platform === 'win32' ? 'cmd' : 'sh',
      streaming: true
    });
    
    const session = manager.getSession(sessionId);
    if (session && session.status === 'running') {
      console.log('✓ Session creation works');
      testsPassed++;
      
      await manager.sendInput(sessionId, 'exit\n');
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const updatedSession = manager.getSession(sessionId);
      if (!updatedSession || updatedSession.status === 'stopped') {
        console.log('✓ Session termination works');
        testsPassed++;
      } else {
        console.log('✗ Session termination failed');
        testsFailed++;
      }
    } else {
      console.log('✗ Session creation failed');
      testsFailed++;
    }
  } catch (error) {
    console.log('✗ Session management error:', error.message);
    testsFailed++;
  }

  // Test 5: Resource monitoring
  console.log('\nTest 5: Resource monitoring');
  try {
    const usage = manager.getResourceUsage();
    if (usage && typeof usage.sessions === 'number' && typeof usage.memoryMB === 'number') {
      console.log('✓ Resource monitoring works');
      console.log(`  Sessions: ${usage.sessions}, Memory: ${usage.memoryMB}MB`);
      testsPassed++;
    } else {
      console.log('✗ Resource monitoring failed');
      testsFailed++;
    }
  } catch (error) {
    console.log('✗ Resource monitoring error:', error.message);
    testsFailed++;
  }

  // Cleanup
  await manager.destroy();

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log(`Tests passed: ${testsPassed}`);
  console.log(`Tests failed: ${testsFailed}`);
  console.log('='.repeat(50));
  
  if (testsFailed === 0) {
    console.log('\n✅ All tests passed! Server is production-ready.');
  } else {
    console.log(`\n⚠️  ${testsFailed} test(s) failed. Please review.`);
  }
  
  process.exit(testsFailed > 0 ? 1 : 0);
}

runTests().catch(error => {
  console.error('Test suite error:', error);
  process.exit(1);
});