import { ConsoleManager } from '../src/core/ConsoleManager.js';

async function demonstrateSSHIntegration() {
  const manager = new ConsoleManager();
  
  try {
    console.log('=== SSH Integration Demo ===\n');
    
    // Example 1: Basic SSH connection with username and host
    console.log('1. Creating SSH session with basic format...');
    const sessionId1 = await manager.createSession({
      command: 'ssh user@example.com',
      streaming: true
    });
    console.log(`SSH Session created: ${sessionId1}`);
    
    // Example 2: SSH connection with custom port
    console.log('\n2. Creating SSH session with custom port...');
    const sessionId2 = await manager.createSession({
      command: 'ssh -p 2222 admin@server.example.com',
      streaming: true
    });
    console.log(`SSH Session with custom port created: ${sessionId2}`);
    
    // Example 3: SSH connection with private key
    console.log('\n3. Creating SSH session with private key...');
    const sessionId3 = await manager.createSession({
      command: 'ssh -i ~/.ssh/id_rsa deploy@production.example.com',
      streaming: true
    });
    console.log(`SSH Session with private key created: ${sessionId3}`);
    
    // Listen for events
    manager.on('console-event', (event) => {
      console.log(`Event: ${event.type} for session ${event.sessionId}`);
      if (event.type === 'output') {
        console.log(`Output: ${event.data.data.trim()}`);
      }
      if (event.type === 'error') {
        console.error(`Error: ${JSON.stringify(event.data)}`);
      }
    });
    
    // Send commands to SSH sessions
    console.log('\n4. Sending commands to SSH sessions...');
    
    // Wait a moment for connection to establish
    setTimeout(async () => {
      try {
        await manager.sendInput(sessionId1, 'ls -la\n');
        await manager.sendInput(sessionId2, 'pwd\n');
        await manager.sendInput(sessionId3, 'whoami\n');
      } catch (error) {
        console.error('Error sending input:', error);
      }
    }, 2000);
    
    // Demonstrate connection pooling - create another session to the same host
    console.log('\n5. Demonstrating connection pooling...');
    setTimeout(async () => {
      try {
        const pooledSessionId = await manager.createSession({
          command: 'ssh user@example.com', // Same host as session 1
          streaming: true
        });
        console.log(`Pooled SSH Session created: ${pooledSessionId}`);
        await manager.sendInput(pooledSessionId, 'echo "Using pooled connection"\n');
      } catch (error) {
        console.error('Error creating pooled session:', error);
      }
    }, 5000);
    
    // Stop sessions after 30 seconds
    setTimeout(async () => {
      console.log('\n6. Stopping all SSH sessions...');
      await manager.stopAllSessions();
      console.log('All sessions stopped.');
      
      // Show resource usage
      const usage = manager.getResourceUsage();
      console.log('Final resource usage:', usage);
      
      await manager.destroy();
      console.log('Manager destroyed.');
    }, 30000);
    
  } catch (error) {
    console.error('SSH Demo error:', error);
    await manager.destroy();
  }
}

// Helper function to show SSH command parsing
function demonstrateSSHCommandParsing() {
  console.log('\n=== SSH Command Parsing Examples ===');
  
  const examples = [
    'ssh user@hostname',
    'ssh -p 2222 admin@server.com',
    'ssh -i ~/.ssh/key user@host.example.com',
    'ssh -l username -p 443 gateway.company.com',
    'ssh -o StrictHostKeyChecking=no deploy@prod.example.org'
  ];
  
  // Note: This would require exposing the parseSSHCommand method or creating a separate parser utility
  examples.forEach((cmd, idx) => {
    console.log(`${idx + 1}. Command: ${cmd}`);
    // In a real implementation, you'd parse and show the extracted components
  });
}

// Run the demo if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  demonstrateSSHIntegration();
  demonstrateSSHCommandParsing();
}

export { demonstrateSSHIntegration, demonstrateSSHCommandParsing };