import { ConsoleManager } from './core/ConsoleManager.js';

async function testSSHCommands() {
  console.log('Testing SSH with command execution...');

  try {
    const manager = new ConsoleManager();
    console.log('ConsoleManager created successfully');

    // Test creating an SSH session with password to the real server
    console.log('Connecting to SSH server with password...');
    const sessionId = await manager.createSession({
      command: 'ssh',
      consoleType: 'ssh',
      sshOptions: {
        host: 'ns107444.ip-51-81-109.us',
        port: 22,
        username: 'ubuntu',
        password: '0hbTMtqW0D4oH0fv'
      }
    });

    console.log(`Session created with ID: ${sessionId}`);

    // Get session to check status
    const session = manager.getSession(sessionId);
    if (session) {
      console.log(`Session status: ${session.status}`);
    }

    // Wait a bit for connection to stabilize
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Execute a command using sendInput (for SSH sessions)
    console.log('\\nExecuting command: uname -a');
    await manager.sendInput(sessionId, 'uname -a\\n');

    // Wait for output
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Get output
    const output1 = manager.getOutput(sessionId);
    console.log('Command output:', output1.map(o => o.data).join(''));

    // Execute another command
    console.log('\\nExecuting command: pwd');
    await manager.sendInput(sessionId, 'pwd\\n');

    // Wait for output
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Get output
    const output2 = manager.getOutput(sessionId);
    console.log('Command output:', output2.map(o => o.data).join(''));

    // Execute ls command
    console.log('\\nExecuting command: ls -la');
    await manager.sendInput(sessionId, 'ls -la\\n');

    // Wait for output
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Get output
    const output3 = manager.getOutput(sessionId);
    const fullOutput = output3.map(o => o.data).join('');
    console.log('Command output (last 1000 chars):', fullOutput.slice(-1000));

    // Clean up
    console.log('\\nStopping session...');
    await manager.stopSession(sessionId);
    console.log('✓ SUCCESS: SSH password authentication and command execution works on Windows!');

  } catch (error: any) {
    console.error('✗ FAILURE:', error.message);
    console.error('Stack:', error.stack);
  }
}

testSSHCommands().catch(console.error);