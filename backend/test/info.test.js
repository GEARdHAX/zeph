const request = require('supertest');
const { buildApp } = require('./helpers/app');
const db = require('./helpers/db');
const store = require('../src/store');
const config = require('../config');

let app;

beforeAll(async () => {
  await db.connect();
  app = buildApp();
});

afterAll(async () => {
  await db.closeDatabase();
});

afterEach(() => {
  store.config = { ...config, redisUrl: null };
});

describe('GET /api/info — meetingAiEnabled (Meeting AI, Phase 14)', () => {
  it('is false when AI is disabled entirely', async () => {
    store.config.aiProvider = 'none';
    const res = await request(app).get('/api/info');
    expect(res.body.meetingAiEnabled).toBe(false);
  });

  it('is false when AI_PROVIDER=ollama (no transcription support)', async () => {
    store.config.aiProvider = 'ollama';
    store.config.ollamaUrl = 'http://localhost:11434';
    store.config.ollamaModel = 'llama3.2:1b';
    const res = await request(app).get('/api/info');
    expect(res.body.meetingAiEnabled).toBe(false);
    // aiEnabled (chat assistant) is still true for ollama — a distinct flag
    expect(res.body.aiEnabled).toBe(true);
  });

  it('is false when AI_PROVIDER=groq but no API key is set', async () => {
    store.config.aiProvider = 'groq';
    store.config.groqApiKey = null;
    const res = await request(app).get('/api/info');
    expect(res.body.meetingAiEnabled).toBe(false);
  });

  it('is true only when AI_PROVIDER=groq AND a key is configured', async () => {
    store.config.aiProvider = 'groq';
    store.config.groqApiKey = 'test-key';
    const res = await request(app).get('/api/info');
    expect(res.body.meetingAiEnabled).toBe(true);
  });
});
