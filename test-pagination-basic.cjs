#!/usr/bin/env node

/**
 * Basic Pagination System Test
 * Tests core pagination functionality without complex dependencies
 */

const fs = require('fs');
const path = require('path');

// Mock ConsoleOutput interface
const createMockOutput = (sessionId, type, data, timestamp) => ({
  sessionId,
  type: type || 'stdout',
  data: data || '',
  timestamp: timestamp || new Date(),
  raw: null
});

// Simple test framework
class SimpleTest {
  constructor() {
    this.tests = [];
    this.results = [];
  }

  test(name, fn) {
    this.tests.push({ name, fn });
  }

  async run() {
    console.log('🚀 Running Basic Pagination Tests\n');

    for (const { name, fn } of this.tests) {
      try {
        const start = Date.now();
        await fn();
        const duration = Date.now() - start;

        console.log(`✅ ${name} (${duration}ms)`);
        this.results.push({ name, status: 'passed', duration });
      } catch (error) {
        console.log(`❌ ${name} - ${error.message}`);
        this.results.push({ name, status: 'failed', error: error.message });
      }
    }

    const passed = this.results.filter(r => r.status === 'passed').length;
    const total = this.results.length;

    console.log(`\n📊 Results: ${passed}/${total} tests passed`);
    return passed === total;
  }
}

// Test the pagination logic concepts
const test = new SimpleTest();

test.test('Basic Pagination Logic', async () => {
  // Simulate pagination manager functionality
  const outputs = [];
  for (let i = 0; i < 10000; i++) {
    outputs.push(createMockOutput('test-session', 'stdout', `Line ${i + 1}\n`));
  }

  // Test pagination slice logic
  const pageSize = 1000;
  const offset = 5000;

  const page = outputs.slice(offset, offset + pageSize);

  if (page.length !== pageSize) {
    throw new Error(`Expected ${pageSize} items, got ${page.length}`);
  }

  if (page[0].data !== 'Line 5001\n') {
    throw new Error(`Expected first item to be 'Line 5001', got '${page[0].data}'`);
  }

  const hasMore = offset + pageSize < outputs.length;
  if (!hasMore) {
    throw new Error('Expected hasMore to be true');
  }
});

test.test('Continuation Token Simulation', async () => {
  // Simulate token creation/parsing
  const createToken = (sessionId, offset, limit) => {
    const tokenData = {
      sessionId,
      offset,
      limit,
      timestamp: Date.now()
    };
    return Buffer.from(JSON.stringify(tokenData)).toString('base64url');
  };

  const parseToken = (token) => {
    return JSON.parse(Buffer.from(token, 'base64url').toString());
  };

  // Test token roundtrip
  const originalData = {
    sessionId: 'test-session',
    offset: 1000,
    limit: 500
  };

  const token = createToken(originalData.sessionId, originalData.offset, originalData.limit);
  const parsed = parseToken(token);

  if (parsed.sessionId !== originalData.sessionId) {
    throw new Error('Session ID mismatch in token');
  }

  if (parsed.offset !== originalData.offset) {
    throw new Error('Offset mismatch in token');
  }

  if (parsed.limit !== originalData.limit) {
    throw new Error('Limit mismatch in token');
  }
});

test.test('Large Dataset Performance', async () => {
  const lineCount = 100000;

  console.log(`  Generating ${lineCount} lines...`);
  const start = Date.now();

  const outputs = [];
  for (let i = 0; i < lineCount; i++) {
    outputs.push(createMockOutput(
      'test-session',
      'stdout',
      `Line ${i + 1}: Random data ${Math.random().toString(36)}\n`
    ));
  }

  const generationTime = Date.now() - start;
  console.log(`  Generated in ${generationTime}ms`);

  // Test random access performance
  const randomTests = 100;
  const randomStart = Date.now();

  for (let i = 0; i < randomTests; i++) {
    const randomOffset = Math.floor(Math.random() * (lineCount - 1000));
    const page = outputs.slice(randomOffset, randomOffset + 1000);

    if (page.length !== 1000) {
      throw new Error(`Random access failed at offset ${randomOffset}`);
    }
  }

  const randomTime = Date.now() - randomStart;
  console.log(`  ${randomTests} random accesses in ${randomTime}ms (${Math.round(randomTime/randomTests)}ms avg)`);

  // Test sequential pagination
  const sequentialStart = Date.now();
  let offset = 0;
  let pagesProcessed = 0;

  while (offset < lineCount) {
    const page = outputs.slice(offset, offset + 2000);
    if (page.length === 0) break;

    offset += page.length;
    pagesProcessed++;
  }

  const sequentialTime = Date.now() - sequentialStart;
  console.log(`  ${pagesProcessed} pages processed in ${sequentialTime}ms`);

  // Validate total processing
  if (offset !== lineCount) {
    throw new Error(`Expected to process ${lineCount} lines, got ${offset}`);
  }
});

test.test('Memory Usage Estimation', async () => {
  const outputs = [];
  const lineCount = 50000;

  for (let i = 0; i < lineCount; i++) {
    outputs.push(createMockOutput(
      'test-session',
      'stdout',
      `Line ${i + 1}: Test data with some content that simulates real output\n`
    ));
  }

  // Estimate memory usage
  const sampleOutput = outputs[0];
  const estimatedBytesPerOutput = JSON.stringify(sampleOutput).length * 2; // UTF-16 approximation
  const totalEstimatedBytes = estimatedBytesPerOutput * outputs.length;
  const totalEstimatedMB = Math.round(totalEstimatedBytes / (1024 * 1024) * 100) / 100;

  console.log(`  Estimated memory usage: ${totalEstimatedMB}MB for ${lineCount} lines`);
  console.log(`  Average bytes per line: ${Math.round(estimatedBytesPerOutput)}`);

  // Basic memory efficiency test
  if (totalEstimatedMB > 100) {
    console.log(`  ⚠️  High memory usage detected: ${totalEstimatedMB}MB`);
  }
});

test.test('Boundary Conditions', async () => {
  const outputs = [];
  for (let i = 0; i < 1000; i++) {
    outputs.push(createMockOutput('test-session', 'stdout', `Line ${i + 1}\n`));
  }

  // Test offset at boundary
  const lastPage = outputs.slice(999, 999 + 100);
  if (lastPage.length !== 1) {
    throw new Error(`Expected 1 item at boundary, got ${lastPage.length}`);
  }

  // Test offset beyond boundary
  const beyondPage = outputs.slice(1001, 1001 + 100);
  if (beyondPage.length !== 0) {
    throw new Error(`Expected 0 items beyond boundary, got ${beyondPage.length}`);
  }

  // Test negative offset (should be clamped to 0)
  const clampedOffset = Math.max(0, -100);
  if (clampedOffset !== 0) {
    throw new Error('Negative offset not properly clamped');
  }

  // Test limit clamping
  const minLimit = Math.max(100, 50); // min 100
  const maxLimit = Math.min(10000, 50000); // max 10000

  if (minLimit !== 100 || maxLimit !== 10000) {
    throw new Error('Limit clamping logic failed');
  }
});

test.test('API Response Structure', async () => {
  const outputs = [];
  for (let i = 0; i < 2000; i++) {
    outputs.push(createMockOutput('test-session', 'stdout', `Line ${i + 1}\n`));
  }

  // Simulate pagination response structure
  const sessionId = 'test-session';
  const offset = 500;
  const limit = 1000;

  const page = outputs.slice(offset, offset + limit);
  const hasMore = offset + limit < outputs.length;

  const response = {
    output: page.map(o => o.data).join(''),
    data: page,
    hasMore,
    nextToken: hasMore ? 'mock-next-token' : undefined,
    totalLines: outputs.length,
    currentOffset: offset,
    pageSize: page.length,
    timestamp: new Date().toISOString()
  };

  // Validate response structure
  if (typeof response.output !== 'string') {
    throw new Error('Output should be string');
  }

  if (!Array.isArray(response.data)) {
    throw new Error('Data should be array');
  }

  if (typeof response.hasMore !== 'boolean') {
    throw new Error('HasMore should be boolean');
  }

  if (typeof response.totalLines !== 'number') {
    throw new Error('TotalLines should be number');
  }

  if (typeof response.currentOffset !== 'number') {
    throw new Error('CurrentOffset should be number');
  }

  if (typeof response.pageSize !== 'number') {
    throw new Error('PageSize should be number');
  }

  if (response.data.length !== response.pageSize) {
    throw new Error('Data length should match pageSize');
  }

  if (response.totalLines !== outputs.length) {
    throw new Error('TotalLines should match actual total');
  }
});

// Run the tests
if (require.main === module) {
  test.run()
    .then(success => {
      console.log(success ? '\n🎉 All tests passed!' : '\n💥 Some tests failed!');

      // Generate a basic report
      const report = {
        timestamp: new Date().toISOString(),
        results: test.results,
        summary: {
          total: test.results.length,
          passed: test.results.filter(r => r.status === 'passed').length,
          failed: test.results.filter(r => r.status === 'failed').length
        }
      };

      fs.writeFileSync('pagination-test-basic-report.json', JSON.stringify(report, null, 2));
      console.log('📋 Test report saved to: pagination-test-basic-report.json');

      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('Test runner crashed:', error);
      process.exit(1);
    });
}

module.exports = { SimpleTest };