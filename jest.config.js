export default {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests', '<rootDir>/test', '<rootDir>/src/tests'],
  testMatch: [
    '<rootDir>/tests/**/*.test.ts',
    '<rootDir>/test/**/*.test.ts',
    '<rootDir>/src/tests/**/*.test.ts'
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
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@tests/(.*)$': '<rootDir>/tests/$1'
  },
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      tsconfig: {
        module: 'commonjs',
        target: 'es2022',
        moduleResolution: 'node',
        esModuleInterop: true,
        allowSyntheticDefaultImports: true
      },
      isolatedModules: true,
      babelConfig: false
    }],
    '^.+\\.jsx?$': 'babel-jest'
  },
  transformIgnorePatterns: [
    'node_modules/(?!(.*\\.mjs$))'
  ],
  setupFilesAfterEnv: [
    '<rootDir>/tests/setup/jest.setup.ts',
    '<rootDir>/tests/setup/global-teardown.ts'
  ],
  testTimeout: 45000,
  maxWorkers: '75%',
  detectOpenHandles: true,
  forceExit: true,
  clearMocks: true,
  restoreMocks: true,
  resetMocks: true,
  projects: [
    {
      displayName: 'test-framework',
      testMatch: ['<rootDir>/src/tests/**/*.test.ts'],
      maxWorkers: '50%',
      globalSetup: undefined,
      globalTeardown: undefined,
      preset: 'ts-jest',
      moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1'
      },
      transformIgnorePatterns: [
        'node_modules/(?!(strip-ansi|ansi-regex)/)'
      ],
      transform: {
        '^.+\\.ts$': ['ts-jest', {
          tsconfig: {
            module: 'commonjs',
            target: 'es2022',
            moduleResolution: 'node',
            esModuleInterop: true
          }
        }],
        '^.+\\.js$': 'babel-jest'
      }
    },
    {
      displayName: 'unit',
      testMatch: ['<rootDir>/tests/unit/**/*.test.ts'],
      maxWorkers: '50%'
    },
    {
      displayName: 'integration',
      testMatch: ['<rootDir>/tests/integration/**/*.test.ts'],
      maxWorkers: 3,
      setupFilesAfterEnv: ['<rootDir>/tests/setup/integration.setup.ts']
    },
    {
      displayName: 'performance',
      testMatch: ['<rootDir>/tests/performance/**/*.test.ts'],
      maxWorkers: 2,
      setupFilesAfterEnv: ['<rootDir>/tests/setup/performance.setup.ts']
    },
    {
      displayName: 'security',
      testMatch: ['<rootDir>/tests/security/**/*.test.ts'],
      maxWorkers: 2,
      setupFilesAfterEnv: ['<rootDir>/tests/setup/security.setup.ts']
    },
    {
      displayName: 'e2e',
      testMatch: ['<rootDir>/tests/e2e/**/*.test.ts'],
      maxWorkers: 1,
      setupFilesAfterEnv: ['<rootDir>/tests/setup/e2e.setup.ts']
    }
  ],
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