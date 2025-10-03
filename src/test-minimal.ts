import { ConsoleManager } from './core/ConsoleManager.js';
import { SmartExecutor } from './core/SmartExecutor.js';

async function testMinimal() {
  console.log('Running minimal test...\n');

  const consoleManager = new ConsoleManager({
    sessionManager: {
      maxSessions: 10,
      sessionTimeout: 300000
    }
  });

  const smartExecutor = new SmartExecutor(consoleManager);

  try {
    console.log('Creating SSH session...');
    const sessionId = await consoleManager.createSession({
      command: 'ssh',
      args: [],
      consoleType: 'ssh',
      sshOptions: {
        host: 'ns107444.ip-51-81-109.us',
        username: 'ubuntu',
        password: '0hbTMtqW0D4oH0fv',
        port: 22
      }
    });
    console.log(`✓ Session created: ${sessionId}\n`);

    console.log('Executing single echo command...');
    const result = await smartExecutor.execute('echo "test"', {
      sessionId,
      timeout: 15000
    });

    console.log(`\n=== RESULT ===`);
    console.log(`Strategy: ${result.strategyUsed}`);
    console.log(`Success: ${result.success}`);
    console.log(`Exit Code: ${result.exitCode}`);
    console.log(`Output: ${JSON.stringify(result.output)}`);

    await consoleManager.stopSession(sessionId);
    console.log('\n✓ Test completed');

  } catch (error) {
    console.error('✗ Test failed:', error);
    throw error;
  }
}

testMinimal()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });