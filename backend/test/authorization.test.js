const request = require('supertest');
const argon2 = require('argon2');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const User = require('../src/models/User');
const Room = require('../src/models/Room');
const Message = require('../src/models/Message');

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

const createUser = async (overrides = {}) => {
  const password = await argon2.hash('password123');
  return User.create({
    username: overrides.username || `user-${Math.random().toString(36).slice(2)}`,
    email: overrides.email || `${Math.random().toString(36).slice(2)}@example.com`,
    firstName: 'Test',
    lastName: 'User',
    password,
    level: overrides.level || 'standard',
  });
};

describe('IDOR regression: DELETE /api/room/remove', () => {
  it('blocks a non-member from deleting a room they do not belong to', async () => {
    const owner = await createUser();
    const attacker = await createUser();
    const room = await Room.create({ people: [owner._id], title: 'Private room', isGroup: false });

    const res = await request(app)
      .post('/api/room/remove')
      .set('Authorization', `Bearer ${tokenFor(attacker)}`)
      .field('id', room._id.toString());

    expect(res.status).toBe(403);
    const stillExists = await Room.findById(room._id);
    expect(stillExists).not.toBeNull();
  });

  it('allows a member to delete their own room', async () => {
    const owner = await createUser();
    const room = await Room.create({ people: [owner._id], title: 'My room', isGroup: false });

    const res = await request(app)
      .post('/api/room/remove')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .field('id', room._id.toString());

    expect(res.status).toBe(200);
    const stillExists = await Room.findById(room._id);
    expect(stillExists).toBeNull();
  });
});

describe('IDOR regression: POST /api/room/get', () => {
  it('blocks a non-member from reading a room they do not belong to', async () => {
    const owner = await createUser();
    const attacker = await createUser();
    const room = await Room.create({ people: [owner._id], title: 'Private room', isGroup: false });

    const res = await request(app)
      .post('/api/room/get')
      .set('Authorization', `Bearer ${tokenFor(attacker)}`)
      .field('id', room._id.toString());

    expect(res.status).toBe(403);
  });

  it('allows a member to read their own room', async () => {
    const owner = await createUser();
    const room = await Room.create({ people: [owner._id], title: 'My room', isGroup: false });

    const res = await request(app)
      .post('/api/room/get')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .field('id', room._id.toString());

    expect(res.status).toBe(200);
  });
});

describe('Spoofing regression: POST /api/message', () => {
  it('ignores a client-supplied authorID and derives the author from the authenticated session', async () => {
    const sender = await createUser();
    const victim = await createUser();
    const room = await Room.create({ people: [sender._id, victim._id], title: 'Shared room', isGroup: true });

    const res = await request(app)
      .post('/api/message')
      .set('Authorization', `Bearer ${tokenFor(sender)}`)
      .field('roomID', room._id.toString())
      .field('authorID', victim._id.toString()) // attempted spoof
      .field('content', 'hello')
      .field('type', 'text');

    expect(res.status).toBe(200);
    const saved = await Message.findOne({ room: room._id });
    expect(saved.author.toString()).toBe(sender._id.toString());
    expect(saved.author.toString()).not.toBe(victim._id.toString());
  });

  it('blocks posting a message into a room the sender is not a member of', async () => {
    const owner = await createUser();
    const attacker = await createUser();
    const room = await Room.create({ people: [owner._id], title: 'Private room', isGroup: false });

    const res = await request(app)
      .post('/api/message')
      .set('Authorization', `Bearer ${tokenFor(attacker)}`)
      .field('roomID', room._id.toString())
      .field('content', 'intrusion')
      .field('type', 'text');

    expect(res.status).toBe(403);
    const count = await Message.countDocuments({ room: room._id });
    expect(count).toBe(0);
  });
});

describe('Unauthenticated-endpoint regression', () => {
  it('rejects /api/rtc/peers without a token', async () => {
    const res = await request(app).post('/api/rtc/peers');
    expect(res.status).toBe(401);
  });

  it('rejects /api/meeting/get without a token', async () => {
    const res = await request(app).post('/api/meeting/get').field('title', 'call');
    expect(res.status).toBe(401);
  });

  it('derives caller from the authenticated session on /api/meeting/get', async () => {
    const caller = await createUser();
    const impersonated = await createUser();

    const res = await request(app)
      .post('/api/meeting/get')
      .set('Authorization', `Bearer ${tokenFor(caller)}`)
      .field('title', 'call')
      .field('callee', impersonated._id.toString());

    expect(res.status).toBe(200);
    expect(res.body.caller).toBe(caller._id.toString());
  });
});

describe('Admin-gate regression: POST /api/user/edit and /api/user/delete', () => {
  // The frontend calls these routes with a JSON body (axios default), which express-formidable
  // parses into nested req.fields objects — so requests here use .send() (JSON), not .field() (multipart),
  // to match real production traffic.
  it('blocks a standard user from editing another user (previously bypassed by a `!x === y` bug)', async () => {
    const standardUser = await createUser({ level: 'standard' });
    const victim = await createUser();

    const res = await request(app)
      .post('/api/user/edit')
      .set('Authorization', `Bearer ${tokenFor(standardUser)}`)
      .send({
        username: 'renamed',
        email: victim.email,
        firstName: 'Hacked',
        lastName: 'Account',
        user: { username: victim.username, email: victim.email },
      });

    expect(res.status).toBe(401);
    const unchanged = await User.findById(victim._id);
    expect(unchanged.firstName).not.toBe('Hacked');
  });

  it('blocks a standard user from deleting another user (previously bypassed by a `!x === y` bug)', async () => {
    const standardUser = await createUser({ level: 'standard' });
    const victim = await createUser();

    const res = await request(app)
      .post('/api/user/delete')
      .set('Authorization', `Bearer ${tokenFor(standardUser)}`)
      .send({ email: victim.email });

    expect(res.status).toBe(401);
    const stillExists = await User.findById(victim._id);
    expect(stillExists).not.toBeNull();
  });

  it('allows a root user to edit another user', async () => {
    const admin = await createUser({ level: 'root' });
    const target = await createUser();

    const res = await request(app)
      .post('/api/user/edit')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({
        username: target.username,
        email: target.email,
        firstName: 'Updated',
        lastName: target.lastName,
        user: { username: target.username, email: target.email },
      });

    expect(res.status).toBe(200);
  });
});
