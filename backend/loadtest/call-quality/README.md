# Call quality harness

Measures captured / sent / received video quality against live Cloudflare Realtime. Results and rationale: `docs/CALL-QUALITY-METRICS.md`.

Needs `CF_REALTIME_APP_ID` and `CF_REALTIME_APP_SECRET` in `backend/.env`, and a throwaway Playwright (not a project dependency):

```
cd frontend && npm install playwright --no-save && npx playwright install chromium
cd ../backend/loadtest/call-quality
node build.cjs      # bundles the current frontend/src/lib/cloudflareCall.js
node quality.cjs    # ~55 s: old caps vs new caps
node live-e2e.cjs   # session, publish, subscribe, close, republish
cd ../../../frontend && npm uninstall playwright --no-save
```
