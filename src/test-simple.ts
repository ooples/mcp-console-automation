import { ConsoleAutomationServer } from './mcp/server.js';
import { ConsoleManager } from './core/ConsoleManager.js';

async function test() {
  console.log('Starting simple test...');

  try {
    const manager = new ConsoleManager();
    console.log('ConsoleManager created successfully');

    const server = new ConsoleAutomationServer();
    console.log('ConsoleAutomationServer created successfully');

    // Test creating a cmd session (Windows)
    const sessionId = await manager.createSession({
      command: 'echo',
      args: ['Hello from test!'],
      consoleType: 'cmd'
    });
    console.log(`Session created with ID: ${sessionId}`);

    // Get session details
    const sessions = manager.getAllSessions();
    console.log(`Active sessions: ${sessions.length}`);

    console.log('\nTest completed successfully!');
  } catch (error) {
    console.error('Test failed:', error);
  }
}

test().catch(console.error);