/**
 * Test Worker - Worker thread for executing tests in isolation
 */

import { parentPort, workerData } from 'worker_threads';
import { TestDefinition, TestResult, AssertionResult } from '../types/test-framework';

interface WorkerMessage {
  type: 'execute' | 'shutdown';
  task?: {
    id: string;
    test: TestDefinition;
    timeout: number;
  };
}

class TestWorker {
  private workerId: number;
  private heartbeatInterval?: NodeJS.Timeout;

  constructor(workerId: number) {
    this.workerId = workerId;
    this.startHeartbeat();
  }

  /**
   * Start sending heartbeat messages
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      this.sendMessage({ type: 'heartbeat' });
    }, 5000);
  }

  /**
   * Stop heartbeat
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
  }

  /**
   * Send message to parent
   */
  private sendMessage(message: any): void {
    if (parentPort) {
      parentPort.postMessage(message);
    }
  }

  /**
   * Execute a test
   */
  async executeTest(taskId: string, test: TestDefinition): Promise<void> {
    const startTime = Date.now();

    try {
      // Create a timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Test timed out after ${test.timeout}ms`));
        }, test.timeout);
      });

      // Execute test with timeout
      const result = await Promise.race([
        this.runTest(test, startTime),
        timeoutPromise,
      ]);

      this.sendMessage({
        type: 'result',
        result: {
          taskId,
          result,
        },
      });
    } catch (error) {
      this.sendMessage({
        type: 'error',
        error: {
          taskId,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
      });
    }
  }

  /**
   * Run the actual test
   */
  private async runTest(test: TestDefinition, startTime: number): Promise<TestResult> {
    // Execute setup hook if present
    if (test.setup) {
      await this.executeHook(test.setup.fn, test.setup.timeout || 5000);
    }

    // Execute the test assertions
    const assertionResults: AssertionResult[] = [];

    for (const assertion of test.assertions) {
      try {
        const passed = await this.evaluateAssertion(assertion);
        assertionResults.push({
          assertion,
          passed,
          message: passed ? 'Assertion passed' : 'Assertion failed',
        });
      } catch (error) {
        assertionResults.push({
          assertion,
          passed: false,
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      }
    }

    // Execute teardown hook if present
    if (test.teardown) {
      try {
        await this.executeHook(test.teardown.fn, test.teardown.timeout || 5000);
      } catch (error) {
        // Log teardown errors but don't fail the test
        console.error('Teardown error:', error);
      }
    }

    const endTime = Date.now();
    const allPassed = assertionResults.every((r) => r.passed);

    const result: TestResult = {
      test,
      status: test.skip ? 'skip' : allPassed ? 'pass' : 'fail',
      duration: endTime - startTime,
      startTime,
      endTime,
      assertions: assertionResults,
    };

    return result;
  }

  /**
   * Execute a test hook
   */
  private async executeHook(fn: () => Promise<void> | void, timeout: number): Promise<void> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Hook timed out after ${timeout}ms`));
      }, timeout);
    });

    await Promise.race([Promise.resolve(fn()), timeoutPromise]);
  }

  /**
   * Evaluate an assertion
   * This is a stub implementation - real implementation would use AssertionEngine from Phase 2
   */
  private async evaluateAssertion(assertion: any): Promise<boolean> {
    // Stub: Just return true for now
    // Real implementation would integrate with Phase 2's AssertionEngine
    return true;
  }

  /**
   * Handle incoming messages
   */
  handleMessage(message: WorkerMessage): void {
    switch (message.type) {
      case 'execute':
        if (message.task) {
          this.executeTest(message.task.id, message.task.test);
        }
        break;

      case 'shutdown':
        this.stopHeartbeat();
        process.exit(0);
        break;

      default:
        console.warn('Unknown message type:', message.type);
    }
  }
}

// Initialize worker
if (parentPort) {
  const worker = new TestWorker(workerData.workerId);

  parentPort.on('message', (message: WorkerMessage) => {
    worker.handleMessage(message);
  });
} else {
  console.error('This file must be run as a worker thread');
  process.exit(1);
}
