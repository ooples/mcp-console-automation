/**
 * Unit tests for TestRecorder
 */

import { TestRecorder } from '../testing/TestRecorder.js';
import * as fs from 'fs';
import * as path from 'path';

describe('TestRecorder', () => {
  const testOutputDir = 'data/recordings/test';
  let recorder: TestRecorder;

  beforeEach(() => {
    recorder = new TestRecorder(testOutputDir);
    // Clean up test directory
    if (fs.existsSync(testOutputDir)) {
      const files = fs.readdirSync(testOutputDir);
      files.forEach(file => {
        fs.unlinkSync(path.join(testOutputDir, file));
      });
    }
  });

  afterEach(() => {
    // Clean up
    if (recorder.isCurrentlyRecording()) {
      try {
        recorder.cancelRecording();
      } catch (e) {
        // Ignore
      }
    }
  });

  describe('startRecording', () => {
    it('should start a new recording', () => {
      recorder.startRecording({
        name: 'test-recording',
        author: 'Test Author',
        description: 'Test description',
        tags: ['test', 'unit']
      });

      expect(recorder.isCurrentlyRecording()).toBe(true);
      expect(recorder.getRecording()).not.toBeNull();
      expect(recorder.getRecording()?.name).toBe('test-recording');
    });

    it('should throw error if recording already in progress', () => {
      recorder.startRecording({ name: 'test1' });

      expect(() => {
        recorder.startRecording({ name: 'test2' });
      }).toThrow('Recording already in progress');
    });

    it('should capture environment metadata', () => {
      recorder.startRecording({ name: 'test-env' });

      const recording = recorder.getRecording();
      expect(recording?.metadata.environment).toBeDefined();
      expect(recording?.metadata.environment?.platform).toBe(process.platform);
    });
  });

  describe('stopRecording', () => {
    it('should stop recording and save to file', () => {
      recorder.startRecording({ name: 'test-stop' });
      recorder.recordSendInput('echo hello', 'session1');

      const result = recorder.stopRecording();

      expect(result.name).toBe('test-stop');
      expect(result.steps.length).toBe(1);
      expect(recorder.isCurrentlyRecording()).toBe(false);

      // Check file was created
      const filepath = path.join(testOutputDir, 'test_stop.json');
      expect(fs.existsSync(filepath)).toBe(true);
    });

    it('should throw error if no recording in progress', () => {
      expect(() => {
        recorder.stopRecording();
      }).toThrow('No recording in progress');
    });

    it('should include duration in saved recording', () => {
      recorder.startRecording({ name: 'test-duration' });

      const result = recorder.stopRecording();

      expect(result.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('recordCreateSession', () => {
    it('should record a create_session step', () => {
      recorder.startRecording({ name: 'test-create-session' });

      const sessionData = { command: 'bash', cwd: '/tmp' };
      recorder.recordCreateSession('session123', sessionData, 'Session created');

      const recording = recorder.getRecording();
      expect(recording?.steps.length).toBe(1);
      expect(recording?.steps[0].type).toBe('create_session');
      expect(recording?.steps[0].sessionId).toBe('session123');
      expect(recording?.steps[0].data).toEqual(sessionData);
      expect(recording?.steps[0].output).toBe('Session created');
    });

    it('should set currentSessionId', () => {
      recorder.startRecording({ name: 'test-session-id' });
      recorder.recordCreateSession('session456', {});

      // Verify by recording another step without sessionId
      recorder.recordSendInput('test', undefined, 'output');

      const steps = recorder.getRecording()?.steps;
      expect(steps?.[1].sessionId).toBe('session456');
    });
  });

  describe('recordSendInput', () => {
    it('should record a send_input step', () => {
      recorder.startRecording({ name: 'test-input' });
      recorder.recordSendInput('echo test', 'session1', 'test output');

      const steps = recorder.getRecording()?.steps;
      expect(steps?.length).toBe(1);
      expect(steps?.[0].type).toBe('send_input');
      expect(steps?.[0].data.input).toBe('echo test');
      expect(steps?.[0].sessionId).toBe('session1');
    });

    it('should use current session ID if not specified', () => {
      recorder.startRecording({ name: 'test-current-session' });
      recorder.recordCreateSession('session999', {});
      recorder.recordSendInput('test input');

      const steps = recorder.getRecording()?.steps;
      expect(steps?.[1].sessionId).toBe('session999');
    });
  });

  describe('recordSendKey', () => {
    it('should record a send_key step', () => {
      recorder.startRecording({ name: 'test-key' });
      recorder.recordSendKey('enter', 'session1');

      const steps = recorder.getRecording()?.steps;
      expect(steps?.length).toBe(1);
      expect(steps?.[0].type).toBe('send_key');
      expect(steps?.[0].data.key).toBe('enter');
    });
  });

  describe('recordWaitForOutput', () => {
    it('should record a wait_for_output step', () => {
      recorder.startRecording({ name: 'test-wait' });
      recorder.recordWaitForOutput('prompt>', 5000, 'session1', 'matched');

      const steps = recorder.getRecording()?.steps;
      expect(steps?.length).toBe(1);
      expect(steps?.[0].type).toBe('wait_for_output');
      expect(steps?.[0].data.pattern).toBe('prompt>');
      expect(steps?.[0].data.timeout).toBe(5000);
    });
  });

  describe('getStats', () => {
    it('should return recording statistics', () => {
      recorder.startRecording({ name: 'test-stats' });
      recorder.recordSendInput('test1');
      recorder.recordSendInput('test2');
      recorder.recordSendInput('test3');

      const stats = recorder.getStats();
      expect(stats).not.toBeNull();
      expect(stats?.steps).toBe(3);
      expect(stats?.duration).toBeGreaterThanOrEqual(0);
    });

    it('should return null if no recording', () => {
      const stats = recorder.getStats();
      expect(stats).toBeNull();
    });
  });

  describe('cancelRecording', () => {
    it('should cancel recording without saving', () => {
      recorder.startRecording({ name: 'test-cancel' });
      recorder.recordSendInput('test');

      recorder.cancelRecording();

      expect(recorder.isCurrentlyRecording()).toBe(false);
      expect(recorder.getRecording()).toBeNull();

      // Verify file was not created
      const files = fs.existsSync(testOutputDir) ? fs.readdirSync(testOutputDir) : [];
      expect(files.length).toBe(0);
    });

    it('should throw error if no recording in progress', () => {
      expect(() => {
        recorder.cancelRecording();
      }).toThrow('No recording in progress');
    });
  });

  describe('Static methods', () => {
    describe('listRecordings', () => {
      it('should list all recordings in directory', () => {
        // Create some test recordings
        recorder.startRecording({ name: 'test1' });
        recorder.stopRecording();

        recorder.startRecording({ name: 'test2' });
        recorder.stopRecording();

        const recordings = TestRecorder.listRecordings(testOutputDir);
        expect(recordings.length).toBe(2);
        expect(recordings).toContain('test1');
        expect(recordings).toContain('test2');
      });

      it('should return empty array if directory does not exist', () => {
        const recordings = TestRecorder.listRecordings('nonexistent/dir');
        expect(recordings).toEqual([]);
      });
    });

    describe('loadRecording', () => {
      it('should load a recording from file', () => {
        recorder.startRecording({ name: 'test-load' });
        recorder.recordSendInput('test data');
        recorder.stopRecording();

        const loaded = TestRecorder.loadRecording('test-load', testOutputDir);
        expect(loaded.name).toBe('test-load');
        expect(loaded.steps.length).toBe(1);
      });

      it('should throw error if recording not found', () => {
        expect(() => {
          TestRecorder.loadRecording('nonexistent', testOutputDir);
        }).toThrow('Recording not found');
      });

      it('should handle .json extension', () => {
        recorder.startRecording({ name: 'test-ext' });
        recorder.stopRecording();

        const loaded = TestRecorder.loadRecording('test-ext.json', testOutputDir);
        expect(loaded.name).toBe('test-ext');
      });
    });

    describe('deleteRecording', () => {
      it('should delete a recording file', () => {
        recorder.startRecording({ name: 'test-delete' });
        recorder.stopRecording();

        const filepath = path.join(testOutputDir, 'test_delete.json');
        expect(fs.existsSync(filepath)).toBe(true);

        TestRecorder.deleteRecording('test-delete', testOutputDir);
        expect(fs.existsSync(filepath)).toBe(false);
      });

      it('should not throw if file does not exist', () => {
        expect(() => {
          TestRecorder.deleteRecording('nonexistent', testOutputDir);
        }).not.toThrow();
      });
    });
  });

  describe('Timestamp tracking', () => {
    it('should record relative timestamps for steps', async () => {
      recorder.startRecording({ name: 'test-timing' });

      recorder.recordSendInput('step1');
      await new Promise(resolve => setTimeout(resolve, 10));
      recorder.recordSendInput('step2');
      await new Promise(resolve => setTimeout(resolve, 10));
      recorder.recordSendInput('step3');

      const steps = recorder.getRecording()?.steps;
      expect(steps?.[0].timestamp).toBe(0); // First step should be at 0
      expect(steps?.[1].timestamp).toBeGreaterThan(0);
      expect(steps?.[2].timestamp).toBeGreaterThan(steps?.[1].timestamp);
    });
  });

  describe('Edge cases', () => {
    it('should handle special characters in filenames', () => {
      recorder.startRecording({ name: 'test@#$%^&*()' });
      recorder.stopRecording();

      const recordings = TestRecorder.listRecordings(testOutputDir);
      expect(recordings.length).toBe(1);
    });

    it('should handle empty steps array', () => {
      recorder.startRecording({ name: 'test-empty' });
      const result = recorder.stopRecording();

      expect(result.steps.length).toBe(0);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should preserve metadata through save/load cycle', () => {
      const metadata = {
        author: 'John Doe',
        description: 'Test recording',
        tags: ['integration', 'ssh'],
        environment: { test: 'value' }
      };

      recorder.startRecording({
        name: 'test-metadata',
        ...metadata
      });
      recorder.stopRecording();

      const loaded = TestRecorder.loadRecording('test-metadata', testOutputDir);
      expect(loaded.metadata.author).toBe(metadata.author);
      expect(loaded.metadata.description).toBe(metadata.description);
      expect(loaded.metadata.tags).toEqual(metadata.tags);
    });
  });
});
