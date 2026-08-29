# Rebrand Audit — Chitcx → zeph.

Generated as step 1 of the zeph rebrand. Case-insensitive repo-wide search for
"Chitcx" and legacy template/author branding, before any changes were made.

**Note on task-brief premise:** the brief describes `frontend/src/components/ui/zeph-spinner.jsx`,
`zeph-loading-overlay.jsx`, `lib/useZephLoader.js`, `@fontsource-variable/google-sans-flex`,
and a `--font-zeph` token as already existing in this repo ("old spec context").
None of these exist in this worktree — verified by `find`/`grep` across `frontend/src`.
They were built fresh as part of this rebrand (see final report). Treated as new
work, not "reuse existing", since there was nothing to reuse.

## Search methodology
`grep -riI` across the repo excluding `node_modules` and `.git`, plus targeted
searches for `adarsh`, `codecanyon`, `envato`, `clover`, `chattr`, `honeyside`.

## Findings — "Chitcx" (case-insensitive)

| File | User-facing? | Safe to replace? | Notes |
|---|---|---|---|
| `frontend/index.html` (title, meta description) | Yes | Yes | Browser tab title + SEO description |
| `frontend/public/manifest.json` (name/short_name) | Yes | Yes | PWA install name |
| `frontend/src/config.js` (`appName`/`brand` fallback literals) | Yes | Yes | Central brand config — becomes the new source of truth |
| `frontend/src/pages/Login/index.jsx` (`ChitcxLogo` fn name, wordmark text, alt text, copyright) | Yes | Yes | Auth page hero + footer |
| `frontend/src/pages/ForgotPassword/components/Logo.jsx` | Yes (renders `Config.appName`) | Yes (indirect via config) | No hardcoded string, but uses generic `alt="Logo"` — improved |
| `frontend/src/pages/ForgotPassword/components/Credits.jsx` | Yes | Yes | Copyright line |
| `frontend/src/features/Shell/components/NavRail.jsx` (alt text, brand label) | Yes | Yes | Sidebar/nav brand |
| `frontend/src/features/Details/components/Info.jsx` (alt text, welcome/about copy) | Yes | Yes | Profile/about panel |
| `frontend/src/features/Welcome/index.jsx` | Yes | Yes | Empty-state version string |
| `frontend/src/features/Shell/components/PendingFriendInviteDialog.jsx` | Yes | Yes | Invite dialog copy |
| `frontend/src/features/Group/components/InviteGroup.jsx` | Yes | Yes | Native share sheet title |
| `frontend/src/features/Panel/components/InviteFriend.jsx` | Yes | Yes | Native share sheet title + helper text |
| `frontend/src/features/Conversation/components/AudioViewer.jsx` | No (code comment only) | Yes | Internal comment, no runtime string |
| `frontend/src/pages/InvitePreview/FriendInvitePreview.jsx` | Yes | Yes | Invite landing page copy |
| `frontend/src/pages/InvitePreview/GroupInvitePreview.jsx` | Yes | Yes | Invite landing page copy |
| `frontend/src/pages/InvitePreview/FriendInvitePreview.test.jsx` | Test assertion | Yes | Must track the copy change above |
| `frontend/src/features/Panel/components/RequestToJoinGroup.test.jsx` | Test data (`chitcx.com` example URL) | Optional | Arbitrary example domain in a test fixture, not brand-critical; updated for consistency |
| `frontend/src/init.js` (`localStorage` cache-bust key `'Chitcx 3.x.x'`) | No (internal versioning key) | Yes | Free-form string used only to bump a client cache; safe to rename |
| `frontend/src/tours/driver.js` (code comment + `popoverClass: 'chitcx-tour-popover'`) | Comment: no. CSS class: indirectly (internal selector) | Yes | CSS class is an implementation detail, not displayed text itself |
| `frontend/src/tours/tourTheme.css` (`.chitcx-tour-popover` selectors ×13, doc comment) | No (CSS class names) | Yes | Purely internal selector namespace |
| `frontend/src/tours/tours/chat.js`, `groups.js`, `meetings.js`, `onboarding.js` (tour titles) | Yes | Yes | Product tour copy shown to users |
| `frontend/src/tours/tourStorage.js` (`STORAGE_PREFIX = 'chitcx:tours:'`, test-key string) | No (localStorage key, not displayed) | Yes, with a note | Renaming changes the storage key; existing users' tour-completion flags reset once (no data loss risk — tours just re-offer). Not a DB field/API contract, so outside the hard "don't rename schema" constraint. Renamed for consistency. |
| `frontend/src/tours/tourStorage.test.js` | Test assertion | Yes | Tracks the key rename above |
| `frontend/src/lib/parseBio.test.js` (`'love #chitcx'` test fixture) | Test data only | **No — left as-is** | Arbitrary hashtag content proving hashtag-parsing works; not brand text |
| `frontend/src/components/BioText.test.jsx` (`"#chitcx"` test fixture) | Test data only | **No — left as-is** | Same as above |
| `backend/index.js` (boot log line) | No (server log, not user-facing) | Yes | Cosmetic, updated anyway for consistency |
| `backend/reset.js` (CLI banner) | Yes (seen by the operator running the script) | Yes | Dev-tool CLI output |
| `backend/config.js` (`vaultRpName: 'Chitcx'`) | Yes (shown in OS passkey/WebAuthn prompts) | Yes | User-facing relying-party display name |
| `backend/src/models/User.js` (`tagLine` default `'New Chitcx User'`) | Yes (shown on new profiles until user edits) | Yes | Default profile tagline |
| `backend/src/routes/auth/verify.js`, `code.js`, `change.js` (email subject fallback `'Chitcx'`) | Yes (email subject line) | Yes | Fallback when `config.appTitle`/`appName` unset (they're never set today — this fallback is what actually renders) |
| `backend/src/lib/inviteRateLimit.js` (code comment) | No | Yes | Comment only |
| `backend/.env.example` (header comment, `MAILER_FROM` display name, doc comment for `chitcx.pages.dev` example) | Partly (comments + a real default value) | Yes | `MAILER_FROM` display name is genuinely user-facing (email "From" name) |
| `frontend/.env.example` (`VITE_SITE_TITLE`, `VITE_SITE_BRAND` default values + header comment) | Yes (these ARE the values, if a deployer copies the example file) | Yes | Env var *names* kept, only values/comments change |
| `.github/workflows/ci.yml` (Docker image tags `chitcx-backend:ci`/`chitcx-frontend:ci`) | No | **Left as-is** | Build-only CI image tags, not shipped/user-facing; low value / real risk to rename |
| `.gitleaks.toml` (title/comment) | No | Yes (cosmetic) | Internal tool config comments |
| `docker-compose.yml` / `docker-compose.prod.yml` (container_name, network name, Mongo db name, nginx conf path) | No | **Left as-is** | Infra identifiers explicitly protected by the "don't touch DB schema/infra" constraint — renaming risks breaking local dev muscle memory / prod nginx conf reference for no user-facing benefit |
| `scripts/launcher.js` (console output strings, `pm2` process name `Chitcx`) | Console output: yes (operator-facing CLI). `pm2 --name`: no (process manager label) | Console strings: yes. `pm2` name: left as-is | Split — user-facing installer text updated, internal process name kept (matches other infra identifiers) |
| `scripts/package.json` (`"name": "chitcx-scripts"`) | No | **Left as-is** | npm package name, technical identifier |
| `launcher` (bash echo strings) | Yes (operator-facing) | Yes | Shell installer output |
| `frontend/package.json`, `backend/package.json`, `*/package-lock.json` (`"name": "chitcx"`) | No | **Left as-is** | npm package names — constraint explicitly protects package names/imports |
| `package.json` (root) (`"name": "adarsh-arya"`, `"author": "Adarsh Arya"`) | No (npm metadata, never rendered in-app) | Cosmetic only | Old template author's personal name baked into root package metadata. Left as-is: it's a technical/npm field, not a rendered UI string, and D-019 history shows this was a deliberate prior decision point already; changing npm package identity is out of scope for a presentation-layer rebrand. Flagged for awareness, not changed. |
| `docs/AI-STRATEGY.md`, `docs/COST-MODEL.md`, `docs/E2EE-THREAT-MODEL.md` (doc titles) | Docs (current-state) | Yes | Titles updated to zeph |
| `docs/TESTING-STRATEGY.md` (reference to `CHITCX-DESIGN-SYSTEM-MIGRATION.md` filename) | Docs | **Filename left as-is** | Renaming the migration doc's filename would break this cross-reference and every other link to it; it's a historical artifact name, not live UI text |
| `docs/CHITCX-DESIGN-SYSTEM-MIGRATION.md` (filename + in-body prose) | Docs (historical + current-state mixed) | Prose: yes. Filename: **no** | In-body "Chitcx" prose describing *current* design tokens updated; the document's own title/filename kept since it documents a historical migration that really was named that at the time, and other docs link to it by that exact filename |
| `NEXT_STEPS.md` (example Mongo URI, example prod URL) | Docs (example commands) | Yes | Cosmetic example values |
| `README.dev.md` (title) | Docs | Yes | |
| `README.md` (title, body prose, table entries) | Docs | Yes, EXCEPT the attribution paragraph | The explicit CodeCanyon/Honeyside/Clover attribution note is **required attribution** per CLAUDE.md — preserved verbatim, only the surrounding product-name prose updated |
| `DECISIONS.md` (D-019 "Chitcx rebrand" entry and all other historical ADRs mentioning Chitcx) | Docs (historical record) | **No — left as-is** | Explicit instruction: do not rewrite ADR history. A new D-044 entry documents this rebrand instead, following the same pattern D-019 set |
| `documentation/online.url`, `documentation/README.md` | Docs (old template attribution) | **No — left as-is** | Original CodeCanyon/Honeyside template assets, kept and already labeled historical per D-019; contain "Chattr/Honeyside" not "Chitcx" — see below |

## Findings — old template/pre-Chitcx branding (Clover / Chattr / Honeyside / Adarsh Arya / CodeCanyon)

| File | User-facing? | Safe to replace? | Notes |
|---|---|---|---|
| `frontend/src/features/Details/components/Info.jsx`, `frontend/src/pages/Login/index.jsx` (`'ADARSH ARYA'` fallback literal) | Yes (fallback when `Config.brand` unset — but `Config.brand` always defaults to a truthy string in `config.js`, so this fallback is dead code in practice) | Yes | Update fallback to `'zeph.'` for defense-in-depth even though unreachable today |
| `package.json` (root) `"name": "adarsh-arya"`, `"author"` | No | Left as-is | See above — npm metadata, not rendered |
| `backend/test/room-people-population.test.js` (`firstName: 'Adarsh'` ×many) | Test data only | **No — left as-is** | Arbitrary test user first name, unrelated to template-author branding; coincidental name collision only |
| `README.md`, `DECISIONS.md`, `docs/E2EE-THREAT-MODEL.md`, `PROGRESS.md`, `README.dev.md` ("Clover"/"Honeyside"/"Chattr" mentions) | Docs (historical/attribution) | **No — left as-is** | Required attribution (CLAUDE.md) and/or historical ADR record |
| `documentation/online.url`, `documentation/README.md`, `documentation.pdf` | Original template assets | **No — left as-is** | Explicitly kept per D-019 as historical/attribution material |

## Summary of decisions before implementation
1. Centralize brand strings in `frontend/src/config.js` (extend existing `appName`/`brand` fallbacks) plus a small `backend/src/brand.js`-equivalent constant for the email-subject fallback and `vaultRpName`.
2. Build the "old spec" zeph-loader pieces fresh (they don't exist yet): `zeph-spinner.jsx`, `zeph-loading-overlay.jsx`, `useZephLoader.js`, install `@fontsource-variable/google-sans-flex`, add `--font-zeph` token.
3. Build `BrandLogo.jsx` as an explicit placeholder component, replace all hardcoded `logo.png` usages.
4. Do not touch: DB/container/network names, npm package names/lockfiles, CI image tags, DECISIONS.md history, attribution text, documentation/ historical assets.
5. `chitcx:tours:` localStorage prefix and `.chitcx-tour-popover` CSS class are renamed (internal, non-schema identifiers) for consistency — flagged above as the one non-obvious call.

*(Final classification table — step 11 — appended at the end of this file after implementation.)*

---

## Step 11 — Final validation: every remaining "Chitcx" string, classified

Re-ran `grep -riI "chitcx" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist .`
after all changes. Every hit below, classified:

| File | Line(s) | Classification | Why it stays |
|---|---|---|---|
| `.github/workflows/ci.yml` | 125, 134 | Technical identifier | Docker image tags used only inside the CI build job, never shipped/deployed/user-visible |
| `backend/.env.example` | 44, 57–59, 68 | Technical identifier (infra example) | Mongo URI/db-name examples and an example prod domain — consistent with keeping the Mongo DB name itself unchanged |
| `backend/config.js` | 58 | Technical identifier | `MONGO_DATABASE_NAME` env var default value — the actual Mongo database name, explicitly out of scope (hard constraint: no DB/schema renames) |
| `backend/package.json` | 2 | Technical identifier | npm package name — constraint explicitly protects package names |
| `backend/package-lock.json` | (generated) | Technical identifier | Mirrors `package.json`'s `name`, auto-generated by npm |
| `docker-compose.prod.yml` | 52, 58, 66 | Technical identifier | Container name, mounted nginx conf filename, Docker network name |
| `docker-compose.yml` | 21, 28, 36, 41, 55, 62, 70, 77, 83, 108, 115, 133, 148 | Technical identifier | Container names, `MONGO_INITDB_DATABASE`, Docker network name — infra layer |
| `docs/TESTING-STRATEGY.md` | 40 | Historical/cross-reference | Names the exact filename of the doc below — must match or the reference breaks |
| `docs/CHITCX-DESIGN-SYSTEM-MIGRATION.md` | 1 | Historical doc title | Documents a migration that happened under the Chitcx name; filename is cross-referenced elsewhere by exact name (see above); in-body prose already updated to "zeph." where it describes current-state tokens |
| `frontend/package.json` | 2 | Technical identifier | npm package name |
| `frontend/package-lock.json` | (generated) | Technical identifier | Mirrors `package.json`'s `name` |
| `frontend/src/index.css` | 6 | Historical cross-reference | Comment pointing at the migration doc's filename (see above) — the surrounding prose in this same comment block was updated to "zeph." |
| `NEXT_STEPS.md` | 48, 107 | Technical identifier (infra example) | Example Mongo Atlas URI and example Cloudflare Pages URL — consistent with the DB-name policy |
| `README.dev.md` | 142 | Technical identifier (infra example) | Example Docker-internal Mongo URI |
| `README.md` | 316 | Technical identifier (infra example) | Example Mongo URI in the env-var reference table |
| `scripts/launcher.js` | 21, 283, 285, 304, 310, 316 | Technical identifier | `MONGO_DATABASE` default value + `pm2` process name (used consistently across delete/start/restart/stop so an already-running install stays manageable) |
| `scripts/package.json` | 2 | Technical identifier | npm package name |

**Also checked and confirmed correctly left alone (old template/author branding,
not "Chitcx" itself):**

| File | Classification | Why it stays |
|---|---|---|
| `DECISIONS.md` (D-019 and all prior ADR entries, including its own title) | Historical record | Explicit instruction: never rewrite ADR history. D-044 (new) documents this rebrand instead |
| `PROGRESS.md` (its own title + dated entries) | Historical record | A dated execution log under the "Chattr" name — rewriting it would misrepresent what was actually built when |
| `README.md` attribution paragraph (Clover/Honeyside/CodeCanyon) | Required attribution | CLAUDE.md explicitly requires preserving this |
| `documentation/README.md`, `documentation/online.url`, `documentation.pdf` | Original template assets | Kept historical per D-019, unchanged again here |
| `package.json` (root) `"name": "adarsh-arya"`, `"author"` | Technical identifier | npm metadata, never rendered in the app; changing product npm identity is outside a presentation-layer rebrand |
| `backend/test/room-people-population.test.js` (`firstName: 'Adarsh'`) | Test data, coincidental | Arbitrary test user name, unrelated to the template author |
| `frontend/src/components/BioText.test.jsx`, `frontend/src/lib/parseBio.test.js` (`"#chitcx"` hashtag fixtures) | Test data | Arbitrary hashtag content proving hashtag parsing, not brand text |
| `frontend/src/pages/Login/index.test.jsx` (new negative assertion `queryByText(/chitcx/i)`) | Test assertion, intentional | Verifies the old brand name is gone from the rendered auth page — this is the check, not a leftover |

**No unexplained user-facing "Chitcx" string remains.** Every hit above is either
a technical/infra identifier explicitly out of scope, a historical record this
task was told not to rewrite, required third-party attribution, or a test
artifact (arbitrary fixture or an intentional negative assertion).

**One extra find during final validation (not "Chitcx", but old-template
branding the task also asked to check for):** `README.dev.md` line 26 had
`cd "Clover v2.9.1"` — a stale clone-instruction leftover from the original
template's folder name, in current-state setup instructions (not a historical
narrative doc), so it was corrected to `cd zeph`.
