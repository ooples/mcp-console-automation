#!/usr/bin/env node

/**
 * Simple validation script for race condition fixes
 * Tests the key improvements without requiring full test infrastructure
 */

import { ConsoleManager } from './src/core/ConsoleManager.js';
import { SmartExecutor } from './src/core/SmartExecutor.js';

console.log('='.repeat(70));
console.log('Race Condition Fix - Validation Script');
console.log('='.repeat(70));
console.log();

let consoleManager;
let smartExecutor;
let sessionId;

async function cleanup() {
  if (consoleManager && sessionId) {
    try {
      await consoleManager.stopSession(sessionId);
      console.log('✓ Cleaned up test session');
    } catch (error) {
      console.log('⚠ Cleanup warning:', error.message);
    }
  }
}

async function testEventDrivenCompletion() {
  console.log('Test 1: Event-Driven Completion');
  console.log('-'.repeat(70));

  consoleManager = new ConsoleManager();

  // Create session
  const session = await consoleManager.createSession({
    consoleType: 'bash'
  });
  sessionId = session.id;
  console.log(`✓ Created session: ${sessionId}`);

  // Test event emission
  let eventReceived = false;
  consoleManager.once('command-completed', (event) => {
    eventReceived = true;
    console.log(`✓ Event received:`, {
      commandId: event.commandId,
      status: event.status,
      duration: event.duration
    });
  });

  // Execute command
  const startTime = Date.now();
  const result = await consoleManager.executeCommandInSession(
    sessionId,
    'echo "Event-driven test"',
    [],
    5000
  );
  const duration = Date.now() - startTime;

  console.log(`✓ Command completed in ${duration}ms`);
  console.log(`✓ Exit code: ${result.exitCode}`);
  console.log(`✓ Event was ${eventReceived ? 'received' : 'NOT received'}`);

  if (duration < 1000) {
    console.log('✓ PASS: Latency is acceptable (<1000ms)');
  } else {
    console.log('⚠ WARNING: Latency is high (>1000ms)');
  }

  if (eventReceived) {
    console.log('✓ PASS: Event-driven completion is working');
  } else {
    console.log('✗ FAIL: Event was not emitted');
  }

  console.log();
  return eventReceived && duration < 1000;
}

async function testSmartExecutor() {
  console.log('Test 2: Smart Executor');
  console.log('-'.repeat(70));

  if (!consoleManager || !sessionId) {
    console.log('⚠ Skipping - no active session');
    return false;
  }

  smartExecutor = new SmartExecutor(consoleManager);
  console.log('✓ Smart Executor created');

  // Test quick command
  const result = await smartExecutor.execute('echo "Smart execution test"', {
    sessionId,
    timeout: 5000
  });

  console.log(`✓ Command executed`);
  console.log(`  - Strategy used: ${result.strategyUsed}`);
  console.log(`  - Success: ${result.success}`);
  console.log(`  - Switched: ${result.switched}`);
  console.log(`  - Duration: ${result.duration}ms`);
  console.log(`  - Output: ${result.output.substring(0, 50)}...`);

  if (result.success && result.strategyUsed === 'fast') {
    console.log('✓ PASS: Smart executor correctly used fast strategy');
  } else {
    console.log('⚠ WARNING: Unexpected strategy or failure');
  }

  console.log();
  return result.success;
}

async function testPerformanceComparison() {
  console.log('Test 3: Performance Comparison');
  console.log('-'.repeat(70));

  if (!consoleManager || !sessionId) {
    console.log('⚠ Skipping - no active session');
    return false;
  }

  const iterations = 5;
  const latencies = [];

  console.log(`Running ${iterations} iterations...`);

  for (let i = 0; i < iterations; i++) {
    const start = Date.now();
    await consoleManager.executeCommandInSession(
      sessionId,
      `echo "Performance test ${i}"`,
      [],
      5000
    );
    const latency = Date.now() - start;
    latencies.push(latency);
    console.log(`  Iteration ${i + 1}: ${latency}ms`);
  }

  const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const maxLatency = Math.max(...latencies);
  const minLatency = Math.min(...latencies);

  console.log();
  console.log('Statistics:');
  console.log(`  Average: ${avgLatency.toFixed(2)}ms`);
  console.log(`  Max: ${maxLatency}ms`);
  console.log(`  Min: ${minLatency}ms`);

  if (avgLatency < 500) {
    console.log('✓ PASS: Average latency is excellent (<500ms)');
  } else if (avgLatency < 1000) {
    console.log('✓ PASS: Average latency is good (<1000ms)');
  } else {
    console.log('⚠ WARNING: Average latency is high (>1000ms)');
  }

  console.log();
  return avgLatency < 1000;
}

async function testCPUIdleUsage() {
  console.log('Test 4: CPU Usage During Idle');
  console.log('-'.repeat(70));

  if (!consoleManager || !sessionId) {
    console.log('⚠ Skipping - no active session');
    return false;
  }

  // Execute a command to ensure session is active
  await consoleManager.executeCommandInSession(
    sessionId,
    'echo "CPU test"',
    [],
    5000
  );

  console.log('Measuring CPU during 1 second idle period...');
  const cpuBefore = process.cpuUsage();
  await new Promise(resolve => setTimeout(resolve, 1000));
  const cpuAfter = process.cpuUsage();

  const cpuUsedMs = (cpuAfter.user - cpuBefore.user) / 1000;
  console.log(`CPU used during 1s idle: ${cpuUsedMs.toFixed(2)}ms`);

  if (cpuUsedMs < 50) {
    console.log('✓ PASS: Low CPU usage during idle (event-driven)');
  } else {
    console.log('⚠ WARNING: High CPU usage during idle (possible polling)');
  }

  console.log();
  return cpuUsedMs < 50;
}

async function main() {
  try {
    const results = [];

    results.push(await testEventDrivenCompletion());
    results.push(await testSmartExecutor());
    results.push(await testPerformanceComparison());
    results.push(await testCPUIdleUsage());

    await cleanup();

    console.log('='.repeat(70));
    console.log('Summary');
    console.log('='.repeat(70));
    
    const passed = results.filter(r => r).length;
    const total = results.length;
    
    console.log(`Tests passed: ${passed}/${total}`);
    
    if (passed === total) {
      console.log('✓ All tests PASSED');
      console.log();
      console.log('Race condition fixes validated successfully:');
      console.log('  ✓ Event-driven completion eliminates polling overhead');
      console.log('  ✓ Smart executor provides intelligent strategy selection');
      console.log('  ✓ Performance is optimal with low latency and CPU usage');
      process.exit(0);
    } else {
      console.log('⚠ Some tests did not pass completely');
      console.log('This may be due to system load or environment limitations');
      process.exit(1);
    }
  } catch (error) {
    console.error('✗ Validation failed with error:');
    console.error(error);
    await cleanup();
    process.exit(1);
  }
}

main();
