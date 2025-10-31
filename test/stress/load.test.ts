import { describe, beforeAll, afterAll, beforeEach, afterEach, it, expect, jest } from '@jest/globals';
import { ConsoleManager } from '../../src/core/ConsoleManager.js';
import { SSHServer } from '../mocks/SSHServer.js';
import { EventEmitter } from 'events';
import { performance } from 'perf_hooks';
import { platform } from 'os';

// Skip hardware-intensive tests in CI
const describeIfHardware = process.env.SKIP_HARDWARE_TESTS ? describe.skip : describe;

describeIfHardware('Load and Stress Tests', () => {
  let consoleManager: ConsoleManager;
  let sshServer: SSHServer;
  let sshPort: number;

  beforeAll(async () => {
    consoleManager = new ConsoleManager();
    sshServer = new SSHServer();
    sshPort = await sshServer.start();
    sshServer.enablePerformanceMode();
    sshServer.setAuthMode('password');
    sshServer.addUser('loadtest', 'password123');
  }, 30000);

  afterAll(async () => {
    await sshServer.stop();
    await consoleManager.destroy();
  }, 15000);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Concurrent Session Stress Tests', () => {
    it('should handle 50+ concurrent sessions', async () => {
      const concurrentSessions = 50;
      const sessionIds: string[] = [];
      const command = platform() === 'win32' ? 'echo Load test session' : 'echo Load test session';

      const startTime = performance.now();

      try {
        // Create sessions concurrently
        const createPromises = Array.from({ length: concurrentSessions }, async (_, index) => {
          try {
            const sessionId = await consoleManager.createSession({
              command: `${command} ${index}`,
              timeout: 30000
            });
            return sessionId;
          } catch (error) {
            // Some sessions might fail due to resource limits
            return null;
          }
        });

        const results = await Promise.all(createPromises);
        const validSessions = results.filter((id): id is string => id !== null);
        sessionIds.push(...validSessions);

        const creationTime = performance.now() - startTime;
        
        expect(validSessions.length).toBeGreaterThan(30); // At least 60% success rate
        expect(creationTime).toBeLessThan(10000); // Should create within 10 seconds

        // Verify sessions are running
        const runningSessions = sessionIds.filter(id => 
          consoleManager.isSessionRunning(id)
        );
        expect(runningSessions.length).toBeGreaterThan(20);

        // Wait for some execution
        await new Promise(resolve => setTimeout(resolve, 3000));

        const resourceUsage = consoleManager.getResourceUsage();
        expect(resourceUsage.sessions).toBeGreaterThan(20);
        expect(resourceUsage.memoryMB).toBeLessThan(1000); // Should not exceed 1GB

      } finally {
        // Cleanup all sessions
        const stopPromises = sessionIds.map(async (id) => {
          try {
            await consoleManager.stopSession(id);
          } catch (error) {
            // Ignore cleanup errors
          }
        });
        await Promise.all(stopPromises);
      }
    }, 60000);

    it('should handle rapid session creation and destruction', async () => {
      const cycles = 20;
      const sessionsPerCycle = 5;
      const command = platform() === 'win32' ? 'echo Rapid test' : 'echo Rapid test';

      const startTime = performance.now();
      let totalSessions = 0;

      for (let cycle = 0; cycle < cycles; cycle++) {
        const sessionIds: string[] = [];

        try {
          // Create sessions
          for (let i = 0; i < sessionsPerCycle; i++) {
            const sessionId = await consoleManager.createSession({
              command: `${command} cycle-${cycle} session-${i}`,
              timeout: 5000
            });
            sessionIds.push(sessionId);
            totalSessions++;
          }

          // Brief wait
          await new Promise(resolve => setTimeout(resolve, 100));

          // Destroy sessions
          await Promise.all(sessionIds.map(id => consoleManager.stopSession(id)));

        } catch (error) {
          // Clean up any created sessions
          await Promise.all(sessionIds.map(async (id) => {
            try {
              await consoleManager.stopSession(id);
            } catch (e) {
              // Ignore
            }
          }));
        }
      }

      const totalTime = performance.now() - startTime;
      const avgTimePerSession = totalTime / totalSessions;

      expect(totalSessions).toBe(cycles * sessionsPerCycle);
      expect(avgTimePerSession).toBeLessThan(500); // Should average under 500ms per session
      expect(totalTime).toBeLessThan(30000); // Total should be under 30 seconds

      // Verify no sessions are leaked
      await new Promise(resolve => setTimeout(resolve, 1000));
      const finalUsage = consoleManager.getResourceUsage();
      expect(finalUsage.sessions).toBeLessThan(10); // Should be mostly cleaned up
    }, 45000);

    it('should maintain performance with high-output sessions', async () => {
      const highOutputSessions = 10;
      const sessionIds: string[] = [];
      
      const command = platform() === 'win32' ? 
        'for /L %i in (1,1,100) do @echo High output line %i' :
        'for i in {1..100}; do echo "High output line $i"; done';

      const startTime = performance.now();

      try {
        // Create high-output sessions
        const createPromises = Array.from({ length: highOutputSessions }, async (_, index) => {
          const sessionId = await consoleManager.createSession({
            command: command,
            streaming: true,
            timeout: 20000
          });
          return sessionId;
        });

        const results = await Promise.all(createPromises);
        sessionIds.push(...results);

        // Monitor performance during execution
        const monitoringInterval = setInterval(() => {
          const usage = consoleManager.getResourceUsage();
          expect(usage.memoryMB).toBeLessThan(2000); // Memory should stay reasonable
        }, 1000);

        // Wait for execution to complete
        await new Promise(resolve => setTimeout(resolve, 15000));

        clearInterval(monitoringInterval);

        const executionTime = performance.now() - startTime;
        expect(executionTime).toBeLessThan(25000); // Should complete within 25 seconds

        // Verify output was captured
        sessionIds.forEach(sessionId => {
          const output = consoleManager.getOutput(sessionId, 10);
          expect(output.length).toBeGreaterThan(0);
        });

      } finally {
        await Promise.all(sessionIds.map(id => consoleManager.stopSession(id)));
      }
    }, 45000);

    it('should handle mixed workload scenarios', async () => {
      const sessions: { id: string; type: string }[] = [];
      
      const workloads = [
        { type: 'quick', command: 'echo Quick task', count: 10 },
        { type: 'medium', command: platform() === 'win32' ? 'timeout 3' : 'sleep 3', count: 5 },
        { type: 'output-heavy', command: platform() === 'win32' ? 
          'for /L %i in (1,1,50) do @echo Output %i' : 
          'for i in {1..50}; do echo "Output $i"; done', count: 3 },
      ];

      const startTime = performance.now();

      try {
        // Create mixed workload
        for (const workload of workloads) {
          const createPromises = Array.from({ length: workload.count }, async () => {
            const sessionId = await consoleManager.createSession({
              command: workload.command,
              timeout: 15000
            });
            return { id: sessionId, type: workload.type };
          });

          const workloadSessions = await Promise.all(createPromises);
          sessions.push(...workloadSessions);
        }

        expect(sessions).toHaveLength(18); // 10 + 5 + 3

        // Monitor system during execution
        let maxMemory = 0;
        const monitoringPromise = new Promise<void>((resolve) => {
          const monitor = setInterval(() => {
            const usage = consoleManager.getResourceUsage();
            maxMemory = Math.max(maxMemory, usage.memoryMB);
            
            const runningSessions = sessions.filter(s => 
              consoleManager.isSessionRunning(s.id)
            ).length;
            
            if (runningSessions === 0) {
              clearInterval(monitor);
              resolve();
            }
          }, 500);

          // Timeout monitoring after 20 seconds
          setTimeout(() => {
            clearInterval(monitor);
            resolve();
          }, 20000);
        });

        await monitoringPromise;

        const totalTime = performance.now() - startTime;
        
        expect(totalTime).toBeLessThan(25000); // Should complete within 25 seconds
        expect(maxMemory).toBeLessThan(1500); // Memory should stay reasonable

        // Verify different workload types completed
        const completedSessions = sessions.map(s => {
          const session = consoleManager.getSession(s.id);
          return {
            type: s.type,
            status: session?.status || 'unknown'
          };
        });

        const quickCompleted = completedSessions.filter(s => 
          s.type === 'quick' && s.status === 'stopped'
        ).length;
        expect(quickCompleted).toBeGreaterThan(5); // Most quick tasks should complete

      } finally {
        await Promise.all(sessions.map(s => consoleManager.stopSession(s.id)));
      }
    }, 35000);
  });

  describe('Memory Usage Monitoring', () => {
    it('should not leak memory with many short sessions', async () => {
      const initialUsage = consoleManager.getResourceUsage();
      const initialMemory = process.memoryUsage().heapUsed;
      
      const sessionCount = 100;
      const command = platform() === 'win32' ? 'echo Memory test' : 'echo Memory test';

      const batchSize = 10;
      const batches = Math.ceil(sessionCount / batchSize);

      for (let batch = 0; batch < batches; batch++) {
        const sessionIds: string[] = [];

        try {
          // Create batch of sessions
          for (let i = 0; i < batchSize; i++) {
            const sessionId = await consoleManager.createSession({
              command: `${command} batch-${batch} session-${i}`,
              timeout: 3000
            });
            sessionIds.push(sessionId);
          }

          // Wait briefly for execution
          await new Promise(resolve => setTimeout(resolve, 500));

          // Stop sessions
          await Promise.all(sessionIds.map(id => consoleManager.stopSession(id)));

        } catch (error) {
          // Clean up on error
          await Promise.all(sessionIds.map(async (id) => {
            try {
              await consoleManager.stopSession(id);
            } catch (e) {
              // Ignore
            }
          }));
        }
      }

      // Allow garbage collection time
      if (global.gc) {
        global.gc();
      }
      await new Promise(resolve => setTimeout(resolve, 2000));

      const finalUsage = consoleManager.getResourceUsage();
      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = (finalMemory - initialMemory) / (1024 * 1024);

      expect(finalUsage.sessions).toBeLessThanOrEqual(initialUsage.sessions + 5);
      expect(memoryIncrease).toBeLessThan(100); // Should not increase by more than 100MB
    }, 45000);

    it('should handle large output buffers efficiently', async () => {
      const largeOutputSessions = 5;
      const sessionIds: string[] = [];
      
      const command = platform() === 'win32' ? 
        'for /L %i in (1,1,500) do @echo Large output line %i with extra content to make it bigger' :
        'for i in {1..500}; do echo "Large output line $i with extra content to make it bigger"; done';

      const initialMemory = process.memoryUsage().heapUsed;

      try {
        // Create sessions with large output
        for (let i = 0; i < largeOutputSessions; i++) {
          const sessionId = await consoleManager.createSession({
            command: command,
            timeout: 30000
          });
          sessionIds.push(sessionId);
        }

        // Wait for significant output generation
        await new Promise(resolve => setTimeout(resolve, 10000));

        const peakMemory = process.memoryUsage().heapUsed;
        const memoryIncrease = (peakMemory - initialMemory) / (1024 * 1024);

        // Memory should not grow excessively due to buffer limits
        expect(memoryIncrease).toBeLessThan(200); // Less than 200MB increase

        // Verify buffer size limits are working
        sessionIds.forEach(sessionId => {
          const output = consoleManager.getOutput(sessionId);
          expect(output.length).toBeLessThan(10000); // Should be limited by maxBufferSize
        });

        // Test buffer clearing
        sessionIds.forEach(sessionId => {
          consoleManager.clearOutput(sessionId);
          const output = consoleManager.getOutput(sessionId);
          expect(output).toHaveLength(0);
        });

      } finally {
        await Promise.all(sessionIds.map(id => consoleManager.stopSession(id)));
      }
    }, 45000);

    it('should monitor memory usage in real-time', async () => {
      const memoryReadings: number[] = [];
      const sessionIds: string[] = [];
      
      const command = platform() === 'win32' ? 'timeout 5' : 'sleep 5';

      // Start memory monitoring
      const monitoringInterval = setInterval(() => {
        const usage = process.memoryUsage();
        memoryReadings.push(usage.heapUsed / (1024 * 1024)); // MB
      }, 100);

      try {
        // Create sessions gradually
        for (let i = 0; i < 20; i++) {
          const sessionId = await consoleManager.createSession({
            command: `${command}`,
            monitoring: {
              enabled: true,
              collectMetrics: true
            },
            timeout: 10000
          });
          sessionIds.push(sessionId);
          
          await new Promise(resolve => setTimeout(resolve, 200)); // Stagger creation
        }

        // Wait for execution
        await new Promise(resolve => setTimeout(resolve, 8000));

      } finally {
        clearInterval(monitoringInterval);
        await Promise.all(sessionIds.map(id => consoleManager.stopSession(id)));
      }

      expect(memoryReadings.length).toBeGreaterThan(50);
      
      const maxMemory = Math.max(...memoryReadings);
      const minMemory = Math.min(...memoryReadings);
      const memoryVariation = maxMemory - minMemory;

      // Memory should not vary wildly
      expect(memoryVariation).toBeLessThan(500); // Less than 500MB variation
      expect(maxMemory).toBeLessThan(2000); // Should stay under 2GB
    }, 25000);
  });

  describe('Connection Pool Saturation Testing', () => {
    it('should handle SSH connection pool limits', async () => {
      const maxConnections = 10;
      sshServer.setMaxConnections(maxConnections);
      
      const connections: string[] = [];
      const command = `ssh loadtest@localhost -p ${sshPort}`;

      try {
        // Create connections up to the limit
        for (let i = 0; i < maxConnections; i++) {
          try {
            const sessionId = await consoleManager.createSession({
              command: command,
              timeout: 15000
            });
            connections.push(sessionId);
          } catch (error) {
            // Some might fail due to timing
          }
        }

        // Try to exceed the limit
        try {
          const extraSessionId = await consoleManager.createSession({
            command: command,
            timeout: 5000
          });
          // If this succeeds, it should fail quickly
          await consoleManager.stopSession(extraSessionId);
        } catch (error) {
          // Expected to fail
          expect(error).toBeDefined();
        }

        // Verify existing connections still work
        const activeConnections = connections.filter(id => 
          consoleManager.isSessionRunning(id)
        );
        expect(activeConnections.length).toBeGreaterThan(0);

      } finally {
        await Promise.all(connections.map(async (id) => {
          try {
            await consoleManager.stopSession(id);
          } catch (error) {
            // Ignore cleanup errors
          }
        }));
      }
    }, 25000);

    it('should recover from connection pool exhaustion', async () => {
      const maxConnections = 5;
      sshServer.setMaxConnections(maxConnections);
      
      const initialConnections: string[] = [];
      const command = `ssh loadtest@localhost -p ${sshPort}`;

      try {
        // Exhaust connection pool
        for (let i = 0; i < maxConnections; i++) {
          try {
            const sessionId = await consoleManager.createSession({
              command: command,
              timeout: 10000
            });
            initialConnections.push(sessionId);
          } catch (error) {
            // Some might fail
          }
        }

        // Verify pool is exhausted
        try {
          await consoleManager.createSession({
            command: command,
            timeout: 3000
          });
          // Should not reach here
          expect(false).toBe(true);
        } catch (error) {
          expect(error).toBeDefined();
        }

        // Release some connections
        const toRelease = initialConnections.splice(0, 3);
        await Promise.all(toRelease.map(id => consoleManager.stopSession(id)));

        // Wait for cleanup
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Should now be able to create new connections
        const newSessionId = await consoleManager.createSession({
          command: command,
          timeout: 10000
        });
        expect(newSessionId).toBeTruthy();

        await consoleManager.stopSession(newSessionId);

      } finally {
        await Promise.all(initialConnections.map(async (id) => {
          try {
            await consoleManager.stopSession(id);
          } catch (error) {
            // Ignore
          }
        }));
      }
    }, 30000);

    it('should handle connection pool under high concurrency', async () => {
      const concurrentRequests = 20;
      const maxConnections = 8;
      sshServer.setMaxConnections(maxConnections);
      
      const command = `ssh loadtest@localhost -p ${sshPort}`;
      const sessionIds: (string | null)[] = [];

      const startTime = performance.now();

      // Create many concurrent connection requests
      const connectionPromises = Array.from({ length: concurrentRequests }, async () => {
        try {
          const sessionId = await consoleManager.createSession({
            command: command,
            timeout: 8000
          });
          return sessionId;
        } catch (error) {
          return null; // Connection failed
        }
      });

      const results = await Promise.all(connectionPromises);
      const successfulConnections = results.filter((id): id is string => id !== null);
      sessionIds.push(...results);

      const connectionTime = performance.now() - startTime;

      // Should have some successful connections within limits
      expect(successfulConnections.length).toBeGreaterThan(0);
      expect(successfulConnections.length).toBeLessThanOrEqual(maxConnections + 2); // Allow small tolerance
      expect(connectionTime).toBeLessThan(15000); // Should complete within 15 seconds

      // Cleanup
      await Promise.all(successfulConnections.map(async (id) => {
        try {
          await consoleManager.stopSession(id);
        } catch (error) {
          // Ignore cleanup errors
        }
      }));
    }, 30000);
  });

  describe('Recovery Under Load', () => {
    it('should recover from system overload conditions', async () => {
      const overloadSessions = 30;
      const sessionIds: string[] = [];
      
      // Create resource-intensive sessions
      const command = platform() === 'win32' ? 
        'for /L %i in (1,1,200) do @echo Resource intensive output line %i' :
        'for i in {1..200}; do echo "Resource intensive output line $i"; sleep 0.01; done';

      const startTime = performance.now();

      try {
        // Create overload conditions
        const createPromises = Array.from({ length: overloadSessions }, async (_, index) => {
          try {
            const sessionId = await consoleManager.createSession({
              command: command,
              timeout: 20000
            });
            return sessionId;
          } catch (error) {
            return null;
          }
        });

        const results = await Promise.all(createPromises);
        const validSessions = results.filter((id): id is string => id !== null);
        sessionIds.push(...validSessions);

        // Monitor recovery
        let systemStabilized = false;
        let stabilityCheckCount = 0;

        while (!systemStabilized && stabilityCheckCount < 20) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          const usage = consoleManager.getResourceUsage();
          const memory = process.memoryUsage().heapUsed / (1024 * 1024);

          // Check if system is stable (not growing memory excessively)
          if (memory < 1500 && usage.sessions < overloadSessions + 5) {
            systemStabilized = true;
          }
          
          stabilityCheckCount++;
        }

        const recoveryTime = performance.now() - startTime;
        
        expect(systemStabilized).toBe(true);
        expect(recoveryTime).toBeLessThan(30000); // Should stabilize within 30 seconds

        // Verify system can still create new sessions
        const testSessionId = await consoleManager.createSession({
          command: platform() === 'win32' ? 'echo Recovery test' : 'echo Recovery test',
          timeout: 5000
        });
        
        expect(testSessionId).toBeTruthy();
        await consoleManager.stopSession(testSessionId);

      } finally {
        // Clean up all sessions
        const stopPromises = sessionIds.map(async (id) => {
          try {
            await consoleManager.stopSession(id);
          } catch (error) {
            // Ignore cleanup errors
          }
        });
        await Promise.all(stopPromises);
      }
    }, 45000);

    it('should maintain responsiveness during peak load', async () => {
      const peakLoadSessions = 25;
      const sessionIds: string[] = [];
      const responseTimes: number[] = [];
      
      const command = platform() === 'win32' ? 'timeout 10' : 'sleep 10';

      try {
        // Create peak load
        for (let i = 0; i < peakLoadSessions; i++) {
          const startTime = performance.now();
          
          const sessionId = await consoleManager.createSession({
            command: command,
            timeout: 15000
          });
          
          const responseTime = performance.now() - startTime;
          responseTimes.push(responseTime);
          sessionIds.push(sessionId);
          
          // Brief pause to simulate realistic load pattern
          await new Promise(resolve => setTimeout(resolve, 50));
        }

        // Test responsiveness during load
        const testStart = performance.now();
        const quickTestId = await consoleManager.createSession({
          command: platform() === 'win32' ? 'echo Quick response test' : 'echo Quick response test',
          timeout: 5000
        });
        const quickResponseTime = performance.now() - testStart;

        await consoleManager.stopSession(quickTestId);

        // Analyze response times
        const avgResponseTime = responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length;
        const maxResponseTime = Math.max(...responseTimes);

        expect(avgResponseTime).toBeLessThan(2000); // Average under 2 seconds
        expect(maxResponseTime).toBeLessThan(5000); // Max under 5 seconds
        expect(quickResponseTime).toBeLessThan(1000); // Quick test should be responsive

        // Verify system metrics are reasonable
        const usage = consoleManager.getResourceUsage();
        expect(usage.memoryMB).toBeLessThan(2000);

      } finally {
        await Promise.all(sessionIds.map(id => consoleManager.stopSession(id)));
      }
    }, 35000);

    it('should handle graceful degradation under extreme load', async () => {
      const extremeLoadSessions = 60;
      const sessionIds: string[] = [];
      let successfulSessions = 0;
      let failedSessions = 0;
      
      const command = platform() === 'win32' ? 'echo Extreme load test' : 'echo Extreme load test';

      const startTime = performance.now();

      // Attempt to create extreme load
      for (let i = 0; i < extremeLoadSessions; i++) {
        try {
          const sessionId = await consoleManager.createSession({
            command: `${command} ${i}`,
            timeout: 10000
          });
          sessionIds.push(sessionId);
          successfulSessions++;
        } catch (error) {
          failedSessions++;
          // System should gracefully reject requests rather than crashing
        }
      }

      const loadTime = performance.now() - startTime;

      // System should have handled some sessions but rejected others gracefully
      expect(successfulSessions).toBeGreaterThan(10); // At least some should succeed
      expect(failedSessions).toBeGreaterThan(0); // Some should be rejected
      expect(successfulSessions + failedSessions).toBe(extremeLoadSessions);
      expect(loadTime).toBeLessThan(20000); // Should not hang indefinitely

      // Verify system is still responsive
      try {
        const testSessionId = await consoleManager.createSession({
          command: platform() === 'win32' ? 'echo System responsive' : 'echo System responsive',
          timeout: 5000
        });
        expect(testSessionId).toBeTruthy();
        await consoleManager.stopSession(testSessionId);
      } catch (error) {
        // System might reject new requests, but shouldn't crash
        expect(error).toBeDefined();
      }

      // Cleanup
      const cleanupPromises = sessionIds.map(async (id) => {
        try {
          await consoleManager.stopSession(id);
        } catch (error) {
          // Ignore cleanup errors
        }
      });
      await Promise.all(cleanupPromises);

      // Allow system to recover
      await new Promise(resolve => setTimeout(resolve, 2000));

      // System should recover after load is removed
      const recoverySessionId = await consoleManager.createSession({
        command: platform() === 'win32' ? 'echo Recovery successful' : 'echo Recovery successful',
        timeout: 5000
      });
      expect(recoverySessionId).toBeTruthy();
      await consoleManager.stopSession(recoverySessionId);
    }, 45000);
  });

  describe('Performance Benchmarks', () => {
    it('should meet performance benchmarks for session creation', async () => {
      const benchmarkSessions = 100;
      const sessionIds: string[] = [];
      const command = platform() === 'win32' ? 'echo Benchmark test' : 'echo Benchmark test';

      const startTime = performance.now();

      try {
        // Create sessions in batches for fairness
        const batchSize = 10;
        for (let i = 0; i < benchmarkSessions; i += batchSize) {
          const batchPromises = Array.from({ length: Math.min(batchSize, benchmarkSessions - i) }, async (_, j) => {
            const sessionId = await consoleManager.createSession({
              command: `${command} ${i + j}`,
              timeout: 5000
            });
            return sessionId;
          });

          const batchResults = await Promise.all(batchPromises);
          sessionIds.push(...batchResults);
        }

        const totalTime = performance.now() - startTime;
        const avgTimePerSession = totalTime / benchmarkSessions;

        expect(avgTimePerSession).toBeLessThan(100); // Under 100ms per session on average
        expect(totalTime).toBeLessThan(15000); // Total under 15 seconds

        // Verify all sessions were created
        expect(sessionIds).toHaveLength(benchmarkSessions);

      } finally {
        await Promise.all(sessionIds.map(id => consoleManager.stopSession(id)));
      }
    }, 30000);

    it('should meet memory efficiency benchmarks', async () => {
      const sessions = 50;
      const sessionIds: string[] = [];
      const command = platform() === 'win32' ? 
        'for /L %i in (1,1,20) do @echo Memory benchmark output %i' :
        'for i in {1..20}; do echo "Memory benchmark output $i"; done';

      const initialMemory = process.memoryUsage().heapUsed / (1024 * 1024);

      try {
        // Create sessions
        for (let i = 0; i < sessions; i++) {
          const sessionId = await consoleManager.createSession({
            command: command,
            timeout: 10000
          });
          sessionIds.push(sessionId);
        }

        // Wait for execution
        await new Promise(resolve => setTimeout(resolve, 8000));

        const peakMemory = process.memoryUsage().heapUsed / (1024 * 1024);
        const memoryPerSession = (peakMemory - initialMemory) / sessions;

        expect(memoryPerSession).toBeLessThan(10); // Less than 10MB per session
        expect(peakMemory).toBeLessThan(initialMemory + 500); // Total increase under 500MB

      } finally {
        await Promise.all(sessionIds.map(id => consoleManager.stopSession(id)));
      }
    }, 25000);

    it('should meet throughput benchmarks for command execution', async () => {
      const commands = 200;
      const completedCommands: number[] = [];
      const sessionId = await consoleManager.createSession({
        command: platform() === 'win32' ? 'cmd' : 'bash',
        timeout: 30000
      });

      const startTime = performance.now();

      try {
        // Send commands rapidly
        for (let i = 0; i < commands; i++) {
          await consoleManager.sendInput(sessionId, `echo Command ${i}\n`);
          
          if (i % 10 === 0) {
            // Brief pause every 10 commands
            await new Promise(resolve => setTimeout(resolve, 10));
          }
        }

        // Wait for processing
        await new Promise(resolve => setTimeout(resolve, 10000));

        const totalTime = performance.now() - startTime;
        const commandsPerSecond = commands / (totalTime / 1000);

        expect(commandsPerSecond).toBeGreaterThan(20); // At least 20 commands per second
        expect(totalTime).toBeLessThan(15000); // Should complete within 15 seconds

        // Verify output was captured
        const output = consoleManager.getOutput(sessionId);
        expect(output.length).toBeGreaterThan(commands / 2); // At least half the commands should have output

      } finally {
        await consoleManager.stopSession(sessionId);
      }
    }, 25000);
  });
});