#!/usr/bin/env node
/**
 * SSH Command Queue Test Example
 * 
 * This example demonstrates the fixed SSH command buffering system that prevents
 * command concatenation when sending commands rapidly.
 * 
 * Before the fix: Commands like "tar xzf file.tar.gz" and "ls -la" would get
 * concatenated as "tar xzf file.tar.gzls -la"
 * 
 * After the fix: Commands are properly queued and separated with delays and
 * acknowledgment detection.
 */

import { ConsoleManager } from '../src/core/ConsoleManager.js';
import { SSHConnectionOptions } from '../src/types/index.js';

async function testSSHCommandQueue() {
  const consoleManager = new ConsoleManager();
  
  // Configure command queue with more aggressive settings for testing
  consoleManager.configureCommandQueue({
    interCommandDelay: 1000,        // 1 second between commands
    acknowledgmentTimeout: 15000,   // 15 seconds to wait for command completion
    enablePromptDetection: true,    // Enable prompt detection for acknowledgment
    defaultPromptPattern: /\$\s*$|#\s*$|>\s*$/m  // Common shell prompts
  });

  console.log('SSH Command Queue Test Starting...\n');
  console.log('Configuration:', consoleManager.getCommandQueueConfig());

  // Example SSH connection options (modify these for your test environment)
  const sshOptions: SSHConnectionOptions = {
    host: 'example.com',           // Replace with your SSH host
    username: 'testuser',          // Replace with your username
    port: 22,
    // Use either password or private key authentication
    password: 'your-password',     // Replace or remove
    // privateKey: '/path/to/private/key',  // Uncomment if using key auth
  };

  let sessionId: string;

  try {
    // Create SSH session
    console.log('Creating SSH session...');
    sessionId = await consoleManager.createSession({
      command: '',  // Empty command for interactive shell
      sshOptions,
      streaming: true,
      timeout: 60000
    });

    console.log(`SSH session created: ${sessionId}\n`);

    // Set up event listeners
    consoleManager.on('console-event', (event) => {
      if (event.sessionId !== sessionId) return;

      switch (event.type) {
        case 'output':
          console.log(`[OUTPUT] ${event.data.data}`);
          break;
        case 'input':
          const inputData = event.data as any;
          console.log(`[INPUT${inputData.queued ? '-QUEUED' : ''}] ${inputData.input}`);
          if (inputData.commandId) {
            console.log(`  Command ID: ${inputData.commandId}`);
          }
          break;
        case 'error':
          console.error(`[ERROR] ${event.data.error || 'Unknown error'}`);
          break;
        case 'started':
          console.log('[SESSION] Started');
          break;
        case 'stopped':
          console.log('[SESSION] Stopped');
          break;
      }
    });

    // Wait a bit for connection to stabilize
    await delay(2000);

    console.log('\n=== Testing Rapid Command Sending ===');
    console.log('Sending multiple commands quickly to test queue system...\n');

    // Test commands that would typically get concatenated
    const testCommands = [
      'pwd',
      'ls -la',
      'whoami',
      'date',
      'echo "Command 1 completed"',
      'sleep 2',
      'echo "Command 2 completed"',
      'uname -a'
    ];

    // Send all commands rapidly (this would cause concatenation without the queue)
    const startTime = Date.now();
    console.log('Sending commands rapidly...');
    
    const promises = testCommands.map(async (cmd, index) => {
      console.log(`Queuing command ${index + 1}: ${cmd}`);
      try {
        await consoleManager.sendInput(sessionId, cmd);
        console.log(`Command ${index + 1} queued successfully`);
      } catch (error) {
        console.error(`Failed to queue command ${index + 1}:`, error);
      }
    });

    // Wait for all commands to be queued
    await Promise.all(promises);
    
    const queueTime = Date.now() - startTime;
    console.log(`\nAll commands queued in ${queueTime}ms`);

    // Show queue statistics
    console.log('\nQueue statistics:');
    const stats = consoleManager.getAllCommandQueueStats();
    console.log(JSON.stringify(stats, null, 2));

    // Wait for commands to complete
    console.log('\nWaiting for commands to complete...');
    await delay(20000); // Wait 20 seconds for all commands to execute

    // Final statistics
    console.log('\nFinal queue statistics:');
    const finalStats = consoleManager.getAllCommandQueueStats();
    console.log(JSON.stringify(finalStats, null, 2));

    console.log('\n=== Test Completed Successfully ===');

  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    // Clean up
    if (sessionId) {
      console.log('\nCleaning up session...');
      await consoleManager.stopSession(sessionId);
    }
    await consoleManager.destroy();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Additional test for configuration changes
async function testConfigurationChanges() {
  console.log('\n=== Testing Configuration Changes ===');
  
  const consoleManager = new ConsoleManager();

  // Test initial configuration
  console.log('Initial config:', consoleManager.getCommandQueueConfig());

  // Update configuration
  consoleManager.configureCommandQueue({
    interCommandDelay: 2000,
    maxQueueSize: 50,
    enablePromptDetection: false
  });

  // Verify changes
  console.log('Updated config:', consoleManager.getCommandQueueConfig());

  await consoleManager.destroy();
}

// Run tests
if (require.main === module) {
  (async () => {
    try {
      await testSSHCommandQueue();
      await testConfigurationChanges();
    } catch (error) {
      console.error('Test suite failed:', error);
      process.exit(1);
    }
  })();
}

export { testSSHCommandQueue, testConfigurationChanges };