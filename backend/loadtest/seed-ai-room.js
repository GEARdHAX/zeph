// Seeds one GROUP room directly via the model layer + N text messages
// (bypassing message.js's own rate limits, same reasoning as
// seed-rooms.js — a load test measures AI governance, not message-send
// throughput, which message-only-load.js already covers separately).
//
// Usage: node loadtest/seed-ai-room.js <userIdsJsonFile> <messageCount>
// (a file path, not an inline JSON string — passing a JSON array literal
// through execSync's command-string form gets shell-quoting-mangled
// differently on Windows vs. POSIX; a temp file sidesteps that entirely.)
require('dotenv').config();
const fs = require('fs');
const mongoose = require('../src/models/mongoose');
const Room = require('../src/models/Room');
const Message = require('../src/models/Message');
const config = require('../config');

const userIds = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const messageCount = Number(process.argv[3]) || 105;

const main = async () => {
  await mongoose.connect(config.mongo.uri);

  const room = await Room.create({ people: userIds, isGroup: true, title: 'AI Load Test Group' });

  const docs = Array.from({ length: messageCount }, (_, i) => ({
    author: userIds[i % userIds.length],
    room: room._id,
    content: `Load test message number ${i} discussing the project roadmap and next steps.`,
    type: 'text',
  }));
  await Message.insertMany(docs);

  console.log(JSON.stringify({ roomId: room._id.toString(), messageCount }));
  await mongoose.disconnect();
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
