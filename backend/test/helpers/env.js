// Runs before every test file (jest.config.js `setupFiles`), i.e. before config.js loads backend/.env.
// dotenv never overrides a variable that is already set, so blanking these keeps a developer's real
// object-storage / CDN credentials out of the test run: without it, upload tests would write test
// objects into the real R2 bucket and "storage not configured" tests would fail on a configured machine.
['R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'CDN_BASE_URL', 'CDN_SIGNING_SECRET', 'CDN_PRIVATE_URL_TTL'].forEach(
  (name) => {
    process.env[name] = '';
  },
);
