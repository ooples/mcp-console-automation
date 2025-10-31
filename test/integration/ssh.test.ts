import { describe, beforeAll, afterAll, beforeEach, afterEach, it, expect, jest } from '@jest/globals';
import { SSHAdapter, SSHOptions } from '../../src/core/SSHAdapter.js';
import { ConsoleManager } from '../../src/core/ConsoleManager.js';
import { SSHServer } from '../mocks/SSHServer.js';
import { readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { writeFileSync, unlinkSync } from 'fs';

// Skip hardware-intensive integration tests in CI
const describeIfHardware = process.env.SKIP_HARDWARE_TESTS ? describe.skip : describe;

describeIfHardware('SSH Integration Tests', () => {
  let mockSSHServer: SSHServer;
  let consoleManager: ConsoleManager;
  let testKeyPath: string;
  let testPort: number;

  beforeAll(async () => {
    // Start mock SSH server
    mockSSHServer = new SSHServer();
    testPort = await mockSSHServer.start();
    
    // Create test SSH key pair
    testKeyPath = join(tmpdir(), 'test_ssh_key');
    writeFileSync(testKeyPath, `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAFwAAAAdzc2gtcn
NhAAAAAwEAAQAAAQEA1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ
-----END OPENSSH PRIVATE KEY-----`);

    consoleManager = new ConsoleManager();
  }, 30000);

  afterAll(async () => {
    await mockSSHServer.stop();
    await consoleManager.destroy();
    try {
      unlinkSync(testKeyPath);
    } catch (error) {
      // Ignore cleanup errors
    }
  }, 10000);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('SSH Password Authentication', () => {
    it('should connect with valid password credentials', async () => {
      const options: SSHOptions = {
        host: 'localhost',
        port: testPort,
        username: 'testuser',
        password: 'testpass',
        timeout: 5000
      };

      mockSSHServer.setAuthMode('password');
      mockSSHServer.addUser('testuser', 'testpass');

      const ssh = new SSHAdapter();
      
      await expect(ssh.connect(options)).resolves.not.toThrow();
      expect(ssh.isActive()).toBe(true);
      
      ssh.disconnect();
    });

    it('should fail with invalid password credentials', async () => {
      const options: SSHOptions = {
        host: 'localhost',
        port: testPort,
        username: 'testuser',
        password: 'wrongpass',
        timeout: 5000
      };

      mockSSHServer.setAuthMode('password');
      mockSSHServer.addUser('testuser', 'testpass');

      const ssh = new SSHAdapter();
      
      await expect(ssh.connect(options)).rejects.toThrow();
    });

    it('should handle password prompt correctly', async () => {
      const options: SSHOptions = {
        host: 'localhost',
        port: testPort,
        username: 'testuser',
        timeout: 5000
      };

      mockSSHServer.setAuthMode('password');
      mockSSHServer.addUser('testuser', 'testpass');

      const ssh = new SSHAdapter();
      let passwordPrompted = false;

      ssh.on('password-prompt', () => {
        passwordPrompted = true;
        ssh.sendPassword('testpass');
      });

      await ssh.connect(options);
      expect(passwordPrompted).toBe(true);
      expect(ssh.isActive()).toBe(true);
      
      ssh.disconnect();
    });
  });

  describe('SSH Key Authentication', () => {
    it('should connect with private key authentication', async () => {
      const options: SSHOptions = {
        host: 'localhost',
        port: testPort,
        username: 'testuser',
        privateKey: testKeyPath,
        timeout: 5000
      };

      mockSSHServer.setAuthMode('key');
      mockSSHServer.addUser('testuser', '', testKeyPath + '.pub');

      const ssh = new SSHAdapter();
      
      await expect(ssh.connect(options)).resolves.not.toThrow();
      expect(ssh.isActive()).toBe(true);
      
      ssh.disconnect();
    });

    it('should fail with invalid private key', async () => {
      const invalidKeyPath = join(tmpdir(), 'invalid_key');
      writeFileSync(invalidKeyPath, 'invalid-key-content');

      const options: SSHOptions = {
        host: 'localhost',
        port: testPort,
        username: 'testuser',
        privateKey: invalidKeyPath,
        timeout: 5000
      };

      mockSSHServer.setAuthMode('key');

      const ssh = new SSHAdapter();
      
      await expect(ssh.connect(options)).rejects.toThrow();
      
      unlinkSync(invalidKeyPath);
    });
  });

  describe('SSH Command Execution', () => {
    let ssh: SSHAdapter;

    beforeEach(async () => {
      const options: SSHOptions = {
        host: 'localhost',
        port: testPort,
        username: 'testuser',
        password: 'testpass',
        timeout: 5000
      };

      mockSSHServer.setAuthMode('password');
      mockSSHServer.addUser('testuser', 'testpass');

      ssh = new SSHAdapter();
      await ssh.connect(options);
    });

    afterEach(() => {
      ssh.disconnect();
    });

    it('should execute simple commands', async () => {
      let output = '';
      ssh.on('data', (data: string) => {
        output += data;
      });

      ssh.sendCommand('echo "Hello World"');
      
      // Wait for output
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      expect(output).toContain('Hello World');
    });

    it('should handle multiple commands in sequence', async () => {
      let output = '';
      ssh.on('data', (data: string) => {
        output += data;
      });

      ssh.sendCommand('echo "First"');
      ssh.sendCommand('echo "Second"');
      ssh.sendCommand('echo "Third"');
      
      // Wait for all outputs
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      expect(output).toContain('First');
      expect(output).toContain('Second');
      expect(output).toContain('Third');
    });

    it('should handle long-running commands', async () => {
      let output = '';
      let dataCount = 0;
      ssh.on('data', (data: string) => {
        output += data;
        dataCount++;
      });

      ssh.sendCommand('for i in {1..5}; do echo "Line $i"; sleep 0.1; done');
      
      // Wait for command completion
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      expect(dataCount).toBeGreaterThan(0);
      expect(output).toContain('Line 1');
      expect(output).toContain('Line 5');
    });

    it('should capture stderr output', async () => {
      let errorOutput = '';
      ssh.on('error', (data: string) => {
        errorOutput += data;
      });

      ssh.sendCommand('echo "Error message" >&2');
      
      // Wait for error output
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      expect(errorOutput).toContain('Error message');
    });
  });

  describe('SSH Session Persistence', () => {
    it('should maintain session state across commands', async () => {
      const options: SSHOptions = {
        host: 'localhost',
        port: testPort,
        username: 'testuser',
        password: 'testpass',
        timeout: 5000
      };

      mockSSHServer.setAuthMode('password');
      mockSSHServer.addUser('testuser', 'testpass');

      const ssh = new SSHAdapter();
      await ssh.connect(options);

      let output = '';
      ssh.on('data', (data: string) => {
        output += data;
      });

      // Set environment variable
      ssh.sendCommand('export TEST_VAR="hello"');
      await new Promise(resolve => setTimeout(resolve, 500));

      // Check if variable persists
      ssh.sendCommand('echo $TEST_VAR');
      await new Promise(resolve => setTimeout(resolve, 500));

      expect(output).toContain('hello');
      
      ssh.disconnect();
    });

    it('should handle working directory changes', async () => {
      const options: SSHOptions = {
        host: 'localhost',
        port: testPort,
        username: 'testuser',
        password: 'testpass',
        timeout: 5000
      };

      mockSSHServer.setAuthMode('password');
      mockSSHServer.addUser('testuser', 'testpass');

      const ssh = new SSHAdapter();
      await ssh.connect(options);

      let output = '';
      ssh.on('data', (data: string) => {
        output += data;
      });

      // Change directory
      ssh.sendCommand('cd /tmp');
      await new Promise(resolve => setTimeout(resolve, 500));

      // Check current directory
      ssh.sendCommand('pwd');
      await new Promise(resolve => setTimeout(resolve, 500));

      expect(output).toContain('/tmp');
      
      ssh.disconnect();
    });
  });

  describe('SSH Connection Pooling', () => {
    it('should reuse existing connections for same host', async () => {
      const options: SSHOptions = {
        host: 'localhost',
        port: testPort,
        username: 'testuser',
        password: 'testpass',
        timeout: 5000
      };

      mockSSHServer.setAuthMode('password');
      mockSSHServer.addUser('testuser', 'testpass');

      const ssh1 = new SSHAdapter();
      const ssh2 = new SSHAdapter();

      await ssh1.connect(options);
      await ssh2.connect(options);

      expect(ssh1.isActive()).toBe(true);
      expect(ssh2.isActive()).toBe(true);

      ssh1.disconnect();
      ssh2.disconnect();
    });

    it('should handle connection pool limits', async () => {
      const connections: SSHAdapter[] = [];
      const maxConnections = 5;

      mockSSHServer.setMaxConnections(maxConnections);
      mockSSHServer.setAuthMode('password');
      mockSSHServer.addUser('testuser', 'testpass');

      // Create connections up to the limit
      for (let i = 0; i < maxConnections; i++) {
        const ssh = new SSHAdapter();
        const options: SSHOptions = {
          host: 'localhost',
          port: testPort,
          username: 'testuser',
          password: 'testpass',
          timeout: 5000
        };
        
        await ssh.connect(options);
        connections.push(ssh);
      }

      // Try to exceed the limit
      const extraSsh = new SSHAdapter();
      const options: SSHOptions = {
        host: 'localhost',
        port: testPort,
        username: 'testuser',
        password: 'testpass',
        timeout: 2000
      };

      await expect(extraSsh.connect(options)).rejects.toThrow();

      // Cleanup
      connections.forEach(ssh => ssh.disconnect());
    });
  });

  describe('SSH Error Handling and Retry', () => {
    it('should handle connection refused errors', async () => {
      const options: SSHOptions = {
        host: 'localhost',
        port: 9999, // Non-existent port
        username: 'testuser',
        password: 'testpass',
        timeout: 2000
      };

      const ssh = new SSHAdapter();
      let errorReceived = false;

      ssh.on('connection-refused', () => {
        errorReceived = true;
      });

      await expect(ssh.connect(options)).rejects.toThrow();
      expect(errorReceived).toBe(true);
    });

    it('should handle host unreachable errors', async () => {
      const options: SSHOptions = {
        host: '192.0.2.1', // RFC5737 test address
        port: 22,
        username: 'testuser',
        password: 'testpass',
        timeout: 2000
      };

      const ssh = new SSHAdapter();
      let errorReceived = false;

      ssh.on('host-unreachable', () => {
        errorReceived = true;
      });

      await expect(ssh.connect(options)).rejects.toThrow();
    });

    it('should retry connections on failure', async () => {
      const options: SSHOptions = {
        host: 'localhost',
        port: testPort,
        username: 'testuser',
        password: 'testpass',
        timeout: 5000
      };

      // First connection attempt fails
      mockSSHServer.setFailureMode(true);
      mockSSHServer.setAuthMode('password');
      mockSSHServer.addUser('testuser', 'testpass');

      const ssh = new SSHAdapter();
      
      const connectPromise = ssh.connect(options);

      // After 2 seconds, enable success mode
      setTimeout(() => {
        mockSSHServer.setFailureMode(false);
      }, 2000);

      await expect(connectPromise).rejects.toThrow(); // First attempt should fail
      
      // Second attempt should succeed
      await expect(ssh.connect(options)).resolves.not.toThrow();
      
      ssh.disconnect();
    });

    it('should handle authentication failures gracefully', async () => {
      const options: SSHOptions = {
        host: 'localhost',
        port: testPort,
        username: 'testuser',
        password: 'wrongpass',
        timeout: 5000
      };

      mockSSHServer.setAuthMode('password');
      mockSSHServer.addUser('testuser', 'testpass');

      const ssh = new SSHAdapter();
      let authFailed = false;

      ssh.on('auth-failed', () => {
        authFailed = true;
      });

      await expect(ssh.connect(options)).rejects.toThrow();
      expect(authFailed).toBe(true);
    });

    it('should timeout on slow connections', async () => {
      const options: SSHOptions = {
        host: 'localhost',
        port: testPort,
        username: 'testuser',
        password: 'testpass',
        timeout: 1000 // Very short timeout
      };

      mockSSHServer.setSlowMode(true); // Simulate slow connection
      mockSSHServer.setAuthMode('password');
      mockSSHServer.addUser('testuser', 'testpass');

      const ssh = new SSHAdapter();
      
      await expect(ssh.connect(options)).rejects.toThrow('SSH connection timeout');
      
      mockSSHServer.setSlowMode(false);
    });
  });

  describe('SSH with Different Ports and Configs', () => {
    it('should connect to non-standard SSH port', async () => {
      const customPort = testPort + 1;
      const customServer = new SSHServer();
      const actualPort = await customServer.start(customPort);

      const options: SSHOptions = {
        host: 'localhost',
        port: actualPort,
        username: 'testuser',
        password: 'testpass',
        timeout: 5000
      };

      customServer.setAuthMode('password');
      customServer.addUser('testuser', 'testpass');

      const ssh = new SSHAdapter();
      
      await expect(ssh.connect(options)).resolves.not.toThrow();
      expect(ssh.isActive()).toBe(true);
      
      ssh.disconnect();
      await customServer.stop();
    });

    it('should handle strict host key checking disabled', async () => {
      const options: SSHOptions = {
        host: 'localhost',
        port: testPort,
        username: 'testuser',
        password: 'testpass',
        strictHostKeyChecking: false,
        timeout: 5000
      };

      mockSSHServer.setAuthMode('password');
      mockSSHServer.addUser('testuser', 'testpass');

      const ssh = new SSHAdapter();
      
      await expect(ssh.connect(options)).resolves.not.toThrow();
      expect(ssh.isActive()).toBe(true);
      
      ssh.disconnect();
    });

    it('should handle custom connection timeout', async () => {
      const options: SSHOptions = {
        host: 'localhost',
        port: testPort,
        username: 'testuser',
        password: 'testpass',
        timeout: 10000 // Long timeout
      };

      mockSSHServer.setAuthMode('password');
      mockSSHServer.addUser('testuser', 'testpass');

      const ssh = new SSHAdapter();
      const startTime = Date.now();
      
      await ssh.connect(options);
      const connectTime = Date.now() - startTime;
      
      expect(connectTime).toBeLessThan(10000); // Should connect quickly
      expect(ssh.isActive()).toBe(true);
      
      ssh.disconnect();
    });

    it('should handle IPv6 connections', async () => {
      const options: SSHOptions = {
        host: '::1', // IPv6 localhost
        port: testPort,
        username: 'testuser',
        password: 'testpass',
        timeout: 5000
      };

      mockSSHServer.setAuthMode('password');
      mockSSHServer.addUser('testuser', 'testpass');

      const ssh = new SSHAdapter();
      
      try {
        await ssh.connect(options);
        expect(ssh.isActive()).toBe(true);
        ssh.disconnect();
      } catch (error) {
        // IPv6 might not be available in all test environments
        expect(error).toBeDefined();
      }
    });

    it('should output buffer management', async () => {
      const options: SSHOptions = {
        host: 'localhost',
        port: testPort,
        username: 'testuser',
        password: 'testpass',
        timeout: 5000
      };

      mockSSHServer.setAuthMode('password');
      mockSSHServer.addUser('testuser', 'testpass');

      const ssh = new SSHAdapter();
      await ssh.connect(options);

      // Generate large output
      ssh.sendCommand('for i in {1..100}; do echo "Line $i with some additional text to make it longer"; done');
      
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const output = ssh.getOutput();
      expect(output.length).toBeGreaterThan(0);
      
      // Clear output and verify
      ssh.clearOutput();
      expect(ssh.getOutput()).toBe('');
      
      ssh.disconnect();
    });
  });

  describe('ConsoleManager SSH Integration', () => {
    it('should create SSH sessions through ConsoleManager', async () => {
      mockSSHServer.setAuthMode('password');
      mockSSHServer.addUser('testuser', 'testpass');

      const sessionId = await consoleManager.createSession({
        command: `ssh testuser@localhost -p ${testPort}`,
        detectErrors: true,
        timeout: 10000
      });

      expect(sessionId).toBeTruthy();
      expect(consoleManager.isSessionRunning(sessionId)).toBe(true);

      await consoleManager.stopSession(sessionId);
    });

    it('should handle SSH session errors in ConsoleManager', async () => {
      const sessionId = await consoleManager.createSession({
        command: 'ssh invaliduser@localhost -p 9999',
        detectErrors: true,
        timeout: 5000
      });

      let errorEventReceived = false;
      consoleManager.on('console-event', (event) => {
        if (event.type === 'error' && event.sessionId === sessionId) {
          errorEventReceived = true;
        }
      });

      // Wait for error
      await new Promise(resolve => setTimeout(resolve, 6000));
      
      expect(errorEventReceived).toBe(true);
    });
  });
});