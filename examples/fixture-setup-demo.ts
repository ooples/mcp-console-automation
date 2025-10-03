/**
 * Fixture Setup Demo
 *
 * Demonstrates fixture loading, environment setup, and data seeding.
 */

import { TestDataLoader } from '../src/testing/TestDataLoader.js';
import { TestEnvironmentManager } from '../src/testing/TestEnvironment.js';
import { FixtureManager } from '../src/testing/FixtureManager.js';
import * as path from 'path';

async function main() {
  console.log('=== Fixture Setup Demo ===\n');

  const fixturesPath = path.resolve(process.cwd(), 'data/fixtures');

  // 1. TestDataLoader Demo
  console.log('--- Part 1: Loading Fixtures ---\n');

  const loader = new TestDataLoader();

  // Load JSON
  console.log('Loading users.json...');
  const users = await loader.loadJSON(path.join(fixturesPath, 'users.json'));
  console.log(`  Loaded ${users.length} users`);
  console.log(`  First user: ${users[0].username} (${users[0].email})\n`);

  // Load YAML
  console.log('Loading deploy-config.yaml...');
  const deployConfig = await loader.loadYAML(path.join(fixturesPath, 'deploy-config.yaml'));
  console.log(`  Config name: ${deployConfig.name}`);
  console.log(`  Environments: ${Object.keys(deployConfig.environments).join(', ')}\n`);

  // Load CSV
  console.log('Loading test-data.csv...');
  const testData = await loader.loadCSV(path.join(fixturesPath, 'test-data.csv'));
  console.log(`  Loaded ${testData.length} test cases`);
  console.log(`  First test: ${testData[0].test_name}\n`);

  // 2. FixtureManager Demo
  console.log('--- Part 2: Managing Multiple Fixtures ---\n');

  const fixtureManager = new FixtureManager();

  // Register fixtures
  console.log('Registering fixtures...');
  fixtureManager.register('users', path.join(fixturesPath, 'users.json'), {
    priority: 10,
  });
  fixtureManager.register('servers', path.join(fixturesPath, 'servers.json'), {
    priority: 5,
    dependencies: [],
  });
  fixtureManager.register('deploy-config', path.join(fixturesPath, 'deploy-config.yaml'), {
    priority: 1,
    dependencies: ['servers'],
  });

  console.log(`  Registered: ${fixtureManager.listRegistered().join(', ')}\n`);

  // Validate dependencies
  console.log('Validating dependencies...');
  const validation = fixtureManager.validateDependencies();
  console.log(`  Valid: ${validation.valid}`);
  if (!validation.valid) {
    console.log(`  Errors: ${validation.errors.join(', ')}`);
  }

  // Detect circular dependencies
  const cycles = fixtureManager.detectCircularDependencies();
  console.log(`  Circular dependencies: ${cycles.length > 0 ? cycles.join(', ') : 'None'}\n`);

  // Load all fixtures
  console.log('Loading all fixtures...');
  await fixtureManager.loadAll();
  console.log(`  Loaded: ${fixtureManager.listLoaded().join(', ')}`);
  console.log(`  Load order: ${fixtureManager.getLoadOrder().join(' -> ')}\n`);

  // Get statistics
  const stats = fixtureManager.getStats();
  console.log('Fixture Manager Statistics:');
  console.log(`  Registered: ${stats.registered}`);
  console.log(`  Loaded: ${stats.loaded}`);
  console.log(`  Cached: ${stats.cached}\n`);

  // 3. TestEnvironment Demo
  console.log('--- Part 3: Environment Management ---\n');

  const envManager = new TestEnvironmentManager();

  // Create environment
  console.log('Creating test environment...');
  const env = envManager.createEnvironment({
    name: 'demo-env',
    variables: {
      API_URL: 'http://localhost:3000',
      ENV: 'test',
      DEBUG: true,
    },
    cleanup: true,
  });
  console.log(`  Environment: ${env.name}`);
  console.log(`  Variables: ${JSON.stringify(env.config)}\n`);

  // Setup environment
  console.log('Setting up environment...');
  await envManager.setupEnvironment('demo-env');
  console.log(`  Setup: ${envManager.isSetup('demo-env')}\n`);

  // Add setup hook
  envManager.addSetupHook('demo-env', async () => {
    console.log('  [Hook] Running setup hook...');
  });

  // Set additional variables
  console.log('Setting environment variables...');
  envManager.setVariable('demo-env', 'DATABASE_URL', 'postgresql://localhost/test');
  const dbUrl = envManager.getVariable('demo-env', 'DATABASE_URL');
  console.log(`  DATABASE_URL: ${dbUrl}\n`);

  // 4. Seed Data Demo
  console.log('--- Part 4: Seeding Test Data ---\n');

  // Create seed data
  console.log('Creating seed data...');
  const seedData = fixtureManager.createSeedData(
    ['users', 'servers'],
    { cleanup: true }
  );
  console.log(`  Fixtures to seed: ${seedData.order?.join(', ')}`);
  console.log(`  Cleanup after test: ${seedData.cleanup}\n`);

  // Seed into environment
  console.log('Seeding data into environment...');
  await envManager.seedData('demo-env', seedData);
  console.log('  Data seeded successfully!\n');

  // 5. Scoped Environment Demo
  console.log('--- Part 5: Scoped Environment (Auto-cleanup) ---\n');

  console.log('Creating scoped environment...');
  await envManager.withEnvironment(
    {
      name: 'scoped-env',
      variables: { TEMP: true },
    },
    async (scopedEnv) => {
      console.log(`  Inside scoped environment: ${scopedEnv.name}`);
      console.log(`  Is setup: ${envManager.isSetup('scoped-env')}`);

      // Do something with the environment
      await new Promise((resolve) => setTimeout(resolve, 100));

      console.log('  Scoped work completed');
    }
  );
  console.log('  Environment automatically cleaned up\n');

  // 6. Cleanup
  console.log('--- Part 6: Cleanup ---\n');

  console.log('Tearing down environment...');
  await envManager.teardownEnvironment('demo-env');
  console.log(`  Teardown: ${!envManager.isSetup('demo-env')}\n`);

  console.log('Cleaning up fixtures...');
  fixtureManager.cleanup();
  console.log(`  Loaded fixtures: ${fixtureManager.listLoaded().length}\n`);

  console.log('=== Demo Complete ===');
}

// Run the demo
main().catch((error) => {
  console.error('Demo failed:', error);
  process.exit(1);
});
