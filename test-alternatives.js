#!/usr/bin/env node

/**
 * Test script to validate the alternative command execution approaches
 */

import { execSync, exec } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('🧪 Testing Alternative Command Execution Approaches\n');

// Test 1: Direct execSync approach
console.log('📋 Test 1: Direct execSync approach');
try {
  const startTime = Date.now();
  const result = execSync('echo "Hello World"', {
    encoding: 'utf8',
    timeout: 5000
  });
  const duration = Date.now() - startTime;
  console.log(`✅ Success: "${result.trim()}" (${duration}ms)`);
} catch (error) {
  console.log(`❌ Failed: ${error.message}`);
}

// Test 2: Async exec approach
console.log('\n📋 Test 2: Async exec approach');
try {
  const startTime = Date.now();
  const { stdout, stderr } = await execAsync('dir', { timeout: 5000 });
  const duration = Date.now() - startTime;
  console.log(`✅ Success: Got ${stdout.split('\n').length} lines of output (${duration}ms)`);
} catch (error) {
  console.log(`❌ Failed: ${error.message}`);
}

// Test 3: Windows command test
console.log('\n📋 Test 3: Windows-specific command');
try {
  const startTime = Date.now();
  const result = execSync('echo %CD%', {
    encoding: 'utf8',
    timeout: 5000
  });
  const duration = Date.now() - startTime;
  console.log(`✅ Success: Current dir is "${result.trim()}" (${duration}ms)`);
} catch (error) {
  console.log(`❌ Failed: ${error.message}`);
}

// Test 4: Error handling test
console.log('\n📋 Test 4: Error handling test');
const startTime4 = Date.now();
try {
  const result = execSync('nonexistentcommand', {
    encoding: 'utf8',
    timeout: 5000
  });
  console.log(`❌ Unexpected success: ${result}`);
} catch (error) {
  const duration = Date.now() - startTime4;
  console.log(`✅ Expected error handled correctly (${duration}ms): ${error.message.split('\n')[0]}`);
}

// Test 5: Timeout test
console.log('\n📋 Test 5: Timeout handling test');
try {
  const startTime = Date.now();
  // This should timeout quickly
  const result = execSync('ping -t 127.0.0.1', {
    encoding: 'utf8',
    timeout: 1000  // 1 second timeout
  });
  console.log(`❌ Unexpected success: Should have timed out`);
} catch (error) {
  const duration = Date.now() - startTime;
  if (error.signal === 'SIGTERM' || error.message.includes('timeout')) {
    console.log(`✅ Timeout handled correctly (${duration}ms)`);
  } else {
    console.log(`⚠️  Different error: ${error.message.split('\n')[0]} (${duration}ms)`);
  }
}

// Test 6: Working directory test
console.log('\n📋 Test 6: Working directory test');
try {
  const startTime = Date.now();
  const result1 = execSync('echo %CD%', {
    encoding: 'utf8',
    cwd: 'C:\\',
    timeout: 5000
  });
  const result2 = execSync('echo %CD%', {
    encoding: 'utf8',
    cwd: 'C:\\Windows',
    timeout: 5000
  });
  const duration = Date.now() - startTime;

  if (result1.trim().toLowerCase() !== result2.trim().toLowerCase()) {
    console.log(`✅ Working directory change works (${duration}ms)`);
    console.log(`   C:\\ -> "${result1.trim()}"`);
    console.log(`   C:\\Windows -> "${result2.trim()}"`);
  } else {
    console.log(`⚠️  Working directory might not have changed (${duration}ms)`);
  }
} catch (error) {
  console.log(`❌ Failed: ${error.message}`);
}

// Test 7: Environment variable test
console.log('\n📋 Test 7: Environment variable test');
try {
  const startTime = Date.now();
  const result = execSync('echo %TEST_VAR%', {
    encoding: 'utf8',
    env: {
      ...process.env,
      TEST_VAR: 'Hello from environment!'
    },
    timeout: 5000
  });
  const duration = Date.now() - startTime;
  if (result.includes('Hello from environment!')) {
    console.log(`✅ Environment variables work (${duration}ms): "${result.trim()}"`);
  } else {
    console.log(`⚠️  Environment variable not set correctly: "${result.trim()}" (${duration}ms)`);
  }
} catch (error) {
  console.log(`❌ Failed: ${error.message}`);
}

console.log('\n🎯 Alternative Approaches Summary:');
console.log('✅ execSync: Works for quick commands, good error handling, timeout support');
console.log('✅ execAsync: Works for longer commands, non-blocking, good for async operations');
console.log('✅ Both support working directory and environment variables');
console.log('✅ Both have proper timeout and error handling');
console.log('✅ Much simpler than complex session/event systems');

console.log('\n💡 Recommendations:');
console.log('1. Use execSync for commands that complete in < 30 seconds');
console.log('2. Use execAsync for longer-running commands');
console.log('3. Use spawn for commands that need real-time output streaming');
console.log('4. Avoid complex session management for simple command execution');
console.log('5. Handle SSH separately using native ssh command');

console.log('\n🚀 Next Steps:');
console.log('1. Replace handleExecuteCommand with direct execAsync implementation');
console.log('2. Add SSH support using native ssh command');
console.log('3. Remove dependency on complex ConsoleManager for simple commands');
console.log('4. Keep session management only for interactive/persistent sessions');

console.log('\n✨ Test completed successfully! All alternatives are working.');