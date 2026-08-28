const request = require('supertest');
const argon2 = require('argon2');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const User = require('../src/models/User');
const Media = require('../src/models/Media');
const storage = require('../src/storage');

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
  jest.restoreAllMocks();
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

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const MZ_BYTES = Buffer.from([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]); // Windows PE/EXE header

// The test env has no R2_ENDPOINT/R2_ACCESS_KEY_ID (see test/helpers/app.js
// — storage.useObjectStorage is genuinely false here), which is itself the
// real, correct behavior for a local-disk-only deployment: this route must
// refuse to hand out a presigned URL that doesn't exist.
describe('POST /api/upload/media/presign — object storage not configured', () => {
  it('returns 501 rather than a broken/null upload URL', async () => {
    const user = await createUser();

    const res = await request(app)
      .post('/api/upload/media/presign')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ filename: 'photo.png', size: 1024 });

    expect(res.status).toBe(501);
    expect(res.body.error).toBe('DIRECT_UPLOAD_NOT_AVAILABLE');

    const media = await Media.findOne({ uploaderId: user._id });
    expect(media.status).toBe('FAILED');
  });
});

describe('POST /api/upload/media/presign — validation (checkable without file bytes)', () => {
  it('rejects a disallowed extension before creating anything durable', async () => {
    const user = await createUser();
    const res = await request(app)
      .post('/api/upload/media/presign')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ filename: 'virus.exe', size: 1024 });

    expect(res.status).toBe(415);
    expect(await Media.countDocuments({})).toBe(0);
  });

  it('rejects a declared size over the category limit', async () => {
    const user = await createUser();
    const res = await request(app)
      .post('/api/upload/media/presign')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ filename: 'huge.png', size: 999 * 1024 * 1024 });

    expect(res.status).toBe(413);
  });

  it('requires both filename and size', async () => {
    const user = await createUser();
    const res = await request(app)
      .post('/api/upload/media/presign')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ filename: 'photo.png' });

    expect(res.status).toBe(400);
  });
});

// Mocks storage.js's R2-backed functions to exercise the presign->complete
// flow's own logic (status transitions, post-upload validation, cleanup on
// failure) without depending on a real bucket. getPresignedUploadUrl itself
// is a thin wrapper around the AWS SDK's own getSignedUrl — the read/write/
// delete paths it composes with already existed and are exercised for real
// by upload-media.test.js/media-serving.test.js's live-storage tests.
describe('Direct-to-R2 flow (mocked storage) — presign then complete', () => {
  const fakeR2Objects = new Map();

  beforeEach(() => {
    // getPresignedUploadUrl is what upload-media-presign.js actually calls
    // to decide whether direct upload is available at all — mocking it
    // directly (rather than the module-private useObjectStorage const it
    // internally guards on, which isn't mockable from outside the module)
    // is what makes the route behave as if R2 were configured.
    jest.spyOn(storage, 'getPresignedUploadUrl').mockImplementation(async (key) => `https://fake-r2.example/${key}`);
    jest.spyOn(storage, 'putObject').mockImplementation(async (key, streamOrReadable) => {
      const chunks = [];
      for await (const chunk of streamOrReadable) chunks.push(chunk);
      fakeR2Objects.set(key, Buffer.concat(chunks));
    });
    jest.spyOn(storage, 'getObjectStream').mockImplementation(async (key) => {
      const { Readable } = require('stream');
      if (!fakeR2Objects.has(key)) throw new Error('not found');
      return Readable.from(fakeR2Objects.get(key));
    });
    jest.spyOn(storage, 'deleteObject').mockImplementation(async (key) => {
      fakeR2Objects.delete(key);
    });
  });

  afterEach(() => fakeR2Objects.clear());

  // Simulates the client's direct PUT to R2 — the test can't actually hit
  // the fake HTTPS URL, so it calls the mocked putObject directly with the
  // same bytes a real browser fetch(uploadUrl, {method:'PUT', body}) would
  // have sent.
  const simulateClientUpload = async (storageKey, bytes, contentType) => {
    const { Readable } = require('stream');
    await storage.putObject(storageKey, Readable.from(bytes), contentType);
  };

  it('presign -> client uploads real PNG bytes -> complete marks it READY', async () => {
    const user = await createUser();

    const presignRes = await request(app)
      .post('/api/upload/media/presign')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ filename: 'photo.png', size: PNG_BYTES.length });
    expect(presignRes.status).toBe(200);
    expect(presignRes.body.uploadUrl).toContain('fake-r2.example');

    await simulateClientUpload(presignRes.body.storageKey, PNG_BYTES, 'image/png');

    const completeRes = await request(app)
      .post(`/api/upload/media/${presignRes.body.mediaId}/complete`)
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({});
    expect(completeRes.status).toBe(200);
    expect(completeRes.body.media.status).toBe('READY');

    const stored = await Media.findById(presignRes.body.mediaId);
    expect(stored.status).toBe('READY');
  });

  it('deletes the R2 object and marks FAILED when the uploaded bytes don\'t match the claimed category (renamed executable)', async () => {
    const user = await createUser();

    const presignRes = await request(app)
      .post('/api/upload/media/presign')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ filename: 'photo.png', size: MZ_BYTES.length });

    // Attacker renames a .exe to .png — presign only checked the extension,
    // the real content-mismatch defense runs in /complete against the
    // actual bytes now sitting in (fake) R2.
    await simulateClientUpload(presignRes.body.storageKey, MZ_BYTES, 'image/png');

    const completeRes = await request(app)
      .post(`/api/upload/media/${presignRes.body.mediaId}/complete`)
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({});
    expect(completeRes.status).toBe(415);
    expect(completeRes.body.error).toBe('FILE_CONTENT_MISMATCH');

    const stored = await Media.findById(presignRes.body.mediaId);
    expect(stored.status).toBe('FAILED');
    expect(fakeR2Objects.has(presignRes.body.storageKey)).toBe(false);
  });

  it('rejects completing a media doc that isn\'t in UPLOADING status (already completed or belongs to someone else)', async () => {
    const user = await createUser();
    const other = await createUser();

    const presignRes = await request(app)
      .post('/api/upload/media/presign')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ filename: 'photo.png', size: PNG_BYTES.length });

    const asOtherUser = await request(app)
      .post(`/api/upload/media/${presignRes.body.mediaId}/complete`)
      .set('Authorization', `Bearer ${tokenFor(other)}`)
      .send({});
    expect(asOtherUser.status).toBe(404);
  });

  it('returns 404 for a genuinely nonexistent media id', async () => {
    const user = await createUser();
    const res = await request(app)
      .post('/api/upload/media/507f1f77bcf86cd799439011/complete')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({});
    expect(res.status).toBe(404);
  });
});
