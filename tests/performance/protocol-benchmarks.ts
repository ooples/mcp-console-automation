/**
 * Protocol Performance Benchmarks
 * Production-ready performance testing suite for all protocols
 */

import { performance } from 'perf_hooks';
import { describe, test, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { DockerProtocol } from '../../src/protocols/DockerProtocol.js';
import { WSLProtocol } from '../../src/protocols/WSLProtocol.js';
import { KubernetesProtocol } from '../../src/protocols/KubernetesProtocol.js';
import { SerialProtocol } from '../../src/protocols/SerialProtocol.js';
import { SFTPProtocol } from '../../src/protocols/SFTPProtocol.js';
import { AWSSSMProtocol } from '../../src/protocols/AWSSSMProtocol.js';
import { MockTestServerFactory } from '../utils/protocol-mocks.js';
import { TestServerManager } from '../utils/test-servers.js';

interface BenchmarkResult {
  protocol: string;
  operation: string;
  iterations: number;
  totalTime: number;
  averageTime: number;
  minTime: number;
  maxTime: number;
  throughput: number;
  memoryUsage: {
    before: NodeJS.MemoryUsage;
    after: NodeJS.MemoryUsage;
    delta: NodeJS.MemoryUsage;
  };
  cpuUsage?: {
    before: NodeJS.CpuUsage;
    after: NodeJS.CpuUsage;
    delta: NodeJS.CpuUsage;
  };
}

interface ProtocolBenchmarkSuite {
  protocol: any;
  name: string;
  config: any;
  sessionCount: number;
  operations: Array<{
    name: string;
    setup?: () => Promise<any>;
    execute: (context?: any) => Promise<any>;
    cleanup?: (context?: any) => Promise<void>;
    iterations: number;
    concurrency?: number;
  }>;
}

class PerformanceBenchmark {
  private results: BenchmarkResult[] = [];
  private mockFactory: MockTestServerFactory;
  private testServerManager: TestServerManager;

  constructor() {
    this.mockFactory = new MockTestServerFactory();
    this.testServerManager = new TestServerManager();
  }

  async measureOperation<T>(
    protocol: string,
    operation: string,
    iterations: number,
    executor: () => Promise<T>
  ): Promise<BenchmarkResult> {
    const times: number[] = [];
    
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
    
    const memoryBefore = process.memoryUsage();
    const cpuBefore = process.cpuUsage();
    
    const startTime = performance.now();
    
    for (let i = 0; i < iterations; i++) {
      const operationStart = performance.now();
      await executor();
      const operationEnd = performance.now();
      times.push(operationEnd - operationStart);
    }
    
    const endTime = performance.now();
    const cpuAfter = process.cpuUsage(cpuBefore);
    const memoryAfter = process.memoryUsage();
    
    const totalTime = endTime - startTime;
    const averageTime = totalTime / iterations;
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const throughput = iterations / (totalTime / 1000); // operations per second
    
    const result: BenchmarkResult = {
      protocol,
      operation,
      iterations,
      totalTime,
      averageTime,
      minTime,
      maxTime,
      throughput,
      memoryUsage: {
        before: memoryBefore,
        after: memoryAfter,
        delta: {
          rss: memoryAfter.rss - memoryBefore.rss,
          heapTotal: memoryAfter.heapTotal - memoryBefore.heapTotal,
          heapUsed: memoryAfter.heapUsed - memoryBefore.heapUsed,
          external: memoryAfter.external - memoryBefore.external,
          arrayBuffers: memoryAfter.arrayBuffers - memoryBefore.arrayBuffers
        }
      },
      cpuUsage: {
        before: cpuBefore,
        after: cpuAfter,
        delta: cpuAfter
      }
    };

    this.results.push(result);
    return result;
  }

  async measureConcurrentOperations<T>(
    protocol: string,
    operation: string,
    concurrency: number,
    iterations: number,
    executor: () => Promise<T>
  ): Promise<BenchmarkResult> {
    const times: number[] = [];
    
    if (global.gc) {
      global.gc();
    }
    
    const memoryBefore = process.memoryUsage();
    const cpuBefore = process.cpuUsage();
    
    const startTime = performance.now();
    
    // Execute operations in batches based on concurrency level
    const totalBatches = Math.ceil(iterations / concurrency);
    
    for (let batch = 0; batch < totalBatches; batch++) {
      const batchSize = Math.min(concurrency, iterations - batch * concurrency);
      const batchPromises: Promise<void>[] = [];
      
      for (let i = 0; i < batchSize; i++) {
        const operationPromise = (async () => {
          const operationStart = performance.now();
          await executor();
          const operationEnd = performance.now();
          times.push(operationEnd - operationStart);
        })();
        
        batchPromises.push(operationPromise);
      }
      
      await Promise.all(batchPromises);
    }
    
    const endTime = performance.now();
    const cpuAfter = process.cpuUsage(cpuBefore);
    const memoryAfter = process.memoryUsage();
    
    const totalTime = endTime - startTime;
    const averageTime = totalTime / iterations;
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const throughput = iterations / (totalTime / 1000);
    
    const result: BenchmarkResult = {
      protocol: `${protocol} (${concurrency}x concurrent)`,
      operation,
      iterations,
      totalTime,
      averageTime,
      minTime,
      maxTime,
      throughput,
      memoryUsage: {
        before: memoryBefore,
        after: memoryAfter,
        delta: {
          rss: memoryAfter.rss - memoryBefore.rss,
          heapTotal: memoryAfter.heapTotal - memoryBefore.heapTotal,
          heapUsed: memoryAfter.heapUsed - memoryBefore.heapUsed,
          external: memoryAfter.external - memoryBefore.external,
          arrayBuffers: memoryAfter.arrayBuffers - memoryBefore.arrayBuffers
        }
      },
      cpuUsage: {
        before: cpuBefore,
        after: cpuAfter,
        delta: cpuAfter
      }
    };

    this.results.push(result);
    return result;
  }

  getResults(): BenchmarkResult[] {
    return [...this.results];
  }

  generateReport(): string {
    let report = '\n=== PROTOCOL PERFORMANCE BENCHMARK REPORT ===\n\n';
    
    // Group results by protocol
    const protocolGroups = this.results.reduce((groups, result) => {
      if (!groups[result.protocol]) {
        groups[result.protocol] = [];
      }
      groups[result.protocol].push(result);
      return groups;
    }, {} as Record<string, BenchmarkResult[]>);

    for (const [protocol, results] of Object.entries(protocolGroups)) {
      report += `## ${protocol} Protocol\n`;
      report += '| Operation | Iterations | Total Time (ms) | Avg Time (ms) | Min/Max (ms) | Throughput (ops/sec) | Memory Delta (MB) |\n';
      report += '|-----------|------------|-----------------|---------------|--------------|---------------------|-------------------|\n';
      
      for (const result of results) {
        const memoryDeltaMB = (result.memoryUsage.delta.heapUsed / 1024 / 1024).toFixed(2);
        report += `| ${result.operation} | ${result.iterations} | ${result.totalTime.toFixed(2)} | ${result.averageTime.toFixed(2)} | ${result.minTime.toFixed(2)}/${result.maxTime.toFixed(2)} | ${result.throughput.toFixed(2)} | ${memoryDeltaMB} |\n`;
      }
      
      report += '\n';
    }

    // Performance summary
    report += '## Performance Summary\n\n';
    
    // Find fastest and slowest operations
    const sortedByThroughput = [...this.results].sort((a, b) => b.throughput - a.throughput);
    
    report += `**Fastest Operation:** ${sortedByThroughput[0].protocol} - ${sortedByThroughput[0].operation} (${sortedByThroughput[0].throughput.toFixed(2)} ops/sec)\n`;
    report += `**Slowest Operation:** ${sortedByThroughput[sortedByThroughput.length - 1].protocol} - ${sortedByThroughput[sortedByThroughput.length - 1].operation} (${sortedByThroughput[sortedByThroughput.length - 1].throughput.toFixed(2)} ops/sec)\n\n`;

    // Memory usage analysis
    const memoryIntensive = [...this.results].sort((a, b) => b.memoryUsage.delta.heapUsed - a.memoryUsage.delta.heapUsed);
    const memoryDeltaMB = (memoryIntensive[0].memoryUsage.delta.heapUsed / 1024 / 1024).toFixed(2);
    
    report += `**Most Memory Intensive:** ${memoryIntensive[0].protocol} - ${memoryIntensive[0].operation} (+${memoryDeltaMB} MB)\n\n`;

    return report;
  }
}

describe('Protocol Performance Benchmarks', () => {
  let benchmark: PerformanceBenchmark;
  let protocols: Record<string, any> = {};

  beforeAll(async () => {
    benchmark = new PerformanceBenchmark();

    // Initialize all protocol instances for benchmarking
    protocols.docker = new DockerProtocol({
      connection: { host: '127.0.0.1', port: 2376, timeout: 30000 },
      healthCheck: { enabled: false }, // Disable for benchmarking
      logStreaming: { enabled: false },
      monitoring: { enableMetrics: false },
      autoCleanup: true,
      maxContainers: 100,
      containerDefaults: { image: 'busybox' }
    });

    protocols.wsl = new WSLProtocol({
      defaultDistribution: 'Ubuntu',
      timeout: 30000,
      maxSessions: 50,
      autoStartDistributions: false,
      monitoring: { enableMetrics: false }
    });

    protocols.k8s = new KubernetesProtocol({
      kubeconfig: {
        clusters: [{ name: 'test', cluster: { server: 'https://localhost:6443' } }],
        contexts: [{ name: 'test', context: { cluster: 'test', user: 'test' } }],
        users: [{ name: 'test', user: {} }],
        'current-context': 'test'
      },
      defaultNamespace: 'default',
      timeout: 30000,
      monitoring: { enableMetrics: false }
    });
  }, 30000);

  afterAll(async () => {
    // Cleanup all protocols
    for (const protocol of Object.values(protocols)) {
      try {
        await protocol.cleanup();
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  });

  beforeEach(() => {
    // Force garbage collection between tests if available
    if (global.gc) {
      global.gc();
    }
  });

  describe('Session Creation Performance', () => {
    test('Docker session creation benchmark', async () => {
      const result = await benchmark.measureOperation(
        'Docker',
        'createSession',
        50,
        async () => {
          const session = await protocols.docker.createSession({
            command: '/bin/echo',
            args: ['test'],
            consoleType: 'docker',
            dockerContainerOptions: {
              image: 'busybox',
              hostConfig: { autoRemove: true }
            }
          });
          
          // Clean up immediately to avoid resource accumulation
          await protocols.docker.stopSession(session.id, { force: true });
          return session;
        }
      );

      expect(result.throughput).toBeGreaterThan(1); // At least 1 session/sec
      expect(result.averageTime).toBeLessThan(5000); // Less than 5 seconds per session
      
      console.log(`Docker Session Creation: ${result.throughput.toFixed(2)} ops/sec, ${result.averageTime.toFixed(2)}ms avg`);
    }, 300000);

    test('WSL session creation benchmark', async () => {
      const result = await benchmark.measureOperation(
        'WSL',
        'createSession',
        30,
        async () => {
          const session = await protocols.wsl.createSession({
            command: '/bin/echo',
            args: ['test'],
            consoleType: 'wsl',
            distribution: 'Ubuntu'
          });
          
          await protocols.wsl.terminateSession(session.id);
          return session;
        }
      );

      expect(result.throughput).toBeGreaterThan(2); // At least 2 sessions/sec
      expect(result.averageTime).toBeLessThan(3000); // Less than 3 seconds per session
      
      console.log(`WSL Session Creation: ${result.throughput.toFixed(2)} ops/sec, ${result.averageTime.toFixed(2)}ms avg`);
    }, 180000);

    test('Kubernetes session creation benchmark', async () => {
      const result = await benchmark.measureOperation(
        'Kubernetes',
        'createSession',
        20,
        async () => {
          const session = await protocols.k8s.createSession({
            command: '/bin/echo',
            args: ['test'],
            consoleType: 'kubernetes',
            podName: 'test-pod',
            namespace: 'default',
            containerName: 'main'
          });
          
          await protocols.k8s.terminateSession(session.id);
          return session;
        }
      );

      expect(result.throughput).toBeGreaterThan(1); // At least 1 session/sec
      expect(result.averageTime).toBeLessThan(4000); // Less than 4 seconds per session
      
      console.log(`Kubernetes Session Creation: ${result.throughput.toFixed(2)} ops/sec, ${result.averageTime.toFixed(2)}ms avg`);
    }, 120000);
  });

  describe('Command Execution Performance', () => {
    test('Docker command execution benchmark', async () => {
      // Create a session first
      const session = await protocols.docker.createSession({
        command: '/bin/bash',
        consoleType: 'docker',
        dockerContainerOptions: {
          image: 'busybox',
          hostConfig: { autoRemove: true }
        }
      });

      const result = await benchmark.measureOperation(
        'Docker',
        'executeCommand',
        100,
        async () => {
          return protocols.docker.executeCommand(session.id, 'echo "benchmark test"');
        }
      );

      expect(result.throughput).toBeGreaterThan(5); // At least 5 commands/sec
      expect(result.averageTime).toBeLessThan(1000); // Less than 1 second per command
      
      console.log(`Docker Command Execution: ${result.throughput.toFixed(2)} ops/sec, ${result.averageTime.toFixed(2)}ms avg`);

      // Cleanup
      await protocols.docker.stopSession(session.id, { force: true });
    }, 120000);

    test('Concurrent command execution benchmark', async () => {
      // Create multiple sessions
      const sessions = await Promise.all(
        Array.from({ length: 5 }, async () => {
          return protocols.docker.createSession({
            command: '/bin/bash',
            consoleType: 'docker',
            dockerContainerOptions: {
              image: 'busybox',
              hostConfig: { autoRemove: true }
            }
          });
        })
      );

      let sessionIndex = 0;
      const result = await benchmark.measureConcurrentOperations(
        'Docker',
        'executeCommand',
        5, // 5 concurrent operations
        50, // 50 total operations
        async () => {
          const session = sessions[sessionIndex % sessions.length];
          sessionIndex++;
          return protocols.docker.executeCommand(session.id, `echo "concurrent test ${sessionIndex}"`);
        }
      );

      expect(result.throughput).toBeGreaterThan(10); // At least 10 commands/sec with concurrency
      
      console.log(`Docker Concurrent Command Execution: ${result.throughput.toFixed(2)} ops/sec, ${result.averageTime.toFixed(2)}ms avg`);

      // Cleanup
      await Promise.all(sessions.map(session => 
        protocols.docker.stopSession(session.id, { force: true })
      ));
    }, 180000);
  });

  describe('Data Transfer Performance', () => {
    test('Large data transfer benchmark', async () => {
      const session = await protocols.docker.createSession({
        command: '/bin/bash',
        consoleType: 'docker',
        dockerContainerOptions: {
          image: 'busybox',
          hostConfig: { autoRemove: true }
        }
      });

      const largeData = 'A'.repeat(10000); // 10KB of data
      
      const result = await benchmark.measureOperation(
        'Docker',
        'largeDataTransfer',
        20,
        async () => {
          return protocols.docker.executeCommand(session.id, `echo "${largeData}"`);
        }
      );

      const throughputMBps = (result.throughput * largeData.length / 1024 / 1024).toFixed(2);
      
      console.log(`Docker Large Data Transfer: ${throughputMBps} MB/s, ${result.averageTime.toFixed(2)}ms avg`);
      
      expect(result.throughput).toBeGreaterThan(1); // At least 1 transfer/sec

      await protocols.docker.stopSession(session.id, { force: true });
    }, 60000);

    test('Stream processing benchmark', async () => {
      const session = await protocols.docker.createSession({
        command: '/bin/bash',
        consoleType: 'docker',
        streaming: true,
        dockerContainerOptions: {
          image: 'busybox',
          hostConfig: { autoRemove: true }
        }
      });

      let outputCount = 0;
      protocols.docker.on('output', () => {
        outputCount++;
      });

      const result = await benchmark.measureOperation(
        'Docker',
        'streamProcessing',
        50,
        async () => {
          return protocols.docker.executeCommand(session.id, 'for i in $(seq 1 10); do echo "stream $i"; done');
        }
      );

      console.log(`Docker Stream Processing: ${result.throughput.toFixed(2)} ops/sec, ${outputCount} outputs received`);
      
      expect(outputCount).toBeGreaterThan(100); // Should receive many outputs
      expect(result.throughput).toBeGreaterThan(2);

      await protocols.docker.stopSession(session.id, { force: true });
    }, 120000);
  });

  describe('Resource Usage Benchmarks', () => {
    test('Memory usage under load', async () => {
      const initialMemory = process.memoryUsage();
      
      // Create many sessions rapidly
      const sessions = [];
      for (let i = 0; i < 20; i++) {
        const session = await protocols.docker.createSession({
          command: '/bin/sleep',
          args: ['30'],
          consoleType: 'docker',
          dockerContainerOptions: {
            image: 'busybox',
            hostConfig: { autoRemove: true }
          }
        });
        sessions.push(session);
      }

      const peakMemory = process.memoryUsage();
      const memoryIncreaseMB = (peakMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024;

      console.log(`Memory usage increase with 20 Docker sessions: ${memoryIncreaseMB.toFixed(2)} MB`);
      
      // Should not use excessive memory
      expect(memoryIncreaseMB).toBeLessThan(200); // Less than 200MB increase

      // Cleanup
      await Promise.all(sessions.map(session => 
        protocols.docker.stopSession(session.id, { force: true })
      ));

      // Wait for cleanup and force GC
      await new Promise(resolve => setTimeout(resolve, 2000));
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage();
      const memoryAfterCleanupMB = (finalMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024;
      
      console.log(`Memory usage after cleanup: ${memoryAfterCleanupMB.toFixed(2)} MB increase`);
      
      // Should return close to original memory usage
      expect(memoryAfterCleanupMB).toBeLessThan(50); // Less than 50MB permanent increase
    }, 300000);

    test('CPU usage under concurrent load', async () => {
      const cpuBefore = process.cpuUsage();
      
      // Run multiple concurrent operations
      const promises = Array.from({ length: 10 }, async (_, i) => {
        const session = await protocols.docker.createSession({
          command: '/bin/bash',
          consoleType: 'docker',
          dockerContainerOptions: {
            image: 'busybox',
            hostConfig: { autoRemove: true }
          }
        });

        // Execute multiple commands concurrently
        const commandPromises = Array.from({ length: 10 }, (_, j) => 
          protocols.docker.executeCommand(session.id, `echo "CPU test ${i}-${j}"`)
        );

        await Promise.all(commandPromises);
        await protocols.docker.stopSession(session.id, { force: true });
      });

      await Promise.all(promises);
      
      const cpuAfter = process.cpuUsage(cpuBefore);
      const cpuUsageMs = (cpuAfter.user + cpuAfter.system) / 1000;
      
      console.log(`CPU usage for concurrent operations: ${cpuUsageMs.toFixed(2)}ms`);
      
      // Should not consume excessive CPU time
      expect(cpuUsageMs).toBeLessThan(30000); // Less than 30 seconds total CPU time
    }, 180000);
  });

  describe('Protocol Comparison', () => {
    test('Session creation speed comparison', async () => {
      const protocols_to_test = [
        { name: 'Docker', protocol: protocols.docker, sessionOptions: { 
          command: '/bin/echo', 
          consoleType: 'docker',
          dockerContainerOptions: { image: 'busybox', hostConfig: { autoRemove: true } }
        }},
        { name: 'WSL', protocol: protocols.wsl, sessionOptions: { 
          command: '/bin/echo', 
          consoleType: 'wsl',
          distribution: 'Ubuntu'
        }}
      ];

      const results = [];

      for (const { name, protocol, sessionOptions } of protocols_to_test) {
        const result = await benchmark.measureOperation(
          name,
          'sessionCreationComparison',
          10,
          async () => {
            const session = await protocol.createSession(sessionOptions);
            await protocol.stopSession?.(session.id, { force: true }) || protocol.terminateSession?.(session.id);
            return session;
          }
        );

        results.push({ name, throughput: result.throughput, avgTime: result.averageTime });
      }

      // Log comparison
      console.log('\nSession Creation Speed Comparison:');
      results.sort((a, b) => b.throughput - a.throughput);
      results.forEach((result, index) => {
        console.log(`${index + 1}. ${result.name}: ${result.throughput.toFixed(2)} ops/sec (${result.avgTime.toFixed(2)}ms avg)`);
      });

      expect(results.length).toBeGreaterThan(0);
    }, 240000);
  });

  afterAll(() => {
    // Generate and display performance report
    const report = benchmark.generateReport();
    console.log(report);

    // Save report to file
    const fs = require('fs');
    const path = require('path');
    
    const reportPath = path.join(__dirname, '..', '..', 'performance-report.md');
    fs.writeFileSync(reportPath, report);
    
    console.log(`\nPerformance report saved to: ${reportPath}`);
  });
});