export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests/protocols'],
  testMatch: [
    '<rootDir>/tests/protocols/**/*.test.ts'
  ],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      useESM: true,
      tsconfig: {
        module: 'esnext',
        target: 'es2022',
        moduleResolution: 'bundler'
      }
    }]
  },
  testTimeout: 15000,
  clearMocks: true,
  restoreMocks: true,
  resetMocks: true
};