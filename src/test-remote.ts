import { ConsoleManager } from './core/ConsoleManager.js';

async function testRemote() {
  console.log('Testing remote SSH connection with saved profile...');

  try {
    const manager = new ConsoleManager();
    console.log('ConsoleManager created successfully');

    // Use the saved SSH profile for GitHub runner
    const sessionId = await manager.createSession({
      command: 'ssh',
      args: [],
      consoleType: 'ssh',
      sshOptions: {
        host: 'ns107444.ip-51-81-109.us',
        username: 'ubuntu',
        password: '0hbTMtqW0D4oH0fv',
        port: 22
      }
    });

    console.log(`SSH session created with ID: ${sessionId}`);
    
    // Get session to check status
    const session = manager.getSession(sessionId);
    if (session) {
      console.log(`Session status: ${session.status}`);
    }

    // Wait for connection
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Send a test command
    await manager.sendInput(sessionId, 'hostname\n');
    
    // Wait for response
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Get output
    const output = await manager.getOutput(sessionId);
    console.log('Session output:', output.map(o => o.data).join(''));

    // Send another command
    await manager.sendInput(sessionId, 'ls -la /opt/runner-autoscaler\n');
    
    // Wait for response
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Get new output
    const newOutput = await manager.getOutput(sessionId);
    console.log('Directory listing:', newOutput.slice(-5).map(o => o.data).join(''));

    // Check runner status
    await manager.sendInput(sessionId, 'systemctl status runner-autoscaler --no-pager\n');
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const statusOutput = await manager.getOutput(sessionId);
    console.log('Runner status:', statusOutput.slice(-10).map(o => o.data).join(''));

    // Close session
    await manager.stopSession(sessionId);
    console.log('Session closed successfully');

    console.log('\n✅ Remote SSH test completed successfully!');
    return true;
  } catch (error) {
    console.error('❌ Remote test failed:', error);
    return false;
  }
}

testRemote().then(success => {
  process.exit(success ? 0 : 1);
}).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});