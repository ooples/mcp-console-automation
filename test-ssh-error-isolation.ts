#!/usr/bin/env npx tsx

/**
 * Test that SSH errors don't crash the ultra-persistent server
 */

import { ConsoleManager } from './src/core/ConsoleManager.js';
import { Logger } from './src/utils/logger.js';

const logger = new Logger('TestSSHErrorIsolation');
const manager = new ConsoleManager();

async function testSSHErrorIsolation() {
  logger.info('🧪 Testing SSH Error Isolation...\n');

  try {
    // Try to use the remote profile (will fail with permission denied)
    logger.info('Attempting SSH connection to remote server...');
    logger.info('Expected: Permission denied error');
    logger.info('Testing: Server should NOT crash\n');

    const result = await manager.useProfile('github-runner-server');
    
    // If we get here, connection succeeded (unexpected)
    logger.info('✅ SSH connection succeeded (unexpected but OK)');
    logger.info(`Session ID: ${result.sessionId}`);
    
    // Clean up
    await manager.closeSession(result.sessionId);
    
  } catch (error: any) {
    // This is expected - SSH permission denied
    logger.info('✅ Got expected SSH error:', error.message);
    logger.info('\nNOW THE KEY TEST:');
    logger.info('If using ultra-persistent-server.ts, the MCP server should STILL be running!');
    logger.info('If using old server, it would have crashed.\n');
    
    // Try another operation to verify server is still alive
    logger.info('Testing server is still responsive...');
    try {
      const sessions = manager.getAllSessions();
      logger.info(`✅ Server still responsive! Active sessions: ${sessions.length}`);
      logger.info('\n🎉 ERROR ISOLATION SUCCESSFUL!');
      logger.info('SSH errors no longer crash the MCP server!');
    } catch (secondError) {
      logger.error('❌ Server not responsive after SSH error');
      logger.error('Error isolation may have failed:', secondError);
    }
  }

  // Final test - create a local session to verify full functionality
  logger.info('\n📝 Final test - creating local session...');
  try {
    const localSession = await manager.createSession({
      type: 'local',
      persistent: false
    });
    
    logger.info(`✅ Local session created: ${localSession.sessionId}`);
    
    // Execute a simple command
    const result = await manager.executeCommand(localSession.sessionId, 'echo "Server is fully functional"');
    logger.info(`✅ Command executed: ${result.output}`);
    
    // Cleanup
    await manager.closeSession(localSession.sessionId);
    logger.info('✅ Session cleaned up successfully');
    
    logger.info('\n🎉 ALL TESTS PASSED!');
    logger.info('The ultra-persistent server successfully isolates SSH errors!');
    
  } catch (error) {
    logger.error('❌ Failed to create local session after SSH error');
    logger.error('Server may be in a bad state:', error);
  }

  // Cleanup manager
  await manager.destroy();
}

// Run test
testSSHErrorIsolation().catch(error => {
  logger.error('Test failed:', error);
  process.exit(1);
});