/**
 * Fixture Manager
 *
 * Orchestrates multiple fixtures - manages loading order, dependencies,
 * and cleanup. Uses TestDataLoader internally.
 */

import { TestFixture, SeedData } from '../types/test-framework.js';
import { TestDataLoader, LoaderOptions } from './TestDataLoader.js';

export interface FixtureOptions extends LoaderOptions {
  dependencies?: string[]; // Other fixtures this one depends on
  priority?: number; // Loading priority (higher = earlier)
}

export interface FixtureRegistration {
  name: string;
  path: string;
  options: FixtureOptions;
  loaded: boolean;
  fixture?: TestFixture;
}

export class FixtureManager {
  private loader: TestDataLoader;
  private registrations: Map<string, FixtureRegistration>;
  private loadedFixtures: Map<string, TestFixture>;
  private loadOrder: string[];

  constructor() {
    this.loader = new TestDataLoader();
    this.registrations = new Map();
    this.loadedFixtures = new Map();
    this.loadOrder = [];
  }

  /**
   * Register a fixture
   */
  register(name: string, path: string, options: FixtureOptions = {}): void {
    this.registrations.set(name, {
      name,
      path,
      options,
      loaded: false,
    });
  }

  /**
   * Register multiple fixtures
   */
  registerMany(
    fixtures: Array<{ name: string; path: string; options?: FixtureOptions }>
  ): void {
    for (const fixture of fixtures) {
      this.register(fixture.name, fixture.path, fixture.options || {});
    }
  }

  /**
   * Load a specific fixture by name
   */
  async load(name: string): Promise<TestFixture> {
    const registration = this.registrations.get(name);
    if (!registration) {
      throw new Error(`Fixture not registered: ${name}`);
    }

    // Check if already loaded
    if (registration.loaded && registration.fixture) {
      return registration.fixture;
    }

    // Load dependencies first
    if (registration.options.dependencies) {
      for (const dep of registration.options.dependencies) {
        await this.load(dep);
      }
    }

    // Load the fixture
    const fixture = await this.loader.loadFixture(
      registration.path,
      registration.options
    );

    // Store loaded fixture
    registration.loaded = true;
    registration.fixture = fixture;
    this.loadedFixtures.set(name, fixture);
    this.loadOrder.push(name);

    return fixture;
  }

  /**
   * Load all registered fixtures
   */
  async loadAll(): Promise<Map<string, TestFixture>> {
    // Sort by priority (higher first)
    const sorted = Array.from(this.registrations.values()).sort(
      (a, b) => (b.options.priority || 0) - (a.options.priority || 0)
    );

    for (const registration of sorted) {
      if (!registration.loaded) {
        await this.load(registration.name);
      }
    }

    return this.loadedFixtures;
  }

  /**
   * Load fixtures in specified order
   */
  async loadInOrder(names: string[]): Promise<Map<string, TestFixture>> {
    const fixtures = new Map<string, TestFixture>();

    for (const name of names) {
      const fixture = await this.load(name);
      fixtures.set(name, fixture);
    }

    return fixtures;
  }

  /**
   * Get a loaded fixture
   */
  get(name: string): TestFixture | undefined {
    return this.loadedFixtures.get(name);
  }

  /**
   * Check if fixture is loaded
   */
  isLoaded(name: string): boolean {
    return this.loadedFixtures.has(name);
  }

  /**
   * Get all loaded fixtures
   */
  getAll(): Map<string, TestFixture> {
    return new Map(this.loadedFixtures);
  }

  /**
   * Get load order
   */
  getLoadOrder(): string[] {
    return [...this.loadOrder];
  }

  /**
   * Unload a fixture
   */
  unload(name: string): void {
    const registration = this.registrations.get(name);
    if (registration) {
      registration.loaded = false;
      registration.fixture = undefined;
    }
    this.loadedFixtures.delete(name);

    // Remove from load order
    const index = this.loadOrder.indexOf(name);
    if (index > -1) {
      this.loadOrder.splice(index, 1);
    }
  }

  /**
   * Unload all fixtures
   */
  unloadAll(): void {
    for (const name of this.loadedFixtures.keys()) {
      this.unload(name);
    }
  }

  /**
   * Cleanup - unload all and clear registrations
   */
  cleanup(): void {
    this.unloadAll();
    this.registrations.clear();
    this.loader.clearCache();
  }

  /**
   * Reload a fixture (clear cache and load again)
   */
  async reload(name: string): Promise<TestFixture> {
    this.unload(name);
    return this.load(name);
  }

  /**
   * Validate fixture dependencies
   */
  validateDependencies(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const [name, registration] of this.registrations) {
      if (registration.options.dependencies) {
        for (const dep of registration.options.dependencies) {
          if (!this.registrations.has(dep)) {
            errors.push(
              `Fixture "${name}" depends on unregistered fixture "${dep}"`
            );
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get dependency graph
   */
  getDependencyGraph(): Map<string, string[]> {
    const graph = new Map<string, string[]>();

    for (const [name, registration] of this.registrations) {
      graph.set(name, registration.options.dependencies || []);
    }

    return graph;
  }

  /**
   * Detect circular dependencies
   */
  detectCircularDependencies(): string[] {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const cycles: string[] = [];

    const visit = (name: string, path: string[]): void => {
      if (recursionStack.has(name)) {
        cycles.push(`Circular dependency: ${path.join(' -> ')} -> ${name}`);
        return;
      }

      if (visited.has(name)) {
        return;
      }

      visited.add(name);
      recursionStack.add(name);

      const registration = this.registrations.get(name);
      if (registration?.options.dependencies) {
        for (const dep of registration.options.dependencies) {
          visit(dep, [...path, name]);
        }
      }

      recursionStack.delete(name);
    };

    for (const name of this.registrations.keys()) {
      visit(name, []);
    }

    return cycles;
  }

  /**
   * Create seed data from loaded fixtures
   */
  createSeedData(
    fixtureNames?: string[],
    options?: { cleanup?: boolean }
  ): SeedData {
    const fixtures: TestFixture[] = [];
    const order: string[] = [];

    const names = fixtureNames || Array.from(this.loadedFixtures.keys());

    for (const name of names) {
      const fixture = this.loadedFixtures.get(name);
      if (fixture) {
        fixtures.push(fixture);
        order.push(name);
      }
    }

    return {
      fixtures,
      order,
      cleanup: options?.cleanup ?? true,
    };
  }

  /**
   * Load seed data (convenience method)
   */
  async loadSeedData(seedData: SeedData): Promise<void> {
    if (seedData.order) {
      // Load in specified order
      for (const name of seedData.order) {
        const fixture = seedData.fixtures.find((f) => f.name === name);
        if (fixture) {
          this.loadedFixtures.set(name, fixture);
        }
      }
    } else {
      // Load all fixtures
      for (const fixture of seedData.fixtures) {
        this.loadedFixtures.set(fixture.name, fixture);
      }
    }
  }

  /**
   * Apply seed data to environment
   */
  async applySeedData(
    seedData: SeedData,
    applyFn: (fixture: TestFixture) => Promise<void>
  ): Promise<void> {
    const order = seedData.order || seedData.fixtures.map((f) => f.name);

    for (const name of order) {
      const fixture = seedData.fixtures.find((f) => f.name === name);
      if (fixture) {
        await applyFn(fixture);
      }
    }

    // Cleanup if requested
    if (seedData.cleanup) {
      // Cleanup would be handled by the environment
    }
  }

  /**
   * List registered fixtures
   */
  listRegistered(): string[] {
    return Array.from(this.registrations.keys());
  }

  /**
   * List loaded fixtures
   */
  listLoaded(): string[] {
    return Array.from(this.loadedFixtures.keys());
  }

  /**
   * Get fixture statistics
   */
  getStats(): {
    registered: number;
    loaded: number;
    cached: number;
    loadOrder: string[];
  } {
    return {
      registered: this.registrations.size,
      loaded: this.loadedFixtures.size,
      cached: this.registrations.size, // Approximation
      loadOrder: this.loadOrder,
    };
  }
}
