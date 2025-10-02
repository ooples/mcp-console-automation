/**
 * TestEnvironment Tests
 */

import { TestEnvironmentManager } from '../testing/TestEnvironment.js';

describe('TestEnvironmentManager', () => {
  let manager: TestEnvironmentManager;

  beforeEach(() => {
    manager = new TestEnvironmentManager();
  });

  afterEach(async () => {
    // Cleanup all environments
    const envs = manager.listEnvironments();
    for (const env of envs) {
      await manager.removeEnvironment(env).catch(() => {});
    }
  });

  describe('createEnvironment', () => {
    it('should create a new environment', () => {
      const env = manager.createEnvironment({
        name: 'test-env',
        variables: { key: 'value' },
      });

      expect(env).toBeDefined();
      expect(env.name).toBe('test-env');
    });

    it('should initialize environment state', () => {
      manager.createEnvironment({
        name: 'test-env',
        variables: { key: 'value' },
      });

      const state = manager.getState('test-env');
      expect(state).toBeDefined();
      expect(state?.created).toBe(false);
    });
  });

  describe('setupEnvironment', () => {
    it('should setup environment', async () => {
      manager.createEnvironment({ name: 'test-env' });

      await manager.setupEnvironment('test-env');

      expect(manager.isSetup('test-env')).toBe(true);
    });

    it('should throw error for non-existent environment', async () => {
      await expect(
        manager.setupEnvironment('non-existent')
      ).rejects.toThrow('not found');
    });
  });

  describe('teardownEnvironment', () => {
    it('should teardown environment', async () => {
      manager.createEnvironment({ name: 'test-env' });
      await manager.setupEnvironment('test-env');

      await manager.teardownEnvironment('test-env');

      expect(manager.isSetup('test-env')).toBe(false);
    });
  });

  describe('variables', () => {
    it('should set and get variables', () => {
      manager.createEnvironment({ name: 'test-env' });

      manager.setVariable('test-env', 'key1', 'value1');
      const value = manager.getVariable('test-env', 'key1');

      expect(value).toBe('value1');
    });

    it('should get all variables', () => {
      manager.createEnvironment({
        name: 'test-env',
        variables: { key1: 'val1', key2: 'val2' },
      });

      const vars = manager.getVariables('test-env');

      expect(vars).toEqual({ key1: 'val1', key2: 'val2' });
    });
  });

  describe('hooks', () => {
    it('should register setup hooks', () => {
      manager.createEnvironment({ name: 'test-env' });

      const hookFn = jest.fn(async () => {});
      manager.addSetupHook('test-env', hookFn);

      // Hook will be called on setup
    });

    it('should register teardown hooks', () => {
      manager.createEnvironment({ name: 'test-env' });

      const hookFn = jest.fn(async () => {});
      manager.addTeardownHook('test-env', hookFn);

      // Hook will be called on teardown
    });
  });

  describe('withEnvironment', () => {
    it('should create scoped environment', async () => {
      let envInCallback;

      await manager.withEnvironment(
        { name: 'scoped-env' },
        async (env) => {
          envInCallback = env;
          expect(manager.isSetup('scoped-env')).toBe(true);
        }
      );

      // Environment should be cleaned up
      expect(manager.listEnvironments()).not.toContain('scoped-env');
    });

    it('should cleanup even on error', async () => {
      await expect(
        manager.withEnvironment(
          { name: 'error-env' },
          async () => {
            throw new Error('Test error');
          }
        )
      ).rejects.toThrow('Test error');

      expect(manager.listEnvironments()).not.toContain('error-env');
    });
  });

  describe('createIsolatedEnvironment', () => {
    it('should create isolated copy', () => {
      manager.createEnvironment({
        name: 'base-env',
        variables: { key: 'value' },
      });

      const isolated = manager.createIsolatedEnvironment('base-env', 'isolated-env');

      expect(isolated.name).toBe('isolated-env');
      const vars = manager.getVariables('isolated-env');
      expect(vars.key).toBe('value');
    });
  });

  describe('listEnvironments', () => {
    it('should list all environments', () => {
      manager.createEnvironment({ name: 'env1' });
      manager.createEnvironment({ name: 'env2' });

      const envs = manager.listEnvironments();

      expect(envs).toContain('env1');
      expect(envs).toContain('env2');
    });
  });
});
