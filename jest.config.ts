import type { Config } from '@jest/types';

const config: Config.InitialOptions = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.(ts|js)'],
  verbose: true,
  testTimeout: 30000,
  collectCoverage: true,
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/**/*.{ts,js}',
    '*.sh',
    'scripts_tests/**/*.sh',
    '!src/**/*.d.ts',
    '!**/node_modules/**',
    '!**/dist/**',
  ],
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      branches: 38,  
      functions: 50,  
      lines: 45,      
      statements: 45,
    },
  },
};

export default config;
