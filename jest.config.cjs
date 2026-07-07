module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests', '<rootDir>/test', '<rootDir>/src/tests'],
  testMatch: [
    '<rootDir>/tests/**/*.test.ts',
    '<rootDir>/test/**/*.test.ts',
    '<rootDir>/src/tests/**/*.test.ts'
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/coverage/'
  ],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/index.ts',
    '!src/**/*.mock.ts',
    '!src/**/*.spec.ts'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html', 'json', 'cobertura'],
  coverageThreshold: {
    global: {
      branches: 85,
      functions: 85,
      lines: 85,
      statements: 85
    },
    'src/protocols/**/*.ts': {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90
    },
    'src/core/**/*.ts': {
      branches: 95,
      functions: 95,
      lines: 95,
      statements: 95
    }
  },
  moduleNameMapper: {
    '^(\.{1,2}/.+)\.js$': '$1',
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@tests/(.*)$': '<rootDir>/tests/$1',
    '^strip-ansi$': '<rootDir>/src/tests/__mocks__/strip-ansi.cjs',
    '^ansi-regex$': '<rootDir>/src/tests/__mocks__/ansi-regex.cjs',
    '^p-queue$': '<rootDir>/src/tests/__mocks__/p-queue.cjs',
    '^@kubernetes/client-node$': '<rootDir>/src/tests/__mocks__/@kubernetes/client-node.cjs'
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node', 'mjs'],
  globals: {
    'ts-jest': {
      tsconfig: '<rootDir>/tsconfig.test.json',
      isolatedModules: true
    }
  },
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
    '^.+\\.(js|jsx|cjs)$': 'babel-jest'
  },
  transformIgnorePatterns: [
    // uuid ships ESM-only (dist-node is `import`); babel-jest (preset-env modules:commonjs)
    // transpiles it to CJS so `import { v4 } from 'uuid'` loads under Jest instead of throwing
    // "Must use import to load ES Module".
    'node_modules/(?!(@kubernetes/client-node|uuid)/)'
  ],
  setupFilesAfterEnv: [
    '<rootDir>/tests/setup/jest.setup.ts'
  ],
  testTimeout: 45000,
  maxWorkers: '75%',
  detectOpenHandles: true,
  forceExit: true,
  clearMocks: true,
  restoreMocks: true,
  resetMocks: true,
  reporters: [
    'default',
    ['jest-junit', {
      outputDirectory: 'coverage/junit',
      outputName: 'junit.xml',
      ancestorSeparator: ' › ',
      uniqueOutputName: 'false',
      suiteNameTemplate: '{displayName}: {filepath}',
      classNameTemplate: '{classname}',
      titleTemplate: '{title}'
    }],
    ['jest-html-reporters', {
      publicPath: 'coverage/html-report',
      filename: 'report.html',
      expand: true
    }]
  ],
  testResultsProcessor: 'jest-sonar-reporter',
  globalSetup: '<rootDir>/tests/setup/global-setup-simple.mjs',
  globalTeardown: '<rootDir>/tests/setup/global-teardown-simple.mjs'
};
