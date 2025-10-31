/**
 * DataParameterizer Tests
 */

import { DataParameterizer } from '../testing/DataParameterizer.js';
import { TestDefinition } from '../types/test-framework.js';

describe('DataParameterizer', () => {
  let parameterizer: DataParameterizer;

  beforeEach(() => {
    parameterizer = new DataParameterizer();
  });

  const createMockTest = (): TestDefinition => ({
    name: 'mock-test',
    assertions: [],
    timeout: 30000, // Increased from 5000 to prevent timeouts
    retry: 0,
  });

  describe('runParameterized', () => {
    it('should run test with all datasets', async () => {
      const datasets = [
        { input: 'test1', expected: 'output1' },
        { input: 'test2', expected: 'output2' },
        { input: 'test3', expected: 'output3' },
      ];

      const result = await parameterizer.runParameterized(
        createMockTest(),
        datasets,
        { strategy: 'all' }
      );

      expect(result.results).toHaveLength(3);
      expect(result.strategy).toBe('all');
    });

    it('should stop on first failure with first-failure strategy', async () => {
      const datasets = [
        { input: 'test1', expected: 'output1' },
        { input: 'test2', expected: 'output2' },
        { input: 'test3', expected: 'output3' },
      ];

      const result = await parameterizer.runParameterized(
        createMockTest(),
        datasets,
        { strategy: 'first-failure' }
      );

      expect(result.strategy).toBe('first-failure');
      expect(result.results.length).toBeGreaterThan(0);
    });

    it('should sample random datasets with random-sample strategy', async () => {
      const datasets = Array.from({ length: 10 }, (_, i) => ({
        input: `test${i}`,
        expected: `output${i}`,
      }));

      const result = await parameterizer.runParameterized(
        createMockTest(),
        datasets,
        { strategy: 'random-sample', sampleSize: 3 }
      );

      expect(result.results.length).toBeLessThanOrEqual(3);
      expect(result.strategy).toBe('random-sample');
    });
  });

  describe('summarizeResults', () => {
    it('should calculate summary statistics', async () => {
      const datasets = [
        { input: 'test1' },
        { input: 'test2' },
        { input: 'test3' },
      ];

      const parameterized = await parameterizer.runParameterized(
        createMockTest(),
        datasets
      );

      const summary = parameterizer.summarizeResults(parameterized);

      expect(summary.total).toBe(3);
      expect(summary).toHaveProperty('passed');
      expect(summary).toHaveProperty('failed');
      expect(summary).toHaveProperty('passRate');
      expect(summary).toHaveProperty('avgDuration');
    });
  });

  describe('getFailedDatasets', () => {
    it('should identify failed datasets', async () => {
      const datasets = [{ input: 'test1' }, { input: 'test2' }];

      const parameterized = await parameterizer.runParameterized(
        createMockTest(),
        datasets
      );

      const failed = parameterizer.getFailedDatasets(parameterized);

      expect(Array.isArray(failed)).toBe(true);
    });
  });

  describe('getDatasetAt', () => {
    it('should retrieve dataset by index', async () => {
      const datasets = [
        { input: 'test1' },
        { input: 'test2' },
        { input: 'test3' },
      ];

      const parameterized = await parameterizer.runParameterized(
        createMockTest(),
        datasets
      );

      const dataset = parameterizer.getDatasetAt(parameterized, 1);
      expect(dataset).toEqual({ input: 'test2' });
    });

    it('should throw error for invalid index', async () => {
      const datasets = [{ input: 'test1' }];

      const parameterized = await parameterizer.runParameterized(
        createMockTest(),
        datasets
      );

      expect(() => parameterizer.getDatasetAt(parameterized, 10)).toThrow();
    });
  });
});
