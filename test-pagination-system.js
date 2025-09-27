#!/usr/bin/env node

/**
 * Comprehensive Test Suite for Output Pagination System
 * Tests pagination with large outputs (50k+ lines) and validates functionality
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Import the modules to test
const { ConsoleManager } = require('./dist/core/ConsoleManager.js');
const { OutputPaginationManager } = require('./dist/core/OutputPaginationManager.js');

class PaginationTestSuite {
  constructor() {
    this.testResults = [];
    this.totalTests = 0;
    this.passedTests = 0;
    this.startTime = Date.now();
  }

  log(message, level = 'info') {
    const timestamp = new Date().toISOString();
    const prefix = level === 'error' ? '❌' : level === 'success' ? '✅' : 'ℹ️';
    console.log(`[${timestamp}] ${prefix} ${message}`);
  }

  async runTest(name, testFunction) {
    this.totalTests++;
    const startTime = Date.now();

    try {
      this.log(`Running test: ${name}`, 'info');
      await testFunction();

      const duration = Date.now() - startTime;
      this.passedTests++;
      this.testResults.push({
        name,
        status: 'passed',
        duration,
        error: null
      });

      this.log(`✅ Test passed: ${name} (${duration}ms)`, 'success');
    } catch (error) {
      const duration = Date.now() - startTime;
      this.testResults.push({
        name,
        status: 'failed',
        duration,
        error: error.message
      });

      this.log(`❌ Test failed: ${name} - ${error.message}`, 'error');
      console.error(error.stack);
    }
  }

  /**
   * Generate large test output data
   */
  generateLargeOutput(lineCount = 50000) {
    const outputs = [];
    const baseTimestamp = Date.now();

    for (let i = 0; i < lineCount; i++) {
      outputs.push({
        sessionId: 'test-session',
        type: i % 10 === 0 ? 'stderr' : 'stdout',
        data: `Line ${i + 1}: This is test output line with some random data ${Math.random().toString(36)}\n`,
        timestamp: new Date(baseTimestamp + i * 10),
        raw: null
      });
    }

    return outputs;
  }

  /**
   * Test basic pagination functionality
   */
  async testBasicPagination() {
    const paginationManager = new OutputPaginationManager({
      defaultPageSize: 1000,
      maxPageSize: 5000,
      minPageSize: 100
    });

    const testOutputs = this.generateLargeOutput(10000);
    paginationManager.addOutputs('test-session', testOutputs);

    // Test first page
    const firstPage = paginationManager.getPaginatedOutput({
      sessionId: 'test-session',
      offset: 0,
      limit: 1000
    });

    if (firstPage.data.length !== 1000) {
      throw new Error(`Expected 1000 items, got ${firstPage.data.length}`);
    }

    if (!firstPage.hasMore) {
      throw new Error('Expected hasMore to be true');
    }

    if (firstPage.totalLines !== 10000) {
      throw new Error(`Expected totalLines to be 10000, got ${firstPage.totalLines}`);
    }

    if (firstPage.currentOffset !== 0) {
      throw new Error(`Expected currentOffset to be 0, got ${firstPage.currentOffset}`);
    }

    // Test middle page
    const middlePage = paginationManager.getPaginatedOutput({
      sessionId: 'test-session',
      offset: 5000,
      limit: 1000
    });

    if (middlePage.data.length !== 1000) {
      throw new Error(`Expected 1000 items, got ${middlePage.data.length}`);
    }

    if (middlePage.currentOffset !== 5000) {
      throw new Error(`Expected currentOffset to be 5000, got ${middlePage.currentOffset}`);
    }

    // Test last page
    const lastPage = paginationManager.getPaginatedOutput({
      sessionId: 'test-session',
      offset: 9000,
      limit: 1000
    });

    if (lastPage.data.length !== 1000) {
      throw new Error(`Expected 1000 items, got ${lastPage.data.length}`);
    }

    if (lastPage.hasMore !== false) {
      throw new Error('Expected hasMore to be false for last page');
    }

    paginationManager.destroy();
  }

  /**
   * Test continuation tokens
   */
  async testContinuationTokens() {
    const paginationManager = new OutputPaginationManager({
      defaultPageSize: 500,
      enableContinuationTokens: true
    });

    const testOutputs = this.generateLargeOutput(2000);
    paginationManager.addOutputs('test-session', testOutputs);

    // Get first page
    const firstPage = paginationManager.getPaginatedOutput({
      sessionId: 'test-session',
      offset: 0,
      limit: 500
    });

    if (!firstPage.nextToken) {
      throw new Error('Expected nextToken to be present');
    }

    // Use continuation token for second page
    const secondPage = paginationManager.getPaginatedOutput({
      sessionId: 'test-session',
      continuationToken: firstPage.nextToken
    });

    if (secondPage.currentOffset !== 500) {
      throw new Error(`Expected currentOffset to be 500, got ${secondPage.currentOffset}`);
    }

    if (secondPage.data.length !== 500) {
      throw new Error(`Expected 500 items, got ${secondPage.data.length}`);
    }

    // Verify content is different
    if (firstPage.data[0].data === secondPage.data[0].data) {
      throw new Error('Expected different content between pages');
    }

    paginationManager.destroy();
  }

  /**
   * Test large output performance (100k+ lines)
   */
  async testLargeOutputPerformance() {
    const paginationManager = new OutputPaginationManager({
      defaultPageSize: 1000,
      maxBufferSize: 200000
    });

    const lineCount = 100000;
    this.log(`Generating ${lineCount} lines of test data...`);

    const startGeneration = Date.now();
    const testOutputs = this.generateLargeOutput(lineCount);
    const generationTime = Date.now() - startGeneration;

    this.log(`Generated ${lineCount} lines in ${generationTime}ms`);

    // Add outputs and measure performance
    const startAdd = Date.now();
    paginationManager.addOutputs('test-session', testOutputs);
    const addTime = Date.now() - startAdd;

    this.log(`Added ${lineCount} lines to pagination manager in ${addTime}ms`);

    // Test random access performance
    const randomTests = 50;
    const startRandom = Date.now();

    for (let i = 0; i < randomTests; i++) {
      const randomOffset = Math.floor(Math.random() * (lineCount - 1000));
      const page = paginationManager.getPaginatedOutput({
        sessionId: 'test-session',
        offset: randomOffset,
        limit: 1000
      });

      if (page.data.length !== 1000) {
        throw new Error(`Random access failed at offset ${randomOffset}`);
      }
    }

    const randomTime = Date.now() - startRandom;
    this.log(`Completed ${randomTests} random access tests in ${randomTime}ms (${Math.round(randomTime/randomTests)}ms avg)`);

    // Test sequential pagination
    const startSequential = Date.now();
    let offset = 0;
    let pagesProcessed = 0;

    while (offset < lineCount) {
      const page = paginationManager.getPaginatedOutput({
        sessionId: 'test-session',
        offset,
        limit: 2000
      });

      if (page.data.length === 0) break;

      offset += page.data.length;
      pagesProcessed++;
    }

    const sequentialTime = Date.now() - startSequential;
    this.log(`Processed ${pagesProcessed} pages sequentially in ${sequentialTime}ms`);

    // Get buffer statistics
    const stats = paginationManager.getBufferStats('test-session');
    this.log(`Buffer stats: ${stats.totalLines} lines, ${stats.memoryUsageMB}MB memory`);

    if (stats.totalLines !== lineCount) {
      throw new Error(`Expected ${lineCount} total lines, got ${stats.totalLines}`);
    }

    paginationManager.destroy();
  }

  /**
   * Test ConsoleManager integration
   */
  async testConsoleManagerIntegration() {
    const consoleManager = new ConsoleManager();

    // Create a test session
    const session = await consoleManager.createSession({
      command: 'echo',
      args: ['test'],
      consoleType: 'bash'
    });

    // Simulate adding large amounts of output
    const testOutputs = this.generateLargeOutput(5000);

    // Add outputs through the console manager's internal mechanism
    for (const output of testOutputs) {
      consoleManager.paginationManager.addOutputs(session.id, [output]);
    }

    // Test paginated retrieval through ConsoleManager
    const paginatedResult = consoleManager.getPaginatedOutputCompat(
      session.id,
      0,
      1000
    );

    if (paginatedResult.data.length !== 1000) {
      throw new Error(`Expected 1000 items, got ${paginatedResult.data.length}`);
    }

    if (paginatedResult.totalLines !== 5000) {
      throw new Error(`Expected 5000 total lines, got ${paginatedResult.totalLines}`);
    }

    if (!paginatedResult.hasMore) {
      throw new Error('Expected hasMore to be true');
    }

    // Test continuation token through ConsoleManager
    if (paginatedResult.nextToken) {
      const nextPage = consoleManager.getPaginatedOutputCompat(
        session.id,
        undefined,
        undefined,
        paginatedResult.nextToken
      );

      if (nextPage.currentOffset !== 1000) {
        throw new Error(`Expected offset 1000, got ${nextPage.currentOffset}`);
      }
    }

    await consoleManager.stopSession(session.id);
  }

  /**
   * Test backward compatibility
   */
  async testBackwardCompatibility() {
    const paginationManager = new OutputPaginationManager();
    const testOutputs = this.generateLargeOutput(1000);

    paginationManager.addOutputs('test-session', testOutputs);

    // Test old-style getOutput method
    const allOutputs = paginationManager.getOutput('test-session');
    if (allOutputs.length !== 1000) {
      throw new Error(`Expected 1000 outputs, got ${allOutputs.length}`);
    }

    // Test with limit
    const limitedOutputs = paginationManager.getOutput('test-session', 100);
    if (limitedOutputs.length !== 100) {
      throw new Error(`Expected 100 outputs, got ${limitedOutputs.length}`);
    }

    // Verify it returns last N items (backward compatible behavior)
    if (limitedOutputs[0].data !== testOutputs[testOutputs.length - 100].data) {
      throw new Error('Backward compatibility failed - not returning last N items');
    }

    paginationManager.destroy();
  }

  /**
   * Test error handling and edge cases
   */
  async testErrorHandling() {
    const paginationManager = new OutputPaginationManager({
      minPageSize: 100,
      maxPageSize: 5000
    });

    // Test non-existent session
    const emptyResult = paginationManager.getPaginatedOutput({
      sessionId: 'non-existent',
      offset: 0,
      limit: 1000
    });

    if (emptyResult.data.length !== 0) {
      throw new Error('Expected empty result for non-existent session');
    }

    if (emptyResult.hasMore !== false) {
      throw new Error('Expected hasMore to be false for non-existent session');
    }

    // Test invalid pagination parameters
    const testOutputs = this.generateLargeOutput(1000);
    paginationManager.addOutputs('test-session', testOutputs);

    // Test negative offset (should be clamped to 0)
    const negativeOffset = paginationManager.getPaginatedOutput({
      sessionId: 'test-session',
      offset: -100,
      limit: 100
    });

    if (negativeOffset.currentOffset !== 0) {
      throw new Error('Expected negative offset to be clamped to 0');
    }

    // Test limit exceeding maximum (should be clamped)
    const exceededLimit = paginationManager.getPaginatedOutput({
      sessionId: 'test-session',
      offset: 0,
      limit: 10000 // Exceeds maxPageSize
    });

    if (exceededLimit.data.length > 5000) {
      throw new Error('Expected limit to be clamped to maxPageSize');
    }

    // Test limit below minimum (should be clamped)
    const belowMinimum = paginationManager.getPaginatedOutput({
      sessionId: 'test-session',
      offset: 0,
      limit: 50 // Below minPageSize
    });

    if (belowMinimum.data.length < 100) {
      throw new Error('Expected limit to be clamped to minPageSize');
    }

    paginationManager.destroy();
  }

  /**
   * Performance comparison: paginated vs full retrieval
   */
  async testPerformanceComparison() {
    const consoleManager = new ConsoleManager();
    const testOutputs = this.generateLargeOutput(50000);

    // Add outputs to both systems
    const sessionId = 'perf-test-session';
    consoleManager.outputBuffers.set(sessionId, testOutputs);
    consoleManager.paginationManager.addOutputs(sessionId, testOutputs);

    this.log('Starting performance comparison tests...');

    // Test full retrieval performance
    const startFullRetrieval = Date.now();
    const fullOutput = consoleManager.getOutput(sessionId);
    const fullRetrievalTime = Date.now() - startFullRetrieval;

    this.log(`Full retrieval (${fullOutput.length} lines): ${fullRetrievalTime}ms`);

    // Test paginated retrieval performance (10 pages of 1000 lines each)
    const startPaginated = Date.now();
    let totalPaginatedLines = 0;

    for (let i = 0; i < 10; i++) {
      const page = consoleManager.getPaginatedOutputCompat(
        sessionId,
        i * 1000,
        1000
      );
      totalPaginatedLines += page.data.length;
    }

    const paginatedTime = Date.now() - startPaginated;
    this.log(`Paginated retrieval (${totalPaginatedLines} lines in 10 pages): ${paginatedTime}ms`);

    // Memory usage comparison
    const bufferStats = consoleManager.paginationManager.getBufferStats(sessionId);
    this.log(`Pagination manager memory usage: ${bufferStats.memoryUsageMB}MB`);

    // Calculate rough memory usage of original buffer
    const originalMemoryMB = Math.round(
      testOutputs.reduce((sum, output) => sum + (output.data?.length || 0), 0) * 2 / (1024 * 1024) * 100
    ) / 100;

    this.log(`Original buffer estimated memory usage: ${originalMemoryMB}MB`);

    // Performance metrics
    const performanceMetrics = {
      fullRetrievalTimeMs: fullRetrievalTime,
      paginatedRetrievalTimeMs: paginatedTime,
      paginatedMemoryMB: bufferStats.memoryUsageMB,
      originalMemoryMB: originalMemoryMB,
      performanceImprovement: Math.round((fullRetrievalTime / paginatedTime) * 100) / 100,
      memoryEfficiency: Math.round((originalMemoryMB / bufferStats.memoryUsageMB) * 100) / 100
    };

    this.log(`Performance improvement ratio: ${performanceMetrics.performanceImprovement}x`);
    this.log(`Memory efficiency ratio: ${performanceMetrics.memoryEfficiency}x`);

    await consoleManager.stopSession(sessionId);

    return performanceMetrics;
  }

  /**
   * Run all tests
   */
  async runAllTests() {
    this.log('🚀 Starting Pagination System Test Suite', 'info');
    this.log('=' .repeat(60), 'info');

    await this.runTest('Basic Pagination Functionality', () => this.testBasicPagination());
    await this.runTest('Continuation Tokens', () => this.testContinuationTokens());
    await this.runTest('Large Output Performance (100k+ lines)', () => this.testLargeOutputPerformance());
    await this.runTest('ConsoleManager Integration', () => this.testConsoleManagerIntegration());
    await this.runTest('Backward Compatibility', () => this.testBackwardCompatibility());
    await this.runTest('Error Handling and Edge Cases', () => this.testErrorHandling());

    const performanceMetrics = await this.runTest('Performance Comparison', () => this.testPerformanceComparison());

    // Generate test report
    const totalTime = Date.now() - this.startTime;
    const successRate = Math.round((this.passedTests / this.totalTests) * 100);

    this.log('=' .repeat(60), 'info');
    this.log('📊 TEST RESULTS SUMMARY', 'info');
    this.log('=' .repeat(60), 'info');
    this.log(`Total Tests: ${this.totalTests}`, 'info');
    this.log(`Passed: ${this.passedTests}`, 'success');
    this.log(`Failed: ${this.totalTests - this.passedTests}`, this.passedTests === this.totalTests ? 'info' : 'error');
    this.log(`Success Rate: ${successRate}%`, successRate === 100 ? 'success' : 'error');
    this.log(`Total Time: ${totalTime}ms`, 'info');

    if (this.testResults.some(r => r.status === 'failed')) {
      this.log('\n❌ FAILED TESTS:', 'error');
      this.testResults
        .filter(r => r.status === 'failed')
        .forEach(result => {
          this.log(`  - ${result.name}: ${result.error}`, 'error');
        });
    }

    const report = {
      summary: {
        totalTests: this.totalTests,
        passedTests: this.passedTests,
        failedTests: this.totalTests - this.passedTests,
        successRate: successRate,
        totalTimeMs: totalTime
      },
      testResults: this.testResults,
      performanceMetrics: performanceMetrics,
      timestamp: new Date().toISOString()
    };

    // Save detailed report
    fs.writeFileSync(
      path.join(__dirname, 'pagination-test-report.json'),
      JSON.stringify(report, null, 2)
    );

    this.log('\n📋 Detailed report saved to: pagination-test-report.json', 'info');

    return successRate === 100;
  }
}

// Run the test suite if called directly
if (require.main === module) {
  const testSuite = new PaginationTestSuite();

  testSuite.runAllTests()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('Test suite crashed:', error);
      process.exit(1);
    });
}

module.exports = { PaginationTestSuite };