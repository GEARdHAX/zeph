const mediasoup = require('mediasoup');
config = require('../../config');
const store = require('../store');
const User = require('../models/User');
const Meeting = require('../models/Meeting');
const mongoose = require('mongoose');
const logger = require('../logger');
const { broadcastPresence } = require('../presence');
const groupPolicy = require('../authorization/groupPolicy');

let worker;
let mediasoupRouter;
let producerTransports = {};
let consumerTransports = {};
let producers = {};
let consumers = {};
let consumersObjects = {};

const init = async () => {
  worker = await mediasoup.createWorker({
    rtcMinPort: config.rtcMinPort,
    rtcMaxPort: config.rtcMaxPort,
    logLevel: config.mediasoupLogLevel,
  });

  worker.on('died', () => {
    logger.error({ pid: worker.pid }, 'mediasoup worker died, exiting in 2 seconds...');
    setTimeout(() => process.exit(1), 2000);
  });

  const mediaCodecs = config.mediaCodecs;
  mediasoupRouter = await worker.createRouter({ mediaCodecs });
  logger.info({ ip: config.ipAddress.ip }, 'mediasoup worker running');
};

async function createWebRtcTransport() {
  const transport = await mediasoupRouter.createWebRtcTransport({
    listenInfos: [
      { protocol: 'tcp', ip: config.ipAddress.ip, announcedAddress: config.ipAddress.announcedIp },
      { protocol: 'udp', ip: config.ipAddress.ip, announcedAddress: config.ipAddress.announcedIp },
    ],
    initialAvailableOutgoingBitrate: 1000000,
  });
  try {
    await transport.setMaxIncomingBitrate(1500000);
  } catch (error) {}
  return {
    transport,
    params: {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    },
  };
}

async function createConsumer(producer, rtpCapabilities, consumerTransport) {
  if (
    !mediasoupRouter.canConsume({
      producerId: producer.id,
      rtpCapabilities,
    })
  ) {
    logger.warn({ producerId: producer.id }, 'Cannot consume producer (incompatible rtpCapabilities)');
    return;
  }
  let consumer;
  try {
    consumer = await consumerTransport.consume({
      producerId: producer.id,
      rtpCapabilities,
      paused: producer.kind === 'video',
    });
  } catch (error) {
    logger.error({ err: error, producerId: producer.id }, 'Consume failed');
    return;
  }

  if (consumer.type === 'simulcast') {
    await consumer.setPreferredLayers({ spatialLayer: 2, temporalLayer: 2 });
  }

  return {
    consumer,
    response: {
      producerId: producer.id,
      id: consumer.id,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
      type: consumer.type,
      producerPaused: consumer.producerPaused,
    },
  };
}

// Phase 9 audit finding, CRITICAL: the mediasoup `join` handler previously
// trusted `data.roomID` (actually a Meeting._id) unconditionally — any
// authenticated socket could join, consume every existing participant's
// media, and produce its own into ANY meeting merely by knowing/guessing
// the id. meeting/call.js (the HTTP route that sends the "incoming call"
// socket event) already does real Room-membership + admin-boundary
// authorization, but that check was never re-applied at the point that
// actually matters: the media-plane socket handlers, which are reachable
// directly regardless of whether meeting/call.js ever ran. This closes
// that gap at its root — one check, called from every socket handler that
// grants access to a meeting's media, rather than one per handler.
//
// A caller is authorized if they are the 1:1 call's caller/callee, already
// a recorded participant (Meeting.users — covers rejoining after a drop),
// or — for a group call — a CURRENT member of the group the meeting
// belongs to (re-checked live via groupPolicy, not just Meeting.group's
// historical reference, so someone removed from the group after the call
// started is correctly denied on their next join attempt).
const authorizeMeetingJoin = async (meetingId, userId) => {
  if (!meetingId) return { ok: false, reason: 'no_meeting_id' };
  const meeting = await Meeting.findById(meetingId).select('caller callee group users').catch(() => null);
  if (!meeting) return { ok: false, reason: 'meeting_not_found' };

  const userIdStr = userId.toString();
  if (meeting.caller && meeting.caller.toString() === userIdStr) return { ok: true };
  if (meeting.callee && meeting.callee.toString() === userIdStr) return { ok: true };
  if ((meeting.users || []).some((u) => u.toString() === userIdStr)) return { ok: true };

  if (meeting.group) {
    const membership = await groupPolicy.getMembershipWithFallback(meeting.group, userIdStr);
    if (membership) return { ok: true };
  }

  return { ok: false, reason: 'not_a_participant' };
};

const initSocket = (socket) => {
  socket.on('getRouterRtpCapabilities', (data, callback) => {
    callback(mediasoupRouter.rtpCapabilities);
  });

  socket.on('createProducerTransport', async (data, callback) => {
    try {
      const { transport, params } = await createWebRtcTransport();
      producerTransports[socket.id] = transport;
      callback(params);
    } catch (err) {
      logger.error({ err, socketId: socket.id }, 'Failed to create producer transport');
      callback({ error: err.message });
    }
  });

  socket.on('createConsumerTransport', async (data, callback) => {
    try {
      const { transport, params } = await createWebRtcTransport();
      consumerTransports[socket.id] = transport;
      callback(params);
    } catch (err) {
      logger.error({ err, socketId: socket.id }, 'Failed to create consumer transport');
      callback({ error: err.message });
    }
  });

  socket.on('connectProducerTransport', async (data, callback) => {
    try {
      const transport = producerTransports[socket.id];
      if (!transport) throw new Error('No producer transport for this socket — call createProducerTransport first');
      await transport.connect({ dtlsParameters: data.dtlsParameters });
      callback();
    } catch (err) {
      logger.error({ err, socketId: socket.id }, 'Failed to connect producer transport');
      callback({ error: err.message });
    }
  });

  socket.on('connectConsumerTransport', async (data, callback) => {
    try {
      const transport = consumerTransports[socket.id];
      if (!transport) throw new Error('No consumer transport for this socket — call createConsumerTransport first');
      await transport.connect({ dtlsParameters: data.dtlsParameters });
      callback();
    } catch (err) {
      logger.error({ err, socketId: socket.id }, 'Failed to connect consumer transport');
      callback({ error: err.message });
    }
  });

  socket.on('produce', async (data, callback) => {
    try {
      // Same authorization gate as 'join' — a client that never legitimately
      // joined a meeting must not be able to inject its own media into that
      // meeting's room merely by naming its id in a direct 'produce' call.
      const authz = await authorizeMeetingJoin(data.roomID, socket.decoded_token.id);
      if (!authz.ok) {
        logger.warn({ meetingId: data.roomID, userId: socket.decoded_token.id, reason: authz.reason }, 'Unauthorized mediasoup produce attempt rejected');
        callback({ error: 'unauthorized' });
        return;
      }

      const { kind, rtpParameters, isScreen } = data;
      const transport = producerTransports[socket.id];
      if (!transport) throw new Error('No producer transport for this socket — call createProducerTransport first');
      const producer = await transport.produce({ kind, rtpParameters });

      producer.on('transportclose', () => {
        logger.debug({ producerId: producer.id }, "Producer's transport closed");
        closeProducer(producer, socket.id);
      });
      producer.observer.on('close', () => {
        logger.debug({ producerId: producer.id }, 'Producer closed');
        closeProducer(producer, socket.id);
      });

      await store.peers.asyncInsert({
        type: 'producer',
        socketID: socket.id,
        userID: socket.decoded_token.id,
        roomID: data.roomID || 'general',
        producerID: producer.id,
        isScreen,
      });

      !producers[socket.id] && (producers[socket.id] = {});
      producers[socket.id][producer.id] = producer;

      socket
        .to(data.roomID)
        .emit('newProducer', {
          userID: socket.decoded_token.id,
          roomID: data.roomID || 'general',
          socketID: socket.id,
          producerID: producer.id,
          isScreen,
        });

      callback({ id: producer.id });
    } catch (err) {
      logger.error({ err, socketId: socket.id }, 'Failed to produce');
      callback({ error: err.message });
    }
  });

  socket.on('consume', async (data, callback) => {
    try {
      const producer = producers[data.socketID] && producers[data.socketID][data.producerID];
      if (!producer) throw new Error('Producer not found — it may have already left');

      const consumerTransport = consumerTransports[socket.id];
      if (!consumerTransport) throw new Error('No consumer transport for this socket — call createConsumerTransport first');

      const obj = await createConsumer(producer, data.rtpCapabilities, consumerTransport);
      if (!obj) throw new Error('Cannot consume this producer (incompatible rtpCapabilities)');

      // Phase 7 audit finding: closeConsumer looked up consumers[socketId]
      // by consumer.id, but consumers[socketId] is actually keyed by
      // data.producerID (see the assignment 2 lines below) — the two
      // never matched, so this cleanup was a silent no-op on every real
      // transportclose/producerclose. Pass the actual storage key.
      obj.consumer.on('transportclose', () => {
        closeConsumer(data.producerID, socket.id);
      });
      obj.consumer.on('producerclose', () => {
        closeConsumer(data.producerID, socket.id);
      });

      !consumers[socket.id] && (consumers[socket.id] = {});
      consumers[socket.id][data.producerID] = obj.consumer;
      callback(obj.response);
    } catch (err) {
      logger.error({ err, socketId: socket.id }, 'Failed to consume');
      callback({ error: err.message });
    }
  });

  socket.on('resume', async (data, callback) => {
    try {
      const consumer = consumers[socket.id] && consumers[socket.id][data.producerID];
      if (!consumer) throw new Error('Consumer not found — it may have already left');
      await consumer.resume();
      callback();
    } catch (err) {
      logger.error({ err, socketId: socket.id }, 'Failed to resume consumer');
      callback({ error: err.message });
    }
  });

  socket.on('create', async (data, callback) => {
    const room = await store.rooms.asyncInsert({ lastJoin: Date.now() });
    callback(room);
  });

  socket.on('join', async (data, callback) => {
    const authz = await authorizeMeetingJoin(data.roomID, socket.decoded_token.id).catch((err) => {
      logger.error({ err, meetingId: data.roomID, userId: socket.decoded_token.id }, 'Meeting join authorization check failed');
      return { ok: false, reason: 'authorization_check_failed' };
    });
    if (!authz.ok) {
      logger.warn({ meetingId: data.roomID, userId: socket.decoded_token.id, reason: authz.reason }, 'Unauthorized mediasoup join attempt rejected');
      if (typeof callback === 'function') callback({ error: 'unauthorized' });
      return;
    }

    const user = await User.findOne({ _id: socket.decoded_token.id }, { password: 0 }).populate([
      { path: 'picture', strictPopulate: false },
    ]);
    socket.to(data.roomID).emit('newPeer', { userID: socket.decoded_token.id, socketID: socket.id, user });
    consumersObjects[data.roomID] = {
      ...(consumersObjects[data.roomID] || {}),
      [socket.id]: { userID: socket.decoded_token.id, socketID: socket.id, user },
    };

    await socket.join(data.roomID || 'general');
    if (data.roomID) await store.rooms.asyncUpdate({ _id: data.roomID }, { $set: { lastJoin: Date.now() } });
    const peers = await store.peers.asyncFind({ type: 'producer', roomID: data.roomID || 'general' });

    if (!store.consumerUserIDs[data.roomID]) store.consumerUserIDs[data.roomID] = [];
    store.consumerUserIDs[data.roomID].push(socket.id);

    socket.to(data.roomID).emit('consumers', { content: store.consumerUserIDs[data.roomID], timestamp: Date.now() });

    await Meeting.findOneAndUpdate(
      { _id: data.roomID },
      {
        lastEnter: Date.now(),
        $push: { peers: socket.id },
        $addToSet: { users: mongoose.Types.ObjectId(socket.decoded_token.id) },
      },
    )
      .then((meeting) => {
        // Personal-room delivery keys rooms by the plain string passed to
        // socket.join(id) in init.js (socket.decoded_token.id, a JWT-payload
        // string) — meeting.users is an array of raw Mongoose ObjectId
        // instances (never populated here), and Socket.IO's room lookup is
        // a string-keyed Map, so socket.to(objectIdInstance) silently
        // matched no room at all: every "someone joined/left" notification
        // was emitted into the void, and the sidebar's meeting list only
        // ever showed whatever getMeetings() happened to fetch once on
        // mount — exactly the reported "shows 0 participants until I
        // reopen/refresh" symptom.
        meeting.users.forEach((user) => {
          socket.to(user.toString()).emit('refresh-meetings', { timestamp: Date.now() });
        });
      })
      .catch((err) => logger.error({ err, meetingId: data.roomID }, 'Failed to update meeting on join'));

    store.roomIDs[socket.id] = data.roomID;

    store.onlineUsers.delete(socket);
    store.onlineUsers.set(socket, { id: socket.decoded_token.id, status: 'busy', level: socket.decoded_token.level });
    broadcastPresence().catch((err) => logger.error({ err }, 'Failed to broadcast presence'));

    callback({
      producers: peers,
      consumers: { content: store.consumerUserIDs[data.roomID], timestamp: Date.now() },
      peers: consumersObjects[data.roomID],
    });
  });

  socket.on('leave', async (data, callback) => {
    await leaveRoom(socket, data.roomID);
    if (callback) callback();
  });

  // Phase 7 audit finding: this handler did not exist — a client that
  // disconnects WITHOUT first emitting 'leave' (network loss, tab close,
  // crash) never ran ANY of the leave cleanup below. Its transports/
  // producers/consumers (real mediasoup UDP transports and C++ resources)
  // stayed open on the worker until the whole process restarted, and the
  // meeting/room bookkeeping (store.peers, store.consumerUserIDs,
  // Meeting.peers) never got pruned either. Reuses the exact same
  // leaveRoom() cleanup 'leave' already used, keyed off whatever room this
  // socket was last known to be in (store.roomIDs, set on join).
  socket.on('disconnect', async () => {
    const roomID = store.roomIDs[socket.id];
    if (roomID) {
      await leaveRoom(socket, roomID).catch((err) => logger.error({ err, socketId: socket.id }, 'Failed to clean up mediasoup state on disconnect'));
    } else {
      // Never joined a room (e.g. dropped mid-handshake) — still clear any
      // transports/producers/consumers this socket may have created.
      cleanupSocketResources(socket.id);
    }
  });

  socket.on('remove', async (data, callback) => {
    // Phase 9 audit finding: previously trusted data.producerID with no
    // ownership check at all — any authenticated socket could remove ANY
    // producer in ANY room merely by naming its id (kicking an arbitrary
    // participant's audio/video out of a call they have no relation to).
    // A client only ever legitimately removes a producer IT created (see
    // callManager.js's three call sites — always its own audio/video/screen
    // producer), so ownership is exactly "is this producerID one of mine."
    const ownsProducer = !!(producers[socket.id] && producers[socket.id][data.producerID]);
    if (!ownsProducer) {
      logger.warn({ producerId: data.producerID, socketId: socket.id }, 'Unauthorized mediasoup remove attempt rejected — not the producer owner');
      if (typeof callback === 'function') callback({ error: 'unauthorized' });
      return;
    }
    await store.peers.asyncRemove({ producerID: data.producerID }, { multi: true });
    store.io.to(data.roomID || 'general').emit('remove', { producerID: data.producerID, socketID: socket.id });
    callback();
  });
};

// Phase 7 audit finding: producerTransports[socket.id]/consumerTransports[
// socket.id]/producers[socket.id]/consumers[socket.id] were only ever
// .close()d, never delete()d — every socket that ever connected left a
// permanent (closed-but-still-referenced) entry in these module-level
// objects for the life of the process. This is the one place all four
// maps actually get their keys removed.
const cleanupSocketResources = (socketId) => {
  if (producerTransports[socketId]) {
    producerTransports[socketId].close();
    delete producerTransports[socketId];
  }
  if (consumerTransports[socketId]) {
    consumerTransports[socketId].close();
    delete consumerTransports[socketId];
  }
  delete producers[socketId];
  delete consumers[socketId];
};

// Shared by the explicit 'leave' event and the new 'disconnect' handler
// above — same cleanup either way, so a client that leaves cleanly and one
// that just drops the connection are handled identically.
const leaveRoom = async (socket, roomID) => {
  await socket.leave(roomID || 'general');
  await store.peers.asyncRemove({ socketID: socket.id }, { multi: true });
  store.io.to(roomID || 'general').emit('leave', { socketID: socket.id });
  cleanupSocketResources(socket.id);

  store.roomIDs[socket.id] = null;

  if (store.consumerUserIDs[roomID])
    store.consumerUserIDs[roomID].splice(store.consumerUserIDs[roomID].indexOf(socket.id), 1);

  // Zeph AI Meeting AI (Phase 14): mark the meeting genuinely ended only
  // once the LAST participant has left (checked BEFORE the $pull below
  // removes this socket from peers, using consumerUserIDs — already pruned
  // above — as "who's actually still connected"). endedAt is the anchor
  // ai/eligibility.js uses for meeting-duration eligibility; setting it on
  // every individual departure (like lastLeave already does) would make a
  // meeting with one person briefly dropping and rejoining look "ended"
  // partway through.
  const stillHasParticipants = (store.consumerUserIDs[roomID] || []).length > 0;
  const meetingUpdate = { lastLeave: Date.now(), $pull: { peers: socket.id } };
  if (!stillHasParticipants) meetingUpdate.endedAt = new Date();

  await Meeting.findOneAndUpdate({ _id: roomID }, meetingUpdate)
    .then((meeting) => {
      // Same string-vs-ObjectId fix as the join handler above.
      (meeting?.users || []).forEach((user) => {
        socket.to(user.toString()).emit('refresh-meetings', { timestamp: Date.now() });
      });
    })
    .catch((err) => logger.error({ err, meetingId: roomID }, 'Failed to update meeting on leave'));
  socket.to(roomID).emit('consumers', { content: store.consumerUserIDs[roomID], timestamp: Date.now() });

  socket.to(roomID).emit('leave', { socketID: socket.id });

  store.onlineUsers.delete(socket);
  store.onlineUsers.set(socket, { id: socket.decoded_token.id, status: 'online', level: socket.decoded_token.level });
  broadcastPresence().catch((err) => logger.error({ err }, 'Failed to broadcast presence'));
};

// Phase 7 audit finding: these only ever called .close() on the tracked
// producer/consumer, never deleted its key — same "map entries never
// shrink" bug cleanupSocketResources() above fixes for the transport
// maps. Guarded against producers[socketID]/consumers[socketID] already
// being gone entirely (e.g. cleanupSocketResources already ran via
// leave/disconnect before this mediasoup-internal event fired).
async function closeProducer(producer, socketID) {
  const bucket = producers[socketID];
  if (!bucket || !bucket[producer.id]) return;
  try {
    await bucket[producer.id].close();
  } catch (e) {
    logger.debug({ err: e, producerId: producer.id }, 'closeProducer no-op (already closed)');
  } finally {
    delete bucket[producer.id];
  }
}

// producerID is the actual storage key (see the 'consume' handler above —
// consumers[socketID] is keyed by data.producerID, not by the consumer's
// own .id), not the consumer object itself.
async function closeConsumer(producerID, socketID) {
  const bucket = consumers[socketID];
  if (!bucket || !bucket[producerID]) return;
  try {
    await bucket[producerID].close();
  } catch (e) {
    logger.debug({ err: e, producerID }, 'closeConsumer no-op (already closed)');
  } finally {
    delete bucket[producerID];
  }
}

// Phase 7 — graceful shutdown. Closing the worker cascades to close every
// router/transport/producer/consumer it owns (mediasoup's own documented
// behavior), so this alone releases all real UDP transports and C++
// resources without needing to iterate producerTransports/
// consumerTransports/producers/consumers by hand. No-op if init() was
// never called (MEDIASOUP_ENABLED=false — Render's own current config).
const close = async () => {
  if (worker) {
    worker.close();
    worker = null;
  }
};

module.exports = {
  init,
  initSocket,
  close,
  // Test-only exports — cleanupSocketResources/closeProducer/closeConsumer
  // are pure enough to unit test without a real mediasoup worker (they
  // only touch the module-level tracking objects, never the native
  // mediasoup bindings directly in a way that requires one — the
  // transport/producer/consumer objects themselves are provided by the
  // caller/test, not created here). __testHelpers is not used by any
  // production code path.
  __testHelpers: {
    cleanupSocketResources, closeProducer, closeConsumer, producerTransports, consumerTransports, producers, consumers,
    authorizeMeetingJoin,
  },
};
