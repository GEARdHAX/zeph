module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.js'],
  testTimeout: 30000,
  // No --runInBand: each test file gets its own worker process and its own
  // in-memory MongoDB (test/helpers/db.js), so parallel is safe. 2 workers
  // on CI (2-core runner); tests are IO-bound on Mongo so this still overlaps.
  maxWorkers: process.env.CI ? 2 : '50%',
};
