const mediasoup = require('mediasoup');
config = require('../../config');
const store = require('../store');
const User = require('../models/User');
const Meeting = require('../models/Meeting');
const mongoose = require('mongoose');
const logger = require('../logger');

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

      obj.consumer.on('transportclose', () => {
        closeConsumer(obj.consumer, socket.id);
      });
      obj.consumer.on('producerclose', () => {
        closeConsumer(obj.consumer, socket.id);
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
        meeting.users.forEach((user) => {
          socket.to(user).emit('refresh-meetings', { timestamp: Date.now() });
        });
      })
      .catch((err) => logger.error({ err, meetingId: data.roomID }, 'Failed to update meeting on join'));

    store.roomIDs[socket.id] = data.roomID;

    store.onlineUsers.delete(socket);
    store.onlineUsers.set(socket, { id: socket.decoded_token.id, status: 'busy' });
    store.io.emit('onlineUsers', Array.from(store.onlineUsers.values()));

    callback({
      producers: peers,
      consumers: { content: store.consumerUserIDs[data.roomID], timestamp: Date.now() },
      peers: consumersObjects[data.roomID],
    });
  });

  socket.on('leave', async (data, callback) => {
    await socket.leave(data.roomID || 'general');
    await store.peers.asyncRemove({ socketID: socket.id }, { multi: true });
    store.io.to(data.roomID || 'general').emit('leave', { socketID: socket.id });
    if (producerTransports[socket.id]) producerTransports[socket.id].close();
    if (consumerTransports[socket.id]) consumerTransports[socket.id].close();

    store.roomIDs[socket.id] = null;

    await Meeting.findOneAndUpdate({ _id: data.roomID }, { lastLeave: Date.now(), $pull: { peers: socket.id } })
      .then((meeting) => {
        (meeting.users || []).forEach((user) => {
          socket.to(user).emit('refresh-meetings', { timestamp: Date.now() });
        });
      })
      .catch((err) => logger.error({ err, meetingId: data.roomID }, 'Failed to update meeting on leave'));

    if (store.consumerUserIDs[data.roomID])
      store.consumerUserIDs[data.roomID].splice(store.consumerUserIDs[data.roomID].indexOf(socket.id), 1);
    socket.to(data.roomID).emit('consumers', { content: store.consumerUserIDs[data.roomID], timestamp: Date.now() });

    socket.to(data.roomID).emit('leave', { socketID: socket.id });

    store.onlineUsers.delete(socket);
    store.onlineUsers.set(socket, { id: socket.decoded_token.id, status: 'online' });
    store.io.emit('onlineUsers', Array.from(store.onlineUsers.values()));

    if (callback) callback();
  });

  socket.on('remove', async (data, callback) => {
    await store.peers.asyncRemove({ producerID: data.producerID }, { multi: true });
    store.io.to(data.roomID || 'general').emit('remove', { producerID: data.producerID, socketID: socket.id });
    callback();
  });
};

async function closeProducer(producer, socketID) {
  try {
    await producers[socketID][producer.id].close();
  } catch (e) {
    logger.debug({ err: e, producerId: producer.id }, 'closeProducer no-op (already closed)');
  }
}

async function closeConsumer(consumer, socketID) {
  try {
    await consumers[socketID][consumer.id].close();
  } catch (e) {
    logger.debug({ err: e, consumerId: consumer.id }, 'closeConsumer no-op (already closed)');
  }
}

module.exports = {
  init,
  initSocket,
};
