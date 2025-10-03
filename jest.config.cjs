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
    '^@tests/(.*)$': '<rootDir>/tests/$1'
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  globals: {
    'ts-jest': {
      tsconfig: '<rootDir>/tsconfig.test.json',
      isolatedModules: true
    }
  },
  transform: {
    '^.+\.(js|jsx|mjs|cjs)$': 'babel-jest'
  },
  transformIgnorePatterns: [],
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
  globalSetup: '<rootDir>/tests/setup/global-setup-simple.js',
  globalTeardown: '<rootDir>/tests/setup/global-teardown-simple.js'
};
