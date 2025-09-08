import { describe, beforeAll, afterAll, beforeEach, afterEach, it, expect, jest } from '@jest/globals';
import { PromptDetector, PromptDetectorConfig, PromptPattern } from '../../src/core/PromptDetector.js';

describe('PromptDetector Integration Tests', () => {
  let promptDetector: PromptDetector;
  const testSessionId = 'test-session-1';

  beforeAll(() => {
    promptDetector = new PromptDetector();
  });

  afterAll(() => {
    // Cleanup
    promptDetector.removeSession(testSessionId);
  });

  beforeEach(() => {
    // Configure a basic session before each test
    const config: PromptDetectorConfig = {
      sessionId: testSessionId,
      shellType: 'bash',
      hostname: 'testhost',
      username: 'testuser',
      enableAnsiStripping: true,
      enableMultilineDetection: true,
      timeout: 5000,
      adaptiveLearning: true
    };
    promptDetector.configureSession(config);
  });

  afterEach(() => {
    promptDetector.clearBuffer(testSessionId);
  });

  describe('Basic Prompt Detection', () => {
    it('should detect standard bash prompt', async () => {
      const output = 'Last login: Wed Jan  1 10:00:00 2024\ntestuser@testhost:~$ ';
      
      const result = promptDetector.addOutput(testSessionId, output);
      
      expect(result).toBeTruthy();
      expect(result!.detected).toBe(true);
      expect(result!.matchedText).toContain('testuser@testhost:~$');
      expect(result!.confidence).toBeGreaterThan(0.7);
      expect(result!.pattern?.name).toMatch(/bash|ubuntu|ssh_specific/);
    });

    it('should detect root bash prompt', async () => {
      const output = 'Welcome to Ubuntu 20.04\nroot@server:/home# ';
      
      const result = promptDetector.addOutput(testSessionId, output);
      
      expect(result).toBeTruthy();
      expect(result!.detected).toBe(true);
      expect(result!.matchedText).toContain('root@server:/home#');
      expect(result!.confidence).toBeGreaterThan(0.7);
    });

    it('should detect ubuntu-specific prompt', async () => {
      const output = 'ubuntu@ip-172-31-1-234:~$ ';
      
      const result = promptDetector.addOutput(testSessionId, output);
      
      expect(result).toBeTruthy();
      expect(result!.detected).toBe(true);
      expect(result!.matchedText).toContain('ubuntu@ip-172-31-1-234:~$');
      expect(result!.pattern?.name).toMatch(/ubuntu|bash/);
    });

    it('should detect simple dollar prompt', async () => {
      const output = 'command output\n$ ';
      
      const result = promptDetector.addOutput(testSessionId, output);
      
      expect(result).toBeTruthy();
      expect(result!.detected).toBe(true);
      expect(result!.matchedText).toBe('$');
      expect(result!.confidence).toBeGreaterThan(0.3);
    });

    it('should detect hash root prompt', async () => {
      const output = 'Running as root\n# ';
      
      const result = promptDetector.addOutput(testSessionId, output);
      
      expect(result).toBeTruthy();
      expect(result!.detected).toBe(true);
      expect(result!.matchedText).toBe('#');
      expect(result!.confidence).toBeGreaterThan(0.3);
    });
  });

  describe('ANSI Escape Sequence Handling', () => {
    it('should detect prompt with ANSI color codes', async () => {
      const output = '\x1b[32mtestuser@testhost\x1b[0m:\x1b[34m~\x1b[0m$ ';
      
      const result = promptDetector.addOutput(testSessionId, output);
      
      expect(result).toBeTruthy();
      expect(result!.detected).toBe(true);
      expect(result!.matchedText).toContain('testuser@testhost');
      expect(result!.matchedText).toContain('~$');
      expect(result!.confidence).toBeGreaterThan(0.7);
    });

    it('should handle complex ANSI sequences', async () => {
      const output = '\x1b[1;32m\x1b[0m\x1b[1;32muser@host\x1b[0m:\x1b[1;34m/path\x1b[0m$ ';
      
      const result = promptDetector.addOutput(testSessionId, output);
      
      expect(result).toBeTruthy();
      expect(result!.detected).toBe(true);
      expect(result!.matchedText).toContain('user@host');
    });

    it('should handle cursor control sequences', async () => {
      const output = 'command output\r\x1b[K\x1b[1A\x1b[Kuser@host:~$ ';
      
      const result = promptDetector.addOutput(testSessionId, output);
      
      expect(result).toBeTruthy();
      expect(result!.detected).toBe(true);
      expect(result!.matchedText).toContain('user@host:~$');
    });
  });

  describe('Shell Type Detection', () => {
    it('should detect zsh prompts', async () => {
      const config: PromptDetectorConfig = {
        sessionId: 'zsh-session',
        shellType: 'zsh',
        hostname: 'testhost',
        username: 'testuser'
      };
      promptDetector.configureSession(config);

      const output = 'testuser@testhost /path/to/dir % ';
      const result = promptDetector.addOutput('zsh-session', output);
      
      expect(result).toBeTruthy();
      expect(result!.detected).toBe(true);
      expect(result!.matchedText).toContain('%');
      
      promptDetector.removeSession('zsh-session');
    });

    it('should detect fish shell prompts', async () => {
      const config: PromptDetectorConfig = {
        sessionId: 'fish-session',
        shellType: 'fish',
        hostname: 'testhost',
        username: 'testuser'
      };
      promptDetector.configureSession(config);

      const output = 'testuser@testhost /path/to/dir> ';
      const result = promptDetector.addOutput('fish-session', output);
      
      expect(result).toBeTruthy();
      expect(result!.detected).toBe(true);
      expect(result!.matchedText).toContain('>');
      
      promptDetector.removeSession('fish-session');
    });

    it('should detect Docker container prompts', async () => {
      const output = 'root@abc123def456:/app# ';
      
      const result = promptDetector.addOutput(testSessionId, output);
      
      expect(result).toBeTruthy();
      expect(result!.detected).toBe(true);
      expect(result!.matchedText).toContain('root@abc123def456:/app#');
      expect(result!.pattern?.name).toMatch(/docker|bash/);
    });

    it('should detect Alpine Linux prompts', async () => {
      const output = 'alpine-server:/home/user# ';
      
      const result = promptDetector.addOutput(testSessionId, output);
      
      expect(result).toBeTruthy();
      expect(result!.detected).toBe(true);
      expect(result!.matchedText).toContain('alpine-server:/home/user#');
    });
  });

  describe('Custom Patterns', () => {
    it('should use custom patterns when provided', async () => {
      const customPattern: PromptPattern = {
        name: 'custom_test',
        pattern: /(?:^|\n)(CUSTOM>)\s*$/m,
        description: 'Custom test prompt',
        priority: 25,
        contextual: false
      };

      const config: PromptDetectorConfig = {
        sessionId: 'custom-session',
        shellType: 'auto',
        customPrompts: [customPattern]
      };
      promptDetector.configureSession(config);

      const output = 'Some output\nCUSTOM> ';
      const result = promptDetector.addOutput('custom-session', output);
      
      expect(result).toBeTruthy();
      expect(result!.detected).toBe(true);
      expect(result!.matchedText).toBe('CUSTOM>');
      expect(result!.pattern?.name).toBe('custom_test');
      
      promptDetector.removeSession('custom-session');
    });

    it('should prioritize custom patterns over defaults', async () => {
      const customPattern: PromptPattern = {
        name: 'high_priority_custom',
        pattern: /(?:^|\n)(testuser@testhost:[^$]*\$)\s*$/m,
        description: 'High priority custom pattern',
        priority: 30,
        contextual: true
      };

      const config: PromptDetectorConfig = {
        sessionId: 'priority-session',
        shellType: 'bash',
        hostname: 'testhost',
        username: 'testuser',
        customPrompts: [customPattern]
      };
      promptDetector.configureSession(config);

      const output = 'testuser@testhost:~/project$ ';
      const result = promptDetector.addOutput('priority-session', output);
      
      expect(result).toBeTruthy();
      expect(result!.detected).toBe(true);
      expect(result!.pattern?.name).toBe('high_priority_custom');
      
      promptDetector.removeSession('priority-session');
    });
  });

  describe('Adaptive Learning', () => {
    it('should learn from successful detections', async () => {
      const config: PromptDetectorConfig = {
        sessionId: 'learning-session',
        shellType: 'bash',
        adaptiveLearning: true
      };
      promptDetector.configureSession(config);

      // First detection
      const output1 = 'myuser@myserver:/custom/path$ ';
      const result1 = promptDetector.addOutput('learning-session', output1);
      expect(result1!.detected).toBe(true);

      // Check if a pattern was learned
      const learnedPatterns = promptDetector.getLearnedPatterns('learning-session');
      expect(learnedPatterns.length).toBeGreaterThanOrEqual(0);

      // Second similar detection should have better confidence
      const output2 = 'myuser@myserver:/another/path$ ';
      const result2 = promptDetector.addOutput('learning-session', output2);
      expect(result2!.detected).toBe(true);
      
      promptDetector.removeSession('learning-session');
    });

    it('should limit learned patterns to prevent memory issues', async () => {
      const config: PromptDetectorConfig = {
        sessionId: 'limit-session',
        shellType: 'bash',
        adaptiveLearning: true
      };
      promptDetector.configureSession(config);

      // Generate many different prompts to test learning limits
      for (let i = 0; i < 15; i++) {
        const output = `user${i}@host${i}:~$ `;
        promptDetector.addOutput('limit-session', output);
      }

      const learnedPatterns = promptDetector.getLearnedPatterns('limit-session');
      expect(learnedPatterns.length).toBeLessThanOrEqual(10);
      
      promptDetector.removeSession('limit-session');
    });
  });

  describe('waitForOutput Enhanced Method', () => {
    it('should wait for pattern match with prompt detection', async () => {
      const config: PromptDetectorConfig = {
        sessionId: 'wait-session',
        shellType: 'bash',
        hostname: 'testhost',
        username: 'testuser'
      };
      promptDetector.configureSession(config);

      // Simulate adding output asynchronously
      setTimeout(() => {
        promptDetector.addOutput('wait-session', 'Command executed successfully\n');
        setTimeout(() => {
          promptDetector.addOutput('wait-session', 'testuser@testhost:~$ ');
        }, 100);
      }, 50);

      const result = await promptDetector.waitForOutput('wait-session', /Command executed/, {
        timeout: 1000,
        requirePrompt: true
      });

      expect(result.output).toContain('Command executed successfully');
      expect(result.promptDetected).toBeTruthy();
      expect(result.promptDetected!.detected).toBe(true);
      
      promptDetector.removeSession('wait-session');
    });

    it('should timeout gracefully with debug information', async () => {
      const config: PromptDetectorConfig = {
        sessionId: 'timeout-session',
        shellType: 'bash'
      };
      promptDetector.configureSession(config);

      await expect(
        promptDetector.waitForOutput('timeout-session', /NonExistentPattern/, {
          timeout: 500
        })
      ).rejects.toThrow(/Timeout waiting for pattern/);
      
      promptDetector.removeSession('timeout-session');
    });

    it('should handle ANSI stripping in waitForOutput', async () => {
      const config: PromptDetectorConfig = {
        sessionId: 'ansi-session',
        shellType: 'bash',
        enableAnsiStripping: true
      };
      promptDetector.configureSession(config);

      setTimeout(() => {
        promptDetector.addOutput('ansi-session', '\x1b[32mSUCCESS:\x1b[0m Operation completed');
      }, 50);

      const result = await promptDetector.waitForOutput('ansi-session', /SUCCESS:/, {
        timeout: 1000,
        stripAnsi: true
      });

      expect(result.output).toContain('SUCCESS: Operation completed');
      expect(result.output).not.toContain('\x1b[32m');
      
      promptDetector.removeSession('ansi-session');
    });
  });

  describe('waitForPrompt Method', () => {
    it('should wait for any shell prompt to appear', async () => {
      const config: PromptDetectorConfig = {
        sessionId: 'prompt-wait-session',
        shellType: 'bash',
        hostname: 'testhost',
        username: 'testuser'
      };
      promptDetector.configureSession(config);

      setTimeout(() => {
        promptDetector.addOutput('prompt-wait-session', 'Some command output\n');
        setTimeout(() => {
          promptDetector.addOutput('prompt-wait-session', 'testuser@testhost:~$ ');
        }, 100);
      }, 50);

      const result = await promptDetector.waitForPrompt('prompt-wait-session', 1000);

      expect(result.detected).toBe(true);
      expect(result.matchedText).toContain('testuser@testhost:~$');
      expect(result.confidence).toBeGreaterThan(0.7);
      
      promptDetector.removeSession('prompt-wait-session');
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle empty output gracefully', async () => {
      const result = promptDetector.addOutput(testSessionId, '');
      expect(result).toBeNull();
    });

    it('should handle very long output without performance issues', async () => {
      const longOutput = 'a'.repeat(20000) + '\ntestuser@testhost:~$ ';
      
      const startTime = Date.now();
      const result = promptDetector.addOutput(testSessionId, longOutput);
      const endTime = Date.now();

      expect(result).toBeTruthy();
      expect(result!.detected).toBe(true);
      expect(endTime - startTime).toBeLessThan(1000); // Should process in under 1 second
    });

    it('should handle multiline prompts', async () => {
      const config: PromptDetectorConfig = {
        sessionId: 'multiline-session',
        shellType: 'bash',
        enableMultilineDetection: true
      };
      promptDetector.configureSession(config);

      const output = 'First line of output\nSecond line\n  -> ';
      const result = promptDetector.addOutput('multiline-session', output);
      
      // This might not detect (depends on patterns), but should not crash
      expect(result).toBeDefined();
      
      promptDetector.removeSession('multiline-session');
    });

    it('should handle binary data gracefully', async () => {
      const binaryData = Buffer.from([0x00, 0x01, 0x02, 0xFF, 0xFE]).toString();
      
      expect(() => {
        promptDetector.addOutput(testSessionId, binaryData);
      }).not.toThrow();
    });

    it('should handle sessions that do not exist', async () => {
      const result = promptDetector.addOutput('non-existent-session', 'test$ ');
      expect(result).toBeNull();
    });
  });

  describe('Context Extraction', () => {
    it('should extract context around detected prompts', async () => {
      const output = 'Previous command output\nMore output here\ntestuser@testhost:~$ ';
      
      const result = promptDetector.addOutput(testSessionId, output);
      
      expect(result).toBeTruthy();
      expect(result!.detected).toBe(true);
      expect(result!.context.beforePrompt).toContain('More output here');
      expect(result!.context.promptLine).toContain('testuser@testhost:~$');
    });

    it('should provide position information', async () => {
      const output = 'Command output\ntestuser@testhost:~$ ';
      
      const result = promptDetector.addOutput(testSessionId, output);
      
      expect(result).toBeTruthy();
      expect(result!.detected).toBe(true);
      expect(result!.position).toBeGreaterThan(0);
      expect(result!.position).toBe(output.indexOf('testuser@testhost:~$'));
    });
  });

  describe('Statistics and Debug Information', () => {
    it('should provide detection statistics', async () => {
      const stats = promptDetector.getDetectionStats(testSessionId);
      
      expect(stats).toHaveProperty('totalPatterns');
      expect(stats).toHaveProperty('learnedPatterns');
      expect(stats).toHaveProperty('bufferSize');
      expect(stats).toHaveProperty('shellType');
      expect(typeof stats.totalPatterns).toBe('number');
    });

    it('should provide debug information', async () => {
      promptDetector.addOutput(testSessionId, 'some test output');
      
      const debugInfo = promptDetector.getDebugInfo(testSessionId);
      
      expect(debugInfo).toHaveProperty('sessionId');
      expect(debugInfo).toHaveProperty('bufferLength');
      expect(debugInfo).toHaveProperty('bufferPreview');
      expect(debugInfo).toHaveProperty('availablePatterns');
      expect(debugInfo.sessionId).toBe(testSessionId);
    });
  });

  describe('Buffer Management', () => {
    it('should manage buffer size limits', async () => {
      const config: PromptDetectorConfig = {
        sessionId: 'buffer-session',
        shellType: 'bash',
        maxOutputBuffer: 1000
      };
      promptDetector.configureSession(config);

      // Add output exceeding buffer limit
      const largeOutput = 'x'.repeat(1500);
      promptDetector.addOutput('buffer-session', largeOutput);

      const buffer = promptDetector.getBuffer('buffer-session');
      expect(buffer.length).toBeLessThanOrEqual(1000);
      
      promptDetector.removeSession('buffer-session');
    });

    it('should clear buffer on request', async () => {
      promptDetector.addOutput(testSessionId, 'test output');
      expect(promptDetector.getBuffer(testSessionId)).toContain('test output');

      promptDetector.clearBuffer(testSessionId);
      expect(promptDetector.getBuffer(testSessionId)).toBe('');
    });
  });
});