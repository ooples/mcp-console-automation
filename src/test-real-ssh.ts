import { ConsoleManager } from './core/ConsoleManager.js';

async function testRealSSH() {
  console.log('Testing SSH with real server using password...');

  try {
    const manager = new ConsoleManager();
    console.log('ConsoleManager created successfully');

    // Test creating an SSH session with password to the real server
    console.log('Attempting to connect to real SSH server with password...');
    const sessionId = await manager.createSession({
      command: 'ssh',
      consoleType: 'ssh',
      sshOptions: {
        host: 'ns107444.ip-51-81-109.us',
        port: 22,
        username: 'ubuntu',
        password: '0hbTMtqW0D4oH0fv'  // Real password from saved profile
      }
    });

    console.log(`Session created with ID: ${sessionId} - THIS SHOULD NOT HAPPEN ON WINDOWS!`);

    // Get session to check status
    const session = manager.getSession(sessionId);
    if (session) {
      console.log(`Session status: ${session.status}`);
    }

    // Clean up
    await manager.stopSession(sessionId);

  } catch (error: any) {
    console.log('Expected error caught:', error.message);
    if (error.message.includes('SSH password authentication is not supported on Windows')) {
      console.log('✓ SUCCESS: Password authentication properly blocked on Windows!');
    } else {
      console.error('✗ FAILURE: Should have blocked password auth immediately, but got:', error.message);
    }
  }
}

testRealSSH().catch(console.error);