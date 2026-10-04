module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.js'],
  testTimeout: 30000,
  // Keeps real R2/CDN credentials from backend/.env out of tests (see test/helpers/env.js).
  setupFiles: ['<rootDir>/test/helpers/env.js'],
  // No --runInBand: each test file gets its own worker process and its own
  // in-memory MongoDB (test/helpers/db.js), so parallel is safe. 2 workers
  // on CI (2-core runner); tests are IO-bound on Mongo so this still overlaps.
  maxWorkers: process.env.CI ? 2 : '50%',
};
