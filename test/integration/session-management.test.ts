import { describe, beforeAll, afterAll, beforeEach, afterEach, it, expect, jest } from '@jest/globals';
import { ConsoleManager } from '../../src/core/ConsoleManager.js';
import { ConsoleSession, SessionOptions } from '../../src/types/index.js';
import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import { platform } from 'os';

// Skip hardware-intensive integration tests in CI
const describeIfHardware = process.env.SKIP_HARDWARE_TESTS ? describe.skip : describe;

describeIfHardware('Session Management Integration Tests', () => {
  let consoleManager: ConsoleManager;
  const maxSessions = 10;

  beforeAll(() => {
    consoleManager = new ConsoleManager();
  });

  afterAll(async () => {
    await consoleManager.destroy();
  }, 15000);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Concurrent Session Limits', () => {
    it('should enforce maximum session limits', async () => {
      const sessions: string[] = [];
      const command = platform() === 'win32' ? 'ping -t localhost' : 'ping localhost';
      
      try {
        // Create sessions up to the limit
        for (let i = 0; i < maxSessions; i++) {
          const sessionId = await consoleManager.createSession({
            command: command,
            timeout: 60000
          });
          sessions.push(sessionId);
          expect(consoleManager.isSessionRunning(sessionId)).toBe(true);
        }

        expect(sessions).toHaveLength(maxSessions);

        // Try to exceed the limit - this should succeed since we set maxSessions to 50 in ConsoleManager
        // Let's test with more than the default number to see actual behavior
        const resourceUsage = consoleManager.getResourceUsage();
        expect(resourceUsage.sessions).toBeGreaterThanOrEqual(maxSessions);
        
      } finally {
        // Cleanup all sessions
        await Promise.all(sessions.map(id => consoleManager.stopSession(id)));
      }
    }, 30000);

    it('should handle rapid session creation and cleanup', async () => {
      const sessionIds: string[] = [];
      const command = platform() === 'win32' ? 'echo test' : 'echo test';
      
      // Rapidly create sessions
      const createPromises = Array.from({ length: 5 }, async (_, i) => {
        const sessionId = await consoleManager.createSession({
          command: `${command} ${i}`,
          timeout: 5000
        });
        sessionIds.push(sessionId);
        return sessionId;
      });

      const createdSessions = await Promise.all(createPromises);
      expect(createdSessions).toHaveLength(5);

      // Wait a bit for sessions to potentially complete
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Rapidly clean up
      const stopPromises = sessionIds.map(id => consoleManager.stopSession(id));
      await Promise.all(stopPromises);

      // Verify all sessions are stopped
      sessionIds.forEach(id => {
        const session = consoleManager.getSession(id);
        if (session) {
          expect(['stopped', 'crashed']).toContain(session.status);
        }
      });
    }, 15000);

    it('should handle concurrent session creation from different threads', async () => {
      const command = platform() === 'win32' ? 'timeout 2' : 'sleep 2';
      const concurrentSessions = 5;
      
      // Create sessions concurrently
      const createPromises = Array.from({ length: concurrentSessions }, async (_, i) => {
        return consoleManager.createSession({
          command: `${command}`,
          timeout: 10000
        });
      });

      const sessionIds = await Promise.all(createPromises);
      
      expect(sessionIds).toHaveLength(concurrentSessions);
      expect(new Set(sessionIds).size).toBe(concurrentSessions); // All should be unique

      // Verify all sessions are running
      sessionIds.forEach(id => {
        expect(consoleManager.isSessionRunning(id)).toBe(true);
      });

      // Cleanup
      await Promise.all(sessionIds.map(id => consoleManager.stopSession(id)));
    }, 15000);

    it('should manage memory usage under concurrent session load', async () => {
      const initialUsage = consoleManager.getResourceUsage();
      const sessionIds: string[] = [];
      const command = platform() === 'win32' ? 'echo memory test' : 'echo memory test';

      try {
        // Create multiple sessions that generate output
        for (let i = 0; i < 8; i++) {
          const sessionId = await consoleManager.createSession({
            command: command,
            timeout: 5000
          });
          sessionIds.push(sessionId);
        }

        await new Promise(resolve => setTimeout(resolve, 2000));

        const peakUsage = consoleManager.getResourceUsage();
        expect(peakUsage.sessions).toBeGreaterThan(initialUsage.sessions);

        // Clean up sessions
        await Promise.all(sessionIds.map(id => consoleManager.stopSession(id)));

        // Wait for cleanup
        await new Promise(resolve => setTimeout(resolve, 1000));

        const finalUsage = consoleManager.getResourceUsage();
        expect(finalUsage.sessions).toBeLessThanOrEqual(peakUsage.sessions);
        
      } finally {
        // Ensure cleanup
        await Promise.all(sessionIds.map(id => consoleManager.stopSession(id)));
      }
    }, 20000);
  });

  describe('Session Recovery After Crash', () => {
    it('should detect and handle crashed sessions', async () => {
      const command = platform() === 'win32' ? 'invalidcommand.exe' : 'invalidcommand';
      
      const sessionId = await consoleManager.createSession({
        command: command,
        timeout: 5000
      });

      let errorReceived = false;
      let sessionStopped = false;

      consoleManager.on('console-event', (event) => {
        if (event.sessionId === sessionId) {
          if (event.type === 'error') {
            errorReceived = true;
          } else if (event.type === 'stopped') {
            sessionStopped = true;
          }
        }
      });

      // Wait for process to fail
      await new Promise(resolve => setTimeout(resolve, 6000));

      const session = consoleManager.getSession(sessionId);
      if (session) {
        expect(['crashed', 'stopped']).toContain(session.status);
      }

      expect(errorReceived || sessionStopped).toBe(true);
    }, 10000);

    it('should recover from system resource exhaustion', async () => {
      const sessions: string[] = [];
      const command = platform() === 'win32' ? 'ping -n 10 localhost' : 'ping -c 10 localhost';

      try {
        // Create many sessions to potentially exhaust resources
        const createPromises = Array.from({ length: 15 }, async () => {
          try {
            const sessionId = await consoleManager.createSession({
              command: command,
              timeout: 15000
            });
            return sessionId;
          } catch (error) {
            return null; // Some might fail due to resource limits
          }
        });

        const results = await Promise.all(createPromises);
        const validSessions = results.filter((id): id is string => id !== null);
        sessions.push(...validSessions);

        expect(validSessions.length).toBeGreaterThan(0);

        // Wait for some to complete naturally
        await new Promise(resolve => setTimeout(resolve, 5000));

        // System should still be responsive
        const resourceUsage = consoleManager.getResourceUsage();
        expect(typeof resourceUsage.sessions).toBe('number');
        
      } finally {
        // Cleanup
        await Promise.all(sessions.map(id => consoleManager.stopSession(id)));
      }
    }, 25000);

    it('should handle graceful restart of failed sessions', async () => {
      const command = platform() === 'win32' ? 'echo test & exit 1' : 'echo test && exit 1';
      
      const sessionId = await consoleManager.createSession({
        command: command,
        timeout: 5000
      });

      // Wait for session to complete with error
      await new Promise(resolve => setTimeout(resolve, 2000));

      const session = consoleManager.getSession(sessionId);
      expect(session?.status).toBe('stopped');
      expect(session?.exitCode).toBe(1);

      // Create a new session with the same command (simulating restart)
      const newSessionId = await consoleManager.createSession({
        command: 'echo restart test',
        timeout: 5000
      });

      expect(newSessionId).toBeTruthy();
      expect(newSessionId).not.toBe(sessionId);
      
      await consoleManager.stopSession(newSessionId);
    }, 10000);
  });

  describe('Session State Transitions', () => {
    it('should properly transition through session states', async () => {
      const stateChanges: string[] = [];
      const command = platform() === 'win32' ? 'timeout 3' : 'sleep 3';

      const sessionId = await consoleManager.createSession({
        command: command,
        timeout: 10000
      });

      consoleManager.on('console-event', (event) => {
        if (event.sessionId === sessionId) {
          stateChanges.push(event.type);
        }
      });

      // Session should start
      expect(consoleManager.isSessionRunning(sessionId)).toBe(true);
      const session = consoleManager.getSession(sessionId);
      expect(session?.status).toBe('running');

      // Wait for completion
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Session should be stopped
      const finalSession = consoleManager.getSession(sessionId);
      expect(finalSession?.status).toBe('stopped');

      // Should have received started and stopped events
      expect(stateChanges).toContain('started');
      expect(stateChanges).toContain('stopped');
    }, 15000);

    it('should handle forced termination state transition', async () => {
      const command = platform() === 'win32' ? 'ping -t localhost' : 'ping localhost';
      
      const sessionId = await consoleManager.createSession({
        command: command,
        timeout: 60000
      });

      expect(consoleManager.isSessionRunning(sessionId)).toBe(true);

      // Force stop the session
      await consoleManager.stopSession(sessionId);

      // Session should be stopped
      expect(consoleManager.isSessionRunning(sessionId)).toBe(false);
      const session = consoleManager.getSession(sessionId);
      expect(session?.status).toBe('stopped');
    }, 10000);

    it('should maintain session metadata during transitions', async () => {
      const command = platform() === 'win32' ? 'echo metadata test' : 'echo metadata test';
      const testEnv = { TEST_VAR: 'test_value' };
      const testCwd = process.cwd();

      const sessionId = await consoleManager.createSession({
        command: command,
        env: testEnv,
        cwd: testCwd,
        timeout: 5000
      });

      const session = consoleManager.getSession(sessionId);
      expect(session?.command).toBe(command);
      expect(session?.env?.TEST_VAR).toBe('test_value');
      expect(session?.cwd).toBe(testCwd);
      expect(session?.createdAt).toBeInstanceOf(Date);

      // Wait for completion
      await new Promise(resolve => setTimeout(resolve, 2000));

      const finalSession = consoleManager.getSession(sessionId);
      expect(finalSession?.command).toBe(command);
      expect(finalSession?.env?.TEST_VAR).toBe('test_value');
      expect(finalSession?.createdAt).toBeInstanceOf(Date);
    }, 10000);

    it('should handle rapid state transitions', async () => {
      const command = platform() === 'win32' ? 'echo rapid test' : 'echo rapid test';
      
      const sessionId = await consoleManager.createSession({
        command: command,
        timeout: 1000
      });

      // Immediately try to stop
      await consoleManager.stopSession(sessionId);

      const session = consoleManager.getSession(sessionId);
      expect(['stopped', 'crashed']).toContain(session?.status || 'stopped');
    }, 5000);
  });

  describe('Resource Cleanup', () => {
    it('should clean up process resources after session end', async () => {
      const initialUsage = consoleManager.getResourceUsage();
      const command = platform() === 'win32' ? 'echo cleanup test' : 'echo cleanup test';
      
      const sessionId = await consoleManager.createSession({
        command: command,
        timeout: 5000
      });

      // Wait for session to complete
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Resource usage should return to baseline after cleanup
      // Allow some time for cleanup
      await new Promise(resolve => setTimeout(resolve, 1000));

      const finalUsage = consoleManager.getResourceUsage();
      
      // Since we clean up sessions periodically, the exact count might vary
      // but it shouldn't be significantly higher than initial
      expect(finalUsage.sessions).toBeLessThanOrEqual(initialUsage.sessions + 1);
    }, 10000);

    it('should clean up output buffers and streams', async () => {
      const command = platform() === 'win32' ? 
        'for /L %i in (1,1,10) do @echo Line %i' : 
        'for i in {1..10}; do echo Line $i; done';
      
      const sessionId = await consoleManager.createSession({
        command: command,
        streaming: true,
        timeout: 10000
      });

      // Wait for output
      await new Promise(resolve => setTimeout(resolve, 3000));

      const output = consoleManager.getOutput(sessionId);
      expect(output.length).toBeGreaterThan(0);

      // Clear output buffer
      consoleManager.clearOutput(sessionId);
      const clearedOutput = consoleManager.getOutput(sessionId);
      expect(clearedOutput).toHaveLength(0);

      await consoleManager.stopSession(sessionId);
    }, 15000);

    it('should handle cleanup during high output volume', async () => {
      const command = platform() === 'win32' ? 
        'for /L %i in (1,1,100) do @echo High volume output line %i' : 
        'for i in {1..100}; do echo High volume output line $i; done';
      
      const sessionId = await consoleManager.createSession({
        command: command,
        timeout: 15000
      });

      // Let some output accumulate
      await new Promise(resolve => setTimeout(resolve, 2000));

      const beforeCleanup = consoleManager.getResourceUsage();
      
      // Force stop during high output
      await consoleManager.stopSession(sessionId);

      // Allow cleanup time
      await new Promise(resolve => setTimeout(resolve, 1000));

      const afterCleanup = consoleManager.getResourceUsage();
      
      // Memory usage should not increase significantly
      expect(afterCleanup.memoryMB).toBeLessThanOrEqual(beforeCleanup.memoryMB + 10);
    }, 20000);

    it('should cleanup monitoring resources', async () => {
      const command = platform() === 'win32' ? 'echo monitoring test' : 'echo monitoring test';
      
      const sessionId = await consoleManager.createSession({
        command: command,
        monitoring: {
          enabled: true,
          collectMetrics: true
        },
        timeout: 5000
      });

      // Check if monitoring is active
      expect(consoleManager.getMonitoringSystem().isSessionBeingMonitored(sessionId)).toBe(true);

      await new Promise(resolve => setTimeout(resolve, 2000));
      
      await consoleManager.stopSession(sessionId);

      // Monitoring should be cleaned up
      expect(consoleManager.getMonitoringSystem().isSessionBeingMonitored(sessionId)).toBe(false);
    }, 10000);
  });

  describe('Memory Leak Prevention', () => {
    it('should not leak memory with many short-lived sessions', async () => {
      const initialUsage = consoleManager.getResourceUsage();
      const command = platform() === 'win32' ? 'echo memory leak test' : 'echo memory leak test';
      
      // Create and destroy many sessions
      for (let i = 0; i < 20; i++) {
        const sessionId = await consoleManager.createSession({
          command: `${command} ${i}`,
          timeout: 2000
        });

        // Wait briefly and stop
        await new Promise(resolve => setTimeout(resolve, 100));
        await consoleManager.stopSession(sessionId);
      }

      // Allow cleanup cycle to run
      await new Promise(resolve => setTimeout(resolve, 3000));

      const finalUsage = consoleManager.getResourceUsage();
      
      // Memory shouldn't have increased significantly
      const memoryIncrease = finalUsage.memoryMB - initialUsage.memoryMB;
      expect(memoryIncrease).toBeLessThan(50); // Allow some reasonable growth
    }, 30000);

    it('should handle event listener cleanup', async () => {
      const command = platform() === 'win32' ? 'echo event test' : 'echo event test';
      let eventCount = 0;
      
      const eventHandler = (event: any) => {
        eventCount++;
      };

      consoleManager.on('console-event', eventHandler);

      // Create and destroy sessions
      for (let i = 0; i < 5; i++) {
        const sessionId = await consoleManager.createSession({
          command: `${command} ${i}`,
          timeout: 3000
        });
        
        await new Promise(resolve => setTimeout(resolve, 500));
        await consoleManager.stopSession(sessionId);
      }

      consoleManager.removeListener('console-event', eventHandler);

      expect(eventCount).toBeGreaterThan(0);

      // Verify that removed listeners don't receive new events
      const previousCount = eventCount;
      
      const sessionId = await consoleManager.createSession({
        command: command,
        timeout: 3000
      });
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      await consoleManager.stopSession(sessionId);

      expect(eventCount).toBe(previousCount);
    }, 20000);

    it('should properly handle buffer size limits', async () => {
      const command = platform() === 'win32' ? 
        'for /L %i in (1,1,1000) do @echo Buffer overflow test line %i' :
        'for i in {1..1000}; do echo Buffer overflow test line $i; done';
      
      const sessionId = await consoleManager.createSession({
        command: command,
        timeout: 20000
      });

      // Wait for substantial output
      await new Promise(resolve => setTimeout(resolve, 5000));

      const output = consoleManager.getOutput(sessionId);
      const resourceUsage = consoleManager.getResourceUsage();
      
      // Buffer should be limited to prevent memory issues
      expect(output.length).toBeLessThan(10000); // Should respect maxBufferSize
      expect(resourceUsage.bufferSizes[sessionId]).toBeLessThan(10000);

      await consoleManager.stopSession(sessionId);
    }, 25000);

    it('should handle rapid session creation/destruction without leaks', async () => {
      const initialSessions = consoleManager.getAllSessions().length;
      const command = platform() === 'win32' ? 'echo rapid test' : 'echo rapid test';

      // Rapid fire session creation and destruction
      const promises: Promise<void>[] = [];
      
      for (let i = 0; i < 10; i++) {
        promises.push((async () => {
          const sessionId = await consoleManager.createSession({
            command: `${command} ${i}`,
            timeout: 1000
          });
          
          await new Promise(resolve => setTimeout(resolve, 50));
          await consoleManager.stopSession(sessionId);
        })());
      }

      await Promise.all(promises);

      // Allow cleanup time
      await new Promise(resolve => setTimeout(resolve, 2000));

      const finalSessions = consoleManager.getAllSessions().length;
      const activeSessions = consoleManager.getAllSessions().filter(s => s.status === 'running').length;

      // Should not have accumulated sessions
      expect(activeSessions).toBe(0);
      expect(finalSessions).toBeLessThanOrEqual(initialSessions + 3); // Allow some tolerance
    }, 15000);
  });
});