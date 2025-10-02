/**
 * FixtureManager Tests
 */

import { FixtureManager } from '../testing/FixtureManager.js';
import * as path from 'path';

describe('FixtureManager', () => {
  let manager: FixtureManager;
  const fixturesPath = path.resolve(process.cwd(), 'data/fixtures');

  beforeEach(() => {
    manager = new FixtureManager();
  });

  afterEach(() => {
    manager.cleanup();
  });

  describe('register', () => {
    it('should register a fixture', () => {
      manager.register('users', path.join(fixturesPath, 'users.json'));

      expect(manager.listRegistered()).toContain('users');
    });

    it('should register with options', () => {
      manager.register('users', path.join(fixturesPath, 'users.json'), {
        priority: 10,
        dependencies: ['servers'],
      });

      expect(manager.listRegistered()).toContain('users');
    });
  });

  describe('registerMany', () => {
    it('should register multiple fixtures', () => {
      manager.registerMany([
        { name: 'users', path: path.join(fixturesPath, 'users.json') },
        { name: 'servers', path: path.join(fixturesPath, 'servers.json') },
      ]);

      const registered = manager.listRegistered();
      expect(registered).toContain('users');
      expect(registered).toContain('servers');
    });
  });

  describe('load', () => {
    it('should load a registered fixture', async () => {
      manager.register('users', path.join(fixturesPath, 'users.json'));

      const fixture = await manager.load('users');

      expect(fixture).toBeDefined();
      expect(fixture.name).toBe('users');
      expect(manager.isLoaded('users')).toBe(true);
    });

    it('should throw error for unregistered fixture', async () => {
      await expect(manager.load('non-existent')).rejects.toThrow('not registered');
    });

    it('should return cached fixture on second load', async () => {
      manager.register('users', path.join(fixturesPath, 'users.json'));

      const first = await manager.load('users');
      const second = await manager.load('users');

      expect(second).toBe(first);
    });
  });

  describe('loadAll', () => {
    it('should load all registered fixtures', async () => {
      manager.register('users', path.join(fixturesPath, 'users.json'));
      manager.register('servers', path.join(fixturesPath, 'servers.json'));

      const fixtures = await manager.loadAll();

      expect(fixtures.size).toBe(2);
      expect(fixtures.has('users')).toBe(true);
      expect(fixtures.has('servers')).toBe(true);
    });

    it('should respect priority order', async () => {
      manager.register('users', path.join(fixturesPath, 'users.json'), { priority: 5 });
      manager.register('servers', path.join(fixturesPath, 'servers.json'), { priority: 10 });

      await manager.loadAll();

      const order = manager.getLoadOrder();
      expect(order[0]).toBe('servers'); // Higher priority loads first
    });
  });

  describe('loadInOrder', () => {
    it('should load fixtures in specified order', async () => {
      manager.register('users', path.join(fixturesPath, 'users.json'));
      manager.register('servers', path.join(fixturesPath, 'servers.json'));

      await manager.loadInOrder(['servers', 'users']);

      const order = manager.getLoadOrder();
      expect(order).toEqual(['servers', 'users']);
    });
  });

  describe('get', () => {
    it('should retrieve loaded fixture', async () => {
      manager.register('users', path.join(fixturesPath, 'users.json'));
      await manager.load('users');

      const fixture = manager.get('users');

      expect(fixture).toBeDefined();
      expect(fixture?.name).toBe('users');
    });

    it('should return undefined for unloaded fixture', () => {
      const fixture = manager.get('non-existent');
      expect(fixture).toBeUndefined();
    });
  });

  describe('unload', () => {
    it('should unload a fixture', async () => {
      manager.register('users', path.join(fixturesPath, 'users.json'));
      await manager.load('users');

      manager.unload('users');

      expect(manager.isLoaded('users')).toBe(false);
    });
  });

  describe('reload', () => {
    it('should reload a fixture', async () => {
      manager.register('users', path.join(fixturesPath, 'users.json'));
      await manager.load('users');

      const reloaded = await manager.reload('users');

      expect(reloaded).toBeDefined();
    });
  });

  describe('dependencies', () => {
    it('should validate dependencies', () => {
      manager.register('users', path.join(fixturesPath, 'users.json'), {
        dependencies: ['servers'],
      });
      manager.register('servers', path.join(fixturesPath, 'servers.json'));

      const validation = manager.validateDependencies();

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should detect missing dependencies', () => {
      manager.register('users', path.join(fixturesPath, 'users.json'), {
        dependencies: ['missing'],
      });

      const validation = manager.validateDependencies();

      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });

    it('should get dependency graph', () => {
      manager.register('users', path.join(fixturesPath, 'users.json'), {
        dependencies: ['servers'],
      });
      manager.register('servers', path.join(fixturesPath, 'servers.json'));

      const graph = manager.getDependencyGraph();

      expect(graph.get('users')).toEqual(['servers']);
      expect(graph.get('servers')).toEqual([]);
    });

    it('should detect circular dependencies', () => {
      manager.register('fixture-a', 'path-a', { dependencies: ['fixture-b'] });
      manager.register('fixture-b', 'path-b', { dependencies: ['fixture-a'] });

      const cycles = manager.detectCircularDependencies();

      expect(cycles.length).toBeGreaterThan(0);
    });
  });

  describe('createSeedData', () => {
    it('should create seed data from loaded fixtures', async () => {
      manager.register('users', path.join(fixturesPath, 'users.json'));
      await manager.load('users');

      const seedData = manager.createSeedData(['users']);

      expect(seedData.fixtures).toHaveLength(1);
      expect(seedData.order).toEqual(['users']);
    });
  });

  describe('getStats', () => {
    it('should return statistics', async () => {
      manager.register('users', path.join(fixturesPath, 'users.json'));
      manager.register('servers', path.join(fixturesPath, 'servers.json'));
      await manager.load('users');

      const stats = manager.getStats();

      expect(stats.registered).toBe(2);
      expect(stats.loaded).toBe(1);
    });
  });
});
