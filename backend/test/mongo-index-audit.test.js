const db = require('./helpers/db');
const User = require('../src/models/User');
const Message = require('../src/models/Message');

beforeAll(async () => {
  await db.connect();
});

afterAll(async () => {
  await db.closeDatabase();
});

// Phase 8 audit finding: list-rooms.js's admin-privacy-boundary check runs
// User.find({level: {$ne: 'standard'}}) on every inbox load — confirmed via
// a real explain() against seeded local data: COLLSCAN over the entire
// users collection. This is a regression guard on the index existing, not
// a re-proof of the explain plan itself (that requires a real standalone
// mongod — mongodb-memory-server's explain() output is what's checked here).
describe('User.level index (Phase 8 — inbox admin-boundary query)', () => {
  it('has an index on level so the admin-boundary lookup is not a collection scan', async () => {
    const indexes = await User.schema.indexes();
    const hasLevelIndex = indexes.some(([spec]) => spec.level === 1);
    expect(hasLevelIndex).toBe(true);
  });
});

// Phase 8 audit finding: retryWithBackoff (frontend) can re-POST
// /api/message after a lost response — the {room,author,clientID} unique
// index is what makes that safe. See message-send-idempotency.test.js for
// the full behavioral proof; this is the narrower "does the index exist
// with the right shape" regression guard.
describe('Message idempotency index (Phase 8 — retried send dedup)', () => {
  it('has a unique partial index on {room,author,clientID} scoped to real clientID strings only', async () => {
    const indexes = await Message.schema.indexes();
    const entry = indexes.find(([spec]) => spec.room === 1 && spec.author === 1 && spec.clientID === 1);
    expect(entry).toBeDefined();
    const [, options] = entry;
    expect(options.unique).toBe(true);
    // partialFilterExpression, not sparse:true — sparse would collide every
    // author-less system message with every other in the same room (see
    // Message.js's schema comment and message-send-idempotency.test.js's
    // regression test for the concrete bug this constraint prevents).
    expect(options.partialFilterExpression).toEqual({ clientID: { $type: 'string' } });
  });
});
