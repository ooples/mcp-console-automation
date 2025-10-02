import { ConsoleManager } from './core/ConsoleManager.js';

async function testPromptDebug() {
  console.log('🔍 Debugging SSH Prompt Detection...\n');

  const consoleManager = new ConsoleManager({
    sessionManager: {
      maxSessions: 10,
      sessionTimeout: 300000
    }
  });

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

    // Send command
    console.log('Sending echo command...');
    await consoleManager.sendInput(sessionId, 'echo "test"\n');

    // Wait a bit for output
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Get raw output
    const output = await consoleManager.getOutputImmediate(sessionId, 100);

    console.log(`\n${'='.repeat(60)}`);
    console.log('RAW OUTPUT CHUNKS:');
    console.log('='.repeat(60));

    output.forEach((chunk, index) => {
      console.log(`\nChunk ${index + 1}:`);
      console.log(`  Length: ${chunk.data.length}`);
      console.log(`  Raw: ${JSON.stringify(chunk.data)}`);
      console.log(`  Visible: ${chunk.data}`);
      console.log(`  Ends with $: ${chunk.data.endsWith('$')}`);
      console.log(`  Ends with #: ${chunk.data.endsWith('#')}`);
      console.log(`  Contains @: ${chunk.data.includes('@')}`);
    });

    await consoleManager.stopSession(sessionId);
    console.log('\n✓ Session stopped');

  } catch (error) {
    console.error('✗ Test failed:', error);
    throw error;
  }
}

testPromptDebug()
  .then(() => {
    console.log('\n✓ Debug test completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n✗ Debug test failed:', error);
    process.exit(1);
  });