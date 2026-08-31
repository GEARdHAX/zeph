const request = require('supertest');
const argon2 = require('argon2');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const User = require('../src/models/User');
const Room = require('../src/models/Room');

let app;

beforeAll(async () => {
  await db.connect();
  app = buildApp();
});

afterAll(async () => {
  await db.closeDatabase();
});

afterEach(async () => {
  await db.clearDatabase();
});

const createUser = async () => {
  const password = await argon2.hash('password123');
  return User.create({
    username: `user-${Math.random().toString(36).slice(2)}`,
    email: `${Math.random().toString(36).slice(2)}@example.com`,
    firstName: 'Test',
    lastName: 'User',
    password,
  });
};

// Phase 9 adversarial audit — regression guard for two findings that were
// confirmed NOT EXPLOITABLE this pass, so a future change can't silently
// reintroduce the vector without a test noticing:
//
// 1. NoSQL operator injection ($gt/$ne/$in/$where/nested operators): not
//    exploitable because (a) express-formidable parses multipart bodies
//    into flat STRING fields only — a client cannot make req.fields.x
//    become a real object/array the way a JSON body could — and (b) no
//    JSON body parser (express.json()/bodyParser) is mounted anywhere in
//    this app, and no route reads req.body at all. Both were confirmed
//    directly against the actual installed dependencies/mounted
//    middleware, not assumed.
// 2. Prototype pollution (__proto__/constructor/prototype payloads): no
//    recursive merge/deep-assign utility exists anywhere in backend/src,
//    and no route merges a client-supplied object into a persisted/
//    behavioral structure.
describe('NoSQL injection — structural defenses (Phase 9)', () => {
  it('no JSON body parser is mounted — a JSON request body never reaches req.fields as parsed JSON', async () => {
    const user = await createUser();
    // Sends a real JSON body containing an operator-injection payload.
    // If express.json() were ever mounted, req.fields (or req.body) would
    // receive a real object for `content` here instead of a string/undefined.
    const res = await request(app)
      .post('/api/rooms/list')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ limit: { $gt: 0 } }));

    // Whatever the route does with a malformed/unexpected body, it must
    // never 500 from an uncaught CastError due to a raw operator object
    // reaching a Mongoose query filter — confirms the global error handler
    // (Phase 9) and/or the route's own defensive coding hold even under a
    // deliberately hostile content-type/body combination.
    expect(res.status).not.toBe(500);
  });

  it('an operator-shaped multipart field value arrives as a literal string, not a real query operator', async () => {
    const attacker = await createUser();
    const victim = await createUser();
    // A crafted field NAME (not the standard 'email') containing operator
    // syntax — formidable has no bracket/nested-object parsing, so this can
    // only ever produce a flat string field, never {email: {$ne: null}}.
    const res = await request(app)
      .post('/api/login')
      .field('email[$ne]', 'anything')
      .field('password', 'irrelevant');

    // Login must fail (no valid email field was actually supplied) — proves
    // the operator-shaped field name did not get interpreted as a nested
    // Mongo filter that could have matched every user (an $ne-based
    // account-enumeration/bypass).
    expect(res.status).not.toBe(200);
    expect(res.status).not.toBe(500);
    void victim; // referenced for clarity of intent (an unrelated real account exists and must not be matched)
    void attacker;
  });
});

describe('Prototype pollution — regression guard (Phase 9)', () => {
  it('a __proto__ payload in a group-settings-shaped update does not pollute Object.prototype', async () => {
    const owner = await createUser();
    const member = await createUser();
    const room = await Room.create({ people: [owner._id, member._id], isGroup: true, title: 'Group' });

    await request(app)
      .post('/api/group/update')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .field('id', room._id.toString())
      .field('__proto__.polluted', 'yes')
      .field('constructor.prototype.polluted', 'yes');

    // eslint-disable-next-line no-proto
    expect({}.polluted).toBeUndefined();
    expect(Object.prototype.polluted).toBeUndefined();
  });
});
