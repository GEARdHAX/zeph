const request = require('supertest');
const argon2 = require('argon2');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const User = require('../src/models/User');
const Room = require('../src/models/Room');
const Message = require('../src/models/Message');
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
  jest.restoreAllMocks();
  await db.clearDatabase();
});

const user = async () =>
  User.create({
    username: `u-${Math.random().toString(36).slice(2)}`,
    email: `${Math.random().toString(36).slice(2)}@example.com`,
    firstName: 'T',
    lastName: 'U',
    level: 'standard',
    password: await argon2.hash('password123'),
  });
const auth = (u) => ({ Authorization: `Bearer ${tokenFor(u)}` });
const waitFor = async (fn) => {
  for (let i = 0; i < 50; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    if (await fn()) return;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('timed out');
};

const setup = async () => {
  const author = await user();
  const other = await user();
  const room = await Room.create({ people: [author._id, other._id], isGroup: false });
  const media = await Media.create({
    uploaderId: author._id,
    originalName: 'v.mp4',
    mimeType: 'video/mp4',
    category: 'video',
    size: 10,
    storageKey: `private/users/${author._id}/attachments/abc.mp4`,
    thumbnailKey: `private/users/${author._id}/attachments/abc.mp4-thumb.jpg`,
    status: 'READY',
  });
  const message = await Message.create({ room: room._id, author: author._id, type: 'file', content: media._id.toString(), media: media._id, date: new Date() });
  return { author, other, room, media, message };
};

const del = (u, room, message, forEveryone) => request(app).post('/api/message/delete').set(auth(u)).send({ roomID: room._id.toString(), messageID: message._id.toString(), forEveryone });

describe('deleting a media message', () => {
  it('delete for everyone removes the stored objects and the Media row, and the file stops being servable', async () => {
    const del$ = jest.spyOn(storage, 'deleteObject').mockResolvedValue();
    const { author, other, room, media, message } = await setup();

    const res = await del(author, room, message, true);
    expect(res.status).toBe(200);

    await waitFor(async () => !(await Media.findById(media._id)));
    const keys = del$.mock.calls.map(([k]) => k);
    expect(keys).toContain(media.storageKey);
    expect(keys).toContain(media.thumbnailKey);

    expect((await Message.findById(message._id)).media).toBeNull();
    expect((await request(app).get(`/api/media/${media._id}`).set(auth(other))).status).toBe(404);
    expect((await request(app).get(`/api/media/${media._id}/url`).set(auth(other))).status).toBe(404);
  });

  it('delete for me only hides it: the file stays for everyone else', async () => {
    const del$ = jest.spyOn(storage, 'deleteObject').mockResolvedValue();
    const { other, room, media, message } = await setup();

    expect((await del(other, room, message, false)).status).toBe(200);
    await new Promise((r) => setTimeout(r, 100));
    expect(del$).not.toHaveBeenCalled();
    expect(await Media.findById(media._id)).not.toBeNull();
  });

  it('a non-author cannot delete for everyone, so nothing is purged', async () => {
    const del$ = jest.spyOn(storage, 'deleteObject').mockResolvedValue();
    const { other, room, media, message } = await setup();

    expect((await del(other, room, message, true)).status).toBe(403);
    await new Promise((r) => setTimeout(r, 100));
    expect(del$).not.toHaveBeenCalled();
    expect(await Media.findById(media._id)).not.toBeNull();
  });

  it('media still referenced by another message is kept', async () => {
    const del$ = jest.spyOn(storage, 'deleteObject').mockResolvedValue();
    const { author, room, media, message } = await setup();
    await Message.create({ room: room._id, author: author._id, type: 'file', content: media._id.toString(), media: media._id, date: new Date() });

    expect((await del(author, room, message, true)).status).toBe(200);
    await new Promise((r) => setTimeout(r, 100));
    expect(del$).not.toHaveBeenCalled();
    expect(await Media.findById(media._id)).not.toBeNull();
  });

  it('deleting twice is harmless', async () => {
    jest.spyOn(storage, 'deleteObject').mockResolvedValue();
    const { author, room, message } = await setup();
    expect((await del(author, room, message, true)).status).toBe(200);
    expect((await del(author, room, message, true)).status).toBe(200);
  });

  it('a storage failure does not fail the delete (the user already sees it gone)', async () => {
    jest.spyOn(storage, 'deleteObject').mockRejectedValue(new Error('R2 down'));
    const { author, room, message } = await setup();
    expect((await del(author, room, message, true)).status).toBe(200);
  });

  it('deleting the whole conversation reclaims every attachment in it', async () => {
    const del$ = jest.spyOn(storage, 'deleteObject').mockResolvedValue();
    const { author, room, media } = await setup();

    const res = await request(app).post('/api/room/remove').set(auth(author)).send({ id: room._id.toString() });
    expect(res.status).toBe(200);
    await waitFor(async () => !(await Media.findById(media._id)));
    expect(del$.mock.calls.map(([k]) => k)).toContain(media.storageKey);
  });
});
