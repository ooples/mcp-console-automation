import { ConsoleManager } from './core/ConsoleManager.js';

async function testLocal() {
  console.log('Testing local shell functionality...');

  try {
    const manager = new ConsoleManager();
    console.log('ConsoleManager created successfully');

    // Test creating a PowerShell session
    const sessionId = await manager.createSession({
      command: 'powershell',
      args: ['-NoProfile', '-Command', 'Write-Host "PowerShell test successful"'],
      consoleType: 'powershell'
    });

    console.log(`PowerShell session created with ID: ${sessionId}`);
    
    // Get session to check status
    const session = manager.getSession(sessionId);
    if (session) {
      console.log(`Session status: ${session.status}`);
    }

    // Wait a bit for output
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Get output
    const output = await manager.getOutput(sessionId);
    console.log('Session output:', output);

    // Send another command
    await manager.sendInput(sessionId, 'Get-Date\n');
    
    // Wait for response
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Get new output
    const newOutput = await manager.getOutput(sessionId);
    console.log('New output:', newOutput);

    // Close session
    await manager.stopSession(sessionId);
    console.log('Session closed successfully');

    console.log('\nLocal shell test completed successfully!');
  } catch (error) {
    console.error('Local test failed:', error);
  }
}

testLocal().catch(console.error);