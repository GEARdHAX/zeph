const request = require('supertest');
const argon2 = require('argon2');
const jwt = require('jsonwebtoken');

// Only the cryptographic check is faked: everything else (credential lookup, session, token) is real.
jest.mock('@simplewebauthn/server', () => ({
  ...jest.requireActual('@simplewebauthn/server'),
  verifyAuthenticationResponse: jest.fn(async () => ({ verified: true, authenticationInfo: { newCounter: 1 } })),
}));

const db = require('./helpers/db');
const { buildApp } = require('./helpers/app');
const User = require('../src/models/User');
const Image = require('../src/models/Image');
const PasskeyCredential = require('../src/models/PasskeyCredential');
const challenges = require('../src/vault/webauthnChallenges');
const store = require('../src/store');

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

const passkeyLogin = async (user) => {
  const credentialID = `cred-${Math.random().toString(36).slice(2)}`;
  await PasskeyCredential.create({ user: user._id, credentialID, publicKey: Buffer.from('k') });
  const flowId = `flow-${Math.random().toString(36).slice(2)}`;
  challenges.put(`passkey-login-flow:${flowId}`, 'challenge');
  const res = await request(app)
    .post('/api/passkey/login/verify')
    .field('flowId', flowId)
    .field('response', JSON.stringify({ id: credentialID }));
  expect(res.status).toBe(200);
  return jwt.verify(res.body.token, store.config.secret);
};

// The app builds the avatar URL from user.picture.shieldedID, taken from this token. A bare ObjectId (what a
// non-populated lookup gives) has no shieldedID, so the avatar requested /api/images/undefined/... and showed blank.
describe('passkey login returns a usable picture', () => {
  it('the token carries the picture with its shieldedID, as password login does', async () => {
    const user = await createUser();
    const image = await Image.create({ author: user._id, shieldedID: 'fresh-shield', storageKey: `public/users/${user._id}/avatar/fresh-shield.jpg` });
    await User.updateOne({ _id: user._id }, { picture: image._id });

    const payload = await passkeyLogin(user);

    expect(payload.picture).toBeTruthy();
    expect(payload.picture.shieldedID).toBe('fresh-shield');
  });

  it('uses the picture as it is NOW (changed from another device since the last login)', async () => {
    const user = await createUser();
    const oldImage = await Image.create({ author: user._id, shieldedID: 'old-shield' });
    await User.updateOne({ _id: user._id }, { picture: oldImage._id });
    // another device switches picture; the old one is deleted
    const newImage = await Image.create({ author: user._id, shieldedID: 'new-shield' });
    await User.updateOne({ _id: user._id }, { picture: newImage._id });
    await Image.deleteOne({ _id: oldImage._id });

    const payload = await passkeyLogin(user);
    expect(payload.picture.shieldedID).toBe('new-shield');
  });

  it('a user without a picture still logs in', async () => {
    const user = await createUser();
    const payload = await passkeyLogin(user);
    expect(payload.picture).toBeFalsy();
    expect(payload.id).toBe(user._id.toString());
  });
});
