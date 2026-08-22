const request = require('supertest');
const argon2 = require('argon2');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const User = require('../src/models/User');
const Session = require('../src/models/Session');
const Room = require('../src/models/Room');
const ConversationUserState = require('../src/models/ConversationUserState');

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
  const password = await argon2.hash(overrides.password || 'password123');
  return User.create({
    username: overrides.username || `user-${Math.random().toString(36).slice(2)}`,
    email: overrides.email || `${Math.random().toString(36).slice(2)}@example.com`,
    firstName: 'Test',
    lastName: 'User',
    level: 'standard',
    password,
  });
};

describe('POST /api/users/change-username', () => {
  it('changes the caller\'s own username', async () => {
    const user = await createUser();
    const res = await request(app).post('/api/users/change-username')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ username: 'brandnewhandle' });

    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('brandnewhandle');
    const updated = await User.findById(user._id);
    expect(updated.usernameNormalized).toBe('brandnewhandle');
  });

  it('rejects an invalid format (too short, bad characters)', async () => {
    const user = await createUser();
    const shortRes = await request(app).post('/api/users/change-username')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ username: 'ab' });
    expect(shortRes.status).toBe(400);

    const badCharsRes = await request(app).post('/api/users/change-username')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ username: 'bad name!' });
    expect(badCharsRes.status).toBe(400);
  });

  it('rejects a username already taken by someone else', async () => {
    const user = await createUser();
    const other = await createUser({ username: 'existinghandle' });

    const res = await request(app).post('/api/users/change-username')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ username: 'existinghandle' });

    expect(res.status).toBe(409);
    expect(res.body.reason).toBe('username_taken');
  });

  it('allows re-submitting your own current username unchanged (idempotent)', async () => {
    const user = await createUser({ username: 'mycurrenthandle' });
    const res = await request(app).post('/api/users/change-username')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ username: 'mycurrenthandle' });
    expect(res.status).toBe(200);
  });
});

describe('POST /api/users/update-bio', () => {
  it('stores the raw bio string exactly as submitted, using the app\'s own **bold**/@mention syntax', async () => {
    const user = await createUser();
    const res = await request(app).post('/api/users/update-bio')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ bio: '**Hello** *world* @alice #tag [site](https://example.com)' });

    expect(res.status).toBe(200);
    expect(res.body.user.bio).toBe('**Hello** *world* @alice #tag [site](https://example.com)');
  });

  it('stores a literal HTML tag as inert plain text — there is no HTML sanitization step because bio is never rendered as HTML', async () => {
    const user = await createUser();
    const res = await request(app).post('/api/users/update-bio')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ bio: '<script>alert(1)</script>Hi there' });

    expect(res.status).toBe(200);
    // Stored byte-for-byte, unmodified — the safety property lives entirely
    // in the frontend renderer (parseBio.js + BioText.jsx) never using
    // dangerouslySetInnerHTML, not in stripping/escaping at write time.
    expect(res.body.user.bio).toBe('<script>alert(1)</script>Hi there');
  });

  it('rejects a bio over the word limit', async () => {
    const user = await createUser();
    const longBio = new Array(151).fill('word').join(' ');
    const res = await request(app).post('/api/users/update-bio')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ bio: longBio });

    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('bio_too_long');
  });

  it('allows a bio right at the word limit', async () => {
    const user = await createUser();
    const bio = new Array(150).fill('word').join(' ');
    const res = await request(app).post('/api/users/update-bio')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ bio });

    expect(res.status).toBe(200);
  });

  it('rejects a bio over the character limit even if under the word limit (e.g. one very long word)', async () => {
    const user = await createUser();
    const res = await request(app).post('/api/users/update-bio')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ bio: 'a'.repeat(1001) });

    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('bio_too_long');
  });

  it('allows a bio right at the character limit', async () => {
    const user = await createUser();
    const res = await request(app).post('/api/users/update-bio')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ bio: 'a'.repeat(1000) });

    expect(res.status).toBe(200);
  });
});

describe('POST /api/users/delete-account', () => {
  it('requires the correct password', async () => {
    const user = await createUser({ password: 'correctpassword' });
    const res = await request(app).post('/api/users/delete-account')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ password: 'wrongpassword' });

    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('incorrect_password');
    expect(await User.findById(user._id)).not.toBeNull();
  });

  it('rejects with no password provided', async () => {
    const user = await createUser();
    const res = await request(app).post('/api/users/delete-account')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('deletes the account and cleans up conversations/sessions on correct password', async () => {
    const user = await createUser({ password: 'correctpassword' });
    const other = await createUser();
    const room = await Room.create({ people: [user._id, other._id], isGroup: false });
    const { token, session } = await require('./helpers/app').tokenForDevice(user);

    const res = await request(app).post('/api/users/delete-account')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'correctpassword' });

    expect(res.status).toBe(200);
    expect(await User.findById(user._id)).toBeNull();

    const revokedSession = await Session.findById(session._id);
    expect(revokedSession.revokedAt).not.toBeNull();

    const state = await ConversationUserState.findOne({ conversation: room._id, user: other._id });
    expect(state.deletedAt).not.toBeNull();
  });
});
