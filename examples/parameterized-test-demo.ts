/**
 * Parameterized Test Demo
 *
 * Demonstrates data-driven testing with multiple datasets.
 */

import { DataParameterizer } from '../src/testing/DataParameterizer.js';
import { TestDataLoader } from '../src/testing/TestDataLoader.js';
import { TestDefinition } from '../src/types/test-framework.js';
import * as path from 'path';

async function main() {
  console.log('=== Parameterized Test Demo ===\n');

  // 1. Create instances
  const loader = new TestDataLoader();
  const parameterizer = new DataParameterizer();

  // 2. Load test data from CSV
  console.log('Loading test data from CSV...');
  const fixturesPath = path.resolve(process.cwd(), 'data/fixtures');
  const testData = await loader.loadCSV(path.join(fixturesPath, 'test-data.csv'));
  console.log(`Loaded ${testData.length} test cases\n`);

  // 3. Create a test definition
  const testDef: TestDefinition = {
    name: 'API Health Check Test',
    description: 'Test API endpoints with various inputs',
    assertions: [],
    timeout: 10000,
    retry: 0,
  };

  // 4. Run with different strategies
  console.log('--- Strategy: ALL (run all datasets) ---');
  const resultAll = await parameterizer.runParameterized(
    testDef,
    testData.slice(0, 5),
    { strategy: 'all' }
  );

  const summaryAll = parameterizer.summarizeResults(resultAll);
  console.log(`Total: ${summaryAll.total}`);
  console.log(`Passed: ${summaryAll.passed}`);
  console.log(`Failed: ${summaryAll.failed}`);
  console.log(`Pass Rate: ${(summaryAll.passRate * 100).toFixed(1)}%`);
  console.log(`Avg Duration: ${summaryAll.avgDuration.toFixed(2)}ms\n`);

  // 5. Run with first-failure strategy
  console.log('--- Strategy: FIRST-FAILURE (stop on first failure) ---');
  const resultFirstFailure = await parameterizer.runParameterized(
    testDef,
    testData.slice(0, 10),
    { strategy: 'first-failure' }
  );

  const summaryFirstFailure = parameterizer.summarizeResults(resultFirstFailure);
  console.log(`Executed: ${resultFirstFailure.results.length} out of 10`);
  console.log(`Pass Rate: ${(summaryFirstFailure.passRate * 100).toFixed(1)}%\n`);

  // 6. Run with random sample
  console.log('--- Strategy: RANDOM-SAMPLE (sample 3 random datasets) ---');
  const resultSample = await parameterizer.runParameterized(
    testDef,
    testData,
    { strategy: 'random-sample', sampleSize: 3 }
  );

  const summarySample = parameterizer.summarizeResults(resultSample);
  console.log(`Sampled: ${resultSample.results.length} datasets`);
  console.log(`Pass Rate: ${(summarySample.passRate * 100).toFixed(1)}%\n`);

  // 7. Show individual results
  console.log('--- Individual Results (first 5) ---');
  resultAll.results.slice(0, 5).forEach((result, index) => {
    const dataset = resultAll.datasets[index];
    console.log(`\nDataset ${index + 1}: ${dataset.test_name}`);
    console.log(`  Status: ${result.status}`);
    console.log(`  Duration: ${result.duration}ms`);
  });

  // 8. Identify failed datasets
  const failed = parameterizer.getFailedDatasets(resultAll);
  if (failed.length > 0) {
    console.log('\n--- Failed Datasets ---');
    failed.forEach(({ index, dataset }) => {
      console.log(`  ${index}: ${dataset.test_name}`);
    });
  } else {
    console.log('\nAll tests passed!');
  }

  console.log('\n=== Demo Complete ===');
}

// Run the demo
main().catch((error) => {
  console.error('Demo failed:', error);
  process.exit(1);
});
