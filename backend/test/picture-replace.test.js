const request = require('supertest');
const argon2 = require('argon2');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const User = require('../src/models/User');
const Image = require('../src/models/Image');
const Message = require('../src/models/Message');
const Room = require('../src/models/Room');
const storage = require('../src/storage');
const store = require('../src/store');
const { retireImage, keysFor } = require('../src/retireImage');

let app;
let deleteSpy;

beforeAll(async () => {
  await db.connect();
  app = buildApp();
});
afterAll(async () => {
  await db.closeDatabase();
});
beforeEach(() => {
  deleteSpy = jest.spyOn(storage, 'deleteObject').mockResolvedValue(undefined);
});
afterEach(async () => {
  jest.restoreAllMocks();
  await db.clearDatabase();
});

const createUser = async (overrides = {}) =>
  User.create({
    username: `user-${Math.random().toString(36).slice(2)}`,
    email: `${Math.random().toString(36).slice(2)}@example.com`,
    firstName: 'Test',
    lastName: 'User',
    level: 'standard',
    password: await argon2.hash('password123'),
    ...overrides,
  });

const imageFor = (user, name) =>
  Image.create({
    author: user._id,
    shieldedID: `shield-${name}`,
    storageKey: `public/users/${user._id}/avatar/shield-${name}.jpg`,
  });

const change = (user, body) => request(app).post('/api/picture/change').set('Authorization', `Bearer ${tokenFor(user)}`).send(body);
const remove = (user) => request(app).post('/api/picture/remove').set('Authorization', `Bearer ${tokenFor(user)}`).send({});

// retireImage runs after the response is sent, so wait for it to settle.
const settled = async (check) => {
  for (let i = 0; i < 50; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    if (await check()) return true;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
};

describe('replacing a profile picture deletes the old one', () => {
  it('removes the old image record and every stored copy (main + sizes), keeps the new one', async () => {
    const user = await createUser();
    const oldImage = await imageFor(user, 'old');
    const newImage = await imageFor(user, 'new');
    await User.updateOne({ _id: user._id }, { picture: oldImage._id });

    const res = await change(user, { imageID: newImage._id.toString() });
    expect(res.status).toBe(200);

    expect(await settled(async () => !(await Image.exists({ _id: oldImage._id })))).toBe(true);
    expect(await Image.exists({ _id: newImage._id })).toBeTruthy();
    expect((await User.findById(user._id)).picture.toString()).toBe(newImage._id.toString());

    const expected = [oldImage.storageKey, ...store.config.sizes.map((s) => `${oldImage.storageKey.slice(0, -4)}-${s}.jpg`)];
    expect(deleteSpy.mock.calls.map((c) => c[0]).sort()).toEqual(expected.sort());
    expect(deleteSpy.mock.calls.some((c) => c[0] === newImage.storageKey)).toBe(false);
  });

  it('removing the picture deletes it too', async () => {
    const user = await createUser();
    const image = await imageFor(user, 'only');
    await User.updateOne({ _id: user._id }, { picture: image._id });

    expect((await remove(user)).status).toBe(200);
    expect(await settled(async () => !(await Image.exists({ _id: image._id })))).toBe(true);
    expect(deleteSpy).toHaveBeenCalled();
  });

  it('setting the same picture again deletes nothing', async () => {
    const user = await createUser();
    const image = await imageFor(user, 'same');
    await User.updateOne({ _id: user._id }, { picture: image._id });

    expect((await change(user, { imageID: image._id.toString() })).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(await Image.exists({ _id: image._id })).toBeTruthy();
    expect(deleteSpy).not.toHaveBeenCalled();
  });
});

describe('the old picture is kept when something else still needs it', () => {
  const setup = async () => {
    const user = await createUser();
    const oldImage = await imageFor(user, 'old');
    const newImage = await imageFor(user, 'new');
    await User.updateOne({ _id: user._id }, { picture: oldImage._id });
    return { user, oldImage, newImage };
  };
  const switchAndWait = async ({ user, newImage }) => {
    expect((await change(user, { imageID: newImage._id.toString() })).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 200));
  };

  it('a chat message still displays it', async () => {
    const ctx = await setup();
    const room = await Room.create({ people: [ctx.user._id], isGroup: false });
    await Message.create({ room: room._id, author: ctx.user._id, type: 'image', content: ctx.oldImage.shieldedID });
    await switchAndWait(ctx);
    expect(await Image.exists({ _id: ctx.oldImage._id })).toBeTruthy();
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('a group still uses it as its picture', async () => {
    const ctx = await setup();
    await Room.create({ people: [ctx.user._id], isGroup: true, title: 'g', picture: ctx.oldImage._id });
    await switchAndWait(ctx);
    expect(await Image.exists({ _id: ctx.oldImage._id })).toBeTruthy();
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('another user uses the same image', async () => {
    const ctx = await setup();
    await createUser({ picture: ctx.oldImage._id });
    await switchAndWait(ctx);
    expect(await Image.exists({ _id: ctx.oldImage._id })).toBeTruthy();
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it("it belongs to someone else (a client-supplied id must never delete another user's image)", async () => {
    const owner = await createUser();
    const victim = await imageFor(owner, 'victim');
    const attacker = await createUser({ picture: victim._id }); // attacker pointed their picture at the victim's image
    const mine = await imageFor(attacker, 'mine');

    expect((await change(attacker, { imageID: mine._id.toString() })).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await Image.exists({ _id: victim._id })).toBeTruthy();
    expect(deleteSpy).not.toHaveBeenCalled();
  });
});

describe('retireImage', () => {
  it('never throws and ignores legacy local-disk rows (no storageKey)', async () => {
    const user = await createUser();
    const legacy = await Image.create({ author: user._id, shieldedID: 'legacy', location: './data/x.jpg' });
    expect(keysFor(legacy)).toEqual([]);
    await expect(retireImage(legacy._id, null, user._id)).resolves.toBe(true); // record cleaned, nothing to delete in R2
    expect(deleteSpy).not.toHaveBeenCalled();
    await expect(retireImage('not-an-object-id', null, user._id)).resolves.toBe(false);
    await expect(retireImage(undefined, null, user._id)).resolves.toBe(false);
  });
});
