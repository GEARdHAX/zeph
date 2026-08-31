// Seeds N users directly via the model layer + signs their JWTs the same
// way login.js does — used by http-load.js/socket-load.js to get a large
// pool of authenticated users WITHOUT hammering POST /api/register, which
// is correctly rate-limited to 20/15min per IP (authLimiter, init.js) and
// should not be routed around via a load test any more than a real
// attacker should be able to. Real load only exercises registration once
// per real user; hammering it concurrently isn't what this suite is
// actually trying to measure (see http-load.js's separate, deliberately
// small, auth-specific batch for that number).
//
// Usage: node loadtest/seed.js <count> > loadtest/.seeded-tokens.json
require('dotenv').config();
const jwt = require('jsonwebtoken');
const argon2 = require('argon2');
const mongoose = require('../src/models/mongoose');
const User = require('../src/models/User');
const config = require('../config');

const count = Number(process.argv[2]) || 100;

const main = async () => {
  await mongoose.connect(config.mongo.uri);

  const password = await argon2.hash('LoadTest123!'); // hash once, reuse — seeding isn't measuring argon2 cost, http-load.js's register batch already does
  const users = [];
  for (let i = 0; i < count; i += 1) {
    const tag = `${Date.now()}${i}${Math.floor(Math.random() * 1e6)}`;
    // eslint-disable-next-line no-await-in-loop
    const user = await User.create({
      username: `seed${tag}`,
      email: `seed-${tag}@example.com`,
      firstName: 'Seed',
      lastName: 'User',
      password,
    });
    users.push(user);
  }

  const tokens = users.map((user) => jwt.sign(
    {
      id: user._id, email: user.email, level: user.level, firstName: user.firstName, lastName: user.lastName,
    },
    config.secret,
    { expiresIn: 60 * 60 * 24 * 60 },
  ));

  console.log(JSON.stringify({ tokens, userIds: users.map((u) => u._id.toString()) }));
  await mongoose.disconnect();
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
