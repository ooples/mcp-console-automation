/**
 * Integration Tests for Background Job MCP Handlers
 *
 * This test suite validates the MCP server handlers for background job operations,
 * testing the complete flow from MCP tool calls to JobManager execution and results.
 */

import { ConsoleAutomationServer } from '../../src/mcp/server.js';
import { JobManager } from '../../src/core/JobManager.js';
import { ConsoleManager } from '../../src/core/ConsoleManager.js';
import { platform } from 'os';
import { spawn } from 'child_process';

// Skip tests on Windows for commands that don't exist or behave differently
const isWindows = platform() === 'win32';

describe('Background Jobs Integration Tests', () => {
  let server: ConsoleAutomationServer;
  let consoleManager: ConsoleManager;
  let jobManager: JobManager;

  beforeAll(async () => {
    server = new ConsoleAutomationServer();
    consoleManager = server['consoleManager'];
    jobManager = consoleManager.getJobManager();
  });

  afterAll(async () => {
    if (server) {
      await server['destroy']();
    }
  });

  beforeEach(async () => {
    // Clean up any existing jobs before each test
    const jobs = await jobManager.listJobs();
    for (const job of jobs) {
      if (job.status === 'running') {
        await jobManager.cancelJob(job.id);
      }
    }
    await jobManager.cleanupJobs({ maxAge: 0 });
  });

  describe('console_execute_async Handler', () => {
    test('should execute simple command asynchronously', async () => {
      const command = isWindows ? 'echo' : 'echo';
      const args = ['hello world'];

      const result = await server['handleExecuteAsync']({
        name: 'console_execute_async',
        arguments: { command, args }
      });

      expect(result.content).toBeDefined();
      expect(typeof result.content[0].text).toBe('string');

      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
      expect(response.jobId).toBeDefined();
      expect(typeof response.jobId).toBe('string');
    }, 10000);

    test('should handle command with options', async () => {
      const command = isWindows ? 'dir' : 'ls';
      const args = isWindows ? [] : ['-la'];
      const options = {
        sessionId: 'test-session-123',
        timeout: 5000,
        priority: 5,
        tags: { test: 'integration' }
      };

      const result = await server['handleExecuteAsync']({
        name: 'console_execute_async',
        arguments: { command, args, options }
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
      expect(response.jobId).toBeDefined();

      // Verify job was created with correct options
      const job = await jobManager.getJobStatus(response.jobId);
      expect(job).toBeDefined();
      expect(job!.sessionId).toBe('test-session-123');
      expect(job!.timeout).toBe(5000);
      expect(job!.priority).toBe(5);
      expect(job!.tags).toEqual({ test: 'integration' });
    }, 10000);

    test('should handle invalid command gracefully', async () => {
      const command = 'nonexistent-command-xyz';
      const args = ['test'];

      const result = await server['handleExecuteAsync']({
        name: 'console_execute_async',
        arguments: { command, args }
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
      expect(response.error).toContain('spawn');
    }, 10000);
  });

  describe('console_get_job_status Handler', () => {
    test('should get status of existing job', async () => {
      // First create a job
      const createResult = await server['handleExecuteAsync']({
        name: 'console_execute_async',
        arguments: {
          command: isWindows ? 'ping' : 'sleep',
          args: isWindows ? ['-n', '3', 'localhost'] : ['2']
        }
      });

      const createResponse = JSON.parse(createResult.content[0].text);
      const jobId = createResponse.jobId;

      // Get job status
      const statusResult = await server['handleGetJobStatus']({
        name: 'console_get_job_status',
        arguments: { jobId }
      });

      const statusResponse = JSON.parse(statusResult.content[0].text);
      expect(statusResponse.success).toBe(true);
      expect(statusResponse.job).toBeDefined();
      expect(statusResponse.job.id).toBe(jobId);
      expect(statusResponse.job.command).toBe(isWindows ? 'ping' : 'sleep');
      expect(['running', 'completed', 'failed']).toContain(statusResponse.job.status);
    }, 15000);

    test('should handle non-existent job', async () => {
      const result = await server['handleGetJobStatus']({
        name: 'console_get_job_status',
        arguments: { jobId: 'non-existent-id' }
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(false);
      expect(response.error).toContain('not found');
    });
  });

  describe('console_get_job_output Handler', () => {
    test('should get output from completed job', async () => {
      // Create a simple echo job
      const createResult = await server['handleExecuteAsync']({
        name: 'console_execute_async',
        arguments: {
          command: isWindows ? 'echo' : 'echo',
          args: ['test output message']
        }
      });

      const createResponse = JSON.parse(createResult.content[0].text);
      const jobId = createResponse.jobId;

      // Wait for job to complete
      let attempts = 0;
      let jobCompleted = false;
      while (attempts < 20 && !jobCompleted) {
        await new Promise(resolve => setTimeout(resolve, 500));
        const job = await jobManager.getJobStatus(jobId);
        jobCompleted = job && job.status !== 'running';
        attempts++;
      }

      // Get job output
      const outputResult = await server['handleGetJobOutput']({
        name: 'console_get_job_output',
        arguments: { jobId }
      });

      const outputResponse = JSON.parse(outputResult.content[0].text);
      expect(outputResponse.success).toBe(true);
      expect(outputResponse.output).toBeDefined();
      expect(outputResponse.output.stdout).toBeDefined();
      expect(outputResponse.output.sequences).toBeDefined();
      expect(Array.isArray(outputResponse.output.sequences)).toBe(true);
    }, 20000);

    test('should handle output options', async () => {
      // Create a job that produces both stdout and stderr
      const createResult = await server['handleExecuteAsync']({
        name: 'console_execute_async',
        arguments: {
          command: isWindows ? 'cmd' : 'sh',
          args: isWindows ? ['/c', 'echo stdout & echo stderr 1>&2'] : ['-c', 'echo stdout; echo stderr >&2']
        }
      });

      const createResponse = JSON.parse(createResult.content[0].text);
      const jobId = createResponse.jobId;

      // Wait for job to complete
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Get output with stderr included
      const outputResult = await server['handleGetJobOutput']({
        name: 'console_get_job_output',
        arguments: {
          jobId,
          options: { includeStderr: true, maxLines: 10 }
        }
      });

      const outputResponse = JSON.parse(outputResult.content[0].text);
      expect(outputResponse.success).toBe(true);
      expect(outputResponse.output.stdout).toBeDefined();
      expect(outputResponse.output.stderr).toBeDefined();
    }, 15000);
  });

  describe('console_cancel_job Handler', () => {
    test('should cancel running job', async () => {
      // Create a long-running job
      const createResult = await server['handleExecuteAsync']({
        name: 'console_execute_async',
        arguments: {
          command: isWindows ? 'ping' : 'sleep',
          args: isWindows ? ['-n', '100', 'localhost'] : ['30']
        }
      });

      const createResponse = JSON.parse(createResult.content[0].text);
      const jobId = createResponse.jobId;

      // Wait a moment for job to start
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Cancel the job
      const cancelResult = await server['handleCancelJob']({
        name: 'console_cancel_job',
        arguments: { jobId }
      });

      const cancelResponse = JSON.parse(cancelResult.content[0].text);
      expect(cancelResponse.success).toBe(true);
      expect(cancelResponse.cancelled).toBe(true);

      // Verify job was cancelled
      const job = await jobManager.getJobStatus(jobId);
      expect(job!.status).toBe('cancelled');
    }, 15000);

    test('should handle non-existent job cancellation', async () => {
      const result = await server['handleCancelJob']({
        name: 'console_cancel_job',
        arguments: { jobId: 'non-existent-id' }
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
      expect(response.cancelled).toBe(false);
    });
  });

  describe('console_list_jobs Handler', () => {
    test('should list all jobs', async () => {
      // Create a few jobs
      const job1 = await server['handleExecuteAsync']({
        name: 'console_execute_async',
        arguments: {
          command: isWindows ? 'echo' : 'echo',
          args: ['job1']
        }
      });

      const job2 = await server['handleExecuteAsync']({
        name: 'console_execute_async',
        arguments: {
          command: isWindows ? 'echo' : 'echo',
          args: ['job2']
        }
      });

      // List jobs
      const listResult = await server['handleListJobs']({
        name: 'console_list_jobs',
        arguments: {}
      });

      const listResponse = JSON.parse(listResult.content[0].text);
      expect(listResponse.success).toBe(true);
      expect(listResponse.jobs).toBeDefined();
      expect(Array.isArray(listResponse.jobs)).toBe(true);
      expect(listResponse.jobs.length).toBeGreaterThanOrEqual(2);
    }, 10000);

    test('should filter jobs by session', async () => {
      // Create jobs with different session IDs
      await server['handleExecuteAsync']({
        name: 'console_execute_async',
        arguments: {
          command: isWindows ? 'echo' : 'echo',
          args: ['session1'],
          options: { sessionId: 'session-1' }
        }
      });

      await server['handleExecuteAsync']({
        name: 'console_execute_async',
        arguments: {
          command: isWindows ? 'echo' : 'echo',
          args: ['session2'],
          options: { sessionId: 'session-2' }
        }
      });

      // List jobs for specific session
      const listResult = await server['handleListJobs']({
        name: 'console_list_jobs',
        arguments: { options: { sessionId: 'session-1' } }
      });

      const listResponse = JSON.parse(listResult.content[0].text);
      expect(listResponse.success).toBe(true);
      expect(listResponse.jobs.length).toBeGreaterThanOrEqual(1);
      expect(listResponse.jobs.every((job: any) => job.sessionId === 'session-1')).toBe(true);
    }, 10000);

    test('should respect limit parameter', async () => {
      // Create multiple jobs
      for (let i = 0; i < 5; i++) {
        await server['handleExecuteAsync']({
          name: 'console_execute_async',
          arguments: {
            command: isWindows ? 'echo' : 'echo',
            args: [`job${i}`]
          }
        });
      }

      // List with limit
      const listResult = await server['handleListJobs']({
        name: 'console_list_jobs',
        arguments: { options: { limit: 3 } }
      });

      const listResponse = JSON.parse(listResult.content[0].text);
      expect(listResponse.success).toBe(true);
      expect(listResponse.jobs.length).toBeLessThanOrEqual(3);
    }, 15000);
  });

  describe('console_get_job_metrics Handler', () => {
    test('should return job metrics', async () => {
      // Create some jobs to have metrics
      await server['handleExecuteAsync']({
        name: 'console_execute_async',
        arguments: {
          command: isWindows ? 'echo' : 'echo',
          args: ['metrics test']
        }
      });

      const result = await server['handleGetJobMetrics']({
        name: 'console_get_job_metrics',
        arguments: {}
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
      expect(response.metrics).toBeDefined();
      expect(typeof response.metrics.totalJobs).toBe('number');
      expect(typeof response.metrics.runningJobs).toBe('number');
      expect(typeof response.metrics.completedJobs).toBe('number');
      expect(typeof response.metrics.failedJobs).toBe('number');
      expect(typeof response.metrics.cancelledJobs).toBe('number');
      expect(response.metrics.totalJobs).toBeGreaterThanOrEqual(1);
    }, 10000);
  });

  describe('console_cleanup_jobs Handler', () => {
    test('should cleanup completed jobs', async () => {
      // Create and complete a job
      const createResult = await server['handleExecuteAsync']({
        name: 'console_execute_async',
        arguments: {
          command: isWindows ? 'echo' : 'echo',
          args: ['cleanup test']
        }
      });

      const createResponse = JSON.parse(createResult.content[0].text);
      const jobId = createResponse.jobId;

      // Wait for job to complete
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Cleanup jobs
      const cleanupResult = await server['handleCleanupJobs']({
        name: 'console_cleanup_jobs',
        arguments: { options: { maxAge: 0 } }
      });

      const cleanupResponse = JSON.parse(cleanupResult.content[0].text);
      expect(cleanupResponse.success).toBe(true);
      expect(typeof cleanupResponse.cleaned).toBe('number');
      expect(cleanupResponse.cleaned).toBeGreaterThanOrEqual(0);
    }, 10000);
  });

  describe('Error Handling and Edge Cases', () => {
    test('should handle malformed request parameters', async () => {
      try {
        await server['handleExecuteAsync']({
          name: 'console_execute_async',
          arguments: {} // Missing required command parameter
        });
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    test('should handle timeout scenarios', async () => {
      // Create job with short timeout
      const createResult = await server['handleExecuteAsync']({
        name: 'console_execute_async',
        arguments: {
          command: isWindows ? 'ping' : 'sleep',
          args: isWindows ? ['-n', '10', 'localhost'] : ['10'],
          options: { timeout: 1000 } // 1 second timeout
        }
      });

      const createResponse = JSON.parse(createResult.content[0].text);
      const jobId = createResponse.jobId;

      // Wait for timeout to occur
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Check job status
      const statusResult = await server['handleGetJobStatus']({
        name: 'console_get_job_status',
        arguments: { jobId }
      });

      const statusResponse = JSON.parse(statusResult.content[0].text);
      expect(statusResponse.job.status).toBe('failed');
      expect(statusResponse.job.error).toContain('timeout');
    }, 15000);

    test('should handle concurrent job operations', async () => {
      // Start multiple jobs concurrently
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(
          server['handleExecuteAsync']({
            name: 'console_execute_async',
            arguments: {
              command: isWindows ? 'echo' : 'echo',
              args: [`concurrent-${i}`]
            }
          })
        );
      }

      const results = await Promise.all(promises);
      expect(results.length).toBe(5);

      // Verify all jobs were created successfully
      results.forEach(result => {
        const response = JSON.parse(result.content[0].text);
        expect(response.success).toBe(true);
        expect(response.jobId).toBeDefined();
      });
    }, 15000);
  });

  describe('Performance and Stress Testing', () => {
    test('should handle rapid job creation', async () => {
      const startTime = Date.now();
      const promises = [];

      // Create 10 jobs rapidly
      for (let i = 0; i < 10; i++) {
        promises.push(
          server['handleExecuteAsync']({
            name: 'console_execute_async',
            arguments: {
              command: isWindows ? 'echo' : 'echo',
              args: [`rapid-${i}`]
            }
          })
        );
      }

      const results = await Promise.all(promises);
      const endTime = Date.now();

      expect(results.length).toBe(10);
      expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds

      // Verify all jobs were created
      results.forEach(result => {
        const response = JSON.parse(result.content[0].text);
        expect(response.success).toBe(true);
      });
    }, 20000);
  });
});