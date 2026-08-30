const request = require('supertest');
const argon2 = require('argon2');
const db = require('./helpers/db');
const {
  buildApp, tokenFor, tokenForDevice,
} = require('./helpers/app');
const User = require('../src/models/User');
const Session = require('../src/models/Session');
const SecurityEvent = require('../src/models/SecurityEvent');
const { NEW_SESSION_THRESHOLD_MS } = require('../src/services/zeroTrust/riskEngine');

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

const createUser = async (overrides = {}) => {
  const password = await argon2.hash(overrides.password || 'password123');
  return User.create({
    username: overrides.username || `user-${Math.random().toString(36).slice(2)}`,
    email: overrides.email || `${Math.random().toString(36).slice(2)}@example.com`,
    firstName: 'Test',
    lastName: 'User',
    level: overrides.level || 'standard',
    password,
  });
};

// Backdates a real Session's createdAt so it reads as a "known device" to
// riskEngine.js (session age >= NEW_SESSION_THRESHOLD_MS) — the same real
// resolution path resolveSession()/the JWT strategy use, not a mock.
const ageSession = (session) => Session.updateOne(
  { _id: session._id },
  { $set: { createdAt: new Date(Date.now() - NEW_SESSION_THRESHOLD_MS - 60000) } },
);

describe('zeroTrust middleware — authentication is a hard prerequisite', () => {
  it('an unauthenticated request to a Zero Trust-guarded route is rejected before Zero Trust ever runs', async () => {
    const res = await request(app).post('/api/users/change-password').field('password', 'newpassword123');
    expect(res.status).toBe(401); // passport itself, never reaches zeroTrust()
  });
});

describe('zeroTrust middleware — session revocation (spec section 20)', () => {
  it('a revoked session is DENYed on a sensitive route even with an otherwise-valid JWT', async () => {
    const user = await createUser();
    const { token, session } = await tokenForDevice(user);
    await ageSession(session); // would otherwise be low-risk/known-device
    await Session.updateOne({ _id: session._id }, { $set: { revokedAt: new Date() } });

    // The passport strategy itself already rejects a revoked deviceId
    // token (see init.js) — this proves that existing behavior is
    // completely undisturbed by Zero Trust sitting downstream of it.
    const res = await request(app)
      .post('/api/users/change-password')
      .set('Authorization', `Bearer ${token}`)
      .field('password', 'newpassword123');
    expect(res.status).toBe(401);
  });
});

describe('zeroTrust middleware — low risk allows a sensitive action through', () => {
  it('a known device with no adverse history is ALLOWed to change their password', async () => {
    const user = await createUser();
    const { token, session } = await tokenForDevice(user);
    await ageSession(session);

    const res = await request(app)
      .post('/api/users/change-password')
      .set('Authorization', `Bearer ${token}`)
      .field('password', 'newpassword123');
    expect(res.status).toBe(200);
  });
});

describe('zeroTrust middleware — high risk requires step-up', () => {
  it('a brand-new session with recent failed logins on this account is STEP_UP\'d, not silently allowed', async () => {
    const user = await createUser();
    const { token } = await tokenForDevice(user); // brand-new session -> NEW_SESSION + UNKNOWN_DEVICE = 30
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await SecurityEvent.create({
        eventId: `evt-${i}-${Math.random()}`,
        timestamp: new Date(),
        type: 'LOGIN_FAILED',
        severity: 'medium',
        actor: { userId: user._id.toString() },
        source: {},
        target: {},
        result: 'failure',
        metadata: {},
      }); // +25 -> total 55, >= SENSITIVE's allowBelow:50
    }

    const res = await request(app)
      .post('/api/users/change-password')
      .set('Authorization', `Bearer ${token}`)
      .field('password', 'newpassword123');
    expect(res.status).toBe(428);
    expect(res.body.reason).toBe('step_up_required');

    // The password must NOT have actually changed — STEP_UP blocks the
    // handler from ever running, it isn't just a warning header.
    const stillOldPassword = await argon2.verify((await User.findById(user._id)).password, 'password123');
    expect(stillOldPassword).toBe(true);
  });
});

describe('zeroTrust middleware — step-up flow end to end', () => {
  it('completing step-up (correct password) then retrying with the token succeeds', async () => {
    const user = await createUser({ password: 'correct-password-123' });
    const { token } = await tokenForDevice(user);
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await SecurityEvent.create({
        eventId: `evt-${i}-${Math.random()}`,
        timestamp: new Date(),
        type: 'LOGIN_FAILED',
        severity: 'medium',
        actor: { userId: user._id.toString() },
        source: {},
        target: {},
        result: 'failure',
        metadata: {},
      });
    }

    const blocked = await request(app)
      .post('/api/users/change-password')
      .set('Authorization', `Bearer ${token}`)
      .field('password', 'newpassword123');
    expect(blocked.status).toBe(428);

    const stepUp = await request(app)
      .post('/api/security/step-up')
      .set('Authorization', `Bearer ${token}`)
      .field('resource', 'account')
      .field('action', 'change_password')
      .field('password', 'correct-password-123');
    expect(stepUp.status).toBe(200);
    expect(typeof stepUp.body.token).toBe('string');

    const retried = await request(app)
      .post('/api/users/change-password')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Step-Up-Token', stepUp.body.token)
      .field('password', 'newpassword123');
    expect(retried.status).toBe(200);
  });

  it('the step-up token cannot be replayed for a second change-password call', async () => {
    const user = await createUser({ password: 'correct-password-123' });
    const { token } = await tokenForDevice(user);
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await SecurityEvent.create({
        eventId: `evt-${i}-${Math.random()}`,
        timestamp: new Date(),
        type: 'LOGIN_FAILED',
        severity: 'medium',
        actor: { userId: user._id.toString() },
        source: {},
        target: {},
        result: 'failure',
        metadata: {},
      });
    }

    const stepUp = await request(app)
      .post('/api/security/step-up')
      .set('Authorization', `Bearer ${token}`)
      .field('resource', 'account')
      .field('action', 'change_password')
      .field('password', 'correct-password-123');

    const first = await request(app)
      .post('/api/users/change-password')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Step-Up-Token', stepUp.body.token)
      .field('password', 'newpassword123');
    expect(first.status).toBe(200);

    // Same risk conditions still hold (3 failed logins still within
    // lookback) — a second call with the SAME token must be re-blocked,
    // not silently allowed through on a stale/replayed token.
    const second = await request(app)
      .post('/api/users/change-password')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Step-Up-Token', stepUp.body.token)
      .field('password', 'anotherpassword456');
    expect(second.status).toBe(428);
  });

  it('an invalid/garbage step-up token is ignored, not trusted', async () => {
    const user = await createUser();
    const { token } = await tokenForDevice(user);
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await SecurityEvent.create({
        eventId: `evt-${i}-${Math.random()}`,
        timestamp: new Date(),
        type: 'LOGIN_FAILED',
        severity: 'medium',
        actor: { userId: user._id.toString() },
        source: {},
        target: {},
        result: 'failure',
        metadata: {},
      });
    }

    const res = await request(app)
      .post('/api/users/change-password')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Step-Up-Token', 'i-just-made-this-up')
      .field('password', 'newpassword123');
    expect(res.status).toBe(428);
  });
});

describe('zeroTrust middleware — every decision is telemetered (spec section 24)', () => {
  it('an ALLOW decision writes a ZERO_TRUST_ALLOW SecurityEvent', async () => {
    const user = await createUser();
    const { token, session } = await tokenForDevice(user);
    await ageSession(session);

    await request(app)
      .post('/api/users/change-password')
      .set('Authorization', `Bearer ${token}`)
      .field('password', 'newpassword123');

    await new Promise((resolve) => { setTimeout(resolve, 100); });
    const event = await SecurityEvent.findOne({ type: 'ZERO_TRUST_ALLOW', 'actor.userId': user._id.toString() });
    expect(event).not.toBeNull();
    expect(event.target.resource).toBe('account');
    expect(event.target.action).toBe('change_password');
  });

  it('a STEP_UP decision writes a ZERO_TRUST_STEP_UP SecurityEvent with the risk score in metadata', async () => {
    const user = await createUser();
    const { token } = await tokenForDevice(user);
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await SecurityEvent.create({
        eventId: `evt-${i}-${Math.random()}`,
        timestamp: new Date(),
        type: 'LOGIN_FAILED',
        severity: 'medium',
        actor: { userId: user._id.toString() },
        source: {},
        target: {},
        result: 'failure',
        metadata: {},
      });
    }

    await request(app)
      .post('/api/users/change-password')
      .set('Authorization', `Bearer ${token}`)
      .field('password', 'newpassword123');

    await new Promise((resolve) => { setTimeout(resolve, 100); });
    const event = await SecurityEvent.findOne({ type: 'ZERO_TRUST_STEP_UP', 'actor.userId': user._id.toString() });
    expect(event).not.toBeNull();
    expect(typeof event.metadata.riskScore).toBe('number');
    expect(event.metadata.riskScore).toBeGreaterThanOrEqual(50);
  });
});
