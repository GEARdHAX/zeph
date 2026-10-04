const router = require('express').Router();
const passport = require('passport');
const Config = require('../../config');
const { createTokenBucketLimiter, KeyResolvers } = require('../lib/createTokenBucketLimiter');
const zeroTrust = require('../lib/zeroTrust');
const { sensorAuth } = require('../lib/sensorAuth');
const sensorRateLimit = require('../lib/sensorRateLimit');

const jwtAuth = passport.authenticate('jwt', { session: false }, null);
// Distributed Redis token-bucket rate limiting (see docs/RATE-LIMITING.md)
// — replaces the hand-rolled single-process Map-based inviteRateLimit.js
// (removed). Policy numbers (capacity/refillRate) live in
// lib/rateLimitPolicy.js, carried over unchanged from each of these
// limiters' old (max, windowMs) pair — see that file's own comment on the
// conversion. keyResolver is chosen per route based on where each limiter
// actually sits in its route's middleware chain relative to auth, not
// assumed — see each route mount below.
const inviteCreateLimit = createTokenBucketLimiter({ policyName: 'INVITE_CREATE', keyResolver: KeyResolvers.byUser });
// Unauthenticated (preview is a public share-link landing page) — must key
// by IP, there is no user identity available here.
const invitePreviewLimit = createTokenBucketLimiter({ policyName: 'INVITE_PREVIEW', keyResolver: KeyResolvers.byIp });
const inviteAcceptLimit = createTokenBucketLimiter({ policyName: 'INVITE_ACCEPT', keyResolver: KeyResolvers.byUser });
// Phase 4 — one sensor can send at most 60 batches/min (a bpftrace-backed
// sensor batches on a several-second interval per spec section 17, so this
// is generous headroom, not a tight budget); globally, 20 sensors' worth of
// that same rate — matches spec section 55's "1/10/100 sensors" load shape
// without pre-provisioning for 100 on day one (raise if real fleet size
// approaches it). Untouched by this migration — a genuinely separate
// subsystem (sensorId identity, not userId/IP) kept on its own limiter.
const sensorEventsLimit = sensorRateLimit({ perSensorMax: 60, globalMax: 1200, windowMs: 60 * 1000 });
// Phase 6 — manual AI analysis is admin-only already, but still rate-
// limited per admin (spec section 48: "do not let users submit arbitrary
// massive data... use rate limiting") — an LLM call is expensive
// (latency, resource contention with the automated BullMQ pipeline), so
// even a trusted admin is bounded to a modest rate, not unlimited.
const aiAnalyzeLimit = createTokenBucketLimiter({ policyName: 'SECURITY_AI_ANALYZE', keyResolver: KeyResolvers.byUser });
// Phase 7 audit finding: message-send previously had no dedicated rate
// limiter — only the generic apiLimiter fallback (300 req/15min, shared
// across every /api route not otherwise covered), which is far too loose
// a budget for spam-messaging abuse specifically. 60/min is generous for
// any real conversational pace (a burst of rapid replies, pasting a long
// message split by the client, etc.) while still bounding a scripted
// flood.
const messageSendLimit = createTokenBucketLimiter({ policyName: 'MESSAGE_SEND', keyResolver: KeyResolvers.byUser });
const messageSearchLimit = createTokenBucketLimiter({ policyName: 'MESSAGE_SEARCH', keyResolver: KeyResolvers.byUser });
// A report is a serious, infrequent user action — a real user files a
// handful a day at most. Kept tight mainly to stop scripted mass-reporting
// (harassment via false reports, or flooding the admin queue).
const reportCreateLimit = createTokenBucketLimiter({ policyName: 'REPORT_CREATE', keyResolver: KeyResolvers.byUser });
// Passwordless login is unauthenticated and does a username lookup + a
// WebAuthn verify per call — bound both the enumeration surface and the
// verify cost. 20/min per IP is far above any human sign-in cadence.
const passkeyLoginLimit = createTokenBucketLimiter({ policyName: 'PASSKEY_LOGIN', keyResolver: KeyResolvers.byIp });
// Meeting invites get their own budget, separate from friend/group invites
// above — a meeting invite is meant to be short-lived and created more
// often per session (e.g. a new link per call), so sharing invite:create's
// budget would make ordinary meeting use trip the same limiter as a
// friend-invite spam attempt. Token validation/acceptance especially must
// resist brute-force guessing (spec §19) — kept tight per requester.
const meetingInviteCreateLimit = createTokenBucketLimiter({
  policyName: 'MEETING_INVITE_CREATE',
  keyResolver: KeyResolvers.byUser,
});
const meetingInvitePreviewLimit = createTokenBucketLimiter({
  policyName: 'MEETING_INVITE_PREVIEW',
  keyResolver: KeyResolvers.byIp,
});
const meetingInviteAcceptLimit = createTokenBucketLimiter({
  policyName: 'MEETING_INVITE_ACCEPT',
  keyResolver: KeyResolvers.byUser,
});

// Zero Trust (Phase 2) — mounted AFTER jwtAuth, same middleware-chain
// position every rate limiter already occupies. Only on the routes
// policies.js's POLICY_CATEGORIES table actually names as SENSITIVE/
// ADMINISTRATIVE (spec section 16: "only implement policies for operations
// that actually exist").
//
// rbacCheck is deliberately OMITTED everywhere below (defaults to
// authenticated-only) — every one of these routes ALREADY does its own
// complete RBAC/business-rule validation inline (groupPolicy.hasCapability
// + canChangeRole/canRemoveMember, self-target checks, role-hierarchy,
// returning the specific 400/403/404 each failure mode needs — see
// group/members-role.js, group/members-ban.js). An earlier version of this
// wiring gave ztChangeRole/ztBanMember their own coarser rbacCheck
// (hasCapability alone, no hierarchy/self-target nuance) — that ran BEFORE
// the handler and pre-empted its correct, specific response with a generic
// 403 zero_trust_denied, breaking groups.test.js's privilege-escalation
// assertions (expected 400, got 403; expected 404, got 403). The fix:
// RBAC stays exactly where it already lived and is already correct — Zero
// Trust here ONLY adds its risk-based STEP_UP/DENY layer on top of
// "authenticated," never attempts to re-derive a permission decision the
// handler already owns. See lib/zeroTrust.js's own comment on rbacCheck.
const ztChangePassword = zeroTrust({ resource: 'account', action: 'change_password' });
const ztDeleteAccount = zeroTrust({ resource: 'account', action: 'delete_account' });
const ztManageSessions = zeroTrust({ resource: 'account', action: 'manage_sessions' });
const ztCreateGroup = zeroTrust({ resource: 'group', action: 'create' });
const ztChangeRole = zeroTrust({ resource: 'group', action: 'change_role' });
const ztBanMember = zeroTrust({ resource: 'group', action: 'ban_member' });
const ztViewSecurityEvents = zeroTrust({ resource: 'security_events', action: 'view' });
// Threat-intel admin routes reuse the SAME policy key as the security-
// events viewer — both are the same "view internal security telemetry"
// admin surface, not a separate category worth its own policies.js entry.
const ztViewThreatIntel = zeroTrust({ resource: 'security_events', action: 'view' });

// Same handler as the unauthenticated /healthz mount in index.js (for
// docker-compose.yml's healthcheck) — this /api-prefixed alias is for
// external uptime monitors/manual checks against the hosted API origin,
// where /api/health is the more discoverable convention. /health stays an
// alias of the readiness check for backward compatibility; /health/live
// and /health/ready are the Phase 7 liveness/readiness split.
const healthRoute = require('./health');
router.get('/health', healthRoute);
router.get('/health/live', healthRoute.live);
router.get('/health/ready', healthRoute.ready);

router.get('/images/:id', require('./images'));
router.get('/files/:id', require('./files'));
router.get('/images/:id/:size', require('./images'));
router.post('/login', require('./login'));

// Passwordless login (WebAuthn passkey / fingerprint / device passcode).
// options + verify are public — this IS the sign-in entry point.
router.post('/passkey/login/options', passkeyLoginLimit, require('./passkey/login-options'));
router.post('/passkey/login/verify', passkeyLoginLimit, require('./passkey/login-verify'));
router.post('/typing', passport.authenticate('jwt', { session: false }, null), require('./typing'));
router.post('/check-user', require('./checkUser'));
router.post('/upload', passport.authenticate('jwt', { session: false }, null), require('./upload'));
router.post('/upload/file', passport.authenticate('jwt', { session: false }, null), require('./upload-file'));
router.post('/upload/media', passport.authenticate('jwt', { session: false }, null), require('./upload-media'));
router.post(
  '/upload/media/presign',
  passport.authenticate('jwt', { session: false }, null),
  require('./upload-media-presign'),
);
router.post(
  '/upload/media/:mediaId/complete',
  passport.authenticate('jwt', { session: false }, null),
  require('./upload-media-complete'),
);
router.get('/media/:id', passport.authenticate('jwt', { session: false }, null), require('./media'));
router.get(
  '/media/:id/thumbnail',
  passport.authenticate('jwt', { session: false }, null),
  require('./media').thumbnail,
);
// CDN path: same auth + room-membership check, returns a short-lived signed Cloudflare URL.
router.get('/media/:id/url', passport.authenticate('jwt', { session: false }, null), require('./media').signedUrl);
router.get(
  '/media/:id/thumbnail/url',
  passport.authenticate('jwt', { session: false }, null),
  require('./media').thumbnailSignedUrl,
);
router.post('/register', require('./register'));
router.post('/user/delete', passport.authenticate('jwt', { session: false }, null), require('./user-delete'));
router.post('/user/edit', passport.authenticate('jwt', { session: false }, null), require('./user-edit'));
router.post('/user/list', passport.authenticate('jwt', { session: false }, null), require('./user-list'));

// Zeph AI — admin: inspect / reset a user's AI quota. Admin-only (the
// handlers themselves 404 for non-admins, same posture as the security
// admin routes — see the isPrivileged 404 comment further down).
router.get('/admin/ai-quota/:userId', jwtAuth, require('./admin/ai-quota-get'));
router.post('/admin/ai-quota/reset', jwtAuth, require('./admin/ai-quota-reset'));
router.post('/admin/user/suspend', jwtAuth, require('./admin/user-suspend'));

router.post('/reports', jwtAuth, reportCreateLimit, require('./reports/create'));
router.get('/reports', jwtAuth, require('./reports/list'));
router.post('/reports/:reportId/review', jwtAuth, require('./reports/review'));
// Login-passkey management (enroll / list / remove) — authenticated: you
// must already be signed in to add or remove a passkey for your account.
router.post('/passkey/register/options', jwtAuth, require('./passkey/register-options'));
router.post('/passkey/register/verify', jwtAuth, require('./passkey/register-verify'));
router.get('/passkey/list', jwtAuth, require('./passkey/list'));
router.post('/passkey/:id/delete', jwtAuth, require('./passkey/delete'));
router.post('/picture/change', passport.authenticate('jwt', { session: false }, null), require('./change-picture'));
router.post('/picture/remove', passport.authenticate('jwt', { session: false }, null), require('./change-picture'));

router.post('/favorite/toggle', passport.authenticate('jwt', { session: false }, null), require('./toggle-favorite'));
router.post('/favorites/list', passport.authenticate('jwt', { session: false }, null), require('./list-favorites'));
router.post('/rooms/list', passport.authenticate('jwt', { session: false }, null), require('./list-rooms'));
router.post('/room/get', passport.authenticate('jwt', { session: false }, null), require('./get-room'));
router.post('/room/create', passport.authenticate('jwt', { session: false }, null), require('./create-room'));
router.post('/room/join', passport.authenticate('jwt', { session: false }, null), require('./join-room'));
router.post('/room/remove', passport.authenticate('jwt', { session: false }, null), require('./remove-room'));
router.post('/search', passport.authenticate('jwt', { session: false }, null), require('./search'));
router.post('/message', passport.authenticate('jwt', { session: false }, null), messageSendLimit, require('./message'));
router.post('/message/read', passport.authenticate('jwt', { session: false }, null), require('./message-read'));
router.post('/message/delete', passport.authenticate('jwt', { session: false }, null), require('./message-delete'));
router.post('/messages/more', passport.authenticate('jwt', { session: false }, null), require('./more-messages'));
router.post('/messages/sync', passport.authenticate('jwt', { session: false }, null), require('./sync-messages'));
router.post(
  '/messages/search',
  passport.authenticate('jwt', { session: false }, null),
  messageSearchLimit,
  require('./messages/search'),
);
router.post('/messages/around', passport.authenticate('jwt', { session: false }, null), require('./messages/around'));
router.post(
  '/group/create',
  passport.authenticate('jwt', { session: false }, null),
  ztCreateGroup,
  require('./create-group'),
);
router.post('/group/get', passport.authenticate('jwt', { session: false }, null), require('./group/get'));
router.post('/group/update', passport.authenticate('jwt', { session: false }, null), require('./group/update'));
router.post('/group/members', passport.authenticate('jwt', { session: false }, null), require('./group/members-list'));
router.post(
  '/group/members/search',
  passport.authenticate('jwt', { session: false }, null),
  require('./group/members-search'),
);
router.post(
  '/group/members/add',
  passport.authenticate('jwt', { session: false }, null),
  require('./group/members-add'),
);
router.post(
  '/group/members/remove',
  passport.authenticate('jwt', { session: false }, null),
  require('./group/members-remove'),
);
router.post(
  '/group/members/role',
  passport.authenticate('jwt', { session: false }, null),
  ztChangeRole,
  require('./group/members-role'),
);
router.post('/group/leave', passport.authenticate('jwt', { session: false }, null), require('./group/leave'));
router.post('/group/delete', passport.authenticate('jwt', { session: false }, null), require('./group/delete'));
router.post(
  '/group/members/ban',
  passport.authenticate('jwt', { session: false }, null),
  ztBanMember,
  require('./group/members-ban'),
);
router.post(
  '/group/ownership/transfer',
  passport.authenticate('jwt', { session: false }, null),
  require('./group/ownership-transfer'),
);

router.post('/group/join-requests', jwtAuth, require('./group/join-requests/create'));
router.post('/group/join-requests/list', jwtAuth, require('./group/join-requests/list'));
router.post('/group/join-requests/:userId/approve', jwtAuth, require('./group/join-requests/approve'));
router.post('/group/join-requests/:userId/deny', jwtAuth, require('./group/join-requests/deny'));

router.post(
  '/conversation/hide',
  passport.authenticate('jwt', { session: false }, null),
  require('./conversation-hide'),
);
router.post(
  '/conversation/unhide',
  passport.authenticate('jwt', { session: false }, null),
  require('./conversation-unhide'),
);
router.post(
  '/conversation/delete',
  passport.authenticate('jwt', { session: false }, null),
  require('./conversation-delete'),
);
router.post(
  '/conversation/restore',
  passport.authenticate('jwt', { session: false }, null),
  require('./conversation-restore'),
);
router.post(
  '/conversation/mute',
  passport.authenticate('jwt', { session: false }, null),
  require('./conversation-mute'),
);
router.post(
  '/conversations/removed',
  passport.authenticate('jwt', { session: false }, null),
  require('./removed-list'),
);

router.get('/vault/list', passport.authenticate('jwt', { session: false }, null), require('./vault-list'));
router.get('/vault/status', passport.authenticate('jwt', { session: false }, null), require('./vault-status'));
router.post('/vault/unlock/pin', passport.authenticate('jwt', { session: false }, null), require('./vault-unlock-pin'));
router.post('/vault/pin/setup', passport.authenticate('jwt', { session: false }, null), require('./vault-pin-setup'));
router.post(
  '/vault/webauthn/register/options',
  passport.authenticate('jwt', { session: false }, null),
  require('./vault-webauthn/register-options'),
);
router.post(
  '/vault/webauthn/register/verify',
  passport.authenticate('jwt', { session: false }, null),
  require('./vault-webauthn/register-verify'),
);
router.post(
  '/vault/webauthn/auth/options',
  passport.authenticate('jwt', { session: false }, null),
  require('./vault-webauthn/auth-options'),
);
router.post(
  '/vault/webauthn/auth/verify',
  passport.authenticate('jwt', { session: false }, null),
  require('./vault-webauthn/auth-verify'),
);

// Phase 9 audit finding: routes/rtc/create.js|join.js|peers.js removed —
// confirmed dead code (zero callers anywhere in frontend/src) with two real
// vulnerabilities: join.js granted access to any NeDB room by guessed id
// with zero authorization check, and peers.js leaked every active peer
// across every room to any authenticated caller. The real call flow goes
// entirely through meeting/*.js (HTTP) + mediasoup's Socket.IO events
// (both independently authorized this same audit pass) — these three
// routes duplicated a subset of that same store.rooms/store.peers state
// with no authorization at all. Removing unreachable, insecure code is the
// fix here, not hardening a path nothing calls.

router.post('/meeting/get', passport.authenticate('jwt', { session: false }, null), require('./meeting/get'));
router.post('/meeting/call', passport.authenticate('jwt', { session: false }, null), require('./meeting/call'));
router.post('/meeting/add', passport.authenticate('jwt', { session: false }, null), require('./meeting/add'));
router.post('/meeting/answer', passport.authenticate('jwt', { session: false }, null), require('./meeting/answer'));
router.post('/meeting/close', passport.authenticate('jwt', { session: false }, null), require('./meeting/close'));
router.post('/meeting/list', passport.authenticate('jwt', { session: false }, null), require('./meeting/list'));
router.post('/meeting/delete', passport.authenticate('jwt', { session: false }, null), require('./meeting/delete'));
router.post(
  '/meeting/:id/summarize',
  passport.authenticate('jwt', { session: false }, null),
  require('./meeting/summarize'),
);
router.get(
  '/meeting/:id/summary',
  passport.authenticate('jwt', { session: false }, null),
  require('./meeting/get-summary'),
);
router.post(
  '/meeting/:id/upload-recording',
  passport.authenticate('jwt', { session: false }, null),
  require('./meeting/upload-recording'),
);
router.get(
  '/meeting/:id/participants',
  passport.authenticate('jwt', { session: false }, null),
  require('./meeting/participants'),
);
// Call Timeline / Call History — the current user's OWN history (userId
// derived from the JWT only, spec §12). Deliberately no
// /users/:userId/call-history route.
router.get('/calls/history', passport.authenticate('jwt', { session: false }, null), require('./calls/history'));

router.post('/auth/change', require('./auth/change'));
router.post('/auth/code', require('./auth/code'));
router.post('/auth/verify', require('./auth/verify'));

router.post(
  '/users/change-password',
  passport.authenticate('jwt', { session: false }, null),
  ztChangePassword,
  require('./users/change-password'),
);
router.post(
  '/users/change-username',
  passport.authenticate('jwt', { session: false }, null),
  require('./users/change-username'),
);
router.post('/users/update-bio', passport.authenticate('jwt', { session: false }, null), require('./users/update-bio'));
router.post(
  '/users/delete-account',
  passport.authenticate('jwt', { session: false }, null),
  ztDeleteAccount,
  require('./users/delete-account'),
);

router.post('/ai/summarize', passport.authenticate('jwt', { session: false }, null), require('./ai/summarize'));
router.post('/ai/translate', passport.authenticate('jwt', { session: false }, null), require('./ai/translate'));
router.post('/ai/draft-reply', passport.authenticate('jwt', { session: false }, null), require('./ai/draft-reply'));
router.post('/ai/rewrite', passport.authenticate('jwt', { session: false }, null), require('./ai/rewrite'));
router.post('/ai/title', passport.authenticate('jwt', { session: false }, null), require('./ai/title'));
router.post('/ai/topics', passport.authenticate('jwt', { session: false }, null), require('./ai/topics'));

router.post('/logout', passport.authenticate('jwt', { session: false }, null), require('./logout'));
router.get('/sessions', passport.authenticate('jwt', { session: false }, null), require('./sessions/list'));
router.post(
  '/sessions/revoke',
  passport.authenticate('jwt', { session: false }, null),
  ztManageSessions,
  require('./sessions/revoke'),
);

router.get('/users/:username', passport.authenticate('jwt', { session: false }, null), require('./users/resolve'));

router.get(
  '/friend-requests',
  passport.authenticate('jwt', { session: false }, null),
  require('./friend-requests/list'),
);
router.post(
  '/friend-requests',
  passport.authenticate('jwt', { session: false }, null),
  require('./friend-requests/send'),
);
router.post(
  '/friend-requests/:id/accept',
  passport.authenticate('jwt', { session: false }, null),
  require('./friend-requests/accept'),
);
router.post(
  '/friend-requests/:id/decline',
  passport.authenticate('jwt', { session: false }, null),
  require('./friend-requests/decline'),
);

router.get('/friends', passport.authenticate('jwt', { session: false }, null), require('./friends/list'));

router.post('/block', passport.authenticate('jwt', { session: false }, null), require('./relationships/block'));
router.post('/unblock', passport.authenticate('jwt', { session: false }, null), require('./relationships/unblock'));

router.use('/info', require('./info'));

router.post('/friends/invites', jwtAuth, inviteCreateLimit, require('./friends/invites/create'));
router.get('/friends/invites/:token', invitePreviewLimit, require('./friends/invites/preview'));
router.post('/friends/invites/:token/accept', jwtAuth, inviteAcceptLimit, require('./friends/invites/accept'));

router.post('/group/invites/create', jwtAuth, inviteCreateLimit, require('./group/invites/create'));
router.get('/group/invites/:token', invitePreviewLimit, require('./group/invites/preview'));
router.post('/group/invites/:token/join', jwtAuth, inviteAcceptLimit, require('./group/invites/join'));
router.post('/group/invites/:token/revoke', jwtAuth, require('./group/invites/revoke'));

// Meeting share-link/QR invites — see docs (if any) and
// authorization/meetingInvitePolicy.js. Token is the sole authorization
// lookup key (never meetingId alone, spec §2); preview is intentionally
// unauthenticated (spec §11/§17); accept/create/revoke/list all require a
// real Zeph session, with the accepting identity always taken from
// req.user, never a request body field.
router.post(
  '/meetings/:meetingId/invites',
  jwtAuth,
  meetingInviteCreateLimit,
  require('./meetings/invites/create'),
);
router.get('/meetings/:meetingId/invites', jwtAuth, require('./meetings/invites/list'));
router.get('/meeting-invites/:token', meetingInvitePreviewLimit, require('./meetings/invites/preview'));
router.post(
  '/meeting-invites/:token/accept',
  jwtAuth,
  meetingInviteAcceptLimit,
  require('./meetings/invites/accept'),
);
router.post('/meeting-invites/:inviteId/revoke', jwtAuth, require('./meetings/invites/revoke'));

// Admin-only security telemetry query API (spec section 17) — RBAC enforced
// inside each handler via isPrivileged(req.user), same pattern the
// admin-privacy-boundary code already uses elsewhere (see
// authorization/policy.js), rather than a route-level middleware, so a
// denial can return the same indistinguishable-from-"doesn't exist" 404
// that convention already establishes. ztViewSecurityEvents is mounted
// WITHOUT an rbacCheck deliberately — Zero Trust's own DENY returns 403,
// which would leak "this route exists" to a non-admin BEFORE the handler's
// isPrivileged 404 ever runs. RBAC stays exactly where it already is (the
// handler); Zero Trust only adds its risk-based STEP_UP/DENY layer on top,
// for callers RBAC has already let through — spec section 14's ordering
// (RBAC, then risk) applied literally, not just in spirit.
router.get('/security/events', jwtAuth, ztViewSecurityEvents, require('./security/events-list'));
router.get('/security/events/:eventId', jwtAuth, ztViewSecurityEvents, require('./security/events-get'));
router.post('/security/step-up', jwtAuth, require('./security/step-up'));

// Phase 3 — Threat Intelligence admin API (spec sections 28-29/36).
router.get('/security/threat-intelligence', jwtAuth, ztViewThreatIntel, require('./security/threat-intelligence-list'));
router.get(
  '/security/threat-intelligence/status',
  jwtAuth,
  ztViewThreatIntel,
  require('./security/threat-intelligence-status'),
);
router.get(
  '/security/threat-intelligence/:indicator',
  jwtAuth,
  ztViewThreatIntel,
  require('./security/threat-intelligence-get'),
);

// Phase 4 — eBPF sensor ingestion (spec section 29). Deliberately NOT
// jwtAuth/passport — sensorAuth is a completely separate, least-privilege
// credential universe (req.sensor, never req.user) that can never touch
// admin/user/DB access. sensorRateLimit runs AFTER sensorAuth since it
// keys on req.sensor.sensorId.
router.post('/security/sensor/events', sensorAuth, sensorEventsLimit, require('./security/sensor-events'));

// Admin-only sensor registration (spec sections 11-13) — mints sensorId +
// one-time-reveal credential. Reuses the same "view internal security
// telemetry" admin policy as the other security admin routes above.
router.post('/security/sensor/register', jwtAuth, ztViewThreatIntel, require('./security/sensor-register'));

// Admin sensor status view (spec sections 38-39/46) — sensor/host/status/
// version/last-heartbeat/events, deliberately minimal.
router.get('/security/sensor/status', jwtAuth, ztViewThreatIntel, require('./security/sensor-status'));

// Phase 5 — Network Intelligence admin summary (spec section 47-48).
// Deliberately the ONLY new network-specific admin API this phase adds —
// raw event listing/filtering (spec's own "GET /api/security/network/events"
// suggestion) is already fully covered by the existing GET /api/security/
// events?type=... from Phase 1 (every Phase 5 event type is a real
// SecurityEventTypes entry that route already validates/returns); building
// a second, narrower listing endpoint here would be pure duplication.
router.get('/security/network/summary', jwtAuth, ztViewThreatIntel, require('./security/network-summary'));

// Phase 6 — AI Security Risk Engine admin API (spec section 47-48). Same
// "view internal security telemetry" admin policy every other security
// admin route already uses — AI incident data is exactly that, an
// analyst-facing view, never a mutation of anything authoritative.
router.get('/security/ai/incidents', jwtAuth, ztViewThreatIntel, require('./security/ai-incidents-list'));
router.get('/security/ai/incidents/:incidentId', jwtAuth, ztViewThreatIntel, require('./security/ai-incidents-get'));
router.post('/security/ai/analyze', jwtAuth, ztViewThreatIntel, aiAnalyzeLimit, require('./security/ai-analyze'));

module.exports = router;
