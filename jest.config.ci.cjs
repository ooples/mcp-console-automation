/**
 * Minimal Jest configuration for CI/CD
 * Fast, reliable, no complex setup/teardown
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',

  // Only run unit tests in CI (skip slow integration/stress tests)
  testMatch: [
    '<rootDir>/tests/unit/**/*.test.ts'
  ],

  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/coverage/',
    '/tests/integration/',
    '/tests/stress/',
    '/test/',
    '/src/tests/'  // Exclude all src/tests - contains integration/performance tests
  ],

  moduleNameMapper: {
    // Strip .js extension from any relative import starting with .
    '^(\\..*)\\\.js$': '$1',
    '^@/(.*)$': '<rootDir>/src/$1'
  },

  // Minimal setup - no complex global setup/teardown
  setupFilesAfterEnv: [],
  globalSetup: undefined,
  globalTeardown: undefined,

  // Fast execution settings
  testTimeout: 10000,
  maxWorkers: '100%',
  bail: false,

  // Performance optimizations
  clearMocks: true,
  restoreMocks: true,
  resetMocks: true,

  // Transform settings
  transform: {
    '^.+\.ts$': ['ts-jest', {
      tsconfig: '<rootDir>/tsconfig.test.json',
      isolatedModules: true
    }]
  },

  transformIgnorePatterns: [],

  // Simple reporting for CI
  reporters: ['default'],

  // Coverage (optional, can be disabled for speed)
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/*.test.ts',
    '!src/**/*.spec.ts'
  ]
};
