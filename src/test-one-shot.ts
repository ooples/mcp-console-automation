import { ConsoleManager } from './core/ConsoleManager.js';

async function testOneShot() {
  console.log('Testing one-shot session functionality...');

  try {
    const manager = new ConsoleManager();
    console.log('ConsoleManager created successfully');

    // Test one-shot command execution
    const result = await manager.executeCommand('echo', ['One-shot test successful!'], {
      consoleType: 'cmd'
    });

    console.log('One-shot execution result:', result);
    console.log('Output:', result.output);
    console.log('Exit code:', result.exitCode);

    // Check that session was cleaned up
    const sessions = manager.getAllSessions();
    console.log(`Active sessions after one-shot: ${sessions.length} (should be 0)`);

    console.log('\n✅ One-shot test completed successfully!');
    return true;
  } catch (error) {
    console.error('❌ One-shot test failed:', error);
    return false;
  }
}

testOneShot().then(success => {
  process.exit(success ? 0 : 1);
}).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});