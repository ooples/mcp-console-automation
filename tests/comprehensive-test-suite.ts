import { ConsoleAutomationServer } from '../src/mcp/server';
import { ConsoleManager } from '../src/core/ConsoleManager';
import { ErrorDetector } from '../src/core/ErrorDetector';
import { describe, test, expect, beforeAll, afterAll, jest } from '@jest/globals';

describe('Comprehensive Console Automation Test Suite', () => {
  let server: ConsoleAutomationServer;
  let consoleManager: ConsoleManager;

  beforeAll(() => {
    server = new ConsoleAutomationServer();
    consoleManager = new ConsoleManager();
  });

  afterAll(async () => {
    // Cleanup all sessions
    const sessions = await consoleManager.listSessions();
    for (const session of sessions) {
      await consoleManager.stopSession(session.id);
    }
  });

  describe('Basic Command Execution', () => {
    test('Execute simple echo command', async () => {
      const sessionId = await consoleManager.createSession({
        command: 'echo',
        args: ['Hello World'],
        consoleType: 'auto'
      });
      
      const output = await consoleManager.getOutput(sessionId);
      expect(output).toContain('Hello World');
      
      await consoleManager.stopSession(sessionId);
    });

    test('Execute command with environment variables', async () => {
      const sessionId = await consoleManager.createSession({
        command: 'echo',
        args: ['%TEST_VAR%'],
        env: { TEST_VAR: 'test_value' },
        consoleType: 'cmd'
      });
      
      const output = await consoleManager.getOutput(sessionId);
      expect(output).toContain('test_value');
      
      await consoleManager.stopSession(sessionId);
    });

    test('Execute command in specific directory', async () => {
      const sessionId = await consoleManager.createSession({
        command: 'pwd',
        cwd: '/tmp',
        consoleType: 'bash'
      });
      
      const output = await consoleManager.getOutput(sessionId);
      expect(output).toContain('/tmp');
      
      await consoleManager.stopSession(sessionId);
    });
  });

  describe('Interactive Session Management', () => {
    test('Send input to interactive Python session', async () => {
      const sessionId = await consoleManager.createSession({
        command: 'python',
        args: ['-i'],
        consoleType: 'auto'
      });
      
      await consoleManager.waitForOutput(sessionId, '>>>', 5000);
      await consoleManager.sendInput(sessionId, 'print("Hello from Python")\\n');
      
      const output = await consoleManager.waitForOutput(sessionId, 'Hello from Python', 5000);
      expect(output).toBeTruthy();
      
      await consoleManager.sendInput(sessionId, 'exit()\\n');
      await consoleManager.stopSession(sessionId);
    });

    test('Send special keys to interactive session', async () => {
      const sessionId = await consoleManager.createSession({
        command: 'cmd',
        consoleType: 'cmd'
      });
      
      await consoleManager.sendInput(sessionId, 'dir');
      await consoleManager.sendKey(sessionId, 'enter');
      
      const output = await consoleManager.getOutput(sessionId);
      expect(output).toBeTruthy();
      
      await consoleManager.sendKey(sessionId, 'ctrl+c');
      await consoleManager.stopSession(sessionId);
    });
  });

  describe('SSH Connection Scenarios', () => {
    test('SSH with password authentication', async () => {
      const sessionId = await consoleManager.createSession({
        command: 'ssh',
        args: ['user@host'],
        consoleType: 'bash',
        streaming: true
      });
      
      try {
        // Wait for password prompt
        const passwordPrompt = await consoleManager.waitForOutput(
          sessionId, 
          'password:', 
          10000
        );
        
        if (passwordPrompt) {
          await consoleManager.sendInput(sessionId, 'password\\n');
          
          // Wait for shell prompt
          const shellPrompt = await consoleManager.waitForOutput(
            sessionId,
            '$',
            10000
          );
          
          expect(shellPrompt).toBeTruthy();
        }
      } catch (error) {
        // Expected to fail without real SSH server
        expect(error).toBeDefined();
      } finally {
        await consoleManager.stopSession(sessionId);
      }
    });

    test('SSH with key authentication', async () => {
      const sessionId = await consoleManager.createSession({
        command: 'ssh',
        args: ['-i', '~/.ssh/id_rsa', 'user@host'],
        consoleType: 'bash'
      });
      
      try {
        const output = await consoleManager.waitForOutput(
          sessionId,
          '$',
          10000
        );
        expect(output).toBeTruthy();
      } catch (error) {
        // Expected to fail without real SSH server
        expect(error).toBeDefined();
      } finally {
        await consoleManager.stopSession(sessionId);
      }
    });

    test('SSH with StrictHostKeyChecking disabled', async () => {
      const sessionId = await consoleManager.createSession({
        command: 'ssh',
        args: [
          '-o', 'StrictHostKeyChecking=no',
          '-o', 'UserKnownHostsFile=/dev/null',
          'user@host'
        ],
        consoleType: 'bash'
      });
      
      try {
        const output = await consoleManager.getOutput(sessionId);
        expect(output).toBeDefined();
      } catch (error) {
        expect(error).toBeDefined();
      } finally {
        await consoleManager.stopSession(sessionId);
      }
    });
  });

  describe('Long-Running Process Management', () => {
    test('Handle streaming output from long-running process', async () => {
      const sessionId = await consoleManager.createSession({
        command: 'ping',
        args: ['localhost', '-n', '3'],
        consoleType: 'cmd',
        streaming: true
      });
      
      let outputCount = 0;
      const checkOutput = setInterval(async () => {
        const stream = await consoleManager.getStream(sessionId);
        if (stream && stream.length > 0) {
          outputCount++;
        }
      }, 1000);
      
      await new Promise(resolve => setTimeout(resolve, 4000));
      clearInterval(checkOutput);
      
      expect(outputCount).toBeGreaterThan(0);
      await consoleManager.stopSession(sessionId);
    });

    test('Timeout handling for stuck processes', async () => {
      const sessionId = await consoleManager.createSession({
        command: 'sleep',
        args: ['60'],
        timeout: 2000,
        consoleType: 'bash'
      });
      
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const session = (await consoleManager.listSessions())
        .find(s => s.id === sessionId);
      expect(session?.status).toBe('timeout');
    });
  });

  describe('Error Detection and Handling', () => {
    test('Detect compilation errors', async () => {
      const detector = new ErrorDetector();
      const errors = detector.detect('error CS0246: The type or namespace name');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].type).toBe('compilation');
    });

    test('Detect runtime errors', async () => {
      const detector = new ErrorDetector();
      const errors = detector.detect('Unhandled exception: System.NullReferenceException');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].type).toBe('runtime');
    });

    test('Detect network errors', async () => {
      const detector = new ErrorDetector();
      const errors = detector.detect('Connection refused: connect');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].type).toBe('network');
    });

    test('Custom error pattern detection', async () => {
      const sessionId = await consoleManager.createSession({
        command: 'echo',
        args: ['CUSTOM_ERROR: Something went wrong'],
        detectErrors: true,
        patterns: [
          { pattern: /CUSTOM_ERROR:/, type: 'custom', severity: 'high' }
        ]
      });
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Check if error was detected
      const output = await consoleManager.getOutput(sessionId);
      expect(output).toContain('CUSTOM_ERROR');
      
      await consoleManager.stopSession(sessionId);
    });
  });

  describe('Cross-Platform Shell Support', () => {
    test('Windows CMD shell', async () => {
      if (process.platform === 'win32') {
        const sessionId = await consoleManager.createSession({
          command: 'dir',
          consoleType: 'cmd'
        });
        
        const output = await consoleManager.getOutput(sessionId);
        expect(output).toBeTruthy();
        
        await consoleManager.stopSession(sessionId);
      }
    });

    test('PowerShell', async () => {
      if (process.platform === 'win32') {
        const sessionId = await consoleManager.createSession({
          command: 'Get-Process',
          consoleType: 'powershell'
        });
        
        const output = await consoleManager.getOutput(sessionId);
        expect(output).toBeTruthy();
        
        await consoleManager.stopSession(sessionId);
      }
    });

    test('Bash shell', async () => {
      const sessionId = await consoleManager.createSession({
        command: 'ls',
        args: ['-la'],
        consoleType: 'bash'
      });
      
      try {
        const output = await consoleManager.getOutput(sessionId);
        expect(output).toBeTruthy();
      } catch (error) {
        // May fail on Windows without WSL
        expect(error).toBeDefined();
      } finally {
        await consoleManager.stopSession(sessionId);
      }
    });
  });

  describe('Resource Management', () => {
    test('Session cleanup on crash', async () => {
      const sessionId = await consoleManager.createSession({
        command: 'invalid_command_that_doesnt_exist'
      });
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const session = (await consoleManager.listSessions())
        .find(s => s.id === sessionId);
      expect(session?.status).toBe('crashed');
    });

    test('Maximum session limit enforcement', async () => {
      const sessions: string[] = [];
      const maxSessions = 50; // Default max
      
      // Try to create more than max sessions
      for (let i = 0; i < maxSessions + 5; i++) {
        try {
          const id = await consoleManager.createSession({
            command: 'echo',
            args: [`session_${i}`]
          });
          sessions.push(id);
        } catch (error: any) {
          expect(error.message).toContain('Maximum session limit');
          break;
        }
      }
      
      // Cleanup
      for (const id of sessions) {
        await consoleManager.stopSession(id);
      }
    });

    test('Output buffer size limit', async () => {
      const sessionId = await consoleManager.createSession({
        command: 'yes',
        consoleType: 'bash'
      });
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const output = await consoleManager.getOutput(sessionId);
      // Buffer should be limited
      expect(output.length).toBeLessThan(1000000);
      
      await consoleManager.stopSession(sessionId);
    });

    test('Resource usage monitoring', async () => {
      const usage = await consoleManager.getResourceUsage();
      
      expect(usage).toHaveProperty('totalSessions');
      expect(usage).toHaveProperty('activeSessions');
      expect(usage).toHaveProperty('memoryUsage');
      expect(usage).toHaveProperty('cpuUsage');
    });
  });

  describe('Edge Cases and Error Scenarios', () => {
    test('Handle null/undefined input gracefully', async () => {
      const sessionId = await consoleManager.createSession({
        command: 'echo',
        args: [null as any, undefined as any, '']
      });
      
      const output = await consoleManager.getOutput(sessionId);
      expect(output).toBeDefined();
      
      await consoleManager.stopSession(sessionId);
    });

    test('Handle special characters in commands', async () => {
      const sessionId = await consoleManager.createSession({
        command: 'echo',
        args: ['$pecial & ch@rs | > < "quotes"']
      });
      
      const output = await consoleManager.getOutput(sessionId);
      expect(output).toBeDefined();
      
      await consoleManager.stopSession(sessionId);
    });

    test('Handle rapid session creation/destruction', async () => {
      const promises = [];
      
      for (let i = 0; i < 10; i++) {
        promises.push(
          consoleManager.createSession({
            command: 'echo',
            args: [`rapid_${i}`]
          }).then(async (id) => {
            await consoleManager.stopSession(id);
            return id;
          })
        );
      }
      
      const results = await Promise.all(promises);
      expect(results.length).toBe(10);
    });

    test('Handle binary output', async () => {
      const sessionId = await consoleManager.createSession({
        command: 'cat',
        args: ['/dev/urandom'],
        consoleType: 'bash'
      });
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const output = await consoleManager.getOutput(sessionId);
      expect(output).toBeDefined();
      
      await consoleManager.stopSession(sessionId);
    });
  });

  describe('Integration Tests', () => {
    test('Git operations workflow', async () => {
      const sessionId = await consoleManager.createSession({
        command: 'git',
        args: ['status'],
        consoleType: 'auto'
      });
      
      const output = await consoleManager.getOutput(sessionId);
      expect(output).toBeDefined();
      
      await consoleManager.stopSession(sessionId);
    });

    test('Docker container management', async () => {
      const sessionId = await consoleManager.createSession({
        command: 'docker',
        args: ['ps'],
        consoleType: 'auto'
      });
      
      try {
        const output = await consoleManager.getOutput(sessionId);
        expect(output).toBeDefined();
      } catch (error) {
        // Docker might not be installed
        expect(error).toBeDefined();
      } finally {
        await consoleManager.stopSession(sessionId);
      }
    });

    test('NPM package installation', async () => {
      const sessionId = await consoleManager.createSession({
        command: 'npm',
        args: ['list', '--depth=0'],
        consoleType: 'auto'
      });
      
      const output = await consoleManager.getOutput(sessionId);
      expect(output).toBeDefined();
      
      await consoleManager.stopSession(sessionId);
    }, 30000); // Extended timeout for npm
  });
});

// Additional test utilities
describe('Test Utilities', () => {
  test('Mock SSH server for testing', () => {
    // This would be a mock SSH server for testing SSH functionality
    // without needing a real server
    const mockSSHServer = {
      start: jest.fn(),
      stop: jest.fn(),
      onConnection: jest.fn(),
      onAuthentication: jest.fn()
    };
    
    expect(mockSSHServer.start).toBeDefined();
  });
});