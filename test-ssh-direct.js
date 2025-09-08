import { ConsoleManager } from './dist/core/ConsoleManager.js';

async function testDirectSSH() {
  console.log('Testing direct SSH connection with enhanced MCP...\n');
  
  const manager = new ConsoleManager();
  
  try {
    // Create SSH session
    console.log('Creating SSH session to 51.81.109.208...');
    const sessionId = await manager.createSession({
      command: 'ssh',
      args: [],
      type: 'ssh',
      ssh: {
        host: '51.81.109.208',
        port: 22,
        username: 'ubuntu',
        password: '0hbTMtqW0D4oH0fv'
      },
      enableMonitoring: true,
      detectErrors: true
    });
    
    console.log(`Session created: ${sessionId}\n`);
    
    // Wait for connection
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Execute command
    console.log('Executing command: uname -a');
    await manager.executeCommand(sessionId, 'uname -a');
    
    // Wait for output
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Get output
    const output = await manager.getOutput(sessionId);
    console.log('\nCommand output:');
    console.log(output.output);
    
    // Execute another command
    console.log('\nExecuting command: ls -la');
    await manager.executeCommand(sessionId, 'ls -la');
    
    // Wait for output
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Get output again
    const output2 = await manager.getOutput(sessionId);
    console.log('\nCommand output:');
    console.log(output2.output);
    
    // Stop session
    console.log('\nStopping session...');
    await manager.stopSession(sessionId);
    console.log('Session stopped successfully');
    
  } catch (error) {
    console.error('Error during SSH test:', error);
    console.error('Stack:', error.stack);
  } finally {
    await manager.cleanup();
  }
}

// Run test
testDirectSSH().catch(console.error);