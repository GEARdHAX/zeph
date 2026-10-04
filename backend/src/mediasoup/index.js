const mediasoup = require('mediasoup');
config = require('../../config');
const store = require('../store');
const logger = require('../logger');
const { authorizeMeetingJoin, registerLifecycleHandlers } = require('../calls/roomLifecycle');

let worker;
let mediasoupRouter;
let producerTransports = {};
let consumerTransports = {};
let producers = {};
let consumers = {};

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

const initSocket = (socket) => {
  registerLifecycleHandlers(socket, { onMediaCleanup: cleanupSocketResources });

  socket.on('call:config', (data, callback) => {
    if (typeof callback === 'function') callback({ backend: 'mediasoup' });
  });

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
        logger.warn(
          { meetingId: data.roomID, userId: socket.decoded_token.id, reason: authz.reason },
          'Unauthorized mediasoup produce attempt rejected',
        );
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

      socket.to(data.roomID).emit('newProducer', {
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
      // Audit finding (Phase 10, N4-equivalent): unlike 'join' and
      // 'produce', this handler had NO authorization check at all — any
      // authenticated socket that knew a producerID/socketID pair could
      // pull another meeting's audio/video merely by calling 'consume'
      // directly, without ever having passed authorizeMeetingJoin for that
      // meeting. The authorization check is against THIS socket's own
      // server-recorded room (store.roomIDs, set only by the 'join'
      // handler after authorizeMeetingJoin already passed) — never a
      // client-supplied meetingId, since this event's payload doesn't even
      // carry one.
      const roomID = store.roomIDs[socket.id];
      const authz = await authorizeMeetingJoin(roomID, socket.decoded_token.id);
      if (!authz.ok) {
        logger.warn(
          { meetingId: roomID, userId: socket.decoded_token.id, reason: authz.reason },
          'Unauthorized mediasoup consume attempt rejected',
        );
        callback({ error: 'unauthorized' });
        return;
      }

      const producer = producers[data.socketID] && producers[data.socketID][data.producerID];
      if (!producer) throw new Error('Producer not found — it may have already left');

      const consumerTransport = consumerTransports[socket.id];
      if (!consumerTransport)
        throw new Error('No consumer transport for this socket — call createConsumerTransport first');

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
      logger.warn(
        { producerId: data.producerID, socketId: socket.id },
        'Unauthorized mediasoup remove attempt rejected — not the producer owner',
      );
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
    cleanupSocketResources,
    closeProducer,
    closeConsumer,
    producerTransports,
    consumerTransports,
    producers,
    consumers,
    authorizeMeetingJoin,
  },
};
