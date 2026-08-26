const request = require('supertest');
const argon2 = require('argon2');
const path = require('path');
const fs = require('fs');
const os = require('os');
const sharp = require('sharp');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const User = require('../src/models/User');
const Image = require('../src/models/Image');

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

// upload.js/upload-file.js were migrated onto storage.js (matching
// upload-media.js) so avatars/legacy files work on a host with an
// ephemeral filesystem (e.g. Render) — previously they only ever wrote to
// local disk directly, which silently vanished on every restart/redeploy
// there despite working fine in local dev (persistent disk). See
// DECISIONS.md, Image.js's storageKey comment.
const realJpegFixture = async () => {
  const buffer = await sharp({
    create: {
      width: 8, height: 8, channels: 3, background: { r: 200, g: 50, b: 50 },
    },
  }).jpeg().toBuffer();
  const filePath = path.join(os.tmpdir(), `avatar-test-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`);
  fs.writeFileSync(filePath, buffer);
  return filePath;
};

describe('POST /api/upload — avatar image goes through storage.js', () => {
  it('persists storageKey (not a raw local path) and the image is servable via /api/images/:id', async () => {
    const user = await createUser();
    const filePath = await realJpegFixture();

    const uploadRes = await request(app)
      .post('/api/upload')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .attach('image', filePath, { filename: 'avatar.jpg', contentType: 'image/jpeg' });
    fs.unlinkSync(filePath);

    expect(uploadRes.status).toBe(200);
    expect(uploadRes.body.image.storageKey).toBeTruthy();

    const stored = await Image.findById(uploadRes.body.image._id);
    expect(stored.storageKey).toMatch(new RegExp(`^${user._id}/`));

    const serveRes = await request(app).get(`/api/images/${stored.shieldedID}`);
    expect(serveRes.status).toBe(200);
    expect(serveRes.headers['content-type']).toBe('image/jpeg');
  });

  it('also serves a resized variant (e.g. 256px) via storage.js', async () => {
    const user = await createUser();
    const filePath = await realJpegFixture();

    const uploadRes = await request(app)
      .post('/api/upload')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .attach('image', filePath, { filename: 'avatar.jpg', contentType: 'image/jpeg' });
    fs.unlinkSync(filePath);

    const { shieldedID } = uploadRes.body.image;
    const serveRes = await request(app).get(`/api/images/${shieldedID}/256`);
    expect(serveRes.status).toBe(200);
  });

  it('a legacy row (location only, no storageKey) still serves via direct fs read', async () => {
    const user = await createUser();
    const tmpDir = path.join(os.tmpdir(), `legacy-avatar-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const legacyPath = path.join(tmpDir, 'legacy.jpg');
    const buffer = await sharp({
      create: {
        width: 4, height: 4, channels: 3, background: { r: 10, g: 10, b: 10 },
      },
    }).jpeg().toBuffer();
    fs.writeFileSync(legacyPath, buffer);

    const legacyImage = await Image.create({
      shield: 'legacyshield', name: 'legacy.jpg', location: legacyPath, author: user._id, size: buffer.length, shieldedID: 'legacyshieldedid123',
    });

    const serveRes = await request(app).get(`/api/images/${legacyImage.shieldedID}`);
    expect(serveRes.status).toBe(200);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
