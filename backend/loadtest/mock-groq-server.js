// Zeph AI — Phase 12 load test support. A tiny local stand-in for Groq's
// API, used ONLY by ai-load.js, so the AI load test measures Zeph's OWN
// governance pipeline (eligibility, quota, dedup, Redis, BullMQ) without
// spending real Groq quota/cost — same "never hit real shared/external
// infra during a load test" principle this directory's README already
// applies to Mongo/Redis. Plain Node `http`, no dependency.
//
// Mimics the two endpoints ai/provider.js's buildGroqProvider calls:
// POST /openai/v1/chat/completions and POST /openai/v1/audio/transcriptions.
// Response content is fixed/synthetic — this measures LATENCY THROUGH THE
// PIPELINE, never real model quality, and the load-test report must always
// label provider-latency numbers from this mock as "simulated," never as a
// stand-in for Groq's real production latency.
//
// Usage: node loadtest/mock-groq-server.js [port] [artificialDelayMs]
const http = require('http');

const port = Number(process.argv[2]) || 4098;
const artificialDelayMs = Number(process.argv[3]) || 300; // a rough, documented stand-in for real Groq round-trip latency — NOT a measured value

let requestCount = 0;
let rateLimitEvery = 0; // 0 = never simulate a 429; set via SIMULATE_RATE_LIMIT_EVERY env for the rate-limit-handling scenario

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    requestCount += 1;
    setTimeout(() => {
      if (rateLimitEvery > 0 && requestCount % rateLimitEvery === 0) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'rate limit (simulated)' } }));
        return;
      }

      if (req.url.includes('/audio/transcriptions')) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('this is a simulated transcript. '.repeat(30)); // ~150 words, clears the default 100-word eligibility floor
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message: { content: 'This is a simulated AI response for load testing.' } }],
      }));
    }, artificialDelayMs);
  });
});

if (process.env.SIMULATE_RATE_LIMIT_EVERY) rateLimitEvery = Number(process.env.SIMULATE_RATE_LIMIT_EVERY);

server.listen(port, () => {
  console.log(`Mock Groq server listening on :${port} (artificial delay ${artificialDelayMs}ms${rateLimitEvery ? `, simulating 429 every ${rateLimitEvery} requests` : ''})`);
});
