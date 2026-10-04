// Verifies your Cloudflare Realtime credentials without starting the server:
//   npm run calls:check
// Creates one throwaway SFU session and (if a TURN key is set) generates ICE servers.
// Prints which variables are set and whether Cloudflare accepted them - never the values.
require('dotenv').config();
const { createCloudflareClient } = require('../src/calls/cloudflare/client');

const env = process.env;
const client = createCloudflareClient({
  appId: env.CF_REALTIME_APP_ID,
  appSecret: env.CF_REALTIME_APP_SECRET,
  turnKeyId: env.CF_TURN_KEY_ID,
  turnApiToken: env.CF_TURN_API_TOKEN,
});

const set = (name) => (env[name] ? 'set' : 'MISSING');

(async () => {
  console.log(`CALL_BACKEND            ${env.CALL_BACKEND || '(unset -> cloudflare)'}`);
  console.log(`CF_REALTIME_APP_ID      ${set('CF_REALTIME_APP_ID')}`);
  console.log(`CF_REALTIME_APP_SECRET  ${set('CF_REALTIME_APP_SECRET')}`);
  console.log(`CF_TURN_KEY_ID          ${set('CF_TURN_KEY_ID')}`);
  console.log(`CF_TURN_API_TOKEN       ${set('CF_TURN_API_TOKEN')}`);

  if (!client.isConfigured()) {
    console.error('\nFAIL: CF_REALTIME_APP_ID and CF_REALTIME_APP_SECRET are required.');
    process.exit(1);
  }

  let failed = false;
  try {
    const sessionId = await client.newSession();
    console.log(`\nOK   SFU: created a session (${sessionId.slice(0, 8)}...)`);
  } catch (err) {
    failed = true;
    console.error(`\nFAIL SFU: ${err.message}`);
    if (err.status === 401 || err.status === 403) console.error('     -> check CF_REALTIME_APP_ID / CF_REALTIME_APP_SECRET (copy the App Secret, not the ID).');
  }

  if (!client.turnConfigured()) {
    console.log('SKIP TURN: CF_TURN_KEY_ID / CF_TURN_API_TOKEN not set (calls still work; people on strict networks may not connect).');
  } else {
    try {
      const servers = await client.getIceServers();
      const turn = servers.filter((x) => x.username).length;
      console.log(`OK   TURN: ${servers.length} ICE server entries, ${turn} with credentials.`);
    } catch (err) {
      failed = true;
      console.error(`FAIL TURN: ${err.message}`);
    }
  }
  process.exit(failed ? 1 : 0);
})();
