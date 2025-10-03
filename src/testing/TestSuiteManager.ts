/**
 * Test Suite Manager
 *
 * Manages test suite creation, configuration, and persistence.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import {
  TestSuite,
  TestDefinition,
  TestHook,
  SuiteConfig,
  Assertion
} from '../types/test-framework.js';

export class TestSuiteManager {
  private suites: Map<string, TestSuite> = new Map();
  private suitesDir: string;

  constructor(suitesDir: string = 'data/suites') {
    this.suitesDir = suitesDir;
  }

  /**
   * Create a new test suite
   */
  async createSuite(
    name: string,
    description: string,
    config: Partial<SuiteConfig> = {},
    tags?: string[]
  ): Promise<TestSuite> {
    if (this.suites.has(name)) {
      throw new Error(`Test suite "${name}" already exists`);
    }

    const suite: TestSuite = {
      name,
      description,
      tests: [],
      config: {
        timeout: config.timeout ?? 30000,
        retry: config.retry ?? 0,
        parallel: config.parallel ?? false,
        maxWorkers: config.maxWorkers ?? 1,
        bail: config.bail ?? false,
        verbose: config.verbose ?? false,
      },
      tags: tags ?? [],
    };

    this.suites.set(name, suite);
    return suite;
  }

  /**
   * Add a test to an existing suite
   */
  async addTest(
    suiteName: string,
    test: Omit<TestDefinition, 'timeout' | 'retry'> & {
      timeout?: number;
      retry?: number;
    }
  ): Promise<TestSuite> {
    const suite = this.suites.get(suiteName);
    if (!suite) {
      throw new Error(`Test suite "${suiteName}" not found`);
    }

    const testDef: TestDefinition = {
      name: test.name,
      description: test.description,
      recording: test.recording,
      assertions: test.assertions || [],
      timeout: test.timeout ?? suite.config.timeout ?? 30000,
      retry: test.retry ?? suite.config.retry ?? 0,
      skip: test.skip ?? false,
      tags: test.tags,
      setup: test.setup,
      teardown: test.teardown,
    };

    suite.tests.push(testDef);
    return suite;
  }

  /**
   * Set suite-level setup hook
   */
  async setSuiteSetup(suiteName: string, setup: TestHook): Promise<TestSuite> {
    const suite = this.suites.get(suiteName);
    if (!suite) {
      throw new Error(`Test suite "${suiteName}" not found`);
    }

    suite.setup = setup;
    return suite;
  }

  /**
   * Set suite-level teardown hook
   */
  async setSuiteTeardown(suiteName: string, teardown: TestHook): Promise<TestSuite> {
    const suite = this.suites.get(suiteName);
    if (!suite) {
      throw new Error(`Test suite "${suiteName}" not found`);
    }

    suite.teardown = teardown;
    return suite;
  }

  /**
   * Update suite configuration
   */
  async updateConfig(suiteName: string, config: Partial<SuiteConfig>): Promise<TestSuite> {
    const suite = this.suites.get(suiteName);
    if (!suite) {
      throw new Error(`Test suite "${suiteName}" not found`);
    }

    suite.config = { ...suite.config, ...config };
    return suite;
  }

  /**
   * Get a test suite by name
   */
  getSuite(name: string): TestSuite | undefined {
    return this.suites.get(name);
  }

  /**
   * List all test suites
   */
  listSuites(): TestSuite[] {
    return Array.from(this.suites.values());
  }

  /**
   * Save suite to disk
   */
  async saveSuite(name: string): Promise<string> {
    const suite = this.suites.get(name);
    if (!suite) {
      throw new Error(`Test suite "${name}" not found`);
    }

    // Ensure suites directory exists
    await fs.mkdir(this.suitesDir, { recursive: true });

    const filePath = path.join(this.suitesDir, `${name}.json`);

    // Convert suite to JSON-serializable format (remove function references)
    const serializable = this.serializeSuite(suite);

    await fs.writeFile(filePath, JSON.stringify(serializable, null, 2), 'utf-8');
    return filePath;
  }

  /**
   * Load suite from disk
   */
  async loadSuite(name: string): Promise<TestSuite> {
    const filePath = path.join(this.suitesDir, `${name}.json`);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content);
      const suite = this.deserializeSuite(data);
      this.suites.set(name, suite);
      return suite;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Test suite file "${name}.json" not found`);
      }
      throw error;
    }
  }

  /**
   * Load all suites from disk
   */
  async loadAllSuites(): Promise<TestSuite[]> {
    try {
      const files = await fs.readdir(this.suitesDir);
      const suites: TestSuite[] = [];

      for (const file of files) {
        if (file.endsWith('.json')) {
          const name = file.replace('.json', '');
          const suite = await this.loadSuite(name);
          suites.push(suite);
        }
      }

      return suites;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Delete a test suite
   */
  async deleteSuite(name: string): Promise<void> {
    this.suites.delete(name);

    const filePath = path.join(this.suitesDir, `${name}.json`);
    try {
      await fs.unlink(filePath);
    } catch (error) {
      // Ignore if file doesn't exist
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * Convert suite to JSON-serializable format
   */
  private serializeSuite(suite: TestSuite): any {
    return {
      name: suite.name,
      description: suite.description,
      tests: suite.tests.map(test => ({
        name: test.name,
        description: test.description,
        recording: test.recording,
        assertions: test.assertions,
        timeout: test.timeout,
        retry: test.retry,
        skip: test.skip,
        tags: test.tags,
        // Note: setup/teardown functions are not serialized
      })),
      config: suite.config,
      tags: suite.tags,
      // Note: setup/teardown hooks are not serialized
    };
  }

  /**
   * Convert JSON data back to TestSuite
   */
  private deserializeSuite(data: any): TestSuite {
    return {
      name: data.name,
      description: data.description,
      tests: data.tests || [],
      config: data.config || {},
      tags: data.tags || [],
      // Hooks will need to be set programmatically after loading
    };
  }
}
