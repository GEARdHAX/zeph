// Phase 10 audit finding (N4-equivalent): unlike 'join' and 'produce', the
// 'consume' socket handler had NO authorization check at all, and 'leave'
// trusted a client-supplied roomID (rather than the server's own
// store.roomIDs record, which 'disconnect' already correctly used). These
// tests exercise the real handler functions registered by initSocket()
// against a fake socket, with a real MongoDB (same convention as
// mediasoup-join-authorization.test.js) backing authorizeMeetingJoin —
// only the native mediasoup worker/transport/producer/consumer calls on
// the AUTHORIZED success path are out of reach in this dev environment
// (same documented limitation as mediasoup-cleanup.test.js); the
// unauthorized-rejection path this audit fix adds never reaches them.
const db = require('./helpers/db');
const mediasoupModule = require('../src/mediasoup/index');
const store = require('../src/store');
const Meeting = require('../src/models/Meeting');
const User = require('../src/models/User');

const { producerTransports, consumerTransports, producers, consumers } = mediasoupModule.__testHelpers;

beforeAll(async () => {
  await db.connect();
});

afterAll(async () => {
  await db.closeDatabase();
});

afterEach(async () => {
  await db.clearDatabase();
  Object.keys(producerTransports).forEach((k) => delete producerTransports[k]);
  Object.keys(consumerTransports).forEach((k) => delete consumerTransports[k]);
  Object.keys(producers).forEach((k) => delete producers[k]);
  Object.keys(consumers).forEach((k) => delete consumers[k]);
  store.roomIDs = {};
  store.consumerUserIDs = {};
  store.peers = { asyncRemove: async () => {}, asyncFind: async () => [], asyncInsert: async () => {} };
  store.io = { to: () => ({ emit: () => {} }) };
  // leaveRoom (src/mediasoup/index.js) reads/writes store.onlineUsers
  // directly (presence bookkeeping) — a real Map, same as init.js's
  // initSocketAuth sets up in production; unset by default outside that
  // boot path.
  store.onlineUsers = new Map();
});

const createUser = async () =>
  User.create({
    username: `user-${Math.random().toString(36).slice(2)}`,
    email: `${Math.random().toString(36).slice(2)}@example.com`,
    firstName: 'Test',
    lastName: 'User',
    password: 'irrelevant-not-hashed-for-this-test',
  });

// Minimal fake Socket.IO socket: captures every registered handler by event
// name so the test can invoke it directly, same pattern a real `socket.on`
// dispatch would use.
const fakeSocket = (userId) => {
  const handlers = {};
  return {
    id: `socket-${Math.random().toString(36).slice(2)}`,
    decoded_token: { id: userId, level: 'standard' },
    handlers,
    on(event, handler) {
      handlers[event] = handler;
    },
    to: () => ({ emit: () => {} }),
    join: async () => {},
    leave: async () => {},
  };
};

const callHandler = (socket, event, data) =>
  new Promise((resolve) => {
    socket.handlers[event](data, resolve);
  });

describe('mediasoup consume authorization (Phase 10, N4-equivalent)', () => {
  it('rejects consume when the calling socket has no authorized room at all (never joined anything)', async () => {
    const attacker = await createUser();
    const socket = fakeSocket(attacker._id.toString());
    mediasoupModule.initSocket(socket);

    // store.roomIDs[socket.id] is deliberately left unset — exactly the
    // state of a socket that connected but never passed 'join'.
    const result = await callHandler(socket, 'consume', {
      socketID: 'victim-socket',
      producerID: 'some-producer-id',
      rtpCapabilities: {},
    });

    expect(result).toEqual({ error: 'unauthorized' });
  });

  it('rejects consume when the calling socket is tracked in a meeting it is not authorized for', async () => {
    const caller = await createUser();
    const callee = await createUser();
    const attacker = await createUser();
    const meeting = await Meeting.create({ caller: caller._id, callee: callee._id });

    const socket = fakeSocket(attacker._id.toString());
    mediasoupModule.initSocket(socket);
    // Simulates a forged/stale room tracking entry — regardless of how
    // store.roomIDs[socket.id] got this value, an attacker with no real
    // relationship to the meeting must still be denied.
    store.roomIDs[socket.id] = meeting._id.toString();

    const result = await callHandler(socket, 'consume', {
      socketID: 'victim-socket',
      producerID: 'some-producer-id',
      rtpCapabilities: {},
    });

    expect(result).toEqual({ error: 'unauthorized' });
  });

  it('passes authorization (reaches the producer-not-found error, not unauthorized) for a real participant', async () => {
    const caller = await createUser();
    const callee = await createUser();
    const meeting = await Meeting.create({ caller: caller._id, callee: callee._id });

    const socket = fakeSocket(caller._id.toString());
    mediasoupModule.initSocket(socket);
    store.roomIDs[socket.id] = meeting._id.toString();

    const result = await callHandler(socket, 'consume', {
      socketID: 'some-other-socket',
      producerID: 'nonexistent-producer-id',
      rtpCapabilities: {},
    });

    // Authorization passed (no 'unauthorized' error) — it fails later for
    // an unrelated reason (no such producer exists), proving the
    // authorization check itself did not block a legitimate participant.
    expect(result.error).not.toBe('unauthorized');
    expect(result.error).toMatch(/Producer not found/);
  });
});

describe('mediasoup leave authorization and room-spoofing (Phase 10, N4)', () => {
  it('ignores a client-supplied roomID entirely and uses the server-tracked room instead', async () => {
    const caller = await createUser();
    const callee = await createUser();
    const meeting = await Meeting.create({ caller: caller._id, callee: callee._id });

    const socket = fakeSocket(caller._id.toString());
    mediasoupModule.initSocket(socket);
    store.roomIDs[socket.id] = meeting._id.toString();
    store.consumerUserIDs[meeting._id.toString()] = [socket.id];

    // Client sends a completely different, forged roomID — this must be
    // ignored. If it were honored (the pre-fix behavior), leaveRoom would
    // index into store.consumerUserIDs['forged-room-id'] instead, and any
    // splice against the REAL room's array would simply never happen here
    // (so this specific test wouldn't by itself prove the splice bug) —
    // the real assertion is in the next test, which proves the actual
    // roomID used server-side is the tracked one, not the supplied one.
    await callHandler(socket, 'leave', { roomID: 'forged-meeting-id-the-attacker-does-not-belong-to' });

    // The REAL room's tracking was cleaned up — proving store.roomIDs
    // (not the forged payload) is what leaveRoom actually acted on.
    expect(store.consumerUserIDs[meeting._id.toString()]).toEqual([]);
  });

  it('does not corrupt another socket\'s entry when this socket is not actually in any room (no splice(-1) bug)', async () => {
    const caller = await createUser();
    const callee = await createUser();
    const meeting = await Meeting.create({ caller: caller._id, callee: callee._id });

    const victimSocketId = 'victim-socket-genuinely-in-the-room';
    store.consumerUserIDs[meeting._id.toString()] = [victimSocketId];

    const attacker = await createUser();
    const attackerSocket = fakeSocket(attacker._id.toString());
    mediasoupModule.initSocket(attackerSocket);
    // Attacker's socket was never tracked into this room at all —
    // store.roomIDs[attackerSocket.id] is unset (undefined), exactly like
    // a socket that never joined. leaveRoom(socket, undefined) must be a
    // safe no-op, never touching store.consumerUserIDs[meeting] via a
    // forged roomID the attacker could otherwise supply in the payload.
    await callHandler(attackerSocket, 'leave', { roomID: meeting._id.toString() });

    // The real victim's entry must be completely untouched — this is
    // exactly what the old client-trusting code would have corrupted via
    // consumerUserIDs[roomID].splice(indexOf(-1), 1) removing the last
    // (and here, only) real entry.
    expect(store.consumerUserIDs[meeting._id.toString()]).toEqual([victimSocketId]);
  });
});
