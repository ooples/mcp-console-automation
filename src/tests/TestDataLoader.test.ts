/**
 * TestDataLoader Tests
 */

import { TestDataLoader } from '../testing/TestDataLoader.js';
import * as fs from 'fs';
import * as path from 'path';
import { TestFixture } from '../types/test-framework.js';

describe('TestDataLoader', () => {
  let loader: TestDataLoader;
  const fixturesPath = path.resolve(process.cwd(), 'data/fixtures');

  beforeEach(() => {
    loader = new TestDataLoader();
  });

  afterEach(() => {
    loader.clearCache();
  });

  describe('JSON fixtures', () => {
    it('should load JSON fixture', async () => {
      const fixture = await loader.loadJSON(
        path.join(fixturesPath, 'users.json')
      );

      expect(fixture).toBeDefined();
      expect(Array.isArray(fixture)).toBe(true);
      expect(fixture.length).toBeGreaterThan(0);
      expect(fixture[0]).toHaveProperty('id');
      expect(fixture[0]).toHaveProperty('username');
    });

    it('should load servers JSON fixture', async () => {
      const fixture = await loader.loadJSON(
        path.join(fixturesPath, 'servers.json')
      );

      expect(fixture).toBeDefined();
      expect(Array.isArray(fixture)).toBe(true);
      expect(fixture[0]).toHaveProperty('hostname');
      expect(fixture[0]).toHaveProperty('environment');
    });
  });

  describe('YAML fixtures', () => {
    it('should load YAML fixture', async () => {
      const fixture = await loader.loadYAML(
        path.join(fixturesPath, 'deploy-config.yaml')
      );

      expect(fixture).toBeDefined();
      expect(fixture).toHaveProperty('name');
      expect(fixture).toHaveProperty('environments');
      expect(fixture.environments).toHaveProperty('production');
    });

    it('should parse YAML structure correctly', async () => {
      const fixture = await loader.loadYAML(
        path.join(fixturesPath, 'deploy-config.yaml')
      );

      expect(fixture.environments.production.deploy_branch).toBe('main');
      expect(fixture.environments.production.auto_deploy).toBe(false);
    });
  });

  describe('CSV fixtures', () => {
    it('should load CSV fixture', async () => {
      const fixture = await loader.loadCSV(
        path.join(fixturesPath, 'test-data.csv')
      );

      expect(fixture).toBeDefined();
      expect(Array.isArray(fixture)).toBe(true);
      expect(fixture.length).toBeGreaterThan(0);
    });

    it('should parse CSV with correct types', async () => {
      const fixture = await loader.loadCSV(
        path.join(fixturesPath, 'test-data.csv')
      );

      const firstRow = fixture[0];
      expect(typeof firstRow.test_id).toBe('number');
      expect(typeof firstRow.test_name).toBe('string');
      expect(typeof firstRow.timeout_ms).toBe('number');
    });

    it('should parse CSV headers correctly', async () => {
      const fixture = await loader.loadCSV(
        path.join(fixturesPath, 'test-data.csv')
      );

      expect(fixture[0]).toHaveProperty('test_id');
      expect(fixture[0]).toHaveProperty('test_name');
      expect(fixture[0]).toHaveProperty('expected_output');
    });
  });

  describe('Caching', () => {
    it('should cache fixtures by default', async () => {
      const fixturePath = path.join(fixturesPath, 'users.json');

      await loader.loadFixture(fixturePath);
      expect(loader.isCached(fixturePath)).toBe(true);
    });

    it('should return cached fixture on second load', async () => {
      const fixturePath = path.join(fixturesPath, 'users.json');

      const first = await loader.loadFixture(fixturePath);
      const second = await loader.loadFixture(fixturePath);

      expect(second).toBe(first); // Same object reference
    });

    it('should skip cache when disabled', async () => {
      const fixturePath = path.join(fixturesPath, 'users.json');

      const first = await loader.loadFixture(fixturePath, { cache: false });
      const second = await loader.loadFixture(fixturePath, { cache: false });

      expect(second).not.toBe(first); // Different objects
    });

    it('should clear cache', async () => {
      const fixturePath = path.join(fixturesPath, 'users.json');

      await loader.loadFixture(fixturePath);
      expect(loader.isCached(fixturePath)).toBe(true);

      loader.clearCache();
      expect(loader.isCached(fixturePath)).toBe(false);
    });
  });

  describe('Multiple fixtures', () => {
    it('should load multiple fixtures', async () => {
      const fixtures = await loader.loadFixtures([
        path.join(fixturesPath, 'users.json'),
        path.join(fixturesPath, 'servers.json'),
      ]);

      expect(fixtures).toHaveLength(2);
      expect(fixtures[0].format).toBe('json');
      expect(fixtures[1].format).toBe('json');
    });
  });

  describe('Error handling', () => {
    it('should throw error for non-existent file', async () => {
      await expect(
        loader.loadFixture('non-existent-file.json')
      ).rejects.toThrow('not found');
    });

    it('should throw error for unsupported format', async () => {
      const tempFile = path.join(fixturesPath, 'test.xml');
      fs.writeFileSync(tempFile, '<xml></xml>');

      await expect(loader.loadFixture(tempFile)).rejects.toThrow('Unsupported');

      fs.unlinkSync(tempFile);
    });

    it('should throw error for invalid JSON', async () => {
      const tempFile = path.join(fixturesPath, 'invalid.json');
      fs.writeFileSync(tempFile, '{ invalid json }');

      await expect(loader.loadFixture(tempFile)).rejects.toThrow();

      fs.unlinkSync(tempFile);
    });
  });

  describe('Format detection', () => {
    it('should detect JSON format from extension', async () => {
      const fixture = await loader.loadFixture(
        path.join(fixturesPath, 'users.json')
      );
      expect(fixture.format).toBe('json');
    });

    it('should detect YAML format from extension', async () => {
      const fixture = await loader.loadFixture(
        path.join(fixturesPath, 'deploy-config.yaml')
      );
      expect(fixture.format).toBe('yaml');
    });

    it('should detect CSV format from extension', async () => {
      const fixture = await loader.loadFixture(
        path.join(fixturesPath, 'test-data.csv')
      );
      expect(fixture.format).toBe('csv');
    });
  });

  describe('Metadata', () => {
    it('should store and retrieve metadata', () => {
      const metadata = {
        name: 'test-fixture',
        version: '1.0.0',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      loader.setMetadata('test-fixture', metadata);
      const retrieved = loader.getMetadata('test-fixture');

      expect(retrieved).toEqual(metadata);
    });
  });
});
