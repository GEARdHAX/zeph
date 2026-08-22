const request = require('supertest');
const argon2 = require('argon2');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const User = require('../src/models/User');
const File = require('../src/models/File');

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

// Regression coverage for a real bug: upload-file.js set `file: file.type`
// on a schema field actually named `type` (see models/File.js), so Mongoose
// silently dropped it — every uploaded file's mimetype was never persisted.
// The media viewer needs this to route file messages to the right
// video/audio/PDF/file sub-viewer, so this must actually be saved now.
describe('POST /api/upload/file — mimetype persistence', () => {
  it('persists the uploaded file\'s mimetype onto File.type', async () => {
    const user = await createUser();
    const tmpPath = path.join(os.tmpdir(), `test-upload-${Date.now()}.pdf`);
    fs.writeFileSync(tmpPath, 'fake pdf content');

    const res = await request(app)
      .post('/api/upload/file')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .attach('file', tmpPath, { filename: 'document.pdf', contentType: 'application/pdf' });

    fs.unlinkSync(tmpPath);

    expect(res.status).toBe(200);
    expect(res.body.file.type).toBe('application/pdf');

    const stored = await File.findById(res.body.file._id);
    expect(stored.type).toBe('application/pdf');
  });
});
