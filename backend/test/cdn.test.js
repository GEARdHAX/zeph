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
const Image = require('../src/models/Image');
const cdn = require('../src/cdn');
const keys = require('../src/storageKeys');

const BASE = 'https://cdn.example.test';
const setCdn = () => {
  process.env.CDN_BASE_URL = `${BASE}/`; // trailing slash must be tolerated
  process.env.CDN_SIGNING_SECRET = 'test-signing-secret';
};
const clearCdn = () => {
  delete process.env.CDN_BASE_URL;
  delete process.env.CDN_SIGNING_SECRET;
  delete process.env.CDN_PRIVATE_URL_TTL;
};

describe('cdn.js — signing', () => {
  beforeEach(setCdn);
  afterEach(clearCdn);

  it('is off unless both the base URL and the secret are set', () => {
    delete process.env.CDN_SIGNING_SECRET;
    expect(cdn.isEnabled()).toBe(false);
    expect(cdn.createPublicUrl('public/users/u/avatar/a.jpg')).toBeNull();
    setCdn();
    delete process.env.CDN_BASE_URL;
    expect(cdn.isEnabled()).toBe(false);
  });

  it('public URLs are deterministic (so they cache), unexpiring, and only for public/ keys', () => {
    const key = 'public/users/u1/avatar/abc-256.jpg';
    const a = cdn.createPublicUrl(key);
    expect(a).toBe(cdn.createPublicUrl(key));
    expect(a.startsWith(`${BASE}/o/public/users/u1/avatar/abc-256.jpg?exp=0&sig=`)).toBe(true);
    expect(cdn.createPublicUrl('private/users/u1/attachments/x.png')).toBeNull();
    expect(cdn.createPublicUrl('u1/legacy-key.jpg')).toBeNull();
  });

  it('private URLs expire, only cover private/ keys, and bind filename, disposition and type', () => {
    const key = 'private/users/u1/attachments/11111111-1111-1111-1111-111111111111.pdf';
    const before = Date.now();
    const signed = cdn.createSignedDownloadUrl(key, { filename: 'a b.pdf', attachment: true, contentType: 'application/pdf' });
    const url = new URL(signed.url);
    expect(url.searchParams.get('d')).toBe('attachment');
    expect(url.searchParams.get('n')).toBe('a b.pdf');
    expect(url.searchParams.get('ct')).toBe('application/pdf');
    expect(Number(url.searchParams.get('exp')) * 1000).toBe(signed.expiresAt);
    expect(signed.expiresAt).toBeGreaterThan(before + 3500 * 1000); // default 1h
    expect(signed.expiresAt).toBeLessThanOrEqual(Date.now() + 3600 * 1000);

    expect(cdn.createSignedDownloadUrl('public/users/u1/avatar/a.jpg')).toBeNull();
    expect(cdn.createSignedDownloadUrl('u1/legacy.png')).toBeNull();

    // Each signed field changes the signature, so none can be edited in the URL.
    const base = { key, exp: 100, disposition: 'attachment', name: 'a.pdf', contentType: 'application/pdf' };
    const sig = cdn.sign(base);
    ['key', 'exp', 'disposition', 'name', 'contentType'].forEach((field) => {
      expect(cdn.sign({ ...base, [field]: `${base[field]}x` })).not.toBe(sig);
    });
  });

  it('honours and clamps CDN_PRIVATE_URL_TTL', () => {
    const key = 'private/users/u1/attachments/x.png';
    process.env.CDN_PRIVATE_URL_TTL = '300';
    expect(cdn.createSignedDownloadUrl(key).expiresAt - Date.now()).toBeLessThanOrEqual(300 * 1000);
    process.env.CDN_PRIVATE_URL_TTL = '5'; // too small -> clamped to 60s, never an instantly-dead URL
    expect(cdn.createSignedDownloadUrl(key).expiresAt - Date.now()).toBeGreaterThan(50 * 1000);
  });
});

describe('storageKeys', () => {
  it('builds prefixed keys that never contain the original filename', () => {
    expect(keys.avatarKey('u1', 'shield')).toBe('public/users/u1/avatar/shield.jpg');
    const a = keys.attachmentKey('u1', '.png');
    expect(a).toMatch(/^private\/users\/u1\/attachments\/[0-9a-f-]{36}\.png$/);
    expect(keys.attachmentKey('u1', '.png')).not.toBe(a);
    expect(keys.isPublicKey(a)).toBe(false);
    expect(keys.isPrivateKey(a)).toBe(true);
  });
});

describe('CDN routes', () => {
  let app;

  beforeAll(async () => {
    await db.connect();
    app = buildApp();
  });
  afterAll(async () => {
    await db.closeDatabase();
  });
  beforeEach(setCdn);
  afterEach(async () => {
    clearCdn();
    await db.clearDatabase();
  });

  const createUser = async () =>
    User.create({
      username: `user-${Math.random().toString(36).slice(2)}`,
      email: `${Math.random().toString(36).slice(2)}@example.com`,
      firstName: 'Test',
      lastName: 'User',
      level: 'standard',
      password: await argon2.hash('password123'),
    });

  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

  // Uploads through the real proxy route (local-disk storage in tests) and sends it in a room.
  const mediaInRoom = async (sender, recipient) => {
    const room = await Room.create({ people: [sender._id, recipient._id], isGroup: false });
    const file = path.join(os.tmpdir(), `cdn-test-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
    fs.writeFileSync(file, PNG);
    const up = await request(app)
      .post('/api/upload/media')
      .set('Authorization', `Bearer ${tokenFor(sender)}`)
      .attach('file', file, { filename: 'photo.png', contentType: 'image/png' });
    fs.unlinkSync(file);
    const media = up.body.media;
    await request(app)
      .post('/api/message')
      .set('Authorization', `Bearer ${tokenFor(sender)}`)
      .field('roomID', room._id.toString())
      .field('type', 'file')
      .field('content', 'placeholder')
      .field('mediaID', media._id);
    return media;
  };

  it('new uploads get a private/ attachment key', async () => {
    const sender = await createUser();
    const media = await mediaInRoom(sender, await createUser());
    expect(media.storageKey).toMatch(/^private\/users\/[a-f0-9]{24}\/attachments\/[0-9a-f-]{36}\.png$/);
  });

  describe('GET /api/media/:id/url', () => {
    it('gives a room member a short-lived signed CDN URL and forbids caching it', async () => {
      const sender = await createUser();
      const recipient = await createUser();
      const media = await mediaInRoom(sender, recipient);

      const res = await request(app).get(`/api/media/${media._id}/url`).set('Authorization', `Bearer ${tokenFor(recipient)}`);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.body.url.startsWith(`${BASE}/o/private/users/`)).toBe(true);
      expect(res.body.url).toContain('ct=image%2Fpng');
      expect(res.body.expiresAt).toBeGreaterThan(Date.now());
      // never leaks the secret or the storage layer
      expect(res.text).not.toContain('test-signing-secret');
      expect(res.text).not.toContain('r2.cloudflarestorage');
    });

    it('404s a non-member (anti-enumeration), and 401s an unauthenticated caller', async () => {
      const sender = await createUser();
      const media = await mediaInRoom(sender, await createUser());
      const stranger = await createUser();

      const denied = await request(app).get(`/api/media/${media._id}/url`).set('Authorization', `Bearer ${tokenFor(stranger)}`);
      expect(denied.status).toBe(404);
      expect(denied.body.url).toBeUndefined();

      expect((await request(app).get(`/api/media/${media._id}/url`)).status).toBe(401);
    });

    it('reports CDN_NOT_ENABLED when the CDN is off, so the client keeps streaming', async () => {
      const sender = await createUser();
      const recipient = await createUser();
      const media = await mediaInRoom(sender, recipient);
      clearCdn();
      const res = await request(app).get(`/api/media/${media._id}/url`).set('Authorization', `Bearer ${tokenFor(recipient)}`);
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('CDN_NOT_ENABLED');
    });

    it('reports CDN_NOT_AVAILABLE for an object stored under an old (unprefixed) key', async () => {
      const sender = await createUser();
      const recipient = await createUser();
      const media = await mediaInRoom(sender, recipient);
      await Media.updateOne({ _id: media._id }, { storageKey: `${sender._id}/legacy-key.png` });
      const res = await request(app).get(`/api/media/${media._id}/url`).set('Authorization', `Bearer ${tokenFor(recipient)}`);
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('CDN_NOT_AVAILABLE');
    });

    it('signs the thumbnail separately and 404s when there is none', async () => {
      const sender = await createUser();
      const recipient = await createUser();
      const media = await mediaInRoom(sender, recipient);
      const withThumb = await request(app)
        .get(`/api/media/${media._id}/thumbnail/url`)
        .set('Authorization', `Bearer ${tokenFor(recipient)}`);
      if (media.thumbnailKey) {
        expect(withThumb.status).toBe(200);
        expect(withThumb.body.url).toContain('-thumb.jpg');
      }
      await Media.updateOne({ _id: media._id }, { thumbnailKey: null });
      const none = await request(app).get(`/api/media/${media._id}/thumbnail/url`).set('Authorization', `Bearer ${tokenFor(recipient)}`);
      expect(none.status).toBe(404);
    });
  });

  describe('GET /api/images/:id/:size', () => {
    const image = (storageKey) =>
      Image.create({ name: 'a.jpg', author: new (require('mongoose').Types.ObjectId)(), size: 1, shield: 's', shieldedID: 'shield123', storageKey });

    it('redirects a public/ image to the CDN with an immutable-friendly redirect', async () => {
      await image('public/users/u1/avatar/shield123.jpg');
      const res = await request(app).get('/api/images/shield123/256').redirects(0);
      expect(res.status).toBe(302);
      expect(res.headers.location.startsWith(`${BASE}/o/public/users/u1/avatar/shield123-256.jpg?exp=0&sig=`)).toBe(true);
      expect(res.headers['cache-control']).toBe('public, max-age=3600');
    });

    it('keeps streaming an old-key image through Node (no redirect)', async () => {
      await image('u1/oldshield.jpg');
      const res = await request(app).get('/api/images/shield123/256').redirects(0);
      expect(res.status).not.toBe(302);
    });

    it('keeps streaming when the CDN is off', async () => {
      await image('public/users/u1/avatar/shield123.jpg');
      clearCdn();
      const res = await request(app).get('/api/images/shield123/256').redirects(0);
      expect(res.status).not.toBe(302);
    });
  });

  it('GET /api/info reports cdnEnabled', async () => {
    expect((await request(app).get('/api/info')).body.cdnEnabled).toBe(true);
    clearCdn();
    expect((await request(app).get('/api/info')).body.cdnEnabled).toBe(false);
  });
});
