const request = require('supertest');
const argon2 = require('argon2');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const User = require('../src/models/User');
const Room = require('../src/models/Room');
const Media = require('../src/models/Media');

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
    level: 'standard',
    password,
  });
};

const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];

const uploadPng = async (user) => {
  const filePath = path.join(os.tmpdir(), `media-serving-test-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
  fs.writeFileSync(filePath, Buffer.from(PNG_BYTES));
  const res = await request(app)
    .post('/api/upload/media')
    .set('Authorization', `Bearer ${tokenFor(user)}`)
    .attach('file', filePath, { filename: 'photo.png', contentType: 'image/png' });
  fs.unlinkSync(filePath);
  return res.body.media;
};

describe('GET /api/media/:id — authorization', () => {
  it('a room participant can fetch media attached to a message in that room', async () => {
    const sender = await createUser();
    const recipient = await createUser();
    const room = await Room.create({ people: [sender._id, recipient._id], isGroup: false });
    const media = await uploadPng(sender);

    const sendRes = await request(app)
      .post('/api/message')
      .set('Authorization', `Bearer ${tokenFor(sender)}`)
      .field('roomID', room._id.toString())
      .field('type', 'file')
      .field('content', 'placeholder')
      .field('mediaID', media._id);
    expect(sendRes.status).toBe(200);

    const res = await request(app)
      .get(`/api/media/${media._id}`)
      .set('Authorization', `Bearer ${tokenFor(recipient)}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
  });

  it('a non-participant cannot fetch media from a room they are not in (404, not 403 — anti-enumeration)', async () => {
    const sender = await createUser();
    const recipient = await createUser();
    const stranger = await createUser();
    const room = await Room.create({ people: [sender._id, recipient._id], isGroup: false });
    const media = await uploadPng(sender);

    await request(app)
      .post('/api/message')
      .set('Authorization', `Bearer ${tokenFor(sender)}`)
      .field('roomID', room._id.toString())
      .field('type', 'file')
      .field('content', 'placeholder')
      .field('mediaID', media._id);

    const res = await request(app)
      .get(`/api/media/${media._id}`)
      .set('Authorization', `Bearer ${tokenFor(stranger)}`);

    expect(res.status).toBe(404);
  });

  it('returns 404 for media that was never attached to any message', async () => {
    const user = await createUser();
    const media = await uploadPng(user);

    const res = await request(app)
      .get(`/api/media/${media._id}`)
      .set('Authorization', `Bearer ${tokenFor(user)}`);

    expect(res.status).toBe(404);
  });

  it('returns 404 for a nonexistent media id', async () => {
    const user = await createUser();
    const fakeId = '507f1f77bcf86cd799439011';

    const res = await request(app)
      .get(`/api/media/${fakeId}`)
      .set('Authorization', `Bearer ${tokenFor(user)}`);

    expect(res.status).toBe(404);
  });

  it('returns 404 for media stuck in a non-READY status (e.g. FAILED)', async () => {
    const sender = await createUser();
    const recipient = await createUser();
    const room = await Room.create({ people: [sender._id, recipient._id], isGroup: false });
    const media = await uploadPng(sender);
    await Media.updateOne({ _id: media._id }, { $set: { status: 'FAILED' } });

    await request(app)
      .post('/api/message')
      .set('Authorization', `Bearer ${tokenFor(sender)}`)
      .field('roomID', room._id.toString())
      .field('type', 'file')
      .field('content', 'placeholder')
      .field('mediaID', media._id);

    const res = await request(app)
      .get(`/api/media/${media._id}`)
      .set('Authorization', `Bearer ${tokenFor(recipient)}`);

    expect(res.status).toBe(404);
  });

  it('sets Content-Disposition: attachment for a DOWNLOAD_ONLY category (document)', async () => {
    const sender = await createUser();
    const recipient = await createUser();
    const room = await Room.create({ people: [sender._id, recipient._id], isGroup: false });

    const filePath = path.join(os.tmpdir(), `doc-test-${Date.now()}.txt`);
    fs.writeFileSync(filePath, 'plain text document content');
    const uploadRes = await request(app)
      .post('/api/upload/media')
      .set('Authorization', `Bearer ${tokenFor(sender)}`)
      .attach('file', filePath, { filename: 'notes.txt', contentType: 'text/plain' });
    fs.unlinkSync(filePath);
    const media = uploadRes.body.media;

    await request(app)
      .post('/api/message')
      .set('Authorization', `Bearer ${tokenFor(sender)}`)
      .field('roomID', room._id.toString())
      .field('type', 'file')
      .field('content', 'placeholder')
      .field('mediaID', media._id);

    const res = await request(app)
      .get(`/api/media/${media._id}`)
      .set('Authorization', `Bearer ${tokenFor(recipient)}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/^attachment/);
  });

  it('does NOT set Content-Disposition: attachment for a SAFE_PREVIEW category (image)', async () => {
    const sender = await createUser();
    const recipient = await createUser();
    const room = await Room.create({ people: [sender._id, recipient._id], isGroup: false });
    const media = await uploadPng(sender);

    await request(app)
      .post('/api/message')
      .set('Authorization', `Bearer ${tokenFor(sender)}`)
      .field('roomID', room._id.toString())
      .field('type', 'file')
      .field('content', 'placeholder')
      .field('mediaID', media._id);

    const res = await request(app)
      .get(`/api/media/${media._id}`)
      .set('Authorization', `Bearer ${tokenFor(recipient)}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toBeUndefined();
  });

  it('rejects an unauthenticated request', async () => {
    const user = await createUser();
    const media = await uploadPng(user);

    const res = await request(app).get(`/api/media/${media._id}`);
    expect(res.status).toBe(401);
  });
});
