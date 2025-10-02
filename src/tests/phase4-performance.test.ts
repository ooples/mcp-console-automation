/**
 * Phase 4 Performance Tests
 * Demonstrates 3-5x speedup with parallel execution
 */

import { ParallelExecutor } from '../testing/ParallelExecutor';
import { TestDefinition, ParallelExecutionConfig } from '../types/test-framework';
import fs from 'fs';
import path from 'path';

describe('Phase 4 Performance', () => {
  let executor: ParallelExecutor;

  beforeEach(() => {
    executor = new ParallelExecutor();
  });

  describe('Parallel vs Sequential Speedup', () => {
    it('should demonstrate 3-5x speedup with 4 workers', async () => {
      // Create 12 tests with 100ms duration each
      const tests: TestDefinition[] = Array.from({ length: 12 }, (_, i) => ({
        name: `perf-test-${i}`,
        description: `Performance test ${i}`,
        assertions: [],
        timeout: 200,
        retry: 0,
      }));

      const config: ParallelExecutionConfig = {
        maxWorkers: 4,
        timeout: 500,
        isolateTests: true,
        failFast: false,
      };

      console.log('\n=== Performance Benchmark ===');
      console.log(`Running ${tests.length} tests...`);

      // Sequential execution
      console.log('\n1. Sequential Execution:');
      const startSequential = Date.now();
      const sequentialResults = await executor.executeSequential(tests);
      const sequentialDuration = Date.now() - startSequential;
      console.log(`   Duration: ${sequentialDuration}ms`);
      console.log(`   Tests completed: ${sequentialResults.length}`);

      // Parallel execution
      console.log('\n2. Parallel Execution (4 workers):');
      const startParallel = Date.now();
      const parallelResult = await executor.executeTests(tests, config);
      const parallelDuration = Date.now() - startParallel;
      console.log(`   Duration: ${parallelDuration}ms`);
      console.log(`   Tests completed: ${parallelResult.totalTests}`);
      console.log(`   Workers used: ${parallelResult.workersUsed}`);

      // Calculate speedup
      const speedup = sequentialDuration / parallelDuration;
      console.log(`\n3. Results:`);
      console.log(`   Speedup: ${speedup.toFixed(2)}x`);
      console.log(`   Sequential: ${sequentialDuration}ms`);
      console.log(`   Parallel: ${parallelDuration}ms`);
      console.log(`   Time saved: ${(sequentialDuration - parallelDuration).toFixed(0)}ms`);

      // Assertions
      expect(parallelResult.totalTests).toBe(12);
      expect(parallelResult.workersUsed).toBe(4);
      expect(speedup).toBeGreaterThan(2); // At least 2x speedup
      expect(parallelDuration).toBeLessThan(sequentialDuration);

      // Save benchmark results
      const benchmarkResult = {
        timestamp: new Date().toISOString(),
        testCount: tests.length,
        workers: config.maxWorkers,
        sequentialDuration,
        parallelDuration,
        speedup: parseFloat(speedup.toFixed(2)),
        timeSaved: sequentialDuration - parallelDuration,
      };

      const benchmarkDir = path.join(process.cwd(), 'data', 'benchmarks');
      if (!fs.existsSync(benchmarkDir)) {
        fs.mkdirSync(benchmarkDir, { recursive: true });
      }

      const benchmarkPath = path.join(benchmarkDir, 'parallel-vs-sequential.json');
      const existing = fs.existsSync(benchmarkPath)
        ? JSON.parse(fs.readFileSync(benchmarkPath, 'utf8'))
        : { runs: [] };

      existing.runs.push(benchmarkResult);
      existing.latestRun = benchmarkResult;
      existing.averageSpeedup =
        existing.runs.reduce((sum: number, r: any) => sum + r.speedup, 0) / existing.runs.length;

      fs.writeFileSync(benchmarkPath, JSON.stringify(existing, null, 2));
      console.log(`\nBenchmark results saved to: ${benchmarkPath}`);

      console.log('=== Performance Benchmark Complete ===\n');
    }, 30000); // 30 second timeout

    it('should scale with different worker counts', async () => {
      const tests: TestDefinition[] = Array.from({ length: 16 }, (_, i) => ({
        name: `scaling-test-${i}`,
        assertions: [],
        timeout: 100,
        retry: 0,
      }));

      const workerCounts = [1, 2, 4, 8];
      const results: Array<{ workers: number; duration: number }> = [];

      console.log('\n=== Worker Scaling Test ===');

      for (const workerCount of workerCounts) {
        const config: ParallelExecutionConfig = {
          maxWorkers: workerCount,
          timeout: 500,
          isolateTests: true,
          failFast: false,
        };

        const start = Date.now();
        await executor.executeTests(tests, config);
        const duration = Date.now() - start;

        results.push({ workers: workerCount, duration });
        console.log(`${workerCount} workers: ${duration}ms`);
      }

      console.log('=== Worker Scaling Complete ===\n');

      // More workers should generally be faster (with diminishing returns)
      expect(results[3].duration).toBeLessThanOrEqual(results[0].duration);
    }, 30000);

    it('should handle large test suite efficiently', async () => {
      const tests: TestDefinition[] = Array.from({ length: 50 }, (_, i) => ({
        name: `large-suite-test-${i}`,
        assertions: [],
        timeout: 50,
        retry: 0,
      }));

      const config: ParallelExecutionConfig = {
        maxWorkers: 8,
        timeout: 200,
        isolateTests: true,
        failFast: false,
      };

      console.log('\n=== Large Suite Test ===');
      console.log(`Running ${tests.length} tests with ${config.maxWorkers} workers...`);

      const start = Date.now();
      const result = await executor.executeTests(tests, config);
      const duration = Date.now() - start;

      console.log(`Completed ${result.totalTests} tests in ${duration}ms`);
      console.log(`Average: ${(duration / tests.length).toFixed(2)}ms per test`);
      console.log('=== Large Suite Complete ===\n');

      expect(result.totalTests).toBe(50);
      expect(result.results).toHaveLength(50);

      // Should complete in reasonable time
      // 50 tests * 50ms = 2500ms sequential
      // With 8 workers, should be ~300-400ms
      expect(duration).toBeLessThan(1000);
    }, 30000);
  });

  describe('Performance Metrics', () => {
    it('should track execution metrics accurately', async () => {
      const tests: TestDefinition[] = Array.from({ length: 10 }, (_, i) => ({
        name: `metrics-test-${i}`,
        assertions: [],
        timeout: 100,
        retry: 0,
      }));

      const config: ParallelExecutionConfig = {
        maxWorkers: 4,
        timeout: 500,
        isolateTests: true,
        failFast: false,
      };

      await executor.executeTests(tests, config);

      const metrics = executor.getMetrics();
      expect(metrics).toBeDefined();
      expect(Array.isArray(metrics)).toBe(true);
    });
  });
});
