import { ConsoleManager } from './core/ConsoleManager.js';
import { SmartExecutor } from './core/SmartExecutor.js';

async function testSmartExecutor() {
  console.log('🧪 Testing Smart Executor with Remote Server...\n');

  const consoleManager = new ConsoleManager({
    sessionManager: {
      maxSessions: 10,
      sessionTimeout: 300000
    }
  });

  const smartExecutor = new SmartExecutor(consoleManager);

  try {
    console.log('Test 1: Creating SSH session to remote server...');
    const sessionId = await consoleManager.createSession({
      command: 'ssh',
      args: ['-o', 'StrictHostKeyChecking=no', 'ubuntu@ns107444.ip-51-81-109.us'],
      consoleType: 'ssh',
      sshOptions: {
        host: 'ns107444.ip-51-81-109.us',
        username: 'ubuntu',
        privateKeyPath: 'C:\\Users\\yolan\\.ssh\\id_rsa',
        port: 22
      }
    });
    console.log(`✓ Session created: ${sessionId}\n`);

    console.log('═'.repeat(60));
    console.log('Test 2: Quick Command (should use FAST strategy)');
    console.log('═'.repeat(60));
    const start1 = Date.now();
    const result1 = await smartExecutor.execute('echo "Hello from Smart Executor"', {
      sessionId,
      timeout: 10000
    });
    const duration1 = Date.now() - start1;

    console.log(`Strategy Used: ${result1.strategyUsed}`);
    console.log(`Switched: ${result1.switched}`);
    console.log(`Duration: ${duration1}ms`);
    console.log(`Exit Code: ${result1.exitCode}`);
    console.log(`Output (first 100 chars): ${result1.output.substring(0, 100).trim()}`);
    console.log(`Success: ${result1.success ? '✓' : '✗'}\n`);

    console.log('═'.repeat(60));
    console.log('Test 3: Multiple Quick Commands (testing fast path)');
    console.log('═'.repeat(60));
    const start2 = Date.now();
    const result2 = await smartExecutor.execute('pwd && whoami && hostname', {
      sessionId,
      timeout: 10000
    });
    const duration2 = Date.now() - start2;

    console.log(`Strategy Used: ${result2.strategyUsed}`);
    console.log(`Switched: ${result2.switched}`);
    console.log(`Duration: ${duration2}ms`);
    console.log(`Exit Code: ${result2.exitCode}`);
    console.log(`Output (first 150 chars): ${result2.output.substring(0, 150).trim()}`);
    console.log(`Success: ${result2.success ? '✓' : '✗'}\n`);

    console.log('═'.repeat(60));
    console.log('Test 4: System Info Command (testing fast path)');
    console.log('═'.repeat(60));
    const start3 = Date.now();
    const result3 = await smartExecutor.execute('uname -a', {
      sessionId,
      timeout: 10000
    });
    const duration3 = Date.now() - start3;

    console.log(`Strategy Used: ${result3.strategyUsed}`);
    console.log(`Switched: ${result3.switched}`);
    console.log(`Duration: ${duration3}ms`);
    console.log(`Exit Code: ${result3.exitCode}`);
    console.log(`Output: ${result3.output.trim()}`);
    console.log(`Success: ${result3.success ? '✓' : '✗'}\n`);

    console.log('═'.repeat(60));
    console.log('Test 5: File System Command (testing fast path)');
    console.log('═'.repeat(60));
    const start4 = Date.now();
    const result4 = await smartExecutor.execute('ls -lah /home/ubuntu', {
      sessionId,
      timeout: 10000
    });
    const duration4 = Date.now() - start4;

    console.log(`Strategy Used: ${result4.strategyUsed}`);
    console.log(`Switched: ${result4.switched}`);
    console.log(`Duration: ${duration4}ms`);
    console.log(`Exit Code: ${result4.exitCode}`);
    console.log(`Output (first 200 chars): ${result4.output.substring(0, 200).trim()}`);
    console.log(`Success: ${result4.success ? '✓' : '✗'}\n`);

    console.log('═'.repeat(60));
    console.log('Test 6: Git Command (testing fast path)');
    console.log('═'.repeat(60));
    const start5 = Date.now();
    const result5 = await smartExecutor.execute('git --version', {
      sessionId,
      timeout: 10000
    });
    const duration5 = Date.now() - start5;

    console.log(`Strategy Used: ${result5.strategyUsed}`);
    console.log(`Switched: ${result5.switched}`);
    console.log(`Duration: ${duration5}ms`);
    console.log(`Exit Code: ${result5.exitCode}`);
    console.log(`Output: ${result5.output.trim()}`);
    console.log(`Success: ${result5.success ? '✓' : '✗'}\n`);

    await consoleManager.stopSession(sessionId);
    console.log('✓ Session stopped\n');

    console.log('═'.repeat(60));
    console.log('✅ All Smart Executor tests completed successfully!');
    console.log('═'.repeat(60));

  } catch (error) {
    console.error('✗ Test failed:', error);
    throw error;
  }
}

testSmartExecutor()
  .then(() => {
    console.log('\n✓ Test suite completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n✗ Test suite failed:', error);
    process.exit(1);
  });