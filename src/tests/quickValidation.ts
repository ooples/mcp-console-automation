import { OutputFilterEngine } from '../core/OutputFilterEngine.js';
import { ConsoleOutput } from '../types/index.js';

/**
 * Quick validation test for the OutputFilterEngine
 */
async function runQuickValidation() {
  console.log('🔍 Running Quick Validation Tests for OutputFilterEngine...\n');

  const filterEngine = new OutputFilterEngine();
  let passed = 0;
  let failed = 0;

  // Helper to create test data
  const createTestData = (lines: string[]): ConsoleOutput[] => {
    return lines.map((line, index) => ({
      sessionId: 'test-session',
      timestamp: new Date(Date.now() + index * 1000),
      type: 'stdout' as const,
      data: line,
    }));
  };

  // Test 1: Basic grep functionality
  try {
    console.log('🧪 Test 1: Basic Grep Functionality');
    const testData = createTestData([
      'ERROR: Something failed',
      'INFO: Everything is fine',
      'ERROR: Another failure',
      'DEBUG: Debug info',
    ]);

    const result = await filterEngine.filter(testData, { grep: 'ERROR' });

    if (result.output.length === 2 && result.metadata.filteredLines === 2) {
      console.log('✅ PASS: Basic grep works correctly');
      passed++;
    } else {
      console.log(`❌ FAIL: Expected 2 matches, got ${result.output.length}`);
      failed++;
    }
  } catch (error) {
    console.log('❌ FAIL: Basic grep test threw error:', error.message);
    failed++;
  }

  // Test 2: Time-based filtering
  try {
    console.log('\n🧪 Test 2: Time-based Filtering');
    const now = Date.now();
    const testData = createTestData(['old log', 'recent log']).map(
      (item, index) => ({
        ...item,
        timestamp: new Date(now - 60000 * (2 - index)), // 2 minutes ago, 1 minute ago
      })
    );

    const result = await filterEngine.filter(testData, { since: '90s' });

    if (result.output.length === 1) {
      console.log('✅ PASS: Time-based filtering works correctly');
      passed++;
    } else {
      console.log(`❌ FAIL: Expected 1 match, got ${result.output.length}`);
      failed++;
    }
  } catch (error) {
    console.log(
      '❌ FAIL: Time-based filtering test threw error:',
      error.message
    );
    failed++;
  }

  // Test 3: Line operations (tail)
  try {
    console.log('\n🧪 Test 3: Line Operations (Tail)');
    const testData = createTestData([
      'line1',
      'line2',
      'line3',
      'line4',
      'line5',
    ]);

    const result = await filterEngine.filter(testData, { tail: 3 });

    if (result.output.length === 3 && result.output[0].data === 'line3') {
      console.log('✅ PASS: Tail operation works correctly');
      passed++;
    } else {
      console.log(
        `❌ FAIL: Expected 3 lines starting with 'line3', got ${result.output.length} lines`
      );
      failed++;
    }
  } catch (error) {
    console.log('❌ FAIL: Tail operation test threw error:', error.message);
    failed++;
  }

  // Test 4: Multi-pattern search
  try {
    console.log('\n🧪 Test 4: Multi-pattern Search (AND logic)');
    const testData = createTestData([
      'ERROR: Database connection failed',
      'INFO: Database connected',
      'ERROR: Authentication failed',
      'WARN: Database slow',
    ]);

    const result = await filterEngine.filter(testData, {
      multiPattern: {
        patterns: ['ERROR', 'Database'],
        logic: 'AND',
      },
    });

    if (
      result.output.length === 1 &&
      result.output[0].data.includes('Database connection failed')
    ) {
      console.log('✅ PASS: Multi-pattern AND search works correctly');
      passed++;
    } else {
      console.log(
        `❌ FAIL: Expected 1 match with 'Database connection failed', got ${result.output.length} matches`
      );
      failed++;
    }
  } catch (error) {
    console.log(
      '❌ FAIL: Multi-pattern search test threw error:',
      error.message
    );
    failed++;
  }

  // Test 5: Performance test with large dataset
  try {
    console.log('\n🧪 Test 5: Performance Test (10k lines)');
    const largeData = Array.from({ length: 10000 }, (_, i) =>
      i % 100 === 0
        ? `ERROR: Error at line ${i}`
        : `INFO: Regular log line ${i}`
    );
    const testData = createTestData(largeData);

    const startTime = process.hrtime.bigint();
    const result = await filterEngine.filter(testData, { grep: 'ERROR' });
    const endTime = process.hrtime.bigint();
    const processingTime = Number(endTime - startTime) / 1000000; // Convert to milliseconds

    if (result.output.length === 100 && processingTime < 1000) {
      console.log(
        `✅ PASS: Performance test passed (${processingTime.toFixed(2)}ms for 10k lines)`
      );
      passed++;
    } else {
      console.log(
        `❌ FAIL: Expected 100 matches in <1000ms, got ${result.output.length} matches in ${processingTime.toFixed(2)}ms`
      );
      failed++;
    }
  } catch (error) {
    console.log('❌ FAIL: Performance test threw error:', error.message);
    failed++;
  }

  // Test 6: Combined filters
  try {
    console.log('\n🧪 Test 6: Combined Filters (grep + tail)');
    const testData = createTestData([
      'INFO: Starting application',
      'ERROR: Failed to start',
      'INFO: Retrying...',
      'ERROR: Still failing',
      'INFO: Success!',
      'ERROR: New error',
    ]);

    const result = await filterEngine.filter(testData, {
      grep: 'ERROR',
      tail: 2,
    });

    if (
      result.output.length === 2 &&
      result.output[1].data.includes('New error')
    ) {
      console.log('✅ PASS: Combined filters work correctly');
      passed++;
    } else {
      console.log(
        `❌ FAIL: Expected 2 matches with last being 'New error', got ${result.output.length} matches`
      );
      failed++;
    }
  } catch (error) {
    console.log('❌ FAIL: Combined filters test threw error:', error.message);
    failed++;
  }

  // Summary
  console.log('\n📊 VALIDATION SUMMARY');
  console.log('====================');
  console.log(`✅ Tests Passed: ${passed}`);
  console.log(`❌ Tests Failed: ${failed}`);
  console.log(
    `📈 Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`
  );

  if (failed === 0) {
    console.log(
      '\n🎉 ALL TESTS PASSED! OutputFilterEngine is working correctly.'
    );
  } else {
    console.log(
      `\n⚠️  ${failed} test(s) failed. Please review the implementation.`
    );
  }

  return { passed, failed, successRate: (passed / (passed + failed)) * 100 };
}

// Export for use in other files
export { runQuickValidation };

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runQuickValidation()
    .then((results) => {
      process.exit(results.failed > 0 ? 1 : 0);
    })
    .catch((error) => {
      console.error('❌ Validation failed with error:', error);
      process.exit(1);
    });
}
