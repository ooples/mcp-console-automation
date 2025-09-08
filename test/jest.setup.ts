/**
 * Jest setup file for integration and stress tests
 */

import { jest } from '@jest/globals';

// Extend test timeout for integration tests
jest.setTimeout(30000);

// Mock console methods to avoid noise in test output
const originalConsole = global.console;

beforeAll(() => {
  global.console = {
    ...originalConsole,
    // Keep error and warn for debugging
    log: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  };
});

afterAll(() => {
  global.console = originalConsole;
});

// Global error handler for unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Global error handler for uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Increase memory limit for stress tests
if (process.env.NODE_ENV === 'test') {
  // Force garbage collection if available (node --expose-gc)
  if (global.gc) {
    // Run GC between tests to ensure clean state
    afterEach(() => {
      global.gc();
    });
  }
}

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.DISABLE_TELEMETRY = 'true';

export {};