/**
 * TestReplayEngine - Replays recorded console tests
 *
 * This class loads test recordings and replays them step-by-step,
 * with configurable speed control and timing preservation.
 */

import {
  TestRecording,
  RecordingStep,
  ReplayResult,
  StepResult,
} from '../types/test-framework.js';
import { TestRecorder } from './TestRecorder.js';
import { ConsoleManager } from '../core/ConsoleManager.js';

export interface ReplayOptions {
  speed?: number; // 1.0 = normal, 2.0 = 2x speed, 0 = fast-forward
  preserveTiming?: boolean; // Whether to preserve original timing
  validateOutput?: boolean; // Whether to validate output matches recording
  stopOnError?: boolean; // Whether to stop replay on first error
  timeout?: number; // Overall timeout for replay (ms)
}

export class TestReplayEngine {
  private consoleManager: ConsoleManager;
  private sessionMap: Map<string, string> = new Map(); // Maps recorded session IDs to actual session IDs

  constructor(consoleManager?: ConsoleManager) {
    this.consoleManager = consoleManager || new ConsoleManager();
  }

  /**
   * Replay a recording by name
   */
  public async replayByName(
    name: string,
    options: ReplayOptions = {},
    outputDir = 'data/recordings'
  ): Promise<ReplayResult> {
    const recording = TestRecorder.loadRecording(name, outputDir);
    return this.replay(recording, options);
  }

  /**
   * Replay a test recording
   */
  public async replay(
    recording: TestRecording,
    options: ReplayOptions = {}
  ): Promise<ReplayResult> {
    const startTime = Date.now();
    const results: StepResult[] = [];
    const speed = options.speed !== undefined ? options.speed : 1.0;
    const preserveTiming =
      options.preserveTiming !== undefined ? options.preserveTiming : true;
    const validateOutput =
      options.validateOutput !== undefined ? options.validateOutput : false;
    const stopOnError =
      options.stopOnError !== undefined ? options.stopOnError : false;
    const timeout = options.timeout || 300000; // 5 minutes default

    this.sessionMap.clear();

    let lastStepTime = 0;
    let overallStatus: 'success' | 'failure' | 'error' = 'success';
    let replayError: Error | undefined;

    try {
      for (let i = 0; i < recording.steps.length; i++) {
        const step = recording.steps[i];
        const stepStartTime = Date.now();

        // Check overall timeout before step
        if (Date.now() - startTime > timeout) {
          throw new Error(`Replay timeout exceeded: ${timeout}ms`);
        }

        // Handle timing
        if (preserveTiming && i > 0 && speed > 0) {
          const timeDiff = step.timestamp - lastStepTime;
          const waitTime = timeDiff / speed;
          if (waitTime > 0) {
            await this.sleep(waitTime);
          }
        }

        lastStepTime = step.timestamp;

        // Execute step with timeout
        const remainingTime = timeout - (Date.now() - startTime);
        const stepPromise = this.executeStep(step, validateOutput);
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Replay timeout exceeded: ${timeout}ms`)), remainingTime)
        );

        const stepResult = await Promise.race([stepPromise, timeoutPromise]);
        results.push(stepResult);

        // Check step result
        if (stepResult.status === 'fail') {
          overallStatus = 'failure';
          if (stopOnError) {
            break;
          }
        }
      }
    } catch (error) {
      overallStatus = 'error';
      replayError = error instanceof Error ? error : new Error(String(error));
    } finally {
      // Cleanup sessions
      await this.cleanupSessions();
    }

    const duration = Date.now() - startTime;

    return {
      recording: recording.name,
      status: overallStatus,
      duration,
      steps: results,
      error: replayError,
    };
  }

  /**
   * Execute a single recording step
   */
  private async executeStep(
    step: RecordingStep,
    validateOutput: boolean
  ): Promise<StepResult> {
    const startTime = Date.now();
    let status: 'pass' | 'fail' | 'skip' = 'pass';
    let error: Error | undefined;
    let output: string | undefined;

    try {
      switch (step.type) {
        case 'create_session':
          output = await this.executeCreateSession(step);
          break;

        case 'send_input':
          output = await this.executeSendInput(step);
          break;

        case 'send_key':
          output = await this.executeSendKey(step);
          break;

        case 'wait_for_output':
          output = await this.executeWaitForOutput(step);
          break;

        case 'assert':
          // Phase 2 - Assertion framework
          status = 'skip';
          output = 'Assertions not yet implemented (Phase 2)';
          break;

        case 'snapshot':
          // Phase 2 - Snapshot framework
          status = 'skip';
          output = 'Snapshots not yet implemented (Phase 2)';
          break;

        default:
          throw new Error(`Unknown step type: ${(step as any).type}`);
      }

      // Validate output if requested
      if (validateOutput && step.output && output !== step.output) {
        status = 'fail';
        error = new Error(
          `Output mismatch: expected "${step.output}", got "${output}"`
        );
      }
    } catch (err) {
      status = 'fail';
      error = err instanceof Error ? err : new Error(String(err));
      output = error.message;
    }

    const duration = Date.now() - startTime;

    return {
      step,
      status,
      duration,
      error,
      output,
    };
  }

  /**
   * Execute create_session step
   */
  private async executeCreateSession(step: RecordingStep): Promise<string> {
    const { data } = step;
    const recordedSessionId = step.sessionId || 'default';

    try {
      const result = await this.consoleManager.createSession(data);
      const actualSessionId = typeof result === 'string' ? result : result.sessionId;

      // Map recorded session ID to actual session ID
      this.sessionMap.set(recordedSessionId, actualSessionId);

      return `Session created: ${actualSessionId}`;
    } catch (error) {
      throw new Error(
        `Failed to create session: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Execute send_input step
   */
  private async executeSendInput(step: RecordingStep): Promise<string> {
    const { input } = step.data;
    const sessionId = this.getActualSessionId(step.sessionId);

    try {
      await this.consoleManager.sendInput(sessionId, input);

      return 'Input sent successfully';
    } catch (error) {
      throw new Error(
        `Failed to send input: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Execute send_key step
   */
  private async executeSendKey(step: RecordingStep): Promise<string> {
    const { key } = step.data;
    const sessionId = this.getActualSessionId(step.sessionId);

    try {
      await this.consoleManager.sendKey(sessionId, key);

      return 'Key sent successfully';
    } catch (error) {
      throw new Error(
        `Failed to send key: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Execute wait_for_output step
   */
  private async executeWaitForOutput(step: RecordingStep): Promise<string> {
    const { pattern, timeout } = step.data;
    const sessionId = this.getActualSessionId(step.sessionId);

    try {
      const result = await this.consoleManager.waitForOutput(
        sessionId,
        pattern,
        { timeout }
      );

      return result.output || `Matched pattern: ${pattern}`;
    } catch (error) {
      throw new Error(
        `Failed to wait for output: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get actual session ID from recorded session ID
   */
  private getActualSessionId(recordedSessionId?: string): string {
    if (!recordedSessionId) {
      // Use the first session if no specific session ID
      const firstSession = this.sessionMap.values().next().value;
      if (!firstSession) {
        throw new Error('No session available');
      }
      return firstSession;
    }

    const actualSessionId = this.sessionMap.get(recordedSessionId);
    if (!actualSessionId) {
      throw new Error(`Session not found: ${recordedSessionId}`);
    }

    return actualSessionId;
  }

  /**
   * Cleanup all sessions created during replay
   */
  private async cleanupSessions(): Promise<void> {
    const cleanupPromises = Array.from(this.sessionMap.values()).map(
      async (sessionId) => {
        try {
          await this.consoleManager.stopSession(sessionId);
        } catch (error) {
          // Ignore cleanup errors
        }
      }
    );

    await Promise.allSettled(cleanupPromises);
    this.sessionMap.clear();
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get replay statistics
   */
  public static getReplayStats(result: ReplayResult): {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    passRate: number;
  } {
    const total = result.steps.length;
    const passed = result.steps.filter((s) => s.status === 'pass').length;
    const failed = result.steps.filter((s) => s.status === 'fail').length;
    const skipped = result.steps.filter((s) => s.status === 'skip').length;
    const passRate = total > 0 ? passed / total : 0;

    return {
      total,
      passed,
      failed,
      skipped,
      passRate,
    };
  }

  /**
   * Format replay result as human-readable string
   */
  public static formatResult(result: ReplayResult): string {
    const stats = TestReplayEngine.getReplayStats(result);
    const lines: string[] = [];

    lines.push(`Replay Result: ${result.recording}`);
    lines.push(`Status: ${result.status.toUpperCase()}`);
    lines.push(`Duration: ${result.duration}ms`);
    lines.push(
      `Steps: ${stats.passed}/${stats.total} passed (${(stats.passRate * 100).toFixed(1)}%)`
    );

    if (stats.failed > 0) {
      lines.push(`Failed: ${stats.failed}`);
    }
    if (stats.skipped > 0) {
      lines.push(`Skipped: ${stats.skipped}`);
    }

    if (result.error) {
      lines.push(`Error: ${result.error.message}`);
    }

    return lines.join('\n');
  }
}
