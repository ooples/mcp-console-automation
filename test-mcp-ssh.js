#!/usr/bin/env node

/**
 * Test MCP SSH session creation
 */

import { ConsoleManager } from './dist/core/ConsoleManager.js';

async function testMCPSSH() {
  const manager = new ConsoleManager();
  
  console.log('Testing MCP SSH session creation...');
  
  try {
    // Test with profile
    const profileList = manager.listConnectionProfiles();
    console.log('Available profiles:', profileList);
    
    // Create session with SSH options directly
    console.log('\nAttempting to create SSH session...');
    
    const sessionOptions = {
      command: 'echo "Connected successfully"',
      consoleType: 'ssh',
      sshOptions: {
        host: '170.64.174.26',
        port: 22,
        username: 'runner',
        privateKeyPath: 'C:\\Users\\yolan\\.ssh\\id_rsa',
        // Add these options to prevent hanging
        tryKeyboard: false,
        readyTimeout: 10000,
        algorithms: {
          serverHostKey: ['ssh-ed25519', 'ssh-rsa']
        }
      },
      timeout: 15000 // Overall timeout
    };
    
    console.log('Creating session with options:', sessionOptions);
    
    const sessionId = await manager.createSession(sessionOptions);
    console.log('Session created:', sessionId);
    
    // Wait a bit for connection
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Get output
    const output = manager.getOutput(sessionId);
    console.log('Output:', output);
    
    // Stop session
    await manager.stopSession(sessionId);
    console.log('Session stopped');
    
  } catch (error) {
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await manager.destroy();
  }
}

// Run test
testMCPSSH().then(() => {
  console.log('Test completed');
  process.exit(0);
}).catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});