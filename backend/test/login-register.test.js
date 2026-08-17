const request = require('supertest');
const argon2 = require('argon2');
const db = require('./helpers/db');
const { buildApp } = require('./helpers/app');
const User = require('../src/models/User');

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
  const password = await argon2.hash('password123');
  return User.create({
    username: overrides.username || `user-${Math.random().toString(36).slice(2)}`,
    email: overrides.email || `${Math.random().toString(36).slice(2)}@example.com`,
    firstName: 'Test',
    lastName: 'User',
    password,
  });
};

describe('POST /api/register — requires both username and email, both unique', () => {
  it('registers successfully with a unique username and email', async () => {
    const res = await request(app)
      .post('/api/register')
      .field('username', 'newuser1')
      .field('email', 'newuser1@example.com')
      .field('firstName', 'New')
      .field('lastName', 'User')
      .field('password', 'password123')
      .field('repeatPassword', 'password123');

    expect(res.status).toBe(200);
    expect(res.body.username).toBe('newuser1');
    expect(res.body.email).toBe('newuser1@example.com');
  });

  it('rejects a duplicate username even with a different email', async () => {
    await createUser({ username: 'takenname', email: 'first@example.com' });

    const res = await request(app)
      .post('/api/register')
      .field('username', 'takenname')
      .field('email', 'second@example.com')
      .field('firstName', 'New')
      .field('lastName', 'User')
      .field('password', 'password123')
      .field('repeatPassword', 'password123');

    expect(res.status).toBe(400);
    expect(res.body.username).toBeDefined();
  });

  it('rejects a duplicate email even with a different username', async () => {
    await createUser({ username: 'firstname', email: 'taken@example.com' });

    const res = await request(app)
      .post('/api/register')
      .field('username', 'secondname')
      .field('email', 'taken@example.com')
      .field('firstName', 'New')
      .field('lastName', 'User')
      .field('password', 'password123')
      .field('repeatPassword', 'password123');

    expect(res.status).toBe(400);
    expect(res.body.email).toBeDefined();
  });

  it('requires both fields — missing username is rejected', async () => {
    const res = await request(app)
      .post('/api/register')
      .field('email', 'noname@example.com')
      .field('firstName', 'New')
      .field('lastName', 'User')
      .field('password', 'password123')
      .field('repeatPassword', 'password123');

    expect(res.status).toBe(400);
    expect(res.body.username).toBeDefined();
  });

  it('requires both fields — missing email is rejected', async () => {
    const res = await request(app)
      .post('/api/register')
      .field('username', 'noemailuser')
      .field('firstName', 'New')
      .field('lastName', 'User')
      .field('password', 'password123')
      .field('repeatPassword', 'password123');

    expect(res.status).toBe(400);
    expect(res.body.email).toBeDefined();
  });
});

describe('POST /api/login — accepts either username or email', () => {
  it('logs in with the email address', async () => {
    const user = await createUser({ username: 'loginuser1', email: 'loginuser1@example.com' });
    const res = await request(app)
      .post('/api/login')
      .field('email', user.email)
      .field('password', 'password123');

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });

  it('logs in with the @username instead of email', async () => {
    const user = await createUser({ username: 'loginuser2', email: 'loginuser2@example.com' });
    const res = await request(app)
      .post('/api/login')
      .field('email', user.username)
      .field('password', 'password123');

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });

  it('rejects a wrong password regardless of which identifier was used', async () => {
    const user = await createUser({ username: 'loginuser3', email: 'loginuser3@example.com' });
    const res = await request(app)
      .post('/api/login')
      .field('email', user.username)
      .field('password', 'wrongpassword');

    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown username or email', async () => {
    const res = await request(app)
      .post('/api/login')
      .field('email', 'doesnotexist')
      .field('password', 'password123');

    expect(res.status).toBe(404);
  });
});
