import { ConsoleManager } from './dist/core/ConsoleManager.js';
import { Logger } from './dist/utils/logger.js';

// Set debug logging
process.env.LOG_LEVEL = 'debug';

async function debugSSH() {
  console.log('=== SSH Debug Test ===\n');
  
  const logger = new Logger('debug-ssh');
  const manager = new ConsoleManager();
  
  // Listen to events
  manager.on('session-started', (event) => {
    console.log('Session started:', event);
  });
  
  manager.on('session-output', (event) => {
    console.log('Output:', event.data);
  });
  
  manager.on('session-error', (event) => {
    console.log('Error:', event);
  });
  
  try {
    console.log('Creating SSH session with sshOptions...');
    
    const options = {
      command: 'ssh',
      args: [],
      consoleType: 'ssh',
      sshOptions: {
        host: '51.81.109.208',
        port: 22,
        username: 'ubuntu',
        password: '0hbTMtqW0D4oH0fv'
      },
      detectErrors: true,
      enableMonitoring: true
    };
    
    console.log('Options:', JSON.stringify(options, null, 2));
    
    const sessionId = await manager.createSession(options);
    console.log(`\nSession created successfully: ${sessionId}`);
    
    // Wait for connection
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Execute command
    console.log('\nSending command: whoami');
    await manager.sendInput(sessionId, 'whoami\n');
    
    // Wait for output
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Get output
    const output = await manager.getOutput(sessionId);
    console.log('\nSession output:', output);
    
    // Stop session
    console.log('\nStopping session...');
    await manager.stopSession(sessionId);
    console.log('Session stopped');
    
  } catch (error) {
    console.error('\nError during SSH test:');
    console.error('Message:', error.message);
    console.error('Stack:', error.stack);
    
    // Log additional details
    if (error.code) console.error('Code:', error.code);
    if (error.syscall) console.error('Syscall:', error.syscall);
    if (error.path) console.error('Path:', error.path);
  } finally {
    await manager.cleanup();
    process.exit();
  }
}

// Run debug
debugSSH().catch(console.error);