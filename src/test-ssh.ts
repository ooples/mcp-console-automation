import { ConsoleManager } from './core/ConsoleManager.js';

async function testSSH() {
  console.log('Testing SSH functionality...');

  try {
    const manager = new ConsoleManager();
    console.log('ConsoleManager created successfully');

    // Test creating an SSH session to GitHub runner
    const sessionId = await manager.createSession({
      command: 'ssh',
      args: ['-T', 'git@github.com'],
      consoleType: 'ssh',
      sshOptions: {
        host: 'github.com',
        port: 22,
        username: 'git',
        privateKeyPath: 'C:\\Users\\yolan\\.ssh\\id_ed25519'
      }
    });

    console.log(`SSH session created with ID: ${sessionId}`);
    
    // Get session to check status
    const session = manager.getSession(sessionId);
    if (session) {
      console.log(`Session status: ${session.status}`);
    }

    // Send a test command
    await manager.sendInput(sessionId, 'echo "SSH test successful"\n');

    // Wait a bit for output
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Get output
    const output = await manager.getOutput(sessionId);
    console.log('Session output:', output);

    // Close session
    await manager.stopSession(sessionId);
    console.log('Session closed successfully');

    console.log('\nSSH test completed successfully!');
  } catch (error) {
    console.error('SSH test failed:', error);
  }
}

testSSH().catch(console.error);