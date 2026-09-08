const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

// One in-memory MongoDB per test file. Test files run in parallel Jest
// workers (each its own process), so this stays fully isolated — no shared
// server, no cross-file leakage. Slower to boot than a single shared mongod
// but deterministic, which a shared mongod under full parallel load is not.
let mongod;

const connect = async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  // Force every schema's indexes to finish building before any test runs.
  // Mongoose builds them lazily/async on first model use; under --runInBand
  // that always completed in time, but with parallel workers a test that
  // relies on a unique index (case-insensitive username, message
  // idempotency key) can fire before the build finishes and see a
  // duplicate write wrongly succeed.
  await Promise.all(Object.values(mongoose.connection.models).map((m) => m.syncIndexes().catch(() => {})));
};

const closeDatabase = async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  if (mongod) await mongod.stop();
};

const clearDatabase = async () => {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
};

module.exports = { connect, closeDatabase, clearDatabase };
