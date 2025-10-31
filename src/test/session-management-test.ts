#!/usr/bin/env node
/**
 * Test session management fixes - validates one-shot vs persistent detection
 */

import { BaseProtocol } from '../core/BaseProtocol.js';
import {
  ConsoleSession,
  ConsoleOutput,
  SessionOptions,
  ConsoleType,
} from '../types/index.js';
import { SessionState, ProtocolCapabilities } from '../core/IProtocol.js';

/**
 * Test protocol implementation for validating session management fixes
 */
class TestProtocol extends BaseProtocol {
  public readonly type: ConsoleType = 'cmd';
  public readonly capabilities: ProtocolCapabilities = {
    supportsStreaming: true,
    supportsFileTransfer: false,
    supportsX11Forwarding: false,
    supportsPortForwarding: false,
    supportsAuthentication: false,
    supportsEncryption: false,
    supportsCompression: false,
    supportsMultiplexing: false,
    supportsKeepAlive: false,
    supportsReconnection: false,
    supportsBinaryData: false,
    supportsCustomEnvironment: true,
    supportsWorkingDirectory: true,
    supportsSignals: true,
    supportsResizing: false,
    supportsPTY: false,
    maxConcurrentSessions: 10,
    defaultTimeout: 30000,
    supportedEncodings: ['utf-8'],
    supportedAuthMethods: [],
    platformSupport: {
      windows: true,
      linux: true,
      macos: true,
      freebsd: false,
    },
  };

  async initialize(): Promise<void> {
    this.isInitialized = true;
  }

  async dispose(): Promise<void> {
    await this.cleanup();
  }

  async createSession(options: SessionOptions): Promise<ConsoleSession> {
    const sessionId = `test-${Date.now()}`;
    return await this.createSessionWithTypeDetection(sessionId, options);
  }

  protected async doCreateSession(
    sessionId: string,
    options: SessionOptions,
    sessionState: SessionState
  ): Promise<ConsoleSession> {
    const session: ConsoleSession = {
      id: sessionId,
      command: options.command || 'echo',
      args: options.args || [],
      cwd: options.cwd || process.cwd(),
      env: options.env || {},
      createdAt: new Date(),
      status: 'running',
      type: this.type,
      streaming: options.streaming || false,
      executionState: 'idle',
      activeCommands: new Map(),
    };

    this.sessions.set(sessionId, session);
    this.outputBuffers.set(sessionId, []);

    // Simulate output for testing
    setTimeout(() => {
      this.simulateOutput(sessionId, options);
    }, 100);

    return session;
  }

  async closeSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
    this.outputBuffers.delete(sessionId);
    this.markSessionComplete(sessionId, 0);
  }

  async executeCommand(
    sessionId: string,
    command: string,
    args?: string[]
  ): Promise<void> {
    // Simulate command execution
    const output: ConsoleOutput = {
      sessionId,
      type: 'stdout',
      data: `Executed: ${command} ${args?.join(' ') || ''}`,
      timestamp: new Date(),
    };

    this.addToOutputBuffer(sessionId, output);
  }

  async sendInput(sessionId: string, input: string): Promise<void> {
    // Simulate input processing
    const output: ConsoleOutput = {
      sessionId,
      type: 'stdout',
      data: `Input received: ${input}`,
      timestamp: new Date(),
    };

    this.addToOutputBuffer(sessionId, output);
  }

  private simulateOutput(sessionId: string, options: SessionOptions): void {
    const isOneShot = this.isOneShotCommand(options);

    const output: ConsoleOutput = {
      sessionId,
      type: 'stdout',
      data: isOneShot
        ? 'One-shot command completed'
        : 'Persistent session ready',
      timestamp: new Date(),
    };

    this.addToOutputBuffer(sessionId, output);

    if (isOneShot) {
      // Mark one-shot sessions as complete
      setTimeout(() => {
        this.markSessionComplete(sessionId, 0);
      }, 200);
    }
  }
}

/**
 * Test session management functionality
 */
async function runSessionManagementTests(): Promise<void> {
  console.log('🧪 Testing Session Management Fixes\n');

  const protocol = new TestProtocol('TestProtocol');
  await protocol.initialize();

  const tests = [
    {
      name: 'PowerShell one-shot detection',
      options: {
        command: 'powershell',
        args: ['-Command', 'echo "Hello World"'],
      },
      expectedType: 'oneshot',
    },
    {
      name: 'CMD one-shot detection',
      options: {
        command: 'cmd',
        args: ['/c', 'echo Hello World'],
      },
      expectedType: 'oneshot',
    },
    {
      name: 'Bash one-shot detection',
      options: {
        command: 'bash',
        args: ['-c', 'echo "Hello World"'],
      },
      expectedType: 'oneshot',
    },
    {
      name: 'PowerShell persistent detection',
      options: {
        command: 'powershell',
        args: ['-NoExit'],
      },
      expectedType: 'persistent',
    },
    {
      name: 'SSH with command (one-shot)',
      options: {
        command: 'ssh',
        args: ['user@host', 'ls', '-la'],
      },
      expectedType: 'oneshot',
    },
    {
      name: 'SSH interactive (persistent)',
      options: {
        command: 'ssh',
        args: ['user@host'],
      },
      expectedType: 'persistent',
    },
    {
      name: 'Docker exec with command (one-shot)',
      options: {
        command: 'docker',
        args: ['exec', 'container', 'ls', '-la'],
      },
      expectedType: 'oneshot',
    },
    {
      name: 'Kubectl exec with command (one-shot)',
      options: {
        command: 'kubectl',
        args: ['exec', 'pod', '--', 'ls', '-la'],
      },
      expectedType: 'oneshot',
    },
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    console.log(`📝 Testing: ${test.name}`);

    try {
      const session = await protocol.createSession(test.options);
      const sessionState = await protocol.getSessionState(session.id);

      const actualType = sessionState.isOneShot ? 'oneshot' : 'persistent';

      if (actualType === test.expectedType) {
        console.log(`  ✅ PASS - Detected as ${actualType}`);
        passed++;
      } else {
        console.log(
          `  ❌ FAIL - Expected ${test.expectedType}, got ${actualType}`
        );
        failed++;
      }

      // Test output retrieval
      await new Promise((resolve) => setTimeout(resolve, 500));
      const output = await protocol.getOutput(session.id);

      if (output.length > 0) {
        console.log(`  ✅ Output captured: "${output[0].data}"`);
      } else {
        console.log(`  ⚠️  No output captured`);
      }

      await protocol.closeSession(session.id);
    } catch (error) {
      console.log(
        `  ❌ ERROR: ${error instanceof Error ? error.message : String(error)}`
      );
      failed++;
    }

    console.log('');
  }

  console.log('📊 Test Results:');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(
    `📈 Success Rate: ${Math.round((passed / (passed + failed)) * 100)}%\n`
  );

  if (failed === 0) {
    console.log('🎉 All session management tests passed!');
  } else {
    console.log('⚠️ Some tests failed. Session management fixes need review.');
  }

  await protocol.dispose();
}

// Always run tests when this file is executed
runSessionManagementTests().catch(console.error);

export { runSessionManagementTests };
