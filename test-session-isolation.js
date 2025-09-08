// Simple test script to verify session state management works
const { ConsoleManager } = require('./dist/core/ConsoleManager.js');

async function testSessionIsolation() {
  const consoleManager = new ConsoleManager();
  
  try {
    console.log('Creating test session...');
    const sessionId = await consoleManager.createSession('powershell', [], {
      cwd: process.cwd(),
      consoleType: 'powershell'
    });
    
    console.log(`Session created: ${sessionId}`);
    
    // Test session state
    const state = consoleManager.getSessionExecutionState(sessionId);
    console.log('Initial session state:', state);
    
    // Test command execution
    console.log('Executing first command...');
    const result1 = await consoleManager.executeCommandInSession(
      sessionId,
      'Get-Location',
      [],
      5000
    );
    
    console.log('First command result:', {
      commandId: result1.commandId,
      status: result1.status,
      duration: result1.duration,
      outputLines: result1.output.length
    });
    
    console.log('Executing second command...');
    const result2 = await consoleManager.executeCommandInSession(
      sessionId,
      'Get-Date',
      [],
      5000
    );
    
    console.log('Second command result:', {
      commandId: result2.commandId,
      status: result2.status,
      duration: result2.duration,
      outputLines: result2.output.length
    });
    
    // Check command history
    const history = consoleManager.getSessionCommandHistory(sessionId);
    console.log(`Command history: ${history.length} commands`);
    
    // Test self-healing features
    console.log('\n=== Testing Self-Healing Features ===');
    
    // Check self-healing configuration
    const healingConfig = consoleManager.getSelfHealingConfig();
    console.log('Self-healing config:', healingConfig);
    
    // Perform health check
    if (healingConfig.selfHealingEnabled) {
      console.log('Performing comprehensive health check...');
      const healthStatus = await consoleManager.performHealthCheck();
      console.log('Health check results:', {
        systemHealthy: healthStatus.system.overall > 0.7,
        sessionCount: healthStatus.sessions.size,
        connectionsHealthy: healthStatus.connections.size === 0 || 
          Array.from(healthStatus.connections.values()).every(h => h.healthy)
      });
      
      // Get current metrics
      console.log('Getting current metrics...');
      const metrics = consoleManager.getMetrics();
      console.log('Metrics summary:', {
        totalCommands: metrics.commands?.total || 0,
        successRate: metrics.commands?.successRate || 0,
        averageResponseTime: metrics.commands?.averageExecutionTime || 0
      });
      
      // Test manual session recovery (should succeed since session is healthy)
      console.log('Testing manual session recovery...');
      const recoveryResult = await consoleManager.recoverSession(sessionId);
      console.log('Recovery result:', recoveryResult);
      
      // Get recovery history
      const recoveryHistory = consoleManager.getRecoveryHistory();
      console.log('Recovery history:', {
        totalAttempts: recoveryHistory.totalAttempts || 0,
        successfulRecoveries: recoveryHistory.successfulRecoveries || 0
      });
    } else {
      console.log('Self-healing is disabled');
    }
    
    // Clean up
    await consoleManager.stopSession(sessionId);
    console.log('Session stopped');
    
  } catch (error) {
    console.error('Test failed:', error.message);
  } finally {
    consoleManager.destroy();
  }
}

if (require.main === module) {
  testSessionIsolation().catch(console.error);
}