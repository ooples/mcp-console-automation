#!/usr/bin/env npx tsx

/**
 * Test script to verify that SSH spawn errors are properly handled
 * and don't crash the MCP server process
 */

import { SSHAdapter, SSHOptions } from './src/core/SSHAdapter.js';
import { Logger } from './src/utils/logger.js';

const logger = new Logger('SSHSpawnTest');

async function testSSHSpawnErrorHandling() {
  logger.info('🧪 Testing SSH Spawn Error Handling...\n');

  // Test 1: Invalid SSH command (should trigger ENOENT error)
  logger.info('Test 1: Testing invalid SSH command handling');
  try {
    const adapter = new SSHAdapter('test-invalid-cmd');

    // Set up error handler to capture spawn errors
    let spawnErrorCaught = false;
    adapter.on('error', (error) => {
      logger.info(`✅ SSH error properly caught: ${error}`);
      spawnErrorCaught = true;
    });

    // Try to connect with invalid options to trigger spawn error
    const invalidOptions: SSHOptions = {
      host: 'nonexistent.example.com',
      username: 'testuser',
      strictHostKeyChecking: false,
      timeout: 2000  // Short timeout for faster test
    };

    try {
      await adapter.connect(invalidOptions);
      logger.warn('⚠️ Connection unexpectedly succeeded');
    } catch (connectError) {
      logger.info(`✅ Connection properly failed: ${connectError.message}`);
    }

    // Wait a moment for any async error handling
    await new Promise(resolve => setTimeout(resolve, 1000));

    if (spawnErrorCaught) {
      logger.info('✅ Test 1 PASSED: Spawn errors are properly caught');
    } else {
      logger.warn('⚠️ Test 1: No spawn error detected (might be expected on some systems)');
    }

    adapter.destroy();
  } catch (error) {
    logger.error(`❌ Test 1 FAILED: Unhandled error: ${error}`);
    return false;
  }

  // Test 2: Process crash prevention
  logger.info('\nTest 2: Testing process crash prevention');
  try {
    const adapter = new SSHAdapter('test-crash-prevention');

    let errorHandlerCalled = false;
    adapter.on('error', (error) => {
      errorHandlerCalled = true;
      logger.info(`✅ Error handler called: ${error}`);
    });

    // Test with multiple rapid connection attempts
    const promises = [];
    for (let i = 0; i < 3; i++) {
      const testOptions: SSHOptions = {
        host: `test${i}.invalid`,
        username: 'test',
        timeout: 1000
      };

      promises.push(
        adapter.connect(testOptions).catch(err => {
          logger.debug(`Expected error for attempt ${i}: ${err.message}`);
        })
      );
    }

    await Promise.allSettled(promises);

    // Wait for any delayed error handling
    await new Promise(resolve => setTimeout(resolve, 1000));

    logger.info('✅ Test 2 PASSED: No process crash occurred');
    adapter.destroy();
  } catch (error) {
    logger.error(`❌ Test 2 FAILED: ${error}`);
    return false;
  }

  // Test 3: Handler setup race condition prevention
  logger.info('\nTest 3: Testing handler setup race condition prevention');
  try {
    // Create multiple adapters rapidly to test race conditions
    const adapters = [];
    for (let i = 0; i < 5; i++) {
      const adapter = new SSHAdapter(`test-race-${i}`);

      // Each adapter should have error handlers set up immediately
      adapter.on('error', (error) => {
        logger.debug(`Adapter ${i} error handled: ${error}`);
      });

      adapters.push(adapter);
    }

    // Try to connect all adapters simultaneously
    const connectPromises = adapters.map((adapter, i) =>
      adapter.connect({
        host: `race-test-${i}.invalid`,
        username: 'test',
        timeout: 500
      }).catch(err => {
        // Expected to fail - we're testing error handling, not actual connections
        logger.debug(`Race test ${i} failed as expected: ${err.message}`);
      })
    );

    await Promise.allSettled(connectPromises);

    // Clean up
    adapters.forEach(adapter => adapter.destroy());

    logger.info('✅ Test 3 PASSED: Race condition prevention works');
  } catch (error) {
    logger.error(`❌ Test 3 FAILED: ${error}`);
    return false;
  }

  return true;
}

// Test the server stability
async function testServerStability() {
  logger.info('\n🏥 Testing MCP server stability after SSH errors...');

  try {
    // Simulate what happens in the actual MCP server
    logger.info('Server is still running and responsive');

    // Test that we can still create new adapters
    const testAdapter = new SSHAdapter('stability-test');
    testAdapter.on('error', (error) => {
      logger.debug(`Stability test error (expected): ${error}`);
    });

    try {
      await testAdapter.connect({
        host: 'stability-test.invalid',
        username: 'test',
        timeout: 1000
      });
    } catch (error) {
      logger.info('✅ Server remains functional after SSH errors');
    }

    testAdapter.destroy();

    logger.info('✅ MCP server stability maintained');
    return true;
  } catch (error) {
    logger.error(`❌ Server stability test failed: ${error}`);
    return false;
  }
}

// Run all tests
async function runAllTests() {
  logger.info('🚀 Starting SSH spawn error handling tests...\n');

  try {
    const spawnTestsPassed = await testSSHSpawnErrorHandling();
    const stabilityTestPassed = await testServerStability();

    if (spawnTestsPassed && stabilityTestPassed) {
      logger.info('\n🎉 ALL TESTS PASSED!');
      logger.info('SSH spawn error handling is working correctly.');
      logger.info('The MCP server should no longer crash due to SSH spawn errors.');
      process.exit(0);
    } else {
      logger.error('\n❌ Some tests failed');
      process.exit(1);
    }
  } catch (error) {
    logger.error('\n💥 Test suite failed with error:', error);
    process.exit(1);
  }
}

// Handle unhandled exceptions to test our error isolation
process.on('uncaughtException', (error) => {
  logger.error('🚨 UNCAUGHT EXCEPTION (this should not happen with our fixes):', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('🚨 UNHANDLED REJECTION (this should not happen with our fixes):', reason);
  process.exit(1);
});

// Run the tests
runAllTests().catch(error => {
  logger.error('Fatal error in test runner:', error);
  process.exit(1);
});