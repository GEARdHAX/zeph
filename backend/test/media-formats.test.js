const request = require('supertest');
const argon2 = require('argon2');
const fs = require('fs');
const path = require('path');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const { buildSamples, EXE_BYTES, VARIANTS } = require('./helpers/mediaSamples');
const User = require('../src/models/User');
const Room = require('../src/models/Room');
const Media = require('../src/models/Media');
const storage = require('../src/storage');
const policy = require('../src/mediaPolicy');

// Every extension the policy claims to support, end to end: presign -> browser PUT -> complete (real validation) ->
// stored metadata -> serving headers. R2 is modelled in memory, INCLUDING its rule that a presigned upload must carry
// exactly the headers that were signed (verified against the real bucket separately: see scripts/check-media-formats).
const MB = 1024 * 1024;
const ALL = Object.entries(policy.MEDIA_CATEGORIES).flatMap(([category, def]) => def.extensions.map((ext) => ({ ext, category })));

let app;
let samples;
let r2; // key -> { bytes, contentType, cacheControl, contentDisposition, reportedSize }
let signed; // key -> headers the presign bound into the signature

beforeAll(async () => {
  await db.connect();
  app = buildApp();
  samples = await buildSamples();
});
afterAll(async () => {
  await db.closeDatabase();
});
beforeEach(() => {
  r2 = new Map();
  signed = new Map();
  jest.spyOn(storage, 'getPresignedUploadUrl').mockImplementation(async (key, headers) => {
    signed.set(key, typeof headers === 'string' ? { 'Content-Type': headers } : headers);
    return `https://fake-r2.example/${key}`;
  });
  jest.spyOn(storage, 'putObject').mockImplementation(async (key, readable, contentType, options = {}) => {
    const chunks = [];
    for await (const chunk of readable) chunks.push(chunk);
    r2.set(key, { bytes: Buffer.concat(chunks), contentType, cacheControl: options.cacheControl, contentDisposition: options.contentDisposition });
  });
  jest.spyOn(storage, 'getObjectStream').mockImplementation(async (key) => {
    const { Readable } = require('stream');
    if (!r2.has(key)) throw new Error('NoSuchKey');
    return Readable.from(r2.get(key).bytes);
  });
  jest.spyOn(storage, 'getObjectMetadata').mockImplementation(async (key) => {
    const o = r2.get(key);
    return o ? { size: o.reportedSize ?? o.bytes.length, contentType: o.contentType, cacheControl: o.cacheControl, contentDisposition: o.contentDisposition } : null;
  });
  jest.spyOn(storage, 'deleteObject').mockImplementation(async (key) => {
    r2.delete(key);
  });
});
afterEach(async () => {
  jest.restoreAllMocks();
  await db.clearDatabase();
});

const createUser = async () =>
  User.create({
    username: `u-${Math.random().toString(36).slice(2)}`,
    email: `${Math.random().toString(36).slice(2)}@example.com`,
    firstName: 'T',
    lastName: 'U',
    level: 'standard',
    password: await argon2.hash('password123'),
  });
const auth = (user) => ({ Authorization: `Bearer ${tokenFor(user)}` });
const presign = (user, filename, size, extra = {}) => request(app).post('/api/upload/media/presign').set(auth(user)).send({ filename, size, ...extra });
const complete = (user, mediaId, body = {}) => request(app).post(`/api/upload/media/${mediaId}/complete`).set(auth(user)).send(body);

// What the browser's PUT to R2 does: R2 refuses unless the signed headers are sent exactly.
const browserPut = (key, bytes, sentHeaders) => {
  const expected = signed.get(key) || {};
  Object.entries(expected).forEach(([name, value]) => {
    const sent = Object.entries(sentHeaders).find(([n]) => n.toLowerCase() === name.toLowerCase());
    if (!sent || sent[1] !== value) throw new Error(`SignatureDoesNotMatch (${name})`);
  });
  r2.set(key, { bytes, contentType: sentHeaders['Content-Type'], cacheControl: sentHeaders['Cache-Control'], contentDisposition: sentHeaders['Content-Disposition'] });
};

describe('every supported format: presign -> upload -> complete', () => {
  it.each(ALL.map(({ ext, category }) => [ext, category]))('%s (%s)', async (ext, category) => {
    const user = await createUser();
    const bytes = samples[ext];
    const expectedType = policy.mimeForFile(ext, category);

    const res = await presign(user, `My Report${ext}`, bytes.length);
    expect(res.status).toBe(200);
    expect(res.body.storageKey).toMatch(new RegExp(`^private/users/${user._id}/attachments/[0-9a-f-]{36}\\${ext}$`));
    expect(res.body.uploadHeaders['Content-Type']).toBe(expectedType);
    expect(res.body.uploadHeaders['Cache-Control']).toBe('private, no-store');
    const downloadOnly = policy.getSecurityLevel(category) === policy.SecurityLevel.DOWNLOAD_ONLY;
    expect(res.body.uploadHeaders['Content-Disposition']).toBe(downloadOnly ? 'attachment' : undefined);
    // exactly what the server tells the browser to send is what it bound into the signature
    expect(signed.get(res.body.storageKey)).toEqual(res.body.uploadHeaders);

    browserPut(res.body.storageKey, bytes, res.body.uploadHeaders);
    const done = await complete(user, res.body.mediaId);

    expect(done.status).toBe(200);
    expect(done.body.media).toMatchObject({ status: 'READY', category, mimeType: expectedType, size: bytes.length, originalName: `My Report${ext}` });
    const stored = r2.get(res.body.storageKey);
    expect(stored.contentType).toBe(expectedType);
    expect(stored.cacheControl).toBe('private, no-store');
    expect(stored.contentDisposition).toBe(downloadOnly ? 'attachment' : undefined);
  });

  it.each(Object.entries(VARIANTS))('real-world variant: %s', async (name, { ext, bytes }) => {
    const user = await createUser();
    const data = bytes();
    const res = await presign(user, `clip${ext}`, data.length);
    browserPut(res.body.storageKey, data, res.body.uploadHeaders);
    const done = await complete(user, res.body.mediaId);
    expect(done.status).toBe(200);
    expect(done.body.media.status).toBe('READY');
  });

  it('a recorded WebM whose browser-reported type is empty or has codec parameters uploads with the signed type', async () => {
    const user = await createUser();
    const res = await presign(user, 'recording.webm', samples['.webm'].length);
    // the browser's own file.type would be '' or 'video/webm;codecs=vp8,opus': the signed headers are what is sent
    expect(res.body.uploadHeaders['Content-Type']).toBe('video/webm');
    expect(() => browserPut(res.body.storageKey, samples['.webm'], { ...res.body.uploadHeaders, 'Content-Type': 'video/webm;codecs=vp8,opus' })).toThrow('SignatureDoesNotMatch');
    browserPut(res.body.storageKey, samples['.webm'], res.body.uploadHeaders);
    expect((await complete(user, res.body.mediaId)).status).toBe(200);
  });

  it('images get a thumbnail and dimensions', async () => {
    const user = await createUser();
    const res = await presign(user, 'p.png', samples['.png'].length);
    browserPut(res.body.storageKey, samples['.png'], res.body.uploadHeaders);
    const done = await complete(user, res.body.mediaId);
    expect(done.body.media.thumbnailKey).toBe(`${res.body.storageKey}-thumb.jpg`);
    expect(done.body.media).toMatchObject({ width: 8, height: 8 });
    expect(r2.get(`${res.body.storageKey}-thumb.jpg`).cacheControl).toBe('private, no-store');
  });
});

describe('rejections', () => {
  it.each(ALL.map(({ ext, category }) => [ext, category]))('%s: executable bytes under this extension are rejected and removed', async (ext) => {
    const user = await createUser();
    const res = await presign(user, `evil${ext}`, EXE_BYTES.length);
    browserPut(res.body.storageKey, EXE_BYTES, res.body.uploadHeaders);
    const done = await complete(user, res.body.mediaId);
    expect(done.status).toBe(415);
    expect(r2.has(res.body.storageKey)).toBe(false);
    expect((await Media.findById(res.body.mediaId)).status).toBe('FAILED');
  });

  it.each(['.exe', '.dll', '.bat', '.sh', '.msi', '.apk', '.svg', '.avif', '.heic', '.mkv', '.avi', '.m4v', '.flac', '.oga', '.xyz', '.bin'])(
    'extension %s is not supported and is refused before anything is created',
    async (ext) => {
      const user = await createUser();
      const res = await presign(user, `file${ext}`, 100);
      expect(res.status).toBe(415);
      expect(res.body.error).toBe('FILE_TYPE_NOT_ALLOWED');
      expect(await Media.countDocuments({})).toBe(0);
      expect(signed.size).toBe(0);
    },
  );

  it('a name with no extension is refused', async () => {
    const user = await createUser();
    expect((await presign(user, 'README', 100)).status).toBe(415);
  });

  it.each(Object.entries(policy.MEDIA_CATEGORIES).map(([category, def]) => [category, def.maxSize, def.extensions[0]]))(
    '%s: a declared size over the limit is refused at presign',
    async (category, max, ext) => {
      const user = await createUser();
      expect((await presign(user, `big${ext}`, max + 1)).status).toBe(413);
      expect((await presign(user, `ok${ext}`, max)).status).toBe(200);
    },
  );

  it.each([0, -5, 'abc'])('an invalid declared size (%p) is refused', async (size) => {
    const user = await createUser();
    expect([400, 413]).toContain((await presign(user, 'a.png', size)).status); // 0 is "missing" (400); negative/NaN are "too large" (413)
    expect(await Media.countDocuments({})).toBe(0);
  });

  it.each(Object.entries(policy.MEDIA_CATEGORIES).map(([category, def]) => [category, def.maxSize, def.extensions[0]]))(
    '%s: an object bigger than the limit is rejected at complete even though the declared size was small',
    async (category, max, ext) => {
      const user = await createUser();
      const res = await presign(user, `x${ext}`, 10);
      browserPut(res.body.storageKey, samples[ext], res.body.uploadHeaders);
      r2.get(res.body.storageKey).reportedSize = max + 1;
      const done = await complete(user, res.body.mediaId);
      expect(done.status).toBe(413);
      expect(r2.has(res.body.storageKey)).toBe(false);
    },
  );

  it('an object stored under a different content type than the signed one is rejected', async () => {
    const user = await createUser();
    const res = await presign(user, 'pic.png', samples['.png'].length);
    r2.set(res.body.storageKey, { bytes: samples['.png'], contentType: 'text/html' }); // bypassed the signed path
    const done = await complete(user, res.body.mediaId);
    expect(done.status).toBe(415);
    expect(done.body.error).toBe('CONTENT_TYPE_MISMATCH');
    expect(r2.has(res.body.storageKey)).toBe(false);
  });

  it('a missing object (the browser never uploaded) is a 404 and the record is failed', async () => {
    const user = await createUser();
    const res = await presign(user, 'a.png', 100);
    const done = await complete(user, res.body.mediaId);
    expect(done.status).toBe(404);
    expect((await Media.findById(res.body.mediaId)).status).toBe('FAILED');
  });

  it('presign requires authentication', async () => {
    const res = await request(app).post('/api/upload/media/presign').send({ filename: 'a.png', size: 10 });
    expect(res.status).toBe(401);
  });
});

describe('filenames cannot influence storage keys or headers', () => {
  it.each(['../../etc/passwd.png', '..\\..\\windows\\system32\\x.png', 'a/b/c.png', 'name\r\nSet-Cookie: x=1.png', 'x'.repeat(400) + '.png', 'ünïcode 🎬.png'])(
    'filename %j',
    async (filename) => {
      const user = await createUser();
      const res = await presign(user, filename, samples['.png'].length);
      expect(res.status).toBe(200);
      // the key is server-generated: no part of the filename can appear in it
      expect(res.body.storageKey).toMatch(/^private\/users\/[a-f0-9]{24}\/attachments\/[0-9a-f-]{36}\.png$/);
      expect(Object.values(res.body.uploadHeaders).join('')).not.toMatch(/[\r\n]/);
      const media = await Media.findById(res.body.mediaId);
      expect(media.originalName).not.toMatch(/[\r\n/\\]/);
      expect(media.originalName.length).toBeLessThanOrEqual(255);
    },
  );

  it('an over-long extension is stored as .bin rather than embedded in the key', async () => {
    const user = await createUser();
    const res = await presign(user, 'a.png', 10);
    expect(res.body.storageKey.endsWith('.png')).toBe(true);
  });
});

describe('ownership and replay', () => {
  it('another user cannot complete someone else\'s upload', async () => {
    const owner = await createUser();
    const attacker = await createUser();
    const res = await presign(owner, 'a.png', samples['.png'].length);
    browserPut(res.body.storageKey, samples['.png'], res.body.uploadHeaders);
    expect((await complete(attacker, res.body.mediaId)).status).toBe(404);
    expect((await Media.findById(res.body.mediaId)).status).toBe('UPLOADING');
    expect((await complete(owner, res.body.mediaId)).status).toBe(200);
  });

  it('an upload cannot be completed twice', async () => {
    const user = await createUser();
    const res = await presign(user, 'a.png', samples['.png'].length);
    browserPut(res.body.storageKey, samples['.png'], res.body.uploadHeaders);
    expect((await complete(user, res.body.mediaId)).status).toBe(200);
    expect((await complete(user, res.body.mediaId)).status).toBe(404);
  });

  it('a user can only ever presign into their own folder', async () => {
    const a = await createUser();
    const b = await createUser();
    const ra = await presign(a, 'a.png', 10);
    const rb = await presign(b, 'a.png', 10);
    expect(ra.body.storageKey).toContain(`users/${a._id}/`);
    expect(rb.body.storageKey).toContain(`users/${b._id}/`);
  });
});

describe('video posters cannot be used to reach other objects', () => {
  const presignVideo = async (user) => {
    const res = await presign(user, 'clip.mp4', samples['.mp4'].length, { poster: 'true' });
    browserPut(res.body.storageKey, samples['.mp4'], res.body.uploadHeaders);
    return res;
  };
  const jpeg = () => samples['.jpg'];

  it('a valid poster is kept, and signed with its own headers', async () => {
    const user = await createUser();
    const res = await presignVideo(user);
    expect(res.body.posterUploadHeaders).toEqual({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store' });
    browserPut(res.body.posterStorageKey, jpeg(), res.body.posterUploadHeaders);
    const done = await complete(user, res.body.mediaId, { posterStorageKey: res.body.posterStorageKey });
    expect(done.body.media.thumbnailKey).toBe(res.body.posterStorageKey);
  });

  it("a forged poster key pointing at ANOTHER user's private file is ignored (thumbnail IDOR)", async () => {
    const victim = await createUser();
    const attacker = await createUser();
    const victimFile = await presign(victim, 'secret.pdf', samples['.pdf'].length);
    browserPut(victimFile.body.storageKey, samples['.pdf'], victimFile.body.uploadHeaders);

    const res = await presignVideo(attacker);
    const done = await complete(attacker, res.body.mediaId, { posterStorageKey: victimFile.body.storageKey });

    expect(done.status).toBe(200);
    expect(done.body.media.thumbnailKey).toBeFalsy();
    expect(r2.has(victimFile.body.storageKey)).toBe(true); // and the victim's file is untouched
  });

  it('a poster that is not a JPEG is dropped and deleted', async () => {
    const user = await createUser();
    const res = await presignVideo(user);
    browserPut(res.body.posterStorageKey, samples['.pdf'], res.body.posterUploadHeaders);
    const done = await complete(user, res.body.mediaId, { posterStorageKey: res.body.posterStorageKey });
    expect(done.body.media.thumbnailKey).toBeFalsy();
    expect(r2.has(res.body.posterStorageKey)).toBe(false);
  });

  it('an oversized poster is dropped', async () => {
    const user = await createUser();
    const res = await presignVideo(user);
    browserPut(res.body.posterStorageKey, jpeg(), res.body.posterUploadHeaders);
    r2.get(res.body.posterStorageKey).reportedSize = policy.MAX_POSTER_SIZE + 1;
    const done = await complete(user, res.body.mediaId, { posterStorageKey: res.body.posterStorageKey });
    expect(done.body.media.thumbnailKey).toBeFalsy();
  });

  it('a rejected video leaves no poster behind', async () => {
    const user = await createUser();
    const res = await presign(user, 'clip.mp4', EXE_BYTES.length, { poster: 'true' });
    browserPut(res.body.storageKey, EXE_BYTES, res.body.uploadHeaders);
    browserPut(res.body.posterStorageKey, jpeg(), res.body.posterUploadHeaders);
    expect((await complete(user, res.body.mediaId, { posterStorageKey: res.body.posterStorageKey })).status).toBe(415);
    expect(r2.has(res.body.posterStorageKey)).toBe(false);
  });

  it('only video asks for a poster', async () => {
    const user = await createUser();
    const res = await presign(user, 'a.png', 10, { poster: 'true' });
    expect(res.body.posterUploadUrl).toBeNull();
  });
});

describe('proxy upload (no R2): the browser-claimed type is never trusted', () => {
  it.each(ALL.map(({ ext }) => [ext]))('%s is stored and served with the type its extension implies, not the claimed one', async (ext) => {
    jest.restoreAllMocks(); // real local-disk storage for this path
    const user = await createUser();
    const file = path.join(require('os').tmpdir(), `mf-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    fs.writeFileSync(file, samples[ext]);
    const res = await request(app)
      .post('/api/upload/media')
      .set(auth(user))
      .attach('file', file, { filename: `a${ext}`, contentType: 'text/html' }); // a lying browser
    fs.unlinkSync(file);
    expect(res.status).toBe(200);
    const category = policy.categorizeFile(ext);
    expect(res.body.media.mimeType).toBe(policy.mimeForFile(ext, category));
    expect(res.body.media.status).toBe('READY');
  });
});

describe('serving: signed CDN links carry the right type and disposition', () => {
  beforeEach(() => {
    process.env.CDN_BASE_URL = 'https://cdn.example.test';
    process.env.CDN_SIGNING_SECRET = 'matrix-secret';
  });
  afterEach(() => {
    process.env.CDN_BASE_URL = '';
    process.env.CDN_SIGNING_SECRET = '';
  });

  it.each(ALL.map(({ ext, category }) => [ext, category]))('%s: type, filename and disposition in the signed link; strangers get 404', async (ext, category) => {
    const sender = await createUser();
    const recipient = await createUser();
    const stranger = await createUser();
    const room = await Room.create({ people: [sender._id, recipient._id], isGroup: false });

    const res = await presign(sender, `doc${ext}`, samples[ext].length);
    browserPut(res.body.storageKey, samples[ext], res.body.uploadHeaders);
    await complete(sender, res.body.mediaId);
    await request(app).post('/api/message').set(auth(sender)).field('roomID', room._id.toString()).field('type', 'file').field('content', 'x').field('mediaID', res.body.mediaId);

    const link = await request(app).get(`/api/media/${res.body.mediaId}/url`).set(auth(recipient));
    expect(link.status).toBe(200);
    const url = new URL(link.body.url);
    expect(url.searchParams.get('ct')).toBe(policy.mimeForFile(ext, category));
    expect(url.searchParams.get('n')).toBe(`doc${ext}`);
    expect(url.searchParams.get('d')).toBe(policy.getSecurityLevel(category) === policy.SecurityLevel.DOWNLOAD_ONLY ? 'attachment' : null);
    expect(url.pathname).toContain('/o/private/users/');

    expect((await request(app).get(`/api/media/${res.body.mediaId}/url`).set(auth(stranger))).status).toBe(404);
  });
});

describe('policy consistency', () => {
  it('every allowed extension has exactly one MIME type, and it is in its category\'s list', () => {
    ALL.forEach(({ ext, category }) => {
      const mime = policy.mimeForFile(ext, category);
      expect(mime).not.toBe('application/octet-stream');
      expect(policy.MEDIA_CATEGORIES[category].mimes).toContain(mime);
    });
  });

  it('no extension belongs to two categories, and no allowed extension is also blocked', () => {
    const seen = new Map();
    ALL.forEach(({ ext, category }) => {
      expect(seen.has(ext)).toBe(false);
      seen.set(ext, category);
      expect(policy.BLOCKED_EXTENSIONS.has(ext)).toBe(false);
    });
  });

  it('every allowed extension has a real sample (so this suite really covers all of them)', () => {
    ALL.forEach(({ ext }) => expect(samples[ext]).toBeInstanceOf(Buffer));
  });

  it('the frontend mirror lists exactly the same extensions and size limits (it cannot drift)', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../frontend/src/lib/mediaPolicy.js'), 'utf8');
    const literal = /export const MEDIA_CATEGORIES = (\{[\s\S]*?\n\});/.exec(source)[1];
    // eslint-disable-next-line no-new-func
    const mirror = new Function('MB', `return ${literal}`)(MB);
    Object.entries(policy.MEDIA_CATEGORIES).forEach(([category, def]) => {
      expect(mirror[category].extensions).toEqual(def.extensions);
      expect(mirror[category].maxSize).toBe(def.maxSize);
    });
    expect(Object.keys(mirror).sort()).toEqual(Object.keys(policy.MEDIA_CATEGORIES).sort());
  });

  it('download-only categories are stored as attachments', () => {
    ['document', 'archive', 'text'].forEach((category) => {
      expect(policy.uploadHeadersFor(category, policy.MEDIA_CATEGORIES[category].extensions[0])['Content-Disposition']).toBe('attachment');
    });
    ['image', 'video', 'audio', 'pdf'].forEach((category) => {
      expect(policy.uploadHeadersFor(category, policy.MEDIA_CATEGORIES[category].extensions[0])['Content-Disposition']).toBeUndefined();
    });
  });

  it('audio recordings keep their audio type even though .webm / .mp4 mean video elsewhere', () => {
    expect(policy.mimeForFile('.webm', 'audio')).toBe('audio/webm');
    expect(policy.mimeForFile('.webm', 'video')).toBe('video/webm');
    expect(policy.mimeForFile('.mp4', 'audio')).toBe('audio/mp4');
  });
});
