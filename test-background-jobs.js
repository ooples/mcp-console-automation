#!/usr/bin/env node

/**
 * Background Jobs Test Runner
 *
 * This script runs the comprehensive test suite for background job functionality.
 * It includes unit tests, integration tests, and optional performance tests.
 */

import { spawn } from 'child_process';
import { platform } from 'os';
import chalk from 'chalk';

const isWindows = platform() === 'win32';

// Test configurations
const testConfigs = {
  unit: {
    name: 'Unit Tests',
    pattern: 'tests/unit/JobManager.test.ts',
    timeout: 30000,
    maxWorkers: '50%'
  },
  integration: {
    name: 'Integration Tests',
    pattern: 'tests/integration/background-jobs.test.ts',
    timeout: 120000,
    maxWorkers: 3
  },
  performance: {
    name: 'Performance Tests',
    pattern: 'tests/performance/background-jobs.performance.test.ts',
    timeout: 300000,
    maxWorkers: 2,
    env: { RUN_PERFORMANCE_TESTS: 'true' }
  }
};

// Helper functions
function logSection(title) {
  console.log('\n' + chalk.blue.bold('='.repeat(60)));
  console.log(chalk.blue.bold(`  ${title}`));
  console.log(chalk.blue.bold('='.repeat(60)) + '\n');
}

function logSuccess(message) {
  console.log(chalk.green.bold(`✅ ${message}`));
}

function logError(message) {
  console.log(chalk.red.bold(`❌ ${message}`));
}

function logInfo(message) {
  console.log(chalk.cyan(`ℹ️  ${message}`));
}

function runTests(config, additionalArgs = []) {
  return new Promise((resolve, reject) => {
    const jestCmd = isWindows ? 'npx.cmd' : 'npx';
    const args = [
      'jest',
      config.pattern,
      '--testTimeout', config.timeout.toString(),
      '--maxWorkers', config.maxWorkers.toString(),
      '--verbose',
      '--colors',
      '--detectOpenHandles',
      '--forceExit',
      ...additionalArgs
    ];

    logInfo(`Running: ${jestCmd} ${args.join(' ')}`);

    const process = spawn(jestCmd, args, {
      stdio: 'inherit',
      env: {
        ...process.env,
        ...config.env
      },
      shell: true
    });

    process.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, code });
      } else {
        resolve({ success: false, code });
      }
    });

    process.on('error', (error) => {
      reject(error);
    });
  });
}

async function runTestSuite() {
  const args = process.argv.slice(2);
  const shouldRunPerformance = args.includes('--performance') || args.includes('--all');
  const shouldRunCoverage = args.includes('--coverage');
  const shouldRunWatch = args.includes('--watch');

  logSection('Background Jobs Test Suite');

  const results = {
    passed: 0,
    failed: 0,
    total: 0
  };

  // Unit Tests
  logSection('Running Unit Tests');
  try {
    const coverageArgs = shouldRunCoverage ? ['--coverage', '--coverageDirectory=coverage/unit'] : [];
    const watchArgs = shouldRunWatch ? ['--watch'] : [];
    const unitResult = await runTests(testConfigs.unit, [...coverageArgs, ...watchArgs]);

    results.total++;
    if (unitResult.success) {
      logSuccess(`${testConfigs.unit.name} completed successfully`);
      results.passed++;
    } else {
      logError(`${testConfigs.unit.name} failed with exit code ${unitResult.code}`);
      results.failed++;
    }
  } catch (error) {
    logError(`Failed to run unit tests: ${error.message}`);
    results.failed++;
    results.total++;
  }

  // Integration Tests
  if (!shouldRunWatch) {
    logSection('Running Integration Tests');
    try {
      const coverageArgs = shouldRunCoverage ? ['--coverage', '--coverageDirectory=coverage/integration'] : [];
      const integrationResult = await runTests(testConfigs.integration, coverageArgs);

      results.total++;
      if (integrationResult.success) {
        logSuccess(`${testConfigs.integration.name} completed successfully`);
        results.passed++;
      } else {
        logError(`${testConfigs.integration.name} failed with exit code ${integrationResult.code}`);
        results.failed++;
      }
    } catch (error) {
      logError(`Failed to run integration tests: ${error.message}`);
      results.failed++;
      results.total++;
    }
  }

  // Performance Tests (optional)
  if (shouldRunPerformance && !shouldRunWatch) {
    logSection('Running Performance Tests');
    logInfo('Performance tests may take several minutes to complete...');

    try {
      const performanceResult = await runTests(testConfigs.performance);

      results.total++;
      if (performanceResult.success) {
        logSuccess(`${testConfigs.performance.name} completed successfully`);
        results.passed++;
      } else {
        logError(`${testConfigs.performance.name} failed with exit code ${performanceResult.code}`);
        results.failed++;
      }
    } catch (error) {
      logError(`Failed to run performance tests: ${error.message}`);
      results.failed++;
      results.total++;
    }
  }

  // Summary
  logSection('Test Results Summary');

  if (results.failed === 0) {
    logSuccess(`All tests passed! (${results.passed}/${results.total})`);

    if (shouldRunCoverage) {
      logInfo('Coverage reports generated in coverage/ directory');
    }

    if (!shouldRunPerformance && !shouldRunWatch) {
      logInfo('Run with --performance flag to include performance tests');
      logInfo('Run with --coverage flag to generate coverage reports');
      logInfo('Run with --watch flag to run tests in watch mode');
    }
  } else {
    logError(`${results.failed}/${results.total} test suite(s) failed`);
    process.exit(1);
  }
}

// Validation function to check dependencies
async function validateEnvironment() {
  logInfo('Validating test environment...');

  // Check if Jest is available
  try {
    const jestCheck = spawn(isWindows ? 'npx.cmd' : 'npx', ['jest', '--version'], {
      stdio: 'pipe',
      shell: true
    });

    await new Promise((resolve, reject) => {
      jestCheck.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Jest not found or not working (exit code: ${code})`));
        }
      });
    });

    logSuccess('Jest is available');
  } catch (error) {
    logError(`Jest validation failed: ${error.message}`);
    logInfo('Please run: npm install');
    process.exit(1);
  }

  // Check if TypeScript is available
  try {
    const tsCheck = spawn(isWindows ? 'npx.cmd' : 'npx', ['tsc', '--version'], {
      stdio: 'pipe',
      shell: true
    });

    await new Promise((resolve, reject) => {
      tsCheck.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`TypeScript not found (exit code: ${code})`));
        }
      });
    });

    logSuccess('TypeScript is available');
  } catch (error) {
    logError(`TypeScript validation failed: ${error.message}`);
    process.exit(1);
  }

  logSuccess('Environment validation passed');
}

// Help function
function showHelp() {
  console.log(chalk.yellow.bold('Background Jobs Test Runner'));
  console.log();
  console.log(chalk.white('Usage: node test-background-jobs.js [options]'));
  console.log();
  console.log(chalk.white('Options:'));
  console.log(chalk.gray('  --performance    Run performance tests (may take several minutes)'));
  console.log(chalk.gray('  --coverage       Generate code coverage reports'));
  console.log(chalk.gray('  --watch          Run tests in watch mode'));
  console.log(chalk.gray('  --all            Run all tests including performance'));
  console.log(chalk.gray('  --help           Show this help message'));
  console.log();
  console.log(chalk.white('Examples:'));
  console.log(chalk.gray('  node test-background-jobs.js                    # Run unit and integration tests'));
  console.log(chalk.gray('  node test-background-jobs.js --performance      # Include performance tests'));
  console.log(chalk.gray('  node test-background-jobs.js --coverage         # Generate coverage reports'));
  console.log(chalk.gray('  node test-background-jobs.js --watch            # Run in watch mode'));
}

// Main execution
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    return;
  }

  try {
    await validateEnvironment();
    await runTestSuite();
  } catch (error) {
    logError(`Test runner failed: ${error.message}`);
    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logError(`Unhandled rejection at: ${promise}, reason: ${reason}`);
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logError(`Uncaught exception: ${error.message}`);
  process.exit(1);
});

// Run the test suite
main().catch((error) => {
  logError(`Fatal error: ${error.message}`);
  process.exit(1);
});