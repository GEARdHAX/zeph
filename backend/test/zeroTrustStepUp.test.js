const argon2 = require('argon2');
const mongoose = require('mongoose');
const db = require('./helpers/db');
const User = require('../src/models/User');
const StepUpToken = require('../src/models/StepUpToken');
const { issueStepUpToken, verifyAndConsumeStepUpToken } = require('../src/services/zeroTrust/stepUp');

beforeAll(async () => {
  await db.connect();
});

afterAll(async () => {
  await db.closeDatabase();
});

afterEach(async () => {
  await db.clearDatabase();
});

const createUser = async (password = 'correct-password-123') => {
  const hash = await argon2.hash(password);
  return User.create({
    username: `user-${Math.random().toString(36).slice(2)}`,
    email: `${Math.random().toString(36).slice(2)}@example.com`,
    firstName: 'Test',
    lastName: 'User',
    password: hash,
  });
};

describe('stepUp.issueStepUpToken', () => {
  it('rejects the wrong password without issuing a token', async () => {
    const user = await createUser('correct-password-123');
    const result = await issueStepUpToken({
      userId: user._id, sessionId: null, resource: 'account', action: 'change_password', password: 'wrong-password',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('incorrect_password');
    expect(await StepUpToken.countDocuments()).toBe(0);
  });

  it('issues a token on the correct password, storing only its hash', async () => {
    const user = await createUser('correct-password-123');
    const result = await issueStepUpToken({
      userId: user._id, sessionId: null, resource: 'account', action: 'change_password', password: 'correct-password-123',
    });
    expect(result.ok).toBe(true);
    expect(typeof result.token).toBe('string');

    const stored = await StepUpToken.findOne({});
    expect(stored).not.toBeNull();
    expect(stored.tokenHash).not.toBe(result.token); // never the raw token
    expect(JSON.stringify(stored)).not.toContain(result.token); // not embedded anywhere in the stored doc
  });
});

describe('stepUp.verifyAndConsumeStepUpToken', () => {
  const issue = async (overrides = {}) => {
    const user = overrides.user || await createUser();
    const result = await issueStepUpToken({
      userId: user._id,
      sessionId: overrides.sessionId || null,
      resource: overrides.resource || 'account',
      action: overrides.action || 'change_password',
      password: overrides.password || 'correct-password-123',
    });
    return { user, token: result.token };
  };

  it('accepts a valid, freshly-issued token for the exact resource/action/user it was minted for', async () => {
    const { user, token } = await issue();
    const result = await verifyAndConsumeStepUpToken({
      rawToken: token, userId: user._id, sessionId: null, resource: 'account', action: 'change_password',
    });
    expect(result.ok).toBe(true);
  });

  it('rejects a missing token', async () => {
    const result = await verifyAndConsumeStepUpToken({
      rawToken: null, userId: 'user-1', resource: 'account', action: 'change_password',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('missing_token');
  });

  it('rejects a token that was never issued', async () => {
    const result = await verifyAndConsumeStepUpToken({
      rawToken: 'totally-made-up-token', userId: 'user-1', resource: 'account', action: 'change_password',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid_token');
  });

  it('cannot be replayed — a second use of the same token fails', async () => {
    const { user, token } = await issue();
    const first = await verifyAndConsumeStepUpToken({
      rawToken: token, userId: user._id, resource: 'account', action: 'change_password',
    });
    const second = await verifyAndConsumeStepUpToken({
      rawToken: token, userId: user._id, resource: 'account', action: 'change_password',
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.reason).toBe('already_used');
  });

  it('cannot be replayed even under concurrent simultaneous use — exactly one wins', async () => {
    const { user, token } = await issue();
    const attempt = () => verifyAndConsumeStepUpToken({
      rawToken: token, userId: user._id, resource: 'account', action: 'change_password',
    });
    const [a, b] = await Promise.all([attempt(), attempt()]);
    const results = [a.ok, b.ok].sort();
    expect(results).toEqual([false, true]);
  });

  it('rejects an expired token', async () => {
    const { user, token } = await issue();
    await StepUpToken.updateOne({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const result = await verifyAndConsumeStepUpToken({
      rawToken: token, userId: user._id, resource: 'account', action: 'change_password',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('expired');
  });

  it('cannot be used by a different user than it was issued for', async () => {
    const { token } = await issue();
    const otherUser = await createUser();
    const result = await verifyAndConsumeStepUpToken({
      rawToken: token, userId: otherUser._id, resource: 'account', action: 'change_password',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('user_mismatch');
  });

  it('cannot be replayed against a DIFFERENT sensitive action than it was scoped for', async () => {
    const { user, token } = await issue({ resource: 'account', action: 'change_password' });
    const result = await verifyAndConsumeStepUpToken({
      rawToken: token, userId: user._id, resource: 'account', action: 'delete_account',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('scope_mismatch');
  });

  it('cannot be replayed from a different session than it was bound to', async () => {
    const sessionA = new mongoose.Types.ObjectId();
    const sessionB = new mongoose.Types.ObjectId();
    const { user, token } = await issue({ sessionId: sessionA });
    const result = await verifyAndConsumeStepUpToken({
      rawToken: token, userId: user._id, sessionId: sessionB, resource: 'account', action: 'change_password',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('session_mismatch');
  });
});
