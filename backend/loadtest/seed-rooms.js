// Seeds N DM rooms directly via the model layer, paired with N+1 users from
// seed.js's token pool. Used by message-only-load.js so that measuring
// message-SEND throughput isn't gated by discoveryLimiter (100/15min/IP on
// /api/room/create — a real, correctly-scoped limit on room CREATION, a
// different concern from message throughput; see loadtest/README.md for
// the room-creation capacity number measured directly against that limiter
// instead of routed around here).
//
// Usage: node loadtest/seed-rooms.js <tokensAndUserIdsJsonFile> > rooms.json
require('dotenv').config();
const fs = require('fs');
const mongoose = require('../src/models/mongoose');
const Room = require('../src/models/Room');
const config = require('../config');

const inputFile = process.argv[2];

const main = async () => {
  const { tokens, userIds } = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
  await mongoose.connect(config.mongo.uri);

  const count = userIds.length - 1;
  const rooms = [];
  for (let i = 0; i < count; i += 1) {
    const dmKey = [userIds[i], userIds[i + 1]].sort().join(':');
    // eslint-disable-next-line no-await-in-loop
    const room = await Room.create({
      people: [userIds[i], userIds[i + 1]], isGroup: false, dmKey,
    });
    rooms.push({ roomID: room._id.toString(), senderToken: tokens[i] });
  }

  console.log(JSON.stringify({ rooms }));
  await mongoose.disconnect();
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
