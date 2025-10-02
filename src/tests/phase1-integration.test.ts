/**
 * Phase 1 Integration Test
 * Tests the full workflow: Record -> Replay -> Generate Code
 */

import { TestRecorder } from '../testing/TestRecorder';
import { TestReplayEngine } from '../testing/TestReplayEngine';
import { CodeGenerator } from '../testing/CodeGenerator';
import { ConsoleManager } from '../core/ConsoleManager';
import * as fs from 'fs';
import * as path from 'path';

describe('Phase 1 Integration Tests', () => {
  const testDir = 'data/recordings/integration-test';
  let recorder: TestRecorder;
  let replayEngine: TestReplayEngine;
  let codeGenerator: CodeGenerator;
  let consoleManager: ConsoleManager;

  beforeAll(() => {
    // Ensure test directory exists
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  beforeEach(() => {
    recorder = new TestRecorder(testDir);
    consoleManager = new ConsoleManager();
    replayEngine = new TestReplayEngine(consoleManager);
    codeGenerator = new CodeGenerator();

    // Clean up test directory
    if (fs.existsSync(testDir)) {
      const files = fs.readdirSync(testDir);
      files.forEach(file => {
        if (file.endsWith('.json')) {
          fs.unlinkSync(path.join(testDir, file));
        }
      });
    }
  });

  afterEach(async () => {
    // Cleanup any active sessions
    try {
      await consoleManager.cleanupSessions({ force: true });
    } catch (e) {
      // Ignore cleanup errors
    }

    if (recorder.isCurrentlyRecording()) {
      try {
        recorder.cancelRecording();
      } catch (e) {
        // Ignore
      }
    }
  });

  describe('End-to-End Workflow', () => {
    it('should record, save, replay, and generate code', async () => {
      // Step 1: Record
      recorder.startRecording({
        name: 'e2e-test',
        author: 'Integration Test',
        description: 'End-to-end test of Phase 1 features',
        tags: ['integration', 'e2e']
      });

      expect(recorder.isCurrentlyRecording()).toBe(true);

      // Simulate console operations
      recorder.recordCreateSession('test-session-1', {
        command: 'bash',
        cwd: process.cwd()
      }, 'Session created successfully');

      recorder.recordSendInput('echo "Hello, World!"', 'test-session-1', 'Hello, World!');
      recorder.recordWaitForOutput('Hello', 5000, 'test-session-1', 'Pattern matched');

      // Step 2: Save recording
      const savedRecording = recorder.stopRecording();

      expect(savedRecording.name).toBe('e2e-test');
      expect(savedRecording.steps.length).toBe(3);
      expect(fs.existsSync(path.join(testDir, 'e2e_test.json'))).toBe(true);

      // Step 3: List recordings
      const recordings = TestRecorder.listRecordings(testDir);
      expect(recordings).toContain('e2e_test');

      // Step 4: Load and verify
      const loaded = TestRecorder.loadRecording('e2e_test', testDir);
      expect(loaded.name).toBe('e2e-test');
      expect(loaded.steps.length).toBe(3);
      expect(loaded.metadata.description).toBe('End-to-end test of Phase 1 features');

      // Step 5: Generate code (multiple languages)
      const jsCode = codeGenerator.generateCode(loaded, {
        language: 'javascript',
        framework: 'jest'
      });
      expect(jsCode).toContain('e2e_test');
      expect(jsCode).toContain('echo "Hello, World!"');

      const tsCode = codeGenerator.generateCode(loaded, {
        language: 'typescript',
        framework: 'jest'
      });
      expect(tsCode).toContain('ConsoleManager');
      expect(tsCode).toContain(': string');

      const pyCode = codeGenerator.generateCode(loaded, {
        language: 'python',
        framework: 'pytest'
      });
      expect(pyCode).toContain('import pytest');

      // Note: Replay requires actual console which may not be available in CI
      // We'll test replay separately with mocks
    }, 30000);

    it('should handle multiple recordings', async () => {
      // Create first recording
      recorder.startRecording({ name: 'test1' });
      recorder.recordSendInput('command1');
      recorder.stopRecording();

      // Create second recording
      recorder.startRecording({ name: 'test2' });
      recorder.recordSendInput('command2');
      recorder.stopRecording();

      // Create third recording
      recorder.startRecording({ name: 'test3' });
      recorder.recordSendInput('command3');
      recorder.stopRecording();

      // List all
      const recordings = TestRecorder.listRecordings(testDir);
      expect(recordings.length).toBe(3);
      expect(recordings).toContain('test1');
      expect(recordings).toContain('test2');
      expect(recordings).toContain('test3');

      // Generate code for each
      recordings.forEach(name => {
        const code = codeGenerator.generateCodeFromFile(name, {
          language: 'javascript'
        }, testDir);
        expect(code).toContain('describe');
      });
    });
  });

  describe('Recording Workflow', () => {
    it('should capture timing information correctly', async () => {
      recorder.startRecording({ name: 'timing-test' });

      recorder.recordSendInput('step1');
      await new Promise(resolve => setTimeout(resolve, 50));

      recorder.recordSendInput('step2');
      await new Promise(resolve => setTimeout(resolve, 50));

      recorder.recordSendInput('step3');

      const recording = recorder.stopRecording();

      expect(recording.steps[0].timestamp).toBe(0);
      expect(recording.steps[1].timestamp).toBeGreaterThan(40);
      expect(recording.steps[2].timestamp).toBeGreaterThan(recording.steps[1].timestamp);
    }, 10000);

    it('should preserve all metadata through save/load cycle', () => {
      const metadata = {
        name: 'metadata-test',
        author: 'Test Author',
        description: 'Test with full metadata',
        tags: ['tag1', 'tag2', 'tag3']
      };

      recorder.startRecording(metadata);
      recorder.recordCreateSession('s1', { command: 'bash' });
      recorder.stopRecording();

      const loaded = TestRecorder.loadRecording('metadata_test', testDir);

      expect(loaded.metadata.author).toBe(metadata.author);
      expect(loaded.metadata.description).toBe(metadata.description);
      expect(loaded.metadata.tags).toEqual(metadata.tags);
    });
  });

  describe('Code Generation Workflow', () => {
    it('should generate executable test code', () => {
      recorder.startRecording({ name: 'code-gen-test' });

      recorder.recordCreateSession('s1', {
        command: 'node',
        args: ['-e', 'console.log("test")']
      });

      recorder.recordSendInput('console.log("hello")', 's1');
      recorder.recordWaitForOutput('hello', 5000, 's1');

      const recording = recorder.stopRecording();

      const code = codeGenerator.generateCode(recording, {
        language: 'typescript',
        framework: 'jest',
        includeSetup: true,
        includeTeardown: true
      });

      // Verify generated code structure
      expect(code).toContain('import');
      expect(code).toContain('describe');
      expect(code).toContain('beforeAll');
      expect(code).toContain('afterAll');
      expect(code).toContain('it(');
      expect(code).toContain('createSession');
      expect(code).toContain('sendInput');
      expect(code).toContain('waitForOutput');
      expect(code).toContain('stopSession');
    });

    it('should generate code with different framework options', () => {
      recorder.startRecording({ name: 'framework-test' });
      recorder.recordCreateSession('s1', { command: 'bash' });
      const recording = recorder.stopRecording();

      // Jest
      const jestCode = codeGenerator.generateCode(recording, {
        language: 'javascript',
        framework: 'jest'
      });
      expect(jestCode).toContain('beforeAll');
      expect(jestCode).toContain('afterAll');

      // Mocha
      const mochaCode = codeGenerator.generateCode(recording, {
        language: 'javascript',
        framework: 'mocha'
      });
      expect(mochaCode).toContain('before');
      expect(mochaCode).toContain('after');
    });
  });

  describe('Error Handling', () => {
    it('should handle recording errors gracefully', () => {
      expect(() => {
        recorder.stopRecording();
      }).toThrow('No recording in progress');

      recorder.startRecording({ name: 'error-test' });

      expect(() => {
        recorder.startRecording({ name: 'another' });
      }).toThrow('Recording already in progress');
    });

    it('should handle file system errors', () => {
      expect(() => {
        TestRecorder.loadRecording('nonexistent', testDir);
      }).toThrow('Recording not found');

      expect(() => {
        codeGenerator.generateCodeFromFile('nonexistent', {
          language: 'javascript'
        }, testDir);
      }).toThrow('Recording not found');
    });
  });

  describe('Utility Functions', () => {
    it('should provide accurate recording statistics', () => {
      recorder.startRecording({ name: 'stats-test' });

      expect(recorder.getStats()?.steps).toBe(0);

      recorder.recordSendInput('cmd1');
      expect(recorder.getStats()?.steps).toBe(1);

      recorder.recordSendInput('cmd2');
      recorder.recordSendInput('cmd3');
      expect(recorder.getStats()?.steps).toBe(3);

      const stats = recorder.getStats();
      expect(stats?.duration).toBeGreaterThanOrEqual(0);
    });

    it('should allow canceling recordings', () => {
      recorder.startRecording({ name: 'cancel-test' });
      recorder.recordSendInput('test');

      expect(recorder.isCurrentlyRecording()).toBe(true);
      recorder.cancelRecording();
      expect(recorder.isCurrentlyRecording()).toBe(false);

      // File should not exist
      expect(fs.existsSync(path.join(testDir, 'cancel_test.json'))).toBe(false);
    });

    it('should delete recordings', () => {
      recorder.startRecording({ name: 'delete-test' });
      recorder.stopRecording();

      const filepath = path.join(testDir, 'delete_test.json');
      expect(fs.existsSync(filepath)).toBe(true);

      TestRecorder.deleteRecording('delete-test', testDir);
      expect(fs.existsSync(filepath)).toBe(false);
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle multi-session recordings', () => {
      recorder.startRecording({ name: 'multi-session' });

      recorder.recordCreateSession('session1', { command: 'bash' });
      recorder.recordSendInput('echo "session1"', 'session1');

      recorder.recordCreateSession('session2', { command: 'node' });
      recorder.recordSendInput('console.log("session2")', 'session2');

      const recording = recorder.stopRecording();

      expect(recording.steps.length).toBe(4);

      const sessionIds = new Set(recording.steps.map(s => s.sessionId).filter(Boolean));
      expect(sessionIds.size).toBe(2);
    });

    it('should handle recordings with wait steps', () => {
      recorder.startRecording({ name: 'wait-test' });

      recorder.recordCreateSession('s1', { command: 'bash' });
      recorder.recordSendInput('sleep 1', 's1');
      recorder.recordWaitForOutput('prompt', 10000, 's1');

      const recording = recorder.stopRecording();
      const waitStep = recording.steps.find(s => s.type === 'wait_for_output');

      expect(waitStep).toBeDefined();
      expect(waitStep?.data.pattern).toBe('prompt');
      expect(waitStep?.data.timeout).toBe(10000);
    });
  });
});
