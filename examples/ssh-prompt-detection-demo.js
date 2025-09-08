/**
 * SSH Prompt Detection Demo
 * 
 * This script demonstrates the improved SSH prompt detection capabilities
 * of the MCP console automation server.
 */

import { ConsoleManager } from '../dist/core/ConsoleManager.js';
import { Logger } from '../dist/utils/logger.js';

// Enable debug logging
process.env.LOG_LEVEL = 'debug';

async function demonstratePromptDetection() {
  console.log('=== SSH Prompt Detection Demo ===\n');
  
  const logger = new Logger('ssh-prompt-demo');
  const manager = new ConsoleManager();
  let sessionId;
  
  // Listen to events for demonstration
  manager.on('console-event', (event) => {
    if (event.type === 'prompt-detected') {
      console.log(`✅ PROMPT DETECTED:
  Pattern: ${event.data.pattern}
  Confidence: ${event.data.confidence.toFixed(2)}
  Matched Text: "${event.data.matchedText}"
  Context: ${JSON.stringify(event.data.context, null, 2)}\n`);
    } else if (event.type === 'output') {
      console.log(`📄 Output: ${event.data.data.substring(0, 100)}${event.data.data.length > 100 ? '...' : ''}`);
    } else if (event.type === 'error') {
      console.log(`❌ Error: ${event.data.error || JSON.stringify(event.data)}`);
    }
  });
  
  try {
    console.log('🔧 Creating SSH session with enhanced prompt detection...');
    
    // Configure SSH session with prompt detection
    const sshOptions = {
      host: '51.81.109.208', // Replace with your SSH host
      port: 22,
      username: 'ubuntu',    // Replace with your username
      password: process.env.SSH_PASSWORD || '0hbTMtqW0D4oH0fv' // Use environment variable for security
    };
    
    sessionId = await manager.createSession({
      command: '',
      consoleType: 'ssh',
      sshOptions,
      detectErrors: true,
      timeout: 15000
    });
    
    console.log(`✅ SSH session created: ${sessionId}\n`);
    
    // Wait for initial connection and prompt
    console.log('⏳ Waiting for initial SSH prompt...');
    try {
      const initialPrompt = await manager.waitForPrompt(sessionId, 10000);
      console.log(`✅ Initial prompt detected: "${initialPrompt.matchedText}" (confidence: ${initialPrompt.confidence.toFixed(2)})\n`);
    } catch (error) {
      console.log(`⚠️  Initial prompt detection failed: ${error.message}\n`);
    }
    
    // Test 1: Execute simple command and wait for prompt
    console.log('🧪 Test 1: Execute "whoami" and detect prompt');
    await manager.sendInput(sessionId, 'whoami\n');
    
    try {
      const result = await manager.waitForOutput(sessionId, /ubuntu|root/, {
        timeout: 5000,
        requirePrompt: true
      });
      
      console.log(`✅ Command output received with prompt detection:
  Output contains: ${result.output.includes('ubuntu') ? 'ubuntu' : 'other user'}
  Prompt detected: ${result.promptDetected ? 'Yes' : 'No'}
  Pattern: ${result.promptDetected?.pattern?.name || 'N/A'}\n`);
    } catch (error) {
      console.log(`❌ Test 1 failed: ${error.message}\n`);
    }
    
    // Test 2: Execute command with colored output
    console.log('🧪 Test 2: Execute "ls --color=always" to test ANSI handling');
    await manager.sendInput(sessionId, 'ls --color=always\n');
    
    try {
      const result = await manager.waitForOutput(sessionId, /ubuntu@.*\$/, {
        timeout: 5000,
        stripAnsi: true
      });
      
      console.log(`✅ Colored output handled successfully:
  ANSI sequences stripped: ${!result.output.includes('\x1b')}
  Prompt detected: ${result.promptDetected ? 'Yes' : 'No'}\n`);
    } catch (error) {
      console.log(`❌ Test 2 failed: ${error.message}\n`);
    }
    
    // Test 3: Change directory and detect prompt change
    console.log('🧪 Test 3: Change directory to /tmp and detect path change in prompt');
    await manager.sendInput(sessionId, 'cd /tmp\n');
    
    try {
      const result = await manager.waitForPrompt(sessionId, 5000);
      console.log(`✅ Directory change prompt detected:
  New prompt: "${result.matchedText}"
  Contains /tmp: ${result.matchedText.includes('/tmp')}
  Confidence: ${result.confidence.toFixed(2)}\n`);
    } catch (error) {
      console.log(`❌ Test 3 failed: ${error.message}\n`);
    }
    
    // Test 4: Test adaptive learning
    console.log('🧪 Test 4: Test adaptive learning capability');
    await manager.sendInput(sessionId, 'pwd\n');
    
    try {
      await manager.waitForPrompt(sessionId, 5000);
      
      // Get learned patterns
      const stats = manager.promptDetector?.getDetectionStats(sessionId);
      console.log(`✅ Adaptive learning stats:
  Total patterns: ${stats?.totalPatterns || 'N/A'}
  Learned patterns: ${stats?.learnedPatterns || 'N/A'}
  Shell type detected: ${stats?.shellType || 'N/A'}\n`);
    } catch (error) {
      console.log(`❌ Test 4 failed: ${error.message}\n`);
    }
    
    // Test 5: Enhanced waitForOutput with multiple conditions
    console.log('🧪 Test 5: Complex pattern matching with enhanced waitForOutput');
    await manager.sendInput(sessionId, 'echo "SUCCESS: All tests completed"\n');
    
    try {
      const result = await manager.waitForOutput(sessionId, /SUCCESS:.*completed/, {
        timeout: 5000,
        requirePrompt: true,
        stripAnsi: true
      });
      
      console.log(`✅ Complex pattern matching successful:
  Pattern matched: ${result.output.includes('SUCCESS: All tests completed')}
  Prompt required and found: ${result.promptDetected ? 'Yes' : 'No'}
  Final confidence: ${result.promptDetected?.confidence?.toFixed(2) || 'N/A'}\n`);
    } catch (error) {
      console.log(`❌ Test 5 failed: ${error.message}\n`);
    }
    
    console.log('🎉 SSH Prompt Detection Demo completed!\n');
    
    // Display final statistics
    if (manager.promptDetector) {
      const finalStats = manager.promptDetector.getDetectionStats(sessionId);
      const debugInfo = manager.promptDetector.getDebugInfo(sessionId);
      
      console.log('📊 Final Statistics:');
      console.log(`  Buffer size: ${finalStats.bufferSize} characters`);
      console.log(`  Total patterns: ${finalStats.totalPatterns}`);
      console.log(`  Learned patterns: ${finalStats.learnedPatterns}`);
      console.log(`  Shell type: ${finalStats.shellType}`);
      console.log(`  Available pattern types: ${debugInfo.availablePatterns.map(p => p.name).slice(0, 5).join(', ')}...`);
    }
    
  } catch (error) {
    console.error('\n💥 Demo failed with error:');
    console.error('Message:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    if (sessionId) {
      console.log('\n🧹 Cleaning up...');
      await manager.stopSession(sessionId);
    }
    
    await manager.destroy();
    process.exit(0);
  }
}

// Handle process termination gracefully
process.on('SIGINT', () => {
  console.log('\n🛑 Demo interrupted by user');
  process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Run the demo
console.log('Starting SSH Prompt Detection Demo...\n');
console.log('📝 Note: Make sure to set SSH_PASSWORD environment variable or update the script with your SSH credentials.\n');

demonstratePromptDetection().catch((error) => {
  console.error('Demo startup failed:', error);
  process.exit(1);
});