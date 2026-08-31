// Phase 9 audit finding, CRITICAL: the mediasoup 'join'/'produce' socket
// handlers and the meeting/get.js HTTP route previously trusted a
// client-supplied Meeting id / group id with ZERO server-side membership
// verification — any authenticated user who knew or guessed a Meeting._id
// could join an existing call, receive the full existing participant/
// producer list, and inject their own media, regardless of whether they
// were ever a participant in the underlying conversation. Confirmed via a
// real adversarial audit pass before any fix was applied.
//
// authorizeMeetingJoin() is the single choke point both the 'join' and
// 'produce' socket handlers now call before granting any access — these
// tests exercise it directly against a real MongoDB (mongodb-memory-server,
// same as every other backend test) with real Meeting/Room/GroupMember/User
// documents, proving the exact before/after behavior a real attacker would
// have hit.
const mongoose = require('mongoose');
const db = require('./helpers/db');
const mediasoupModule = require('../src/mediasoup/index');
const Meeting = require('../src/models/Meeting');
const Room = require('../src/models/Room');
const User = require('../src/models/User');
const GroupMember = require('../src/models/GroupMember');

const { authorizeMeetingJoin } = mediasoupModule.__testHelpers;

beforeAll(async () => {
  await db.connect();
});

afterAll(async () => {
  await db.closeDatabase();
});

afterEach(async () => {
  await db.clearDatabase();
});

const createUser = async () => User.create({
  username: `user-${Math.random().toString(36).slice(2)}`,
  email: `${Math.random().toString(36).slice(2)}@example.com`,
  firstName: 'Test',
  lastName: 'User',
  password: 'irrelevant-not-hashed-for-this-test',
});

describe('mediasoup join/produce authorization (Phase 9)', () => {
  it('DENIES a user with no relation to the meeting — the exact exploit this audit found', async () => {
    const caller = await createUser();
    const callee = await createUser();
    const attacker = await createUser(); // knows the meeting id (e.g. guessed, leaked, or from another meeting), never invited

    const meeting = await Meeting.create({ caller: caller._id, callee: callee._id });

    const result = await authorizeMeetingJoin(meeting._id.toString(), attacker._id.toString());
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('not_a_participant');
  });

  it('ALLOWS the 1:1 call caller', async () => {
    const caller = await createUser();
    const callee = await createUser();
    const meeting = await Meeting.create({ caller: caller._id, callee: callee._id });

    const result = await authorizeMeetingJoin(meeting._id.toString(), caller._id.toString());
    expect(result.ok).toBe(true);
  });

  it('ALLOWS the 1:1 call callee', async () => {
    const caller = await createUser();
    const callee = await createUser();
    const meeting = await Meeting.create({ caller: caller._id, callee: callee._id });

    const result = await authorizeMeetingJoin(meeting._id.toString(), callee._id.toString());
    expect(result.ok).toBe(true);
  });

  it('ALLOWS a current group member for a group-call meeting', async () => {
    const owner = await createUser();
    const member = await createUser();
    const room = await Room.create({ people: [owner._id, member._id], isGroup: true, title: 'Group' });
    await GroupMember.create({
      group: room._id, user: owner._id, role: 'OWNER', active: true, status: 'ACTIVE',
    });
    await GroupMember.create({
      group: room._id, user: member._id, role: 'MEMBER', active: true, status: 'ACTIVE',
    });
    const meeting = await Meeting.create({
      caller: owner._id, callToGroup: true, group: room._id,
    });

    const result = await authorizeMeetingJoin(meeting._id.toString(), member._id.toString());
    expect(result.ok).toBe(true);
  });

  it('DENIES a user who was REMOVED from the group after the meeting started — re-checks live membership, not the historical Meeting.group reference alone', async () => {
    const owner = await createUser();
    const removedUser = await createUser();
    const room = await Room.create({ people: [owner._id], isGroup: true, title: 'Group' });
    await GroupMember.create({
      group: room._id, user: owner._id, role: 'OWNER', active: true, status: 'ACTIVE',
    });
    // removedUser was a member when the meeting started, then removed —
    // membership row is deactivated (matches the app's real removal pattern,
    // e.g. cleanupDeletedUser.js/members-remove.js: active:false, not deleted).
    await GroupMember.create({
      group: room._id, user: removedUser._id, role: 'MEMBER', active: false, status: 'REMOVED',
    });
    const meeting = await Meeting.create({
      caller: owner._id, callToGroup: true, group: room._id,
    });

    const result = await authorizeMeetingJoin(meeting._id.toString(), removedUser._id.toString());
    expect(result.ok).toBe(false);
  });

  it('ALLOWS a user already recorded as a Meeting participant (rejoin after a drop) even if they are not caller/callee/group-listed', async () => {
    const caller = await createUser();
    const rejoiningUser = await createUser();
    const meeting = await Meeting.create({
      caller: caller._id, users: [caller._id, rejoiningUser._id],
    });

    const result = await authorizeMeetingJoin(meeting._id.toString(), rejoiningUser._id.toString());
    expect(result.ok).toBe(true);
  });

  it('DENIES a non-existent meeting id', async () => {
    const attacker = await createUser();
    const fakeMeetingId = new mongoose.Types.ObjectId().toString();

    const result = await authorizeMeetingJoin(fakeMeetingId, attacker._id.toString());
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('meeting_not_found');
  });

  it('DENIES a missing meeting id (the previous unguarded data.roomID||"general" fallback path)', async () => {
    const attacker = await createUser();

    const result = await authorizeMeetingJoin(undefined, attacker._id.toString());
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no_meeting_id');
  });
});
