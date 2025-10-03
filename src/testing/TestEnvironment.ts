/**
 * Test Environment Manager
 *
 * Manages test environment setup, teardown, seeding, and cleanup.
 * Provides environment isolation and configuration management.
 */

import { TestEnvironment } from '../types/test-framework.js';

export interface EnvironmentConfig {
  name: string;
  variables?: Record<string, any>;
  resources?: ResourceConfig[];
  cleanup?: boolean;
  isolated?: boolean;
}

export interface ResourceConfig {
  type: 'file' | 'directory' | 'network' | 'database' | 'service';
  name: string;
  config: any;
}

export interface EnvironmentState {
  created: boolean;
  resources: Set<string>;
  variables: Map<string, any>;
  startTime: number;
  endTime?: number;
}

export class TestEnvironmentManager {
  private environments: Map<string, TestEnvironment>;
  private states: Map<string, EnvironmentState>;
  private setupHooks: Map<string, (() => Promise<void>)[]>;
  private teardownHooks: Map<string, (() => Promise<void>)[]>;

  constructor() {
    this.environments = new Map();
    this.states = new Map();
    this.setupHooks = new Map();
    this.teardownHooks = new Map();
  }

  /**
   * Create a new test environment
   */
  createEnvironment(config: EnvironmentConfig): TestEnvironment {
    const env: TestEnvironment = {
      name: config.name,
      setup: async () => {
        await this.runSetup(config.name);
      },
      teardown: async () => {
        await this.runTeardown(config.name);
      },
      seed: async (_data: any) => {
        // Seed function - actual seeding logic is in public seedData method
      },
      cleanup: async () => {
        // Cleanup function - actual cleanup logic is in public cleanupEnvironment method
      },
      config: config.variables || {},
    };

    this.environments.set(config.name, env);

    // Initialize state
    this.states.set(config.name, {
      created: false,
      resources: new Set(),
      variables: new Map(Object.entries(config.variables || {})),
      startTime: Date.now(),
    });

    return env;
  }

  /**
   * Get an existing environment
   */
  getEnvironment(name: string): TestEnvironment | undefined {
    return this.environments.get(name);
  }

  /**
   * Setup environment
   */
  async setupEnvironment(name: string): Promise<void> {
    const env = this.environments.get(name);
    if (!env) {
      throw new Error(`Environment not found: ${name}`);
    }

    const state = this.states.get(name)!;
    if (state.created) {
      console.warn(`Environment ${name} already setup`);
      return;
    }

    // Run setup hooks
    await env.setup();

    // Mark as created
    state.created = true;
    state.startTime = Date.now();
  }

  /**
   * Teardown environment
   */
  async teardownEnvironment(name: string): Promise<void> {
    const env = this.environments.get(name);
    if (!env) {
      throw new Error(`Environment not found: ${name}`);
    }

    const state = this.states.get(name)!;
    if (!state.created) {
      console.warn(`Environment ${name} not setup, skipping teardown`);
      return;
    }

    // Run teardown hooks
    await env.teardown();

    // Mark as destroyed
    state.created = false;
    state.endTime = Date.now();
  }

  /**
   * Seed data into environment
   */
  async seedData(name: string, data: any): Promise<void> {
    const env = this.environments.get(name);
    if (!env) {
      throw new Error(`Environment not found: ${name}`);
    }

    const state = this.states.get(name)!;
    if (!state.created) {
      throw new Error(`Environment ${name} not setup, cannot seed data`);
    }

    if (env.seed) {
      await env.seed(data);
    } else {
      throw new Error(`Environment ${name} does not support seeding`);
    }
  }

  /**
   * Cleanup environment resources
   */
  async cleanupEnvironment(name: string): Promise<void> {
    const env = this.environments.get(name);
    if (!env) {
      throw new Error(`Environment not found: ${name}`);
    }

    const state = this.states.get(name)!;

    if (env.cleanup) {
      await env.cleanup();
    }

    // Clear resources
    state.resources.clear();
  }

  /**
   * Register a setup hook
   */
  addSetupHook(envName: string, hook: () => Promise<void>): void {
    if (!this.setupHooks.has(envName)) {
      this.setupHooks.set(envName, []);
    }
    this.setupHooks.get(envName)!.push(hook);
  }

  /**
   * Register a teardown hook
   */
  addTeardownHook(envName: string, hook: () => Promise<void>): void {
    if (!this.teardownHooks.has(envName)) {
      this.teardownHooks.set(envName, []);
    }
    this.teardownHooks.get(envName)!.push(hook);
  }

  /**
   * Set environment variable
   */
  setVariable(envName: string, key: string, value: any): void {
    const state = this.states.get(envName);
    if (!state) {
      throw new Error(`Environment not found: ${envName}`);
    }
    state.variables.set(key, value);
  }

  /**
   * Get environment variable
   */
  getVariable(envName: string, key: string): any {
    const state = this.states.get(envName);
    if (!state) {
      throw new Error(`Environment not found: ${envName}`);
    }
    return state.variables.get(key);
  }

  /**
   * Get all environment variables
   */
  getVariables(envName: string): Record<string, any> {
    const state = this.states.get(envName);
    if (!state) {
      throw new Error(`Environment not found: ${envName}`);
    }
    return Object.fromEntries(state.variables);
  }

  /**
   * Check if environment is setup
   */
  isSetup(envName: string): boolean {
    const state = this.states.get(envName);
    return state ? state.created : false;
  }

  /**
   * Get environment state
   */
  getState(envName: string): EnvironmentState | undefined {
    return this.states.get(envName);
  }

  /**
   * List all environments
   */
  listEnvironments(): string[] {
    return Array.from(this.environments.keys());
  }

  /**
   * Remove environment
   */
  async removeEnvironment(name: string): Promise<void> {
    const state = this.states.get(name);
    if (state && state.created) {
      await this.teardownEnvironment(name);
    }

    this.environments.delete(name);
    this.states.delete(name);
    this.setupHooks.delete(name);
    this.teardownHooks.delete(name);
  }

  /**
   * Run setup hooks
   */
  private async runSetup(envName: string): Promise<void> {
    const hooks = this.setupHooks.get(envName) || [];
    for (const hook of hooks) {
      await hook();
    }
  }

  /**
   * Run teardown hooks
   */
  private async runTeardown(envName: string): Promise<void> {
    const hooks = this.teardownHooks.get(envName) || [];
    // Run teardown hooks in reverse order
    for (let i = hooks.length - 1; i >= 0; i--) {
      await hooks[i]();
    }
  }

  /**
   * Create a scoped environment (auto-cleanup after callback)
   */
  async withEnvironment<T>(
    config: EnvironmentConfig,
    callback: (env: TestEnvironment) => Promise<T>
  ): Promise<T> {
    const env = this.createEnvironment(config);

    try {
      await this.setupEnvironment(config.name);
      const result = await callback(env);
      return result;
    } finally {
      await this.teardownEnvironment(config.name);
      if (config.cleanup !== false) {
        await this.cleanupEnvironment(config.name);
      }
      await this.removeEnvironment(config.name);
    }
  }

  /**
   * Create isolated environment (copy of existing with separate state)
   */
  createIsolatedEnvironment(
    baseName: string,
    newName: string
  ): TestEnvironment {
    const baseEnv = this.environments.get(baseName);
    if (!baseEnv) {
      throw new Error(`Base environment not found: ${baseName}`);
    }

    const baseState = this.states.get(baseName)!;

    // Create copy of configuration
    const config: EnvironmentConfig = {
      name: newName,
      variables: Object.fromEntries(baseState.variables),
      isolated: true,
    };

    return this.createEnvironment(config);
  }
}
