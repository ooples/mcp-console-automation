import { ConsoleManager } from './core/ConsoleManager.js';
import { existsSync } from 'fs';

async function testSSHKey() {
  console.log('Testing SSH with key authentication...');

  try {
    const manager = new ConsoleManager();
    console.log('ConsoleManager created successfully');

    const keyPath = 'C:\\Users\\yolan\\.ssh\\id_ed25519';
    if (!existsSync(keyPath)) {
      console.log(`SSH key not found at ${keyPath}, skipping test`);
      return;
    }

    // Test creating an SSH session with key
    console.log('Attempting to connect with SSH key...');
    const sessionId = await manager.createSession({
      command: 'ssh',
      consoleType: 'ssh',
      sshOptions: {
        host: 'github.com',
        port: 22,
        username: 'git',
        privateKey: keyPath
      }
    });

    console.log(`✓ SUCCESS: SSH session created with key: ${sessionId}`);

    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Clean up
    await manager.stopSession(sessionId);
    console.log('Session closed successfully');

  } catch (error: any) {
    console.error('✗ FAILURE: SSH key authentication failed:', error.message);
  }
}

testSSHKey().catch(console.error);