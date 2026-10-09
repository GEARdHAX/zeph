// Concurrent sign-in capacity (Argon2 verification is deliberately CPU-heavy, so this is the interesting number).
// Registers N users once (not measured), then logs all N in concurrently.
//
// Usage: node loadtest/auth-load.js [concurrency] [baseUrl]
// Run against a LOCAL throwaway backend (see loadtest/README.md). With default rate limits the auth limiter will
// reject most of this: raise RATE_LIMIT_AUTH_CAPACITY on the target to measure raw capacity.
const { summarize, printSummary } = require('./lib/percentiles');

const concurrency = Number(process.argv[2]) || 50;
const baseUrl = process.argv[3] || 'http://127.0.0.1:4099';

const form = (fields) => {
  const f = new FormData();
  Object.entries(fields).forEach(([k, v]) => f.append(k, v));
  return f;
};

const timed = async (fn) => {
  const start = process.hrtime.bigint();
  let status = 0;
  try {
    status = await fn();
  } catch (e) {
    status = -1;
  }
  return { ms: Number(process.hrtime.bigint() - start) / 1e6, status };
};

const main = async () => {
  const users = Array.from({ length: concurrency }, (_, i) => {
    const tag = `${Date.now()}${i}${Math.floor(Math.random() * 1e6)}`;
    return { email: `authload-${tag}@example.com`, username: `al${tag}` };
  });

  // Registration (setup, not measured). Batched so setup itself does not hit connection limits.
  for (let i = 0; i < users.length; i += 25) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(
      users.slice(i, i + 25).map((u) =>
        fetch(`${baseUrl}/api/register`, {
          method: 'POST',
          body: form({ ...u, password: 'LoadTest123!', repeatPassword: 'LoadTest123!', firstName: 'Auth', lastName: 'Load' }),
        }),
      ),
    );
  }

  const wallStart = process.hrtime.bigint();
  const results = await Promise.all(
    users.map((u) =>
      timed(async () => {
        const res = await fetch(`${baseUrl}/api/login`, { method: 'POST', body: form({ email: u.email, password: 'LoadTest123!' }) });
        return res.status;
      }),
    ),
  );
  const wallMs = Number(process.hrtime.bigint() - wallStart) / 1e6;

  const ok = results.filter((r) => r.status === 200);
  const breakdown = results.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {});
  printSummary(`Concurrent login x${concurrency}`, summarize(ok.map((r) => r.ms), { errors: results.length - ok.length, total: results.length }), {
    statusBreakdown: JSON.stringify(breakdown),
    wallClockMs: wallMs.toFixed(0),
    successfulLoginsPerSecond: (ok.length / (wallMs / 1000)).toFixed(1),
  });
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
