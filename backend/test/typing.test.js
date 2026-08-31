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

// Phase 7 audit findings fixed: (1) no membership check on roomID — any
// authenticated user could broadcast a typing event into any room they
// could guess the id of; (2) no null-check on Room.findById — a bad/
// missing roomID threw on room.people.forEach instead of a clean response.
describe('POST /api/typing', () => {
  it('a room member can broadcast typing', async () => {
    const member = await createUser();
    const other = await createUser();
    const room = await Room.create({ people: [member._id, other._id], title: 'Room', isGroup: true });

    const res = await request(app)
      .post('/api/typing')
      .set('Authorization', `Bearer ${tokenFor(member)}`)
      .send({ room: { _id: room._id.toString() }, isTyping: true });
    expect(res.status).toBe(200);
  });

  it('a non-member gets 403, not a typing broadcast into a room they are not in', async () => {
    const member = await createUser();
    const outsider = await createUser();
    const room = await Room.create({ people: [member._id], title: 'Room', isGroup: true });

    const res = await request(app)
      .post('/api/typing')
      .set('Authorization', `Bearer ${tokenFor(outsider)}`)
      .send({ room: { _id: room._id.toString() }, isTyping: true });
    expect(res.status).toBe(403);
  });

  it('a non-existent roomID gets a clean 404, not a 500/crash', async () => {
    const user = await createUser();
    const res = await request(app)
      .post('/api/typing')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ room: { _id: '507f1f77bcf86cd799439011' }, isTyping: true });
    expect(res.status).toBe(404);
  });

  it('a missing room field gets 400', async () => {
    const user = await createUser();
    const res = await request(app)
      .post('/api/typing')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ isTyping: true });
    expect(res.status).toBe(400);
  });

  it('a 1:1 DM member can broadcast typing', async () => {
    const a = await createUser();
    const b = await createUser();
    const room = await Room.create({ people: [a._id, b._id], title: 'DM', isGroup: false });

    const res = await request(app)
      .post('/api/typing')
      .set('Authorization', `Bearer ${tokenFor(a)}`)
      .send({ room: { _id: room._id.toString() }, isTyping: true });
    expect(res.status).toBe(200);
  });

  it('a non-member of a 1:1 DM gets 403', async () => {
    const a = await createUser();
    const b = await createUser();
    const outsider = await createUser();
    const room = await Room.create({ people: [a._id, b._id], title: 'DM', isGroup: false });

    const res = await request(app)
      .post('/api/typing')
      .set('Authorization', `Bearer ${tokenFor(outsider)}`)
      .send({ room: { _id: room._id.toString() }, isTyping: true });
    expect(res.status).toBe(403);
  });
});
