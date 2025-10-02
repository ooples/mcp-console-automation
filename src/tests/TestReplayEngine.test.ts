/**
 * Unit tests for TestReplayEngine
 */

import { TestReplayEngine } from '../testing/TestReplayEngine.js';
import { TestRecorder } from '../testing/TestRecorder.js';
import { TestRecording } from '../types/test-framework.js';
import { ConsoleManager } from '../core/ConsoleManager.js';

// Mock ConsoleManager
jest.mock('../core/ConsoleManager');

describe('TestReplayEngine', () => {
  let engine: TestReplayEngine;
  let mockConsoleManager: jest.Mocked<ConsoleManager>;
  const testOutputDir = 'data/recordings/test';

  beforeEach(() => {
    mockConsoleManager = new ConsoleManager() as jest.Mocked<ConsoleManager>;
    engine = new TestReplayEngine(mockConsoleManager);

    // Setup default mocks
    mockConsoleManager.createSession = jest.fn().mockResolvedValue({
      sessionId: 'test-session-123',
      success: true
    });

    mockConsoleManager.sendInput = jest.fn().mockResolvedValue({
      success: true,
      output: 'Command executed'
    });

    mockConsoleManager.sendKey = jest.fn().mockResolvedValue({
      success: true,
      output: 'Key sent'
    });

    mockConsoleManager.waitForOutput = jest.fn().mockResolvedValue({
      success: true,
      output: 'Pattern matched'
    });

    mockConsoleManager.stopSession = jest.fn().mockResolvedValue({
      success: true
    });
  });

  describe('replay', () => {
    it('should replay a simple recording', async () => {
      const recording: TestRecording = {
        name: 'test-recording',
        version: '1.0.0',
        createdAt: new Date().toISOString(),
        duration: 1000,
        steps: [
          {
            type: 'create_session',
            timestamp: 0,
            data: { command: 'bash' },
            sessionId: 'session1'
          },
          {
            type: 'send_input',
            timestamp: 100,
            data: { input: 'echo hello' },
            sessionId: 'session1'
          }
        ],
        metadata: {}
      };

      const result = await engine.replay(recording);

      expect(result.status).toBe('success');
      expect(result.steps.length).toBe(2);
      expect(result.steps[0].status).toBe('pass');
      expect(result.steps[1].status).toBe('pass');
      expect(mockConsoleManager.createSession).toHaveBeenCalledWith({ command: 'bash' });
      expect(mockConsoleManager.sendInput).toHaveBeenCalled();
    });

    it('should handle recording with wait_for_output', async () => {
      const recording: TestRecording = {
        name: 'test-wait',
        version: '1.0.0',
        createdAt: new Date().toISOString(),
        duration: 500,
        steps: [
          {
            type: 'create_session',
            timestamp: 0,
            data: { command: 'bash' },
            sessionId: 'session1'
          },
          {
            type: 'wait_for_output',
            timestamp: 100,
            data: { pattern: 'prompt>', timeout: 5000 },
            sessionId: 'session1'
          }
        ],
        metadata: {}
      };

      const result = await engine.replay(recording);

      expect(result.status).toBe('success');
      expect(mockConsoleManager.waitForOutput).toHaveBeenCalledWith({
        sessionId: 'test-session-123',
        pattern: 'prompt>',
        timeout: 5000
      });
    });

    it('should skip assertion and snapshot steps (Phase 2)', async () => {
      const recording: TestRecording = {
        name: 'test-skip',
        version: '1.0.0',
        createdAt: new Date().toISOString(),
        duration: 100,
        steps: [
          {
            type: 'assert',
            timestamp: 0,
            data: { type: 'output_contains', expected: 'hello' }
          },
          {
            type: 'snapshot',
            timestamp: 50,
            data: { name: 'state1' }
          }
        ],
        metadata: {}
      };

      const result = await engine.replay(recording);

      expect(result.status).toBe('success');
      expect(result.steps[0].status).toBe('skip');
      expect(result.steps[1].status).toBe('skip');
    });

    it('should handle errors in steps', async () => {
      mockConsoleManager.sendInput = jest.fn().mockRejectedValue(new Error('Send failed'));

      const recording: TestRecording = {
        name: 'test-error',
        version: '1.0.0',
        createdAt: new Date().toISOString(),
        duration: 100,
        steps: [
          {
            type: 'create_session',
            timestamp: 0,
            data: { command: 'bash' },
            sessionId: 'session1'
          },
          {
            type: 'send_input',
            timestamp: 10,
            data: { input: 'test' },
            sessionId: 'session1'
          }
        ],
        metadata: {}
      };

      const result = await engine.replay(recording);

      expect(result.status).toBe('failure');
      expect(result.steps[1].status).toBe('fail');
      expect(result.steps[1].error?.message).toContain('Send failed');
    });

    it('should stop on error if stopOnError is true', async () => {
      mockConsoleManager.createSession = jest.fn()
        .mockResolvedValueOnce({ sessionId: 'session1' })
        .mockRejectedValue(new Error('Failed'));

      const recording: TestRecording = {
        name: 'test-stop',
        version: '1.0.0',
        createdAt: new Date().toISOString(),
        duration: 100,
        steps: [
          { type: 'create_session', timestamp: 0, data: {}, sessionId: 's1' },
          { type: 'create_session', timestamp: 10, data: {}, sessionId: 's2' },
          { type: 'send_input', timestamp: 20, data: { input: 'test' } }
        ],
        metadata: {}
      };

      const result = await engine.replay(recording, { stopOnError: true });

      expect(result.steps.length).toBe(2); // Should stop after second step fails
      expect(result.status).toBe('failure');
    });

    it('should continue on error if stopOnError is false', async () => {
      mockConsoleManager.sendInput = jest.fn()
        .mockRejectedValueOnce(new Error('Error 1'))
        .mockResolvedValueOnce({ success: true });

      const recording: TestRecording = {
        name: 'test-continue',
        version: '1.0.0',
        createdAt: new Date().toISOString(),
        duration: 100,
        steps: [
          { type: 'create_session', timestamp: 0, data: {}, sessionId: 's1' },
          { type: 'send_input', timestamp: 10, data: { input: 'fail' } },
          { type: 'send_input', timestamp: 20, data: { input: 'success' } }
        ],
        metadata: {}
      };

      const result = await engine.replay(recording, { stopOnError: false });

      expect(result.steps.length).toBe(3);
      expect(result.status).toBe('failure'); // Overall failure due to one failed step
    });

    it('should respect timeout option', async () => {
      const recording: TestRecording = {
        name: 'test-timeout',
        version: '1.0.0',
        createdAt: new Date().toISOString(),
        duration: 100,
        steps: [
          { type: 'create_session', timestamp: 0, data: {}, sessionId: 's1' }
        ],
        metadata: {}
      };

      // Mock a slow operation
      mockConsoleManager.createSession = jest.fn((options: any) =>
        new Promise(resolve => setTimeout(() => resolve('s1'), 200))
      ) as any;

      const result = await engine.replay(recording, { timeout: 100 });

      expect(result.status).toBe('error');
      expect(result.error?.message).toContain('timeout');
    }, 10000);

    it('should validate output if validateOutput is true', async () => {
      mockConsoleManager.sendInput = jest.fn().mockResolvedValue({
        success: true,
        output: 'different output'
      });

      const recording: TestRecording = {
        name: 'test-validate',
        version: '1.0.0',
        createdAt: new Date().toISOString(),
        duration: 100,
        steps: [
          { type: 'create_session', timestamp: 0, data: {}, sessionId: 's1' },
          {
            type: 'send_input',
            timestamp: 10,
            data: { input: 'test' },
            output: 'expected output',
            sessionId: 's1'
          }
        ],
        metadata: {}
      };

      const result = await engine.replay(recording, { validateOutput: true });

      expect(result.steps[1].status).toBe('fail');
      expect(result.steps[1].error?.message).toContain('Output mismatch');
    });

    it('should cleanup sessions after replay', async () => {
      const recording: TestRecording = {
        name: 'test-cleanup',
        version: '1.0.0',
        createdAt: new Date().toISOString(),
        duration: 100,
        steps: [
          { type: 'create_session', timestamp: 0, data: {}, sessionId: 's1' },
          { type: 'create_session', timestamp: 10, data: {}, sessionId: 's2' }
        ],
        metadata: {}
      };

      await engine.replay(recording);

      expect(mockConsoleManager.stopSession).toHaveBeenCalledTimes(2);
    });
  });

  describe('replayByName', () => {
    it('should load and replay recording by name', async () => {
      // Create a test recording file
      const recorder = new TestRecorder(testOutputDir);
      recorder.startRecording({ name: 'test-by-name' });
      recorder.recordCreateSession('s1', { command: 'bash' });
      recorder.stopRecording();

      const result = await engine.replayByName('test-by-name', {}, testOutputDir);

      expect(result.recording).toBe('test-by-name');
      expect(result.steps.length).toBeGreaterThan(0);
    });

    it('should throw error if recording not found', async () => {
      await expect(
        engine.replayByName('nonexistent', {}, testOutputDir)
      ).rejects.toThrow('Recording not found');
    });
  });

  describe('Speed control', () => {
    it('should replay at normal speed (1x)', async () => {
      const recording: TestRecording = {
        name: 'test-speed-1x',
        version: '1.0.0',
        createdAt: new Date().toISOString(),
        duration: 100,
        steps: [
          { type: 'create_session', timestamp: 0, data: {}, sessionId: 's1' },
          { type: 'send_input', timestamp: 100, data: { input: 'test' }, sessionId: 's1' }
        ],
        metadata: {}
      };

      const start = Date.now();
      await engine.replay(recording, { speed: 1.0 });
      const duration = Date.now() - start;

      // Should take roughly 100ms (with some tolerance)
      expect(duration).toBeGreaterThanOrEqual(90);
    }, 10000);

    it('should replay at 2x speed', async () => {
      const recording: TestRecording = {
        name: 'test-speed-2x',
        version: '1.0.0',
        createdAt: new Date().toISOString(),
        duration: 100,
        steps: [
          { type: 'create_session', timestamp: 0, data: {}, sessionId: 's1' },
          { type: 'send_input', timestamp: 100, data: { input: 'test' }, sessionId: 's1' }
        ],
        metadata: {}
      };

      const start = Date.now();
      await engine.replay(recording, { speed: 2.0 });
      const duration = Date.now() - start;

      // Should take roughly 50ms
      expect(duration).toBeLessThan(90);
    }, 10000);

    it('should fast-forward when speed is 0', async () => {
      const recording: TestRecording = {
        name: 'test-fast-forward',
        version: '1.0.0',
        createdAt: new Date().toISOString(),
        duration: 1000,
        steps: [
          { type: 'create_session', timestamp: 0, data: {}, sessionId: 's1' },
          { type: 'send_input', timestamp: 1000, data: { input: 'test' }, sessionId: 's1' }
        ],
        metadata: {}
      };

      const start = Date.now();
      await engine.replay(recording, { speed: 0, preserveTiming: false });
      const duration = Date.now() - start;

      // Should complete almost immediately (no timing delays)
      expect(duration).toBeLessThan(100);
    });
  });

  describe('Static methods', () => {
    describe('getReplayStats', () => {
      it('should calculate replay statistics', () => {
        const result = {
          recording: 'test',
          status: 'success' as const,
          duration: 1000,
          steps: [
            { step: {} as any, status: 'pass' as const, duration: 100 },
            { step: {} as any, status: 'pass' as const, duration: 200 },
            { step: {} as any, status: 'fail' as const, duration: 150 },
            { step: {} as any, status: 'skip' as const, duration: 50 }
          ]
        };

        const stats = TestReplayEngine.getReplayStats(result);

        expect(stats.total).toBe(4);
        expect(stats.passed).toBe(2);
        expect(stats.failed).toBe(1);
        expect(stats.skipped).toBe(1);
        expect(stats.passRate).toBe(0.5);
      });
    });

    describe('formatResult', () => {
      it('should format result as human-readable string', () => {
        const result = {
          recording: 'test-recording',
          status: 'success' as const,
          duration: 1234,
          steps: [
            { step: {} as any, status: 'pass' as const, duration: 100 },
            { step: {} as any, status: 'pass' as const, duration: 200 }
          ]
        };

        const formatted = TestReplayEngine.formatResult(result);

        expect(formatted).toContain('test-recording');
        expect(formatted).toContain('SUCCESS');
        expect(formatted).toContain('1234ms');
        expect(formatted).toContain('2/2 passed');
      });

      it('should include error message if present', () => {
        const result = {
          recording: 'test-error',
          status: 'error' as const,
          duration: 100,
          steps: [],
          error: new Error('Test error message')
        };

        const formatted = TestReplayEngine.formatResult(result);

        expect(formatted).toContain('Test error message');
      });
    });
  });
});
