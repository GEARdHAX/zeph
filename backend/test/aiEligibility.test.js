const db = require('./helpers/db');
const User = require('../src/models/User');
const Room = require('../src/models/Room');
const Message = require('../src/models/Message');
const { buildPolicy } = require('../src/ai/policy');
const {
  checkSummaryEligibility, checkTitleEligibility, checkTopicEligibility, isSummaryStale,
} = require('../src/ai/eligibility');

beforeAll(async () => { await db.connect(); });
afterAll(async () => { await db.closeDatabase(); });
afterEach(async () => { await db.clearDatabase(); });

const policy = buildPolicy({});

const seedMessages = async (roomId, authorId, count) => {
  const docs = Array.from({ length: count }, (_, i) => ({
    author: authorId, room: roomId, content: `msg ${i}`, type: 'text',
  }));
  await Message.insertMany(docs);
};

describe('checkSummaryEligibility — DM (below/at/above threshold)', () => {
  it('rejects below the DM minimum (29 < 30)', async () => {
    const user = await User.create({ username: 'a', email: 'a@x.com', firstName: 'A', lastName: 'B', password: 'x' });
    const room = await Room.create({ people: [user._id], isGroup: false });
    await seedMessages(room._id, user._id, 29);
    const result = await checkSummaryEligibility(policy, room._id, 'dm');
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('INSUFFICIENT_CONTEXT');
  });

  it('accepts exactly at the DM minimum (30)', async () => {
    const user = await User.create({ username: 'a', email: 'a@x.com', firstName: 'A', lastName: 'B', password: 'x' });
    const room = await Room.create({ people: [user._id], isGroup: false });
    await seedMessages(room._id, user._id, 30);
    const result = await checkSummaryEligibility(policy, room._id, 'dm');
    expect(result.eligible).toBe(true);
  });

  it('accepts above the DM minimum (31)', async () => {
    const user = await User.create({ username: 'a', email: 'a@x.com', firstName: 'A', lastName: 'B', password: 'x' });
    const room = await Room.create({ people: [user._id], isGroup: false });
    await seedMessages(room._id, user._id, 31);
    const result = await checkSummaryEligibility(policy, room._id, 'dm');
    expect(result.eligible).toBe(true);
  });
});

describe('checkSummaryEligibility — group uses the group threshold, not the DM one', () => {
  it('rejects 40 messages in a group (below 100)', async () => {
    const user = await User.create({ username: 'a', email: 'a@x.com', firstName: 'A', lastName: 'B', password: 'x' });
    const room = await Room.create({ people: [user._id], isGroup: true });
    await seedMessages(room._id, user._id, 40);
    const result = await checkSummaryEligibility(policy, room._id, 'group');
    expect(result.eligible).toBe(false);
  });

  it('accepts 125 messages in a group', async () => {
    const user = await User.create({ username: 'a', email: 'a@x.com', firstName: 'A', lastName: 'B', password: 'x' });
    const room = await Room.create({ people: [user._id], isGroup: true });
    await seedMessages(room._id, user._id, 125);
    const result = await checkSummaryEligibility(policy, room._id, 'group');
    expect(result.eligible).toBe(true);
    expect(result.count).toBe(125);
  });
});

describe('checkTitleEligibility / checkTopicEligibility', () => {
  it('title: rejects below 5, accepts at 5', async () => {
    const user = await User.create({ username: 'a', email: 'a@x.com', firstName: 'A', lastName: 'B', password: 'x' });
    const room = await Room.create({ people: [user._id], isGroup: false });
    await seedMessages(room._id, user._id, 4);
    expect((await checkTitleEligibility(policy, room._id)).eligible).toBe(false);
    await seedMessages(room._id, user._id, 1);
    expect((await checkTitleEligibility(policy, room._id)).eligible).toBe(true);
  });

  it('topics: rejects below 50, accepts at 50', async () => {
    const user = await User.create({ username: 'a', email: 'a@x.com', firstName: 'A', lastName: 'B', password: 'x' });
    const room = await Room.create({ people: [user._id], isGroup: true });
    await seedMessages(room._id, user._id, 49);
    expect((await checkTopicEligibility(policy, room._id)).eligible).toBe(false);
    await seedMessages(room._id, user._id, 1);
    expect((await checkTopicEligibility(policy, room._id)).eligible).toBe(true);
  });
});

describe('isSummaryStale — freshness threshold', () => {
  it('is NOT stale with fewer new messages than the threshold (120 -> 143, 23 < 25)', () => {
    expect(isSummaryStale(policy, 120, 143)).toBe(false);
  });

  it('IS stale at exactly the threshold (120 -> 145, 25 >= 25)', () => {
    expect(isSummaryStale(policy, 120, 145)).toBe(true);
  });

  it('IS stale above the threshold', () => {
    expect(isSummaryStale(policy, 120, 200)).toBe(true);
  });
});
