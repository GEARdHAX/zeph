const mongoose = require('mongoose');

// Connects to the single shared in-memory MongoDB started by
// test/helpers/globalSetup.js. Each Jest worker gets its own database
// (test_<workerId>) on that one server, so parallel workers are isolated
// without paying for a mongod-per-file.
const connect = async () => {
  const baseUri = process.env.MONGO_TEST_URI;
  if (!baseUri) throw new Error('MONGO_TEST_URI not set — is globalSetup configured in jest.config.js?');

  const workerId = process.env.JEST_WORKER_ID || '1';
  const uri = baseUri.replace(/\/[^/?]*(\?|$)/, `/test_${workerId}$1`);

  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(uri);
  }
};

const closeDatabase = async () => {
  // Drop this worker's DB and close the connection — but do NOT stop the
  // shared server (globalTeardown owns that).
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
  }
};

const clearDatabase = async () => {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
};

module.exports = { connect, closeDatabase, clearDatabase };
