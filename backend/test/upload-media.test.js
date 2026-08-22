const request = require('supertest');
const argon2 = require('argon2');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const User = require('../src/models/User');
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

const tmpFile = (bytes, ext) => {
  const filePath = path.join(os.tmpdir(), `upload-media-test-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  fs.writeFileSync(filePath, Buffer.from(bytes));
  return filePath;
};

const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];
const PDF_BYTES = Buffer.from('%PDF-1.4\n%fake pdf content for testing\n');
const MZ_BYTES = [0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]; // Windows PE/EXE header

describe('POST /api/upload/media — accepted categories', () => {
  it('accepts a real PNG and creates a READY Media doc with the image category', async () => {
    const user = await createUser();
    const filePath = tmpFile(PNG_BYTES, '.png');

    const res = await request(app)
      .post('/api/upload/media')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .attach('file', filePath, { filename: 'photo.png', contentType: 'image/png' });

    fs.unlinkSync(filePath);

    expect(res.status).toBe(200);
    expect(res.body.media.category).toBe('image');
    expect(res.body.media.status).toBe('READY');
    expect(res.body.media.storageKey).toBeTruthy();

    const stored = await Media.findById(res.body.media._id);
    expect(stored.status).toBe('READY');
    expect(stored.uploaderId.toString()).toBe(user._id.toString());
  });

  it('accepts a real PDF and creates a READY Media doc with the pdf category', async () => {
    const user = await createUser();
    const filePath = path.join(os.tmpdir(), `test-${Date.now()}.pdf`);
    fs.writeFileSync(filePath, PDF_BYTES);

    const res = await request(app)
      .post('/api/upload/media')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .attach('file', filePath, { filename: 'document.pdf', contentType: 'application/pdf' });

    fs.unlinkSync(filePath);

    expect(res.status).toBe(200);
    expect(res.body.media.category).toBe('pdf');
  });

  it('accepts a plain-text document with no magic number', async () => {
    const user = await createUser();
    const filePath = path.join(os.tmpdir(), `test-${Date.now()}.txt`);
    fs.writeFileSync(filePath, 'Just plain text content, nothing special.');

    const res = await request(app)
      .post('/api/upload/media')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .attach('file', filePath, { filename: 'notes.txt', contentType: 'text/plain' });

    fs.unlinkSync(filePath);

    expect(res.status).toBe(200);
    expect(res.body.media.category).toBe('document');
  });

  it('sanitizes the original filename (strips path separators/control characters)', async () => {
    const user = await createUser();
    const filePath = tmpFile(PNG_BYTES, '.png');

    const res = await request(app)
      .post('/api/upload/media')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .attach('file', filePath, { filename: '../../etc/passwd.png', contentType: 'image/png' });

    fs.unlinkSync(filePath);

    expect(res.status).toBe(200);
    expect(res.body.media.originalName).not.toContain('/');
    expect(res.body.media.originalName).not.toContain('\\');
  });
});

describe('POST /api/upload/media — rejections', () => {
  it('rejects a blocked extension (.exe) outright', async () => {
    const user = await createUser();
    const filePath = tmpFile(MZ_BYTES, '.exe');

    const res = await request(app)
      .post('/api/upload/media')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .attach('file', filePath, { filename: 'virus.exe', contentType: 'application/octet-stream' });

    fs.unlinkSync(filePath);

    expect(res.status).toBe(415);
    expect(res.body.error).toBe('FILE_TYPE_NOT_ALLOWED');
  });

  it('rejects a renamed executable disguised with an allowed extension (content-sniffing defense)', async () => {
    const user = await createUser();
    const filePath = tmpFile(MZ_BYTES, '.png');

    const res = await request(app)
      .post('/api/upload/media')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .attach('file', filePath, { filename: 'totally-a-photo.png', contentType: 'image/png' });

    fs.unlinkSync(filePath);

    expect(res.status).toBe(415);
    expect(res.body.error).toBe('FILE_CONTENT_MISMATCH');

    const count = await Media.countDocuments();
    expect(count).toBe(0);
  });

  it('rejects a file whose header does not match its claimed category (PNG claiming to be a video)', async () => {
    const user = await createUser();
    const filePath = tmpFile(PNG_BYTES, '.mp4');

    const res = await request(app)
      .post('/api/upload/media')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .attach('file', filePath, { filename: 'clip.mp4', contentType: 'video/mp4' });

    fs.unlinkSync(filePath);

    expect(res.status).toBe(415);
    expect(res.body.error).toBe('FILE_CONTENT_MISMATCH');
  });

  it('rejects an oversized file for its category (over the image 10MB limit)', async () => {
    const user = await createUser();
    const filePath = path.join(os.tmpdir(), `big-${Date.now()}.png`);
    const bigBuffer = Buffer.concat([Buffer.from(PNG_BYTES), Buffer.alloc(11 * 1024 * 1024)]);
    fs.writeFileSync(filePath, bigBuffer);

    const res = await request(app)
      .post('/api/upload/media')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .attach('file', filePath, { filename: 'huge.png', contentType: 'image/png' });

    fs.unlinkSync(filePath);

    expect(res.status).toBe(413);
    expect(res.body.error).toBe('FILE_TOO_LARGE');
  });

  it('rejects an unrecognized/unsupported extension', async () => {
    const user = await createUser();
    const filePath = tmpFile([1, 2, 3, 4], '.xyz123');

    const res = await request(app)
      .post('/api/upload/media')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .attach('file', filePath, { filename: 'mystery.xyz123', contentType: 'application/octet-stream' });

    fs.unlinkSync(filePath);

    expect(res.status).toBe(415);
  });

  it('rejects an unauthenticated request', async () => {
    const filePath = tmpFile(PNG_BYTES, '.png');
    const res = await request(app)
      .post('/api/upload/media')
      .attach('file', filePath, { filename: 'photo.png', contentType: 'image/png' });
    fs.unlinkSync(filePath);
    expect(res.status).toBe(401);
  });

  it('rejects when no file is provided', async () => {
    const user = await createUser();
    const res = await request(app)
      .post('/api/upload/media')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .field('note', 'no file attached');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('FILE_REQUIRED');
  });
});
