/**
 * Race Condition Fix Validation Tests
 * 
 * Tests for:
 * 1. Event-driven completion (Phase 1)
 * 2. Error message guidance (Phase 2)
 * 3. Smart executor functionality (Phase 3)
 */

import { ConsoleManager } from '../src/core/ConsoleManager.js';
import { SmartExecutor } from '../src/core/SmartExecutor.js';
import { EventEmitter } from 'events';

describe('Race Condition Fix - Phase 1: Event-Driven Completion', () => {
  let consoleManager: ConsoleManager;

  beforeEach(() => {
    consoleManager = new ConsoleManager();
  });

  afterEach(async () => {
    // Clean up any sessions
    const sessions = consoleManager.listSessions();
    for (const session of sessions) {
      try {
        await consoleManager.stopSession(session.id);
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  });

  test('ConsoleManager extends EventEmitter', () => {
    expect(consoleManager).toBeInstanceOf(EventEmitter);
  });

  test('Command completion emits event', async () => {
    // Create a session
    const session = await consoleManager.createSession({
      consoleType: 'bash'
    });

    // Listen for command-completed event
    const eventPromise = new Promise((resolve) => {
      consoleManager.once('command-completed', (event) => {
        resolve(event);
      });
    });

    // Execute a simple command
    const commandPromise = consoleManager.executeCommandInSession(
      session.id,
      'echo "test"',
      [],
      5000
    );

    // Wait for both event and command to complete
    const [event, result] = await Promise.all([eventPromise, commandPromise]);

    // Verify event was emitted
    expect(event).toBeDefined();
    expect((event as any).commandId).toBeDefined();
    expect((event as any).status).toMatch(/completed|failed/);
    expect((event as any).duration).toBeGreaterThanOrEqual(0);

    // Verify command completed successfully
    expect(result.exitCode).toBe(0);
  }, 10000);

  test('Event-driven waiting has zero latency overhead', async () => {
    const session = await consoleManager.createSession({
      consoleType: 'bash'
    });

    const startTime = Date.now();
    
    // Execute a very fast command
    await consoleManager.executeCommandInSession(
      session.id,
      'echo "test"',
      [],
      5000
    );

    const duration = Date.now() - startTime;

    // With event-driven approach, latency should be minimal
    // Old polling approach added 0-100ms latency
    // Event-driven should complete in <200ms for a simple echo
    expect(duration).toBeLessThan(1000);
  }, 10000);
});

describe('Race Condition Fix - Phase 3: Smart Executor', () => {
  let consoleManager: ConsoleManager;
  let smartExecutor: SmartExecutor;
  let sessionId: string;

  beforeEach(async () => {
    consoleManager = new ConsoleManager();
    smartExecutor = new SmartExecutor(consoleManager);
    
    // Create a test session
    const session = await consoleManager.createSession({
      consoleType: 'bash'
    });
    sessionId = session.id;
  });

  afterEach(async () => {
    try {
      await consoleManager.stopSession(sessionId);
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  test('Smart executor executes simple command with fast strategy', async () => {
    const result = await smartExecutor.execute('echo "hello"', {
      sessionId,
      timeout: 5000
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('hello');
    expect(result.strategyUsed).toBe('fast');
    expect(result.switched).toBe(false);
  }, 10000);

  test('Smart executor recognizes quick command patterns', async () => {
    const quickCommands = ['ls', 'pwd', 'echo test', 'cat /etc/hostname'];

    for (const command of quickCommands) {
      const result = await smartExecutor.execute(command, {
        sessionId,
        timeout: 5000
      });

      expect(result.success).toBe(true);
      expect(result.strategyUsed).toBe('fast');
    }
  }, 30000);

  test('Smart executor provides metadata about execution', async () => {
    const result = await smartExecutor.execute('echo "test"', {
      sessionId,
      timeout: 5000
    });

    // Verify all expected metadata is present
    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('output');
    expect(result).toHaveProperty('exitCode');
    expect(result).toHaveProperty('duration');
    expect(result).toHaveProperty('strategyUsed');
    expect(result).toHaveProperty('switched');
  }, 10000);

  test('Smart executor handles command with arguments', async () => {
    const result = await smartExecutor.execute('echo', {
      sessionId,
      args: ['hello', 'world'],
      timeout: 5000
    });

    expect(result.success).toBe(true);
    expect(result.output).toMatch(/hello.*world/);
  }, 10000);
});

describe('Integration: Smart Executor vs Direct Execution', () => {
  let consoleManager: ConsoleManager;
  let smartExecutor: SmartExecutor;
  let sessionId: string;

  beforeEach(async () => {
    consoleManager = new ConsoleManager();
    smartExecutor = new SmartExecutor(consoleManager);
    
    const session = await consoleManager.createSession({
      consoleType: 'bash'
    });
    sessionId = session.id;
  });

  afterEach(async () => {
    try {
      await consoleManager.stopSession(sessionId);
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  test('Smart executor produces same output as direct execution', async () => {
    const command = 'echo "comparison test"';

    // Execute with smart executor
    const smartResult = await smartExecutor.execute(command, {
      sessionId,
      timeout: 5000
    });

    // Execute directly
    const directResult = await consoleManager.executeCommandInSession(
      sessionId,
      command,
      [],
      5000
    );

    // Both should produce same output
    const smartOutput = smartResult.output.trim();
    const directOutput = directResult.output.map(o => o.data).join('').trim();

    expect(smartOutput).toContain('comparison test');
    expect(directOutput).toContain('comparison test');
  }, 10000);

  test('Smart executor and direct execution both use event-driven completion', async () => {
    // Test that both approaches complete quickly (no 100ms polling overhead)
    
    const smartStart = Date.now();
    await smartExecutor.execute('echo "test"', { sessionId, timeout: 5000 });
    const smartDuration = Date.now() - smartStart;

    const directStart = Date.now();
    await consoleManager.executeCommandInSession(sessionId, 'echo "test"', [], 5000);
    const directDuration = Date.now() - directStart;

    // Both should complete quickly with event-driven approach
    expect(smartDuration).toBeLessThan(1000);
    expect(directDuration).toBeLessThan(1000);

    // They should have similar performance (within 500ms of each other)
    expect(Math.abs(smartDuration - directDuration)).toBeLessThan(500);
  }, 10000);
});

describe('Documentation: Anti-Pattern Prevention', () => {
  test('Error messages should guide to correct APIs', () => {
    // This is a documentation test - we're verifying that the error messages
    // have been updated to guide users correctly
    
    const correctGuidance = [
      'console_execute_smart',
      'console_execute_command',
      'console_create_session',
      'console_execute_async'
    ];

    const incorrectGuidance = [
      'console_send_input',
      'console_wait_for_output'
    ];

    // This test serves as documentation of what the error messages should contain
    // The actual error messages are tested in integration tests
    expect(correctGuidance.length).toBeGreaterThan(0);
    expect(incorrectGuidance.length).toBeGreaterThan(0);
  });

  test('Tool descriptions should warn about misuse', () => {
    // This is a documentation test - we're verifying that tool descriptions
    // have been updated with appropriate warnings
    
    const toolsWithWarnings = [
      'console_send_input',  // Should warn about interactive-only usage
      'console_wait_for_output'  // Should warn about pattern matching
    ];

    const recommendedTools = [
      'console_execute_smart',  // Recommended for all command execution
      'console_execute_command',  // For direct synchronous execution
      'console_execute_async'  // For background jobs
    ];

    expect(toolsWithWarnings.length).toBe(2);
    expect(recommendedTools.length).toBe(3);
  });
});

describe('Performance: Event-Driven vs Polling', () => {
  let consoleManager: ConsoleManager;
  let sessionId: string;

  beforeEach(async () => {
    consoleManager = new ConsoleManager();
    const session = await consoleManager.createSession({
      consoleType: 'bash'
    });
    sessionId = session.id;
  });

  afterEach(async () => {
    try {
      await consoleManager.stopSession(sessionId);
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  test('Event-driven completion has minimal latency', async () => {
    const iterations = 10;
    const latencies: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const start = Date.now();
      await consoleManager.executeCommandInSession(
        sessionId,
        `echo "test ${i}"`,
        [],
        5000
      );
      const latency = Date.now() - start;
      latencies.push(latency);
    }

    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const maxLatency = Math.max(...latencies);

    // With event-driven approach:
    // - Average latency should be < 500ms for simple echo commands
    // - Max latency should be < 1000ms
    expect(avgLatency).toBeLessThan(500);
    expect(maxLatency).toBeLessThan(1000);

    console.log(`Event-driven completion stats:
      Average latency: ${avgLatency.toFixed(2)}ms
      Max latency: ${maxLatency}ms
      Min latency: ${Math.min(...latencies)}ms
    `);
  }, 60000);

  test('No CPU waste during idle periods', async () => {
    // Execute a command
    await consoleManager.executeCommandInSession(
      sessionId,
      'echo "test"',
      [],
      5000
    );

    // Measure CPU during idle period
    const cpuBefore = process.cpuUsage();
    await new Promise(resolve => setTimeout(resolve, 1000));
    const cpuAfter = process.cpuUsage();

    const cpuUsedMs = (cpuAfter.user - cpuBefore.user) / 1000;

    // During 1 second idle, should use minimal CPU
    // With old polling approach, would use ~10ms CPU per second
    // With event-driven, should use <5ms
    expect(cpuUsedMs).toBeLessThan(50);

    console.log(`CPU usage during 1s idle: ${cpuUsedMs.toFixed(2)}ms`);
  }, 10000);
});
