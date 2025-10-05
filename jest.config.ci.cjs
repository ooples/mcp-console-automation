/**
 * Minimal Jest configuration for CI/CD
 * Fast, reliable, no complex setup/teardown
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',

  // Re-enabled unit tests after confirming moduleNameMapper is correct
  testMatch: [
    '<rootDir>/src/tests/**/*.test.ts'
  ],

  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/coverage/',
    '/tests/integration/',
    '/tests/stress/',
    '/test/'
  ],

  moduleNameMapper: {
    '^(\.{1,2}/.+)\.js$': '$1',
    '^@/(.*)$': '<rootDir>/src/$1',
    // Mock ESM-only packages
    '^strip-ansi$': '<rootDir>/src/tests/__mocks__/strip-ansi.js',
    '^ansi-regex$': '<rootDir>/src/tests/__mocks__/ansi-regex.js',
    '^p-queue$': '<rootDir>/src/tests/__mocks__/p-queue.js'
  },

  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],

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

  // Use ts-jest globals config like main config
  globals: {
    'ts-jest': {
      tsconfig: '<rootDir>/tsconfig.test.json',
      isolatedModules: true
    }
  },

  // Transform ESM-only packages (strip-ansi, ansi-regex, etc.)
  transformIgnorePatterns: [
    'node_modules/(?!(strip-ansi|ansi-regex|chalk)/)'
  ],

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
