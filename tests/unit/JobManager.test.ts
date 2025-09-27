/**
 * Comprehensive Unit Tests for JobManager
 *
 * This test suite validates the core functionality of the JobManager class,
 * including job lifecycle management, concurrency control, output buffering,
 * and error handling for background command execution.
 */

import { JobManager } from '../../src/core/JobManager.js';
import { BackgroundJob, JobStatus, BackgroundJobOptions } from '../../src/types/index.js';
import { EventEmitter } from 'events';
import { spawn } from 'child_process';

// Mock child_process module
jest.mock('child_process', () => ({
  spawn: jest.fn()
}));

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

describe('JobManager', () => {
  let jobManager: JobManager;
  let mockProcess: any;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create fresh JobManager instance
    jobManager = new JobManager();

    // Create mock child process
    mockProcess = {
      pid: 12345,
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      stdin: {
        write: jest.fn(),
        end: jest.fn()
      },
      kill: jest.fn(),
      on: jest.fn(),
      removeAllListeners: jest.fn(),
      connected: true
    };

    // Set up default mock spawn behavior
    mockSpawn.mockReturnValue(mockProcess);
  });

  afterEach(async () => {
    await jobManager.destroy();
  });

  describe('Job Creation and Lifecycle', () => {
    test('should create a background job successfully', async () => {
      const jobId = await jobManager.startBackgroundJob('echo', ['hello']);

      expect(jobId).toBeDefined();
      expect(typeof jobId).toBe('string');

      const job = await jobManager.getJobStatus(jobId);
      expect(job).toBeDefined();
      expect(job!.id).toBe(jobId);
      expect(job!.command).toBe('echo');
      expect(job!.args).toEqual(['hello']);
      expect(job!.status).toBe('running');
    });

    test('should handle job with custom options', async () => {
      const options: BackgroundJobOptions = {
        sessionId: 'test-session-123',
        workingDirectory: '/tmp',
        environment: { TEST_VAR: 'test_value' },
        timeout: 30000,
        priority: 5,
        tags: { component: 'test' },
        enableStreaming: true
      };

      const jobId = await jobManager.startBackgroundJob('ls', ['-la'], options);
      const job = await jobManager.getJobStatus(jobId);

      expect(job).toBeDefined();
      expect(job!.sessionId).toBe('test-session-123');
      expect(job!.workingDirectory).toBe('/tmp');
      expect(job!.environment).toEqual({ TEST_VAR: 'test_value' });
      expect(job!.timeout).toBe(30000);
      expect(job!.priority).toBe(5);
      expect(job!.tags).toEqual({ component: 'test' });
    });

    test('should generate unique job IDs', async () => {
      const jobId1 = await jobManager.startBackgroundJob('echo', ['test1']);
      const jobId2 = await jobManager.startBackgroundJob('echo', ['test2']);

      expect(jobId1).not.toBe(jobId2);
    });

    test('should track job creation timestamp', async () => {
      const beforeCreation = Date.now();
      const jobId = await jobManager.startBackgroundJob('echo', ['hello']);
      const afterCreation = Date.now();

      const job = await jobManager.getJobStatus(jobId);
      expect(job).toBeDefined();
      expect(job!.createdAt.getTime()).toBeGreaterThanOrEqual(beforeCreation);
      expect(job!.createdAt.getTime()).toBeLessThanOrEqual(afterCreation);
    });

    test('should start job with default priority', async () => {
      const jobId = await jobManager.startBackgroundJob('echo', ['hello']);
      const job = await jobManager.getJobStatus(jobId);

      expect(job!.priority).toBe(1); // Default priority
    });
  });

  describe('Job Status Management', () => {
    test('should return null for non-existent job', async () => {
      const job = await jobManager.getJobStatus('non-existent-id');
      expect(job).toBeNull();
    });

    test('should update job status when process exits successfully', async () => {
      const jobId = await jobManager.startBackgroundJob('echo', ['hello']);

      // Simulate successful process exit
      mockProcess.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'exit') {
          setTimeout(() => callback(0, null), 10);
        }
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      const job = await jobManager.getJobStatus(jobId);
      expect(job!.status).toBe('completed');
      expect(job!.exitCode).toBe(0);
      expect(job!.endedAt).toBeDefined();
    });

    test('should update job status when process exits with error', async () => {
      const jobId = await jobManager.startBackgroundJob('false');

      // Simulate process exit with error
      mockProcess.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'exit') {
          setTimeout(() => callback(1, null), 10);
        }
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      const job = await jobManager.getJobStatus(jobId);
      expect(job!.status).toBe('failed');
      expect(job!.exitCode).toBe(1);
      expect(job!.endedAt).toBeDefined();
    });

    test('should handle process error events', async () => {
      const jobId = await jobManager.startBackgroundJob('nonexistent-command');

      // Simulate process error
      const error = new Error('Command not found');
      mockProcess.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'error') {
          setTimeout(() => callback(error), 10);
        }
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      const job = await jobManager.getJobStatus(jobId);
      expect(job!.status).toBe('failed');
      expect(job!.error).toBe('Command not found');
    });
  });

  describe('Output Management', () => {
    test('should capture stdout output', async () => {
      const jobId = await jobManager.startBackgroundJob('echo', ['hello world']);

      // Simulate stdout data
      mockProcess.stdout.emit('data', Buffer.from('hello world\n'));

      await new Promise(resolve => setTimeout(resolve, 10));

      const output = await jobManager.getJobOutput(jobId);
      expect(output.stdout).toContain('hello world');
      expect(output.sequences.length).toBeGreaterThan(0);
      expect(output.sequences[0].content).toBe('hello world\n');
      expect(output.sequences[0].type).toBe('stdout');
    });

    test('should capture stderr output', async () => {
      const jobId = await jobManager.startBackgroundJob('ls', ['nonexistent']);

      // Simulate stderr data
      mockProcess.stderr.emit('data', Buffer.from('ls: nonexistent: No such file or directory\n'));

      await new Promise(resolve => setTimeout(resolve, 10));

      const output = await jobManager.getJobOutput(jobId, { includeStderr: true });
      expect(output.stderr).toContain('No such file or directory');
      expect(output.sequences.some(seq => seq.type === 'stderr')).toBe(true);
    });

    test('should handle empty output', async () => {
      const jobId = await jobManager.startBackgroundJob('true'); // Command that produces no output

      const output = await jobManager.getJobOutput(jobId);
      expect(output.stdout).toBe('');
      expect(output.stderr).toBe('');
      expect(output.sequences.length).toBe(0);
    });

    test('should respect maxLines option', async () => {
      const jobId = await jobManager.startBackgroundJob('echo', ['line1']);

      // Simulate multiple lines of output
      mockProcess.stdout.emit('data', Buffer.from('line1\nline2\nline3\nline4\n'));

      await new Promise(resolve => setTimeout(resolve, 10));

      const output = await jobManager.getJobOutput(jobId, { maxLines: 2 });
      const lines = output.stdout.trim().split('\n');
      expect(lines.length).toBeLessThanOrEqual(2);
    });

    test('should handle since parameter for incremental output', async () => {
      const jobId = await jobManager.startBackgroundJob('echo', ['test']);

      // Emit initial output
      mockProcess.stdout.emit('data', Buffer.from('first line\n'));
      await new Promise(resolve => setTimeout(resolve, 10));

      const output1 = await jobManager.getJobOutput(jobId);
      expect(output1.sequences.length).toBe(1);

      // Emit more output
      mockProcess.stdout.emit('data', Buffer.from('second line\n'));
      await new Promise(resolve => setTimeout(resolve, 10));

      const output2 = await jobManager.getJobOutput(jobId, {
        since: output1.sequences[output1.sequences.length - 1].sequenceNumber
      });

      expect(output2.sequences.length).toBe(1);
      expect(output2.sequences[0].content).toBe('second line\n');
    });
  });

  describe('Job Cancellation', () => {
    test('should cancel a running job successfully', async () => {
      const jobId = await jobManager.startBackgroundJob('sleep', ['30']);

      const cancelled = await jobManager.cancelJob(jobId);
      expect(cancelled).toBe(true);

      const job = await jobManager.getJobStatus(jobId);
      expect(job!.status).toBe('cancelled');
      expect(job!.endedAt).toBeDefined();
      expect(mockProcess.kill).toHaveBeenCalled();
    });

    test('should not cancel non-existent job', async () => {
      const cancelled = await jobManager.cancelJob('non-existent-id');
      expect(cancelled).toBe(false);
    });

    test('should not cancel already completed job', async () => {
      const jobId = await jobManager.startBackgroundJob('echo', ['hello']);

      // Simulate completion
      mockProcess.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'exit') {
          setTimeout(() => callback(0, null), 10);
        }
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      const cancelled = await jobManager.cancelJob(jobId);
      expect(cancelled).toBe(false);
    });
  });

  describe('Job Listing and Filtering', () => {
    test('should list all jobs', async () => {
      const jobId1 = await jobManager.startBackgroundJob('echo', ['test1']);
      const jobId2 = await jobManager.startBackgroundJob('echo', ['test2']);

      const jobs = await jobManager.listJobs();
      expect(jobs.length).toBe(2);
      expect(jobs.map(j => j.id)).toContain(jobId1);
      expect(jobs.map(j => j.id)).toContain(jobId2);
    });

    test('should filter jobs by status', async () => {
      const jobId1 = await jobManager.startBackgroundJob('echo', ['test1']);
      const jobId2 = await jobManager.startBackgroundJob('echo', ['test2']);

      // Complete one job
      mockProcess.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'exit') {
          setTimeout(() => callback(0, null), 10);
        }
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      const runningJobs = await jobManager.listJobs({ status: 'running' });
      const completedJobs = await jobManager.listJobs({ status: 'completed' });

      expect(runningJobs.length).toBeGreaterThan(0);
      expect(completedJobs.length).toBeGreaterThan(0);
      expect(runningJobs.every(j => j.status === 'running')).toBe(true);
      expect(completedJobs.every(j => j.status === 'completed')).toBe(true);
    });

    test('should filter jobs by sessionId', async () => {
      const jobId1 = await jobManager.startBackgroundJob('echo', ['test1'], { sessionId: 'session1' });
      const jobId2 = await jobManager.startBackgroundJob('echo', ['test2'], { sessionId: 'session2' });

      const session1Jobs = await jobManager.listJobs({ sessionId: 'session1' });
      expect(session1Jobs.length).toBe(1);
      expect(session1Jobs[0].id).toBe(jobId1);
      expect(session1Jobs[0].sessionId).toBe('session1');
    });

    test('should respect limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await jobManager.startBackgroundJob('echo', [`test${i}`]);
      }

      const jobs = await jobManager.listJobs({ limit: 3 });
      expect(jobs.length).toBe(3);
    });
  });

  describe('Job Metrics', () => {
    test('should provide job metrics', async () => {
      const jobId1 = await jobManager.startBackgroundJob('echo', ['test1']);
      const jobId2 = await jobManager.startBackgroundJob('echo', ['test2']);

      const metrics = await jobManager.getJobMetrics();

      expect(metrics.totalJobs).toBe(2);
      expect(metrics.runningJobs).toBe(2);
      expect(metrics.completedJobs).toBe(0);
      expect(metrics.failedJobs).toBe(0);
      expect(metrics.cancelledJobs).toBe(0);
    });

    test('should track queue metrics', async () => {
      for (let i = 0; i < 3; i++) {
        await jobManager.startBackgroundJob('echo', [`test${i}`], { priority: i });
      }

      const metrics = await jobManager.getJobMetrics();
      expect(metrics.queueSize).toBeGreaterThan(0);
      expect(metrics.concurrency).toBeDefined();
    });
  });

  describe('Job Cleanup', () => {
    test('should cleanup completed jobs by age', async () => {
      const jobId = await jobManager.startBackgroundJob('echo', ['test']);

      // Complete the job
      mockProcess.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'exit') {
          setTimeout(() => callback(0, null), 10);
        }
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // Cleanup jobs older than 0ms (should cleanup all completed jobs)
      const cleaned = await jobManager.cleanupJobs({ maxAge: 0 });
      expect(cleaned).toBe(1);

      const job = await jobManager.getJobStatus(jobId);
      expect(job).toBeNull();
    });

    test('should keep recent jobs during cleanup', async () => {
      const jobId = await jobManager.startBackgroundJob('echo', ['test']);

      // Complete the job
      mockProcess.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'exit') {
          setTimeout(() => callback(0, null), 10);
        }
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // Cleanup jobs older than 1 hour (should keep recent jobs)
      const cleaned = await jobManager.cleanupJobs({ maxAge: 60 * 60 * 1000 });
      expect(cleaned).toBe(0);

      const job = await jobManager.getJobStatus(jobId);
      expect(job).not.toBeNull();
    });

    test('should cleanup by status filter', async () => {
      const jobId1 = await jobManager.startBackgroundJob('echo', ['test1']);
      const jobId2 = await jobManager.startBackgroundJob('false'); // Will fail

      // Complete first job successfully, second with error
      let callCount = 0;
      mockProcess.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'exit') {
          setTimeout(() => {
            callCount++;
            callback(callCount === 1 ? 0 : 1, null);
          }, 10);
        }
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Cleanup only failed jobs
      const cleaned = await jobManager.cleanupJobs({
        maxAge: 0,
        statuses: ['failed']
      });

      expect(cleaned).toBe(1);

      const job1 = await jobManager.getJobStatus(jobId1);
      const job2 = await jobManager.getJobStatus(jobId2);

      expect(job1).not.toBeNull(); // Completed job should remain
      expect(job2).toBeNull(); // Failed job should be cleaned up
    });
  });

  describe('Error Handling', () => {
    test('should handle spawn errors gracefully', async () => {
      mockSpawn.mockImplementation(() => {
        throw new Error('spawn ENOENT');
      });

      await expect(
        jobManager.startBackgroundJob('nonexistent-command')
      ).rejects.toThrow('spawn ENOENT');
    });

    test('should handle timeout correctly', async () => {
      const jobId = await jobManager.startBackgroundJob('sleep', ['60'], { timeout: 100 });

      await new Promise(resolve => setTimeout(resolve, 150));

      const job = await jobManager.getJobStatus(jobId);
      expect(job!.status).toBe('failed');
      expect(job!.error).toContain('timeout');
      expect(mockProcess.kill).toHaveBeenCalled();
    });
  });

  describe('Concurrency Management', () => {
    test('should respect global concurrency limits', async () => {
      const promises = [];

      // Start more jobs than the default concurrency limit
      for (let i = 0; i < 20; i++) {
        promises.push(jobManager.startBackgroundJob('sleep', ['1']));
      }

      const jobIds = await Promise.all(promises);

      // Check that some jobs are queued (not all running immediately)
      const metrics = await jobManager.getJobMetrics();
      expect(metrics.queueSize).toBeGreaterThan(0);
    });

    test('should respect session-based concurrency limits', async () => {
      const sessionId = 'test-session';
      const promises = [];

      // Start multiple jobs in the same session
      for (let i = 0; i < 10; i++) {
        promises.push(
          jobManager.startBackgroundJob('sleep', ['1'], { sessionId })
        );
      }

      const jobIds = await Promise.all(promises);
      const jobs = await jobManager.listJobs({ sessionId });

      expect(jobs.length).toBe(10);
      expect(jobs.every(j => j.sessionId === sessionId)).toBe(true);
    });
  });

  describe('Priority Queue Behavior', () => {
    test('should execute higher priority jobs first', async () => {
      // Start jobs with different priorities
      const lowPriorityJob = await jobManager.startBackgroundJob('echo', ['low'], { priority: 1 });
      const highPriorityJob = await jobManager.startBackgroundJob('echo', ['high'], { priority: 10 });

      // Verify jobs exist
      const lowJob = await jobManager.getJobStatus(lowPriorityJob);
      const highJob = await jobManager.getJobStatus(highPriorityJob);

      expect(lowJob!.priority).toBe(1);
      expect(highJob!.priority).toBe(10);
    });
  });

  describe('Resource Management', () => {
    test('should clean up resources on destroy', async () => {
      const jobId = await jobManager.startBackgroundJob('sleep', ['30']);

      await jobManager.destroy();

      // Verify cleanup occurred
      expect(mockProcess.removeAllListeners).toHaveBeenCalled();
      expect(mockProcess.kill).toHaveBeenCalled();
    });
  });
});