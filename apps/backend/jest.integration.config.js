/**
 * Integration tests: real PostgreSQL (embedded, or TEST_DATABASE_URL), real
 * migrations, real Prisma client. Run with `pnpm --filter @growth-radar/backend test:integration`.
 */
module.exports = {
  rootDir: '.',
  testMatch: ['<rootDir>/test/integration/**/*.int-spec.ts'],
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: {
    '^.+\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.integration.json' }],
  },
  testEnvironment: 'node',
  globalSetup: '<rootDir>/test/integration/global-setup.mjs',
  globalTeardown: '<rootDir>/test/integration/global-teardown.mjs',
  // One shared database: suites run serially and reset it themselves.
  maxWorkers: 1,
  testTimeout: 60_000,
};
