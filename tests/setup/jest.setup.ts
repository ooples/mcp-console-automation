// Jest setup file
import { jest } from '@jest/globals';

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  // Uncomment to suppress logs during tests
  // log: jest.fn(),
  // debug: jest.fn(),
  // info: jest.fn(),
  // warn: jest.fn(),
  // error: jest.fn(),
};

// Extend Jest matchers if needed
expect.extend({
  // Add custom matchers here if needed
});

// Set longer timeout for async operations
jest.setTimeout(30000);

// Mock process.env variables that might be needed
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error'; // Reduce log noise during tests

// Global test setup
beforeAll(() => {
  // Any global setup logic
});

afterAll(() => {
  // Any global cleanup logic
});