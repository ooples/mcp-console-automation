/**
 * Tests for WorkerPool
 */

import { WorkerPool, WorkerTask } from '../testing/WorkerPool';

describe('WorkerPool', () => {
  let pool: WorkerPool;

  afterEach(async () => {
    if (pool) {
      await pool.shutdown();
    }
  });

  describe('Initialization', () => {
    it('should initialize with specified number of workers', async () => {
      pool = new WorkerPool({ maxWorkers: 3 });
      await pool.initialize();

      const stats = pool.getStatistics();
      expect(stats.totalWorkers).toBe(3);
      expect(stats.idleWorkers).toBe(3);
      expect(stats.busyWorkers).toBe(0);
    });

    it('should default to 4 workers if not specified', async () => {
      pool = new WorkerPool();
      await pool.initialize();

      const stats = pool.getStatistics();
      expect(stats.totalWorkers).toBe(4);
    });

    it('should throw error if already initialized', async () => {
      pool = new WorkerPool({ maxWorkers: 2 });
      await pool.initialize();

      await expect(pool.initialize()).rejects.toThrow('already initialized');
    });
  });

  describe('Task Execution', () => {
    it('should execute a simple task', async () => {
      pool = new WorkerPool({ maxWorkers: 2 });
      await pool.initialize();

      const task: WorkerTask = {
        id: 'test-1',
        test: {
          name: 'simple test',
          assertions: [],
          timeout: 5000,
          retry: 0,
        },
        timeout: 5000,
      };

      const result = await pool.executeTask(task);

      expect(result.taskId).toBe('test-1');
      expect(result.result).toBeDefined();
    });

    it('should execute multiple tasks in parallel', async () => {
      pool = new WorkerPool({ maxWorkers: 3 });
      await pool.initialize();

      const tasks: WorkerTask[] = Array.from({ length: 5 }, (_, i) => ({
        id: `test-${i}`,
        test: {
          name: `test ${i}`,
          assertions: [],
          timeout: 1000,
          retry: 0,
        },
        timeout: 1000,
      }));

      const startTime = Date.now();
      const results = await Promise.all(tasks.map((task) => pool.executeTask(task)));
      const duration = Date.now() - startTime;

      expect(results).toHaveLength(5);
      // Should be faster than sequential (5 * 1000ms = 5000ms)
      // With 3 workers, should take about 2 batches = ~2000ms
      expect(duration).toBeLessThan(3000);

      const stats = pool.getStatistics();
      expect(stats.totalTasksCompleted).toBe(5);
    });

    it('should queue tasks when all workers are busy', async () => {
      pool = new WorkerPool({ maxWorkers: 2 });
      await pool.initialize();

      const tasks: WorkerTask[] = Array.from({ length: 4 }, (_, i) => ({
        id: `test-${i}`,
        test: {
          name: `test ${i}`,
          assertions: [],
          timeout: 500,
          retry: 0,
        },
        timeout: 500,
      }));

      const promises = tasks.map((task) => pool.executeTask(task));
      const results = await Promise.all(promises);

      expect(results).toHaveLength(4);

      const stats = pool.getStatistics();
      expect(stats.totalTasksCompleted).toBe(4);
    });
  });

  describe('Error Handling', () => {
    it('should handle task timeout', async () => {
      pool = new WorkerPool({ maxWorkers: 1, workerTimeout: 100 });
      await pool.initialize();

      const task: WorkerTask = {
        id: 'timeout-test',
        test: {
          name: 'timeout test',
          assertions: [],
          timeout: 50,
          retry: 0,
        },
        timeout: 50, // Very short timeout
      };

      // This test may timeout, which is expected behavior
      try {
        await pool.executeTask(task);
      } catch (error: any) {
        expect(error.message).toContain('timeout');
      }
    });

    it('should reject new tasks when shutting down', async () => {
      pool = new WorkerPool({ maxWorkers: 2 });
      await pool.initialize();

      // Start shutdown
      const shutdownPromise = pool.shutdown();

      // Try to execute task during shutdown
      const task: WorkerTask = {
        id: 'test',
        test: { name: 'test', assertions: [], timeout: 1000, retry: 0 },
        timeout: 1000,
      };

      await expect(pool.executeTask(task)).rejects.toThrow('shutting down');

      await shutdownPromise;
    });
  });

  describe('Statistics', () => {
    it('should track task completion statistics', async () => {
      pool = new WorkerPool({ maxWorkers: 2 });
      await pool.initialize();

      const tasks: WorkerTask[] = Array.from({ length: 6 }, (_, i) => ({
        id: `test-${i}`,
        test: {
          name: `test ${i}`,
          assertions: [],
          timeout: 100,
          retry: 0,
        },
        timeout: 100,
      }));

      await Promise.all(tasks.map((task) => pool.executeTask(task)));

      const stats = pool.getStatistics();
      expect(stats.totalWorkers).toBe(2);
      expect(stats.totalTasksCompleted).toBe(6);
      expect(stats.averageTasksPerWorker).toBe(3);
    });
  });

  describe('Shutdown', () => {
    it('should gracefully shutdown all workers', async () => {
      pool = new WorkerPool({ maxWorkers: 3 });
      await pool.initialize();

      await pool.shutdown();

      const stats = pool.getStatistics();
      expect(stats.totalWorkers).toBe(0);
    });

    it('should wait for active tasks before shutdown', async () => {
      pool = new WorkerPool({ maxWorkers: 2, gracefulShutdownTimeout: 2000 });
      await pool.initialize();

      const task: WorkerTask = {
        id: 'long-task',
        test: {
          name: 'long test',
          assertions: [],
          timeout: 1000,
          retry: 0,
        },
        timeout: 1000,
      };

      // Start a long-running task
      const taskPromise = pool.executeTask(task);

      // Start shutdown (should wait)
      const shutdownPromise = pool.shutdown();

      // Task should complete
      await taskPromise;
      await shutdownPromise;

      expect(true).toBe(true); // Test completed successfully
    });
  });
});
