/**
 * Phase 5 Integration Tests
 */

import { TestDataLoader } from '../testing/TestDataLoader.js';
import { DataParameterizer } from '../testing/DataParameterizer.js';
import { TestEnvironmentManager } from '../testing/TestEnvironment.js';
import { FixtureManager } from '../testing/FixtureManager.js';
import * as path from 'path';

describe('Phase 5 Integration', () => {
  const fixturesPath = path.resolve(process.cwd(), 'data/fixtures');

  describe('End-to-end fixture workflow', () => {
    it('should load, manage, and use fixtures', async () => {
      // 1. Create managers
      const loader = new TestDataLoader();
      const fixtureManager = new FixtureManager();
      const envManager = new TestEnvironmentManager();

      // 2. Register fixtures
      fixtureManager.register('users', path.join(fixturesPath, 'users.json'));
      fixtureManager.register(
        'servers',
        path.join(fixturesPath, 'servers.json')
      );

      // 3. Load fixtures
      await fixtureManager.loadAll();

      // 4. Create environment
      const env = envManager.createEnvironment({
        name: 'integration-test',
        variables: { testMode: true },
      });

      await envManager.setupEnvironment('integration-test');

      // 5. Seed data
      const seedData = fixtureManager.createSeedData();
      await envManager.seedData('integration-test', seedData);

      // 6. Verify
      expect(fixtureManager.getStats().loaded).toBe(2);
      expect(envManager.isSetup('integration-test')).toBe(true);

      // 7. Cleanup
      await envManager.teardownEnvironment('integration-test');
      fixtureManager.cleanup();
    });
  });

  describe('Parameterized test with fixture data', () => {
    it('should run parameterized tests with CSV data', async () => {
      // 1. Load test data from CSV
      const loader = new TestDataLoader();
      const testData = await loader.loadCSV(
        path.join(fixturesPath, 'test-data.csv')
      );

      // 2. Run parameterized test
      const parameterizer = new DataParameterizer();
      const testDef = {
        name: 'csv-driven-test',
        assertions: [],
        timeout: 5000,
        retry: 0,
      };

      const result = await parameterizer.runParameterized(
        testDef,
        testData.slice(0, 5), // Run with first 5 datasets
        { strategy: 'all' }
      );

      // 3. Verify results
      expect(result.results.length).toBe(5);
      const summary = parameterizer.summarizeResults(result);
      expect(summary.total).toBe(5);
    });
  });

  describe('Multiple format fixture loading', () => {
    it('should load JSON, YAML, and CSV fixtures', async () => {
      const loader = new TestDataLoader();

      const [json, yaml, csv] = await Promise.all([
        loader.loadJSON(path.join(fixturesPath, 'users.json')),
        loader.loadYAML(path.join(fixturesPath, 'deploy-config.yaml')),
        loader.loadCSV(path.join(fixturesPath, 'test-data.csv')),
      ]);

      expect(Array.isArray(json)).toBe(true);
      expect(typeof yaml).toBe('object');
      expect(Array.isArray(csv)).toBe(true);

      expect(json.length).toBeGreaterThan(0);
      expect(yaml).toHaveProperty('name');
      expect(csv.length).toBeGreaterThan(0);
    });
  });

  describe('Environment isolation', () => {
    it('should create isolated environments', async () => {
      const envManager = new TestEnvironmentManager();

      // Create base environment
      envManager.createEnvironment({
        name: 'base-env',
        variables: { shared: 'value' },
      });

      // Create isolated copy
      const isolated = envManager.createIsolatedEnvironment(
        'base-env',
        'isolated-1'
      );

      // Modify isolated
      envManager.setVariable('isolated-1', 'isolated', 'data');

      // Verify isolation
      const baseVars = envManager.getVariables('base-env');
      const isolatedVars = envManager.getVariables('isolated-1');

      expect(baseVars.shared).toBe('value');
      expect(baseVars.isolated).toBeUndefined();
      expect(isolatedVars.shared).toBe('value');
      expect(isolatedVars.isolated).toBe('data');
    });
  });

  describe('Fixture dependencies', () => {
    it('should handle fixture dependencies', async () => {
      const fixtureManager = new FixtureManager();

      // Register with dependencies
      fixtureManager.register(
        'servers',
        path.join(fixturesPath, 'servers.json')
      );
      fixtureManager.register(
        'deploy-config',
        path.join(fixturesPath, 'deploy-config.yaml'),
        {
          dependencies: ['servers'],
        }
      );

      // Validate
      const validation = fixtureManager.validateDependencies();
      expect(validation.valid).toBe(true);

      // Load (should load servers first)
      await fixtureManager.load('deploy-config');

      const loadOrder = fixtureManager.getLoadOrder();
      expect(loadOrder[0]).toBe('servers');
      expect(loadOrder[1]).toBe('deploy-config');
    });
  });

  describe('Complex workflow', () => {
    it('should handle complete test setup and execution', async () => {
      // This test demonstrates the full Phase 5 workflow

      // 1. Setup managers
      const loader = new TestDataLoader();
      const parameterizer = new DataParameterizer();
      const envManager = new TestEnvironmentManager();
      const fixtureManager = new FixtureManager();

      // 2. Load and prepare test data
      fixtureManager.register(
        'test-data',
        path.join(fixturesPath, 'test-data.csv')
      );
      await fixtureManager.load('test-data');

      const testData = fixtureManager.get('test-data');
      expect(testData).toBeDefined();

      // 3. Setup test environment
      await envManager.withEnvironment(
        {
          name: 'complex-test-env',
          variables: { env: 'test', debug: true },
        },
        async (env) => {
          // 4. Seed fixtures
          const seedData = fixtureManager.createSeedData();
          await envManager.seedData('complex-test-env', seedData);

          // 5. Run parameterized tests
          const testDef = {
            name: 'complex-workflow-test',
            assertions: [],
            timeout: 10000,
            retry: 0,
          };

          if (testData && Array.isArray(testData.data)) {
            const result = await parameterizer.runParameterized(
              testDef,
              testData.data.slice(0, 3),
              { strategy: 'all' }
            );

            // 6. Verify results
            expect(result.results.length).toBeGreaterThan(0);
            const summary = parameterizer.summarizeResults(result);
            expect(summary.total).toBeGreaterThan(0);
          }
        }
      );

      // Environment is automatically cleaned up
    });
  });
});
