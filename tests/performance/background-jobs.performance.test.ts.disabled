/**
 * Performance Tests for Background Job System
 *
 * This test suite validates the performance characteristics of the background job system,
 * including throughput, concurrency limits, memory usage, and scalability under load.
 */

import { JobManager } from '../../src/core/JobManager.js';
import { BackgroundJobOptions } from '../../src/types/index.js';
import { performance } from 'perf_hooks';
import { platform } from 'os';

// Skip performance tests on CI or low-resource environments
const shouldRunPerformanceTests = !process.env.CI && process.env.RUN_PERFORMANCE_TESTS === 'true';
const isWindows = platform() === 'win32';

const describePerformance = shouldRunPerformanceTests ? describe : describe.skip;

describePerformance('Background Jobs Performance Tests', () => {
  let jobManager: JobManager;

  beforeEach(async () => {
    jobManager = new JobManager();
  });

  afterEach(async () => {
    await jobManager.destroy();
  });

  describe('Job Creation Performance', () => {
    test('should create jobs efficiently under load', async () => {
      const jobCount = 1000;
      const startTime = performance.now();

      const promises = [];
      for (let i = 0; i < jobCount; i++) {
        promises.push(
          jobManager.startBackgroundJob(
            isWindows ? 'echo' : 'echo',
            [`job-${i}`]
          )
        );
      }

      const jobIds = await Promise.all(promises);
      const endTime = performance.now();
      const duration = endTime - startTime;
      const jobsPerSecond = (jobCount / duration) * 1000;

      expect(jobIds.length).toBe(jobCount);
      expect(jobsPerSecond).toBeGreaterThan(100); // At least 100 jobs/second
      expect(duration).toBeLessThan(10000); // Should complete within 10 seconds

      console.log(`Created ${jobCount} jobs in ${duration.toFixed(2)}ms (${jobsPerSecond.toFixed(2)} jobs/sec)`);
    }, 30000);

    test('should handle burst creation patterns', async () => {
      const batchSize = 50;
      const batchCount = 10;
      const results = [];

      for (let batch = 0; batch < batchCount; batch++) {
        const startTime = performance.now();

        const promises = [];
        for (let i = 0; i < batchSize; i++) {
          promises.push(
            jobManager.startBackgroundJob(
              isWindows ? 'echo' : 'echo',
              [`batch-${batch}-job-${i}`]
            )
          );
        }

        await Promise.all(promises);
        const endTime = performance.now();
        const batchDuration = endTime - startTime;

        results.push(batchDuration);

        // Small delay between batches to simulate real-world usage
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const avgBatchTime = results.reduce((sum, time) => sum + time, 0) / results.length;
      const maxBatchTime = Math.max(...results);
      const minBatchTime = Math.min(...results);

      expect(avgBatchTime).toBeLessThan(2000); // Average batch should complete within 2 seconds
      expect(maxBatchTime).toBeLessThan(5000); // No batch should take more than 5 seconds

      console.log(`Batch creation: avg=${avgBatchTime.toFixed(2)}ms, min=${minBatchTime.toFixed(2)}ms, max=${maxBatchTime.toFixed(2)}ms`);
    }, 60000);
  });

  describe('Concurrency Performance', () => {
    test('should maintain performance with high concurrency', async () => {
      const concurrentJobs = 100;
      const jobDuration = isWindows ? ['ping', '-n', '2', 'localhost'] : ['sleep', '1'];

      const startTime = performance.now();

      const promises = [];
      for (let i = 0; i < concurrentJobs; i++) {
        promises.push(
          jobManager.startBackgroundJob(jobDuration[0], jobDuration.slice(1))
        );
      }

      const jobIds = await Promise.all(promises);

      // Wait for all jobs to complete
      let completedJobs = 0;
      const checkInterval = setInterval(async () => {
        const metrics = await jobManager.getJobMetrics();
        completedJobs = metrics.completedJobs + metrics.failedJobs + metrics.cancelledJobs;
      }, 500);

      // Wait until all jobs are complete or timeout
      let attempts = 0;
      while (completedJobs < concurrentJobs && attempts < 60) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        attempts++;
      }

      clearInterval(checkInterval);
      const endTime = performance.now();
      const totalDuration = endTime - startTime;

      expect(completedJobs).toBe(concurrentJobs);
      expect(totalDuration).toBeLessThan(30000); // Should complete within 30 seconds

      console.log(`${concurrentJobs} concurrent jobs completed in ${totalDuration.toFixed(2)}ms`);
    }, 90000);

    test('should handle session-based concurrency efficiently', async () => {
      const sessionsCount = 10;
      const jobsPerSession = 20;
      const totalJobs = sessionsCount * jobsPerSession;

      const startTime = performance.now();

      const promises = [];
      for (let session = 0; session < sessionsCount; session++) {
        for (let job = 0; job < jobsPerSession; job++) {
          promises.push(
            jobManager.startBackgroundJob(
              isWindows ? 'echo' : 'echo',
              [`session-${session}-job-${job}`],
              { sessionId: `session-${session}` }
            )
          );
        }
      }

      const jobIds = await Promise.all(promises);
      const creationTime = performance.now() - startTime;

      expect(jobIds.length).toBe(totalJobs);
      expect(creationTime).toBeLessThan(15000); // Creation should be fast

      // Verify session distribution
      const jobs = await jobManager.listJobs();
      const sessionDistribution = new Map<string, number>();

      jobs.forEach(job => {
        const count = sessionDistribution.get(job.sessionId || 'default') || 0;
        sessionDistribution.set(job.sessionId || 'default', count + 1);
      });

      expect(sessionDistribution.size).toBe(sessionsCount);
      sessionDistribution.forEach(count => {
        expect(count).toBe(jobsPerSession);
      });

      console.log(`Created ${totalJobs} jobs across ${sessionsCount} sessions in ${creationTime.toFixed(2)}ms`);
    }, 45000);
  });

  describe('Memory Usage Performance', () => {
    test('should maintain reasonable memory usage during high-volume operations', async () => {
      const measureMemory = () => {
        if (global.gc) {
          global.gc();
        }
        return process.memoryUsage();
      };

      const initialMemory = measureMemory();
      const jobCount = 500;

      // Create many jobs
      const promises = [];
      for (let i = 0; i < jobCount; i++) {
        promises.push(
          jobManager.startBackgroundJob(
            isWindows ? 'echo' : 'echo',
            [`memory-test-${i}`]
          )
        );
      }

      await Promise.all(promises);
      const peakMemory = measureMemory();

      // Wait for jobs to complete
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Clean up completed jobs
      await jobManager.cleanupJobs({ maxAge: 0 });

      const finalMemory = measureMemory();

      const peakIncrease = peakMemory.heapUsed - initialMemory.heapUsed;
      const finalIncrease = finalMemory.heapUsed - initialMemory.heapUsed;

      // Memory increase should be reasonable (less than 100MB for 500 jobs)
      expect(peakIncrease).toBeLessThan(100 * 1024 * 1024);

      // Memory should be mostly reclaimed after cleanup
      expect(finalIncrease).toBeLessThan(peakIncrease * 0.5);

      console.log(`Memory usage - Initial: ${(initialMemory.heapUsed / 1024 / 1024).toFixed(2)}MB, Peak: ${(peakMemory.heapUsed / 1024 / 1024).toFixed(2)}MB, Final: ${(finalMemory.heapUsed / 1024 / 1024).toFixed(2)}MB`);
    }, 30000);
  });

  describe('Queue Performance', () => {
    test('should efficiently manage priority queue operations', async () => {
      const totalJobs = 1000;
      const priorities = [1, 3, 5, 7, 10];

      const startTime = performance.now();

      const promises = [];
      for (let i = 0; i < totalJobs; i++) {
        const priority = priorities[i % priorities.length];
        promises.push(
          jobManager.startBackgroundJob(
            isWindows ? 'echo' : 'echo',
            [`priority-${priority}-job-${i}`],
            { priority }
          )
        );
      }

      await Promise.all(promises);
      const queueTime = performance.now() - startTime;

      const metrics = await jobManager.getJobMetrics();
      expect(metrics.totalJobs).toBe(totalJobs);
      expect(queueTime).toBeLessThan(10000); // Queue operations should be fast

      console.log(`Queued ${totalJobs} jobs with priorities in ${queueTime.toFixed(2)}ms`);
    }, 30000);

    test('should handle rapid queue operations', async () => {
      const operationCount = 500;
      const operations = [];

      // Mix of queue operations
      for (let i = 0; i < operationCount; i++) {
        if (i % 10 === 0) {
          // Every 10th operation is a metrics check
          operations.push(async () => {
            return jobManager.getJobMetrics();
          });
        } else if (i % 15 === 0) {
          // Every 15th operation is a job list
          operations.push(async () => {
            return jobManager.listJobs({ limit: 10 });
          });
        } else {
          // Regular job creation
          operations.push(async () => {
            return jobManager.startBackgroundJob(
              isWindows ? 'echo' : 'echo',
              [`rapid-op-${i}`]
            );
          });
        }
      }

      const startTime = performance.now();
      await Promise.all(operations.map(op => op()));
      const endTime = performance.now();

      const duration = endTime - startTime;
      const opsPerSecond = (operationCount / duration) * 1000;

      expect(opsPerSecond).toBeGreaterThan(50); // At least 50 operations per second
      expect(duration).toBeLessThan(20000); // Should complete within 20 seconds

      console.log(`Performed ${operationCount} mixed operations in ${duration.toFixed(2)}ms (${opsPerSecond.toFixed(2)} ops/sec)`);
    }, 45000);
  });

  describe('Output Handling Performance', () => {
    test('should efficiently handle large output volumes', async () => {
      const command = isWindows ? 'for /L %i in (1,1,1000) do @echo Line %i' : 'for i in {1..1000}; do echo "Line $i"; done';
      const args = isWindows ? [] : ['-c', command];
      const actualCommand = isWindows ? 'cmd' : 'sh';

      const startTime = performance.now();

      const jobId = await jobManager.startBackgroundJob(actualCommand, args);

      // Wait for job to complete
      let job;
      let attempts = 0;
      do {
        await new Promise(resolve => setTimeout(resolve, 1000));
        job = await jobManager.getJobStatus(jobId);
        attempts++;
      } while (job?.status === 'running' && attempts < 30);

      const output = await jobManager.getJobOutput(jobId);
      const endTime = performance.now();

      const duration = endTime - startTime;
      const outputSize = output.stdout.length + output.stderr.length;
      const throughputMBps = (outputSize / (1024 * 1024)) / (duration / 1000);

      expect(job?.status).toBe('completed');
      expect(output.sequences.length).toBeGreaterThan(100);
      expect(outputSize).toBeGreaterThan(1000);
      expect(throughputMBps).toBeGreaterThan(0.1); // At least 0.1 MB/s throughput

      console.log(`Processed ${outputSize} bytes of output in ${duration.toFixed(2)}ms (${throughputMBps.toFixed(2)} MB/s)`);
    }, 60000);

    test('should handle concurrent output streaming', async () => {
      const concurrentJobs = 20;
      const linesPerJob = 100;

      const command = isWindows
        ? `for /L %i in (1,1,${linesPerJob}) do @echo Job output line %i`
        : `for i in {1..${linesPerJob}}; do echo "Job output line $i"; done`;

      const args = isWindows ? [] : ['-c', command];
      const actualCommand = isWindows ? 'cmd' : 'sh';

      const startTime = performance.now();

      // Start concurrent jobs
      const jobPromises = [];
      for (let i = 0; i < concurrentJobs; i++) {
        jobPromises.push(
          jobManager.startBackgroundJob(actualCommand, args)
        );
      }

      const jobIds = await Promise.all(jobPromises);

      // Wait for all jobs to complete
      let allCompleted = false;
      let attempts = 0;
      while (!allCompleted && attempts < 60) {
        await new Promise(resolve => setTimeout(resolve, 1000));

        const statuses = await Promise.all(
          jobIds.map(id => jobManager.getJobStatus(id))
        );

        allCompleted = statuses.every(job =>
          job?.status === 'completed' || job?.status === 'failed'
        );
        attempts++;
      }

      // Get all outputs
      const outputs = await Promise.all(
        jobIds.map(id => jobManager.getJobOutput(id))
      );

      const endTime = performance.now();
      const duration = endTime - startTime;

      const totalOutputSize = outputs.reduce((sum, output) =>
        sum + output.stdout.length + output.stderr.length, 0
      );

      expect(outputs.length).toBe(concurrentJobs);
      expect(totalOutputSize).toBeGreaterThan(concurrentJobs * linesPerJob * 10);
      expect(duration).toBeLessThan(45000); // Should complete within 45 seconds

      console.log(`Processed ${concurrentJobs} concurrent jobs with ${totalOutputSize} bytes total output in ${duration.toFixed(2)}ms`);
    }, 90000);
  });

  describe('Cleanup Performance', () => {
    test('should efficiently cleanup large numbers of completed jobs', async () => {
      const jobCount = 200;

      // Create and complete many jobs
      const promises = [];
      for (let i = 0; i < jobCount; i++) {
        promises.push(
          jobManager.startBackgroundJob(
            isWindows ? 'echo' : 'echo',
            [`cleanup-test-${i}`]
          )
        );
      }

      await Promise.all(promises);

      // Wait for jobs to complete
      await new Promise(resolve => setTimeout(resolve, 5000));

      const startTime = performance.now();
      const cleaned = await jobManager.cleanupJobs({ maxAge: 0 });
      const endTime = performance.now();

      const cleanupDuration = endTime - startTime;
      const jobsPerSecond = (cleaned / cleanupDuration) * 1000;

      expect(cleaned).toBeGreaterThan(0);
      expect(cleanupDuration).toBeLessThan(5000); // Should complete within 5 seconds
      expect(jobsPerSecond).toBeGreaterThan(10); // At least 10 jobs/second cleanup rate

      console.log(`Cleaned up ${cleaned} jobs in ${cleanupDuration.toFixed(2)}ms (${jobsPerSecond.toFixed(2)} jobs/sec)`);
    }, 60000);
  });

  describe('Stress Testing', () => {
    test('should maintain stability under sustained load', async () => {
      const duration = 30000; // 30 seconds
      const jobsPerSecond = 10;
      const interval = 1000 / jobsPerSecond;

      const startTime = performance.now();
      let jobsCreated = 0;
      let errors = 0;

      const createJob = async () => {
        try {
          await jobManager.startBackgroundJob(
            isWindows ? 'echo' : 'echo',
            [`stress-test-${jobsCreated}`]
          );
          jobsCreated++;
        } catch (error) {
          errors++;
          console.warn('Job creation error:', error);
        }
      };

      // Create jobs at regular intervals
      const intervalId = setInterval(createJob, interval);

      // Run for specified duration
      await new Promise(resolve => setTimeout(resolve, duration));
      clearInterval(intervalId);

      const endTime = performance.now();
      const actualDuration = endTime - startTime;
      const actualRate = (jobsCreated / actualDuration) * 1000;

      const metrics = await jobManager.getJobMetrics();

      expect(errors).toBeLessThan(jobsCreated * 0.05); // Less than 5% error rate
      expect(actualRate).toBeGreaterThan(jobsPerSecond * 0.8); // At least 80% of target rate
      expect(metrics.totalJobs).toBe(jobsCreated);

      console.log(`Stress test: ${jobsCreated} jobs created over ${actualDuration.toFixed(2)}ms (${actualRate.toFixed(2)} jobs/sec), ${errors} errors`);
    }, 45000);
  });
});

// Performance benchmarking utilities
export class PerformanceBenchmark {
  private startTime: number = 0;
  private endTime: number = 0;
  private metrics: Map<string, number[]> = new Map();

  start(): void {
    this.startTime = performance.now();
  }

  end(): number {
    this.endTime = performance.now();
    return this.endTime - this.startTime;
  }

  addMetric(name: string, value: number): void {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }
    this.metrics.get(name)!.push(value);
  }

  getStats(name: string): { avg: number; min: number; max: number; count: number } | null {
    const values = this.metrics.get(name);
    if (!values || values.length === 0) return null;

    const avg = values.reduce((sum, val) => sum + val, 0) / values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);

    return { avg, min, max, count: values.length };
  }

  reset(): void {
    this.metrics.clear();
    this.startTime = 0;
    this.endTime = 0;
  }
}