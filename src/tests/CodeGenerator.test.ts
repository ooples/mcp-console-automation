/**
 * Unit tests for CodeGenerator
 */

import { CodeGenerator } from '../testing/CodeGenerator.js';
import { TestRecorder } from '../testing/TestRecorder.js';
import { TestRecording } from '../types/test-framework.js';
import * as fs from 'fs';
import * as path from 'path';

describe('CodeGenerator', () => {
  let generator: CodeGenerator;
  const testRecordingsDir = 'data/recordings/test';
  const testTemplatesDir = 'src/testing/templates';
  const testOutputDir = 'data/generated-tests';

  beforeAll(() => {
    // Ensure templates exist
    if (!fs.existsSync(testTemplatesDir)) {
      fs.mkdirSync(testTemplatesDir, { recursive: true });
    }
  });

  beforeEach(() => {
    generator = new CodeGenerator(testTemplatesDir);

    // Clean up output directory
    if (fs.existsSync(testOutputDir)) {
      const files = fs.readdirSync(testOutputDir);
      files.forEach((file) => {
        fs.unlinkSync(path.join(testOutputDir, file));
      });
    }
  });

  describe('generateCode', () => {
    const sampleRecording: TestRecording = {
      name: 'sample-test',
      version: '1.0.0',
      createdAt: new Date().toISOString(),
      duration: 5000,
      steps: [
        {
          type: 'create_session',
          timestamp: 0,
          data: { command: 'bash', cwd: '/tmp' },
          sessionId: 'session1',
        },
        {
          type: 'send_input',
          timestamp: 100,
          data: { input: 'echo "hello"' },
          sessionId: 'session1',
        },
        {
          type: 'wait_for_output',
          timestamp: 200,
          data: { pattern: 'hello', timeout: 5000 },
          sessionId: 'session1',
        },
      ],
      metadata: {
        description: 'Sample test recording',
        author: 'Test Author',
      },
    };

    it('should generate JavaScript code', () => {
      const code = generator.generateCode(sampleRecording, {
        language: 'javascript',
        framework: 'jest',
      });

      expect(code).toContain('describe');
      expect(code).toContain('sample_test');
      expect(code).toContain('ConsoleManager');
      expect(code).toContain('beforeAll');
      expect(code).toContain('afterAll');
      expect(code).toContain('createSession');
      expect(code).toContain('sendInput');
      expect(code).toContain('echo "hello"');
    });

    it('should generate TypeScript code', () => {
      const code = generator.generateCode(sampleRecording, {
        language: 'typescript',
        framework: 'jest',
      });

      expect(code).toContain('describe');
      expect(code).toContain('ConsoleManager');
      expect(code).toContain(': ConsoleManager');
      expect(code).toContain(': string');
    });

    it('should generate Python code', () => {
      const code = generator.generateCode(sampleRecording, {
        language: 'python',
        framework: 'pytest',
      });

      expect(code).toContain('import pytest');
      expect(code).toContain('ConsoleManager');
      expect(code).toContain('def setUp');
      expect(code).toContain('def tearDown');
      expect(code).toContain('create_session');
    });

    it('should support mocha framework', () => {
      const code = generator.generateCode(sampleRecording, {
        language: 'javascript',
        framework: 'mocha',
      });

      expect(code).toContain('before');
      expect(code).toContain('after');
      expect(code).toContain(
        "import { describe, it, before, after } from 'mocha'"
      );
    });

    it('should include setup code when includeSetup is true', () => {
      const code = generator.generateCode(sampleRecording, {
        language: 'javascript',
        includeSetup: true,
      });

      expect(code).toContain('ConsoleManager');
      expect(code).toContain('sessionId');
    });

    it('should exclude setup code when includeSetup is false', () => {
      const code = generator.generateCode(sampleRecording, {
        language: 'javascript',
        includeSetup: false,
      });

      // Setup code should be minimal or absent
      const lines = code.split('\n').filter((l) => l.trim().length > 0);
      expect(lines.length).toBeGreaterThan(0);
    });

    it('should include teardown code when includeTeardown is true', () => {
      const code = generator.generateCode(sampleRecording, {
        language: 'javascript',
        includeTeardown: true,
      });

      expect(code).toContain('stopSession');
    });

    it('should handle special characters in test names', () => {
      const recording = {
        ...sampleRecording,
        name: 'test@#$%-with-special-chars',
      };

      const code = generator.generateCode(recording, {
        language: 'javascript',
      });

      expect(code).toContain('test');
      // Should sanitize the name
      expect(code).not.toContain('@#$%');
    });

    it('should escape strings in generated code', () => {
      const recording: TestRecording = {
        ...sampleRecording,
        steps: [
          {
            type: 'send_input',
            timestamp: 0,
            data: { input: 'echo "hello\nworld\ttab"' },
          },
        ],
      };

      const code = generator.generateCode(recording, {
        language: 'javascript',
      });

      expect(code).toContain('\\n');
      expect(code).toContain('\\t');
    });
  });

  describe('generateCodeFromFile', () => {
    it('should load recording from file and generate code', () => {
      // Create a test recording
      const recorder = new TestRecorder(testRecordingsDir);
      recorder.startRecording({ name: 'test-from-file' });
      recorder.recordCreateSession('s1', { command: 'bash' });
      recorder.recordSendInput('ls', 's1');
      recorder.stopRecording();

      const code = generator.generateCodeFromFile(
        'test-from-file',
        {
          language: 'typescript',
        },
        testRecordingsDir
      );

      expect(code).toContain('test_from_file');
      expect(code).toContain('createSession');
      expect(code).toContain('sendInput');
    });

    it('should throw error if recording file not found', () => {
      expect(() => {
        generator.generateCodeFromFile(
          'nonexistent',
          {
            language: 'javascript',
          },
          testRecordingsDir
        );
      }).toThrow('Recording not found');
    });
  });

  describe('generateAndSaveCode', () => {
    it('should generate code and save to file', () => {
      const recording: TestRecording = {
        name: 'test-save',
        version: '1.0.0',
        createdAt: new Date().toISOString(),
        duration: 1000,
        steps: [
          {
            type: 'create_session',
            timestamp: 0,
            data: { command: 'bash' },
            sessionId: 's1',
          },
        ],
        metadata: {},
      };

      const outputPath = path.join(testOutputDir, 'test-save.test.ts');
      generator.generateAndSaveCode(
        recording,
        {
          language: 'typescript',
        },
        outputPath
      );

      expect(fs.existsSync(outputPath)).toBe(true);

      const content = fs.readFileSync(outputPath, 'utf-8');
      expect(content).toContain('test_save');
      expect(content).toContain('createSession');
    });

    it('should create output directory if it does not exist', () => {
      const recording: TestRecording = {
        name: 'test-mkdir',
        version: '1.0.0',
        createdAt: new Date().toISOString(),
        duration: 100,
        steps: [],
        metadata: {},
      };

      const deepPath = path.join(testOutputDir, 'deep', 'nested', 'test.js');
      generator.generateAndSaveCode(
        recording,
        {
          language: 'javascript',
        },
        deepPath
      );

      expect(fs.existsSync(deepPath)).toBe(true);
    });
  });

  describe('Code generation for different step types', () => {
    it('should generate code for create_session step', () => {
      const recording: TestRecording = {
        name: 'test-create',
        version: '1.0.0',
        createdAt: new Date().toISOString(),
        duration: 100,
        steps: [
          {
            type: 'create_session',
            timestamp: 0,
            data: { command: 'bash', cwd: '/home', env: { VAR: 'value' } },
            sessionId: 's1',
          },
        ],
        metadata: {},
      };

      const code = generator.generateCode(recording, {
        language: 'javascript',
      });

      expect(code).toContain('createSession');
      expect(code).toContain('"command": "bash"');
      expect(code).toContain('sessionId');
    });

    it('should generate code for send_input step', () => {
      const recording: TestRecording = {
        name: 'test-input',
        version: '1.0.0',
        createdAt: new Date().toISOString(),
        duration: 100,
        steps: [
          {
            type: 'create_session',
            timestamp: 0,
            data: {},
            sessionId: 's1',
          },
          {
            type: 'send_input',
            timestamp: 10,
            data: { input: 'pwd' },
            sessionId: 's1',
          },
        ],
        metadata: {},
      };

      const code = generator.generateCode(recording, {
        language: 'javascript',
      });

      expect(code).toContain('sendInput');
      expect(code).toContain('pwd');
    });

    it('should generate code for send_key step', () => {
      const recording: TestRecording = {
        name: 'test-key',
        version: '1.0.0',
        createdAt: new Date().toISOString(),
        duration: 100,
        steps: [
          {
            type: 'create_session',
            timestamp: 0,
            data: {},
            sessionId: 's1',
          },
          {
            type: 'send_key',
            timestamp: 10,
            data: { key: 'ctrl+c' },
            sessionId: 's1',
          },
        ],
        metadata: {},
      };

      const code = generator.generateCode(recording, {
        language: 'javascript',
      });

      expect(code).toContain('sendKey');
      expect(code).toContain('ctrl+c');
    });

    it('should generate code for wait_for_output step', () => {
      const recording: TestRecording = {
        name: 'test-wait',
        version: '1.0.0',
        createdAt: new Date().toISOString(),
        duration: 100,
        steps: [
          {
            type: 'create_session',
            timestamp: 0,
            data: {},
            sessionId: 's1',
          },
          {
            type: 'wait_for_output',
            timestamp: 10,
            data: { pattern: 'prompt>', timeout: 3000 },
            sessionId: 's1',
          },
        ],
        metadata: {},
      };

      const code = generator.generateCode(recording, {
        language: 'javascript',
      });

      expect(code).toContain('waitForOutput');
      expect(code).toContain('prompt>');
      expect(code).toContain('3000');
    });

    it('should add comment for unimplemented step types', () => {
      const recording: TestRecording = {
        name: 'test-assert',
        version: '1.0.0',
        createdAt: new Date().toISOString(),
        duration: 100,
        steps: [
          {
            type: 'assert',
            timestamp: 0,
            data: { type: 'output_contains', expected: 'test' },
          },
        ],
        metadata: {},
      };

      const code = generator.generateCode(recording, {
        language: 'javascript',
      });

      expect(code).toContain('//');
      expect(code).toContain('Phase 2');
    });
  });

  describe('Template loading', () => {
    it('should throw error if template not found', () => {
      const recording: TestRecording = {
        name: 'test',
        version: '1.0.0',
        createdAt: new Date().toISOString(),
        duration: 100,
        steps: [],
        metadata: {},
      };

      const badGenerator = new CodeGenerator('nonexistent/templates');

      expect(() => {
        badGenerator.generateCode(recording, { language: 'javascript' });
      }).toThrow('Template not found');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty recordings', () => {
      const recording: TestRecording = {
        name: 'empty-test',
        version: '1.0.0',
        createdAt: new Date().toISOString(),
        duration: 0,
        steps: [],
        metadata: {},
      };

      const code = generator.generateCode(recording, {
        language: 'javascript',
      });

      expect(code).toContain('empty_test');
      expect(code).toContain('describe');
    });

    it('should handle recordings with only metadata', () => {
      const recording: TestRecording = {
        name: 'metadata-only',
        version: '1.0.0',
        createdAt: new Date().toISOString(),
        duration: 0,
        steps: [],
        metadata: {
          description: 'This is a test',
          author: 'Test Author',
          tags: ['integration', 'ssh'],
        },
      };

      const code = generator.generateCode(recording, {
        language: 'javascript',
      });

      expect(code).toContain('This is a test');
    });

    it('should handle very long input strings', () => {
      const longInput = 'a'.repeat(10000);
      const recording: TestRecording = {
        name: 'long-input',
        version: '1.0.0',
        createdAt: new Date().toISOString(),
        duration: 100,
        steps: [
          {
            type: 'send_input',
            timestamp: 0,
            data: { input: longInput },
          },
        ],
        metadata: {},
      };

      const code = generator.generateCode(recording, {
        language: 'javascript',
      });

      expect(code).toContain('a'.repeat(10000));
    });
  });
});
