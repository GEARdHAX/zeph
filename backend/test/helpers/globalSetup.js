const { MongoMemoryServer } = require('mongodb-memory-server');

// One in-memory MongoDB for the ENTIRE test run, shared by every worker.
// Previously each of ~80 test files booted its own mongod in beforeAll —
// serial, that's ~80 process starts. Now: one boot, and each Jest worker
// gets its own database name on it (see helpers/db.js) so parallel workers
// still can't see each other's data.
//
// The instance is stashed on globalThis for globalTeardown. Jest runs both
// hooks in the same Node process (the parent), so this works; workers are
// child processes and only see process.env.MONGO_TEST_URI.
module.exports = async () => {
  const mongod = await MongoMemoryServer.create();
  globalThis.__MONGOD__ = mongod;
  process.env.MONGO_TEST_URI = mongod.getUri();
};
