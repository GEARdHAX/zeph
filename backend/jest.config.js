module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.js'],
  testTimeout: 30000,
  globalSetup: '<rootDir>/test/helpers/globalSetup.js',
  globalTeardown: '<rootDir>/test/helpers/globalTeardown.js',
  // One shared in-memory Mongo (globalSetup) + a database per worker
  // (helpers/db.js keys on JEST_WORKER_ID), so workers stay isolated.
  // 2 workers: the tests are IO-bound on Mongo, so a 2-core CI runner
  // still benefits from overlap, and the big win is one mongod boot for
  // the whole run instead of one per test file.
  maxWorkers: process.env.CI ? 2 : '50%',
};
