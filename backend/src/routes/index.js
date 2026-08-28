const router = require('express').Router();
const passport = require('passport');
const Config = require('../../config');
const inviteRateLimit = require('../lib/inviteRateLimit');

const jwtAuth = passport.authenticate('jwt', { session: false }, null);
const inviteCreateLimit = inviteRateLimit({ max: 20, windowMs: 60 * 60 * 1000, keyPrefix: 'invite:create' });
const invitePreviewLimit = inviteRateLimit({ max: 30, windowMs: 60 * 1000, keyPrefix: 'invite:preview' });
const inviteAcceptLimit = inviteRateLimit({ max: 20, windowMs: 60 * 1000, keyPrefix: 'invite:accept' });

// Same handler as the unauthenticated /healthz mount in init.js (for
// docker-compose.yml's healthcheck) — this /api-prefixed alias is for
// external uptime monitors/manual checks against the hosted API origin,
// where /api/health is the more discoverable convention.
router.get('/health', require('./health'));

router.get('/images/:id', require('./images'));
router.get('/files/:id', require('./files'));
router.get('/images/:id/:size', require('./images'));
router.post('/login', require('./login'));
router.post('/typing', passport.authenticate('jwt', { session: false }, null), require('./typing'));
router.post('/check-user', require('./checkUser'));
router.post('/upload', passport.authenticate('jwt', { session: false }, null), require('./upload'));
router.post('/upload/file', passport.authenticate('jwt', { session: false }, null), require('./upload-file'));
router.post('/upload/media', passport.authenticate('jwt', { session: false }, null), require('./upload-media'));
router.post('/upload/media/presign', passport.authenticate('jwt', { session: false }, null), require('./upload-media-presign'));
router.post('/upload/media/:mediaId/complete', passport.authenticate('jwt', { session: false }, null), require('./upload-media-complete'));
router.get('/media/:id', passport.authenticate('jwt', { session: false }, null), require('./media'));
router.get('/media/:id/thumbnail', passport.authenticate('jwt', { session: false }, null), require('./media').thumbnail);
router.post('/register', require('./register'));
router.post('/user/delete', passport.authenticate('jwt', { session: false }, null), require('./user-delete'));
router.post('/user/edit', passport.authenticate('jwt', { session: false }, null), require('./user-edit'));
router.post('/user/list', passport.authenticate('jwt', { session: false }, null), require('./user-list'));
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
router.post('/message', passport.authenticate('jwt', { session: false }, null), require('./message'));
router.post('/message/read', passport.authenticate('jwt', { session: false }, null), require('./message-read'));
router.post('/message/delete', passport.authenticate('jwt', { session: false }, null), require('./message-delete'));
router.post('/messages/more', passport.authenticate('jwt', { session: false }, null), require('./more-messages'));
router.post('/messages/sync', passport.authenticate('jwt', { session: false }, null), require('./sync-messages'));
router.post('/group/create', passport.authenticate('jwt', { session: false }, null), require('./create-group'));
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
  require('./group/members-role'),
);
router.post('/group/leave', passport.authenticate('jwt', { session: false }, null), require('./group/leave'));
router.post('/group/delete', passport.authenticate('jwt', { session: false }, null), require('./group/delete'));
router.post('/group/members/ban', passport.authenticate('jwt', { session: false }, null), require('./group/members-ban'));
router.post(
  '/group/ownership/transfer',
  passport.authenticate('jwt', { session: false }, null),
  require('./group/ownership-transfer'),
);

router.post('/group/join-requests', jwtAuth, require('./group/join-requests/create'));
router.post('/group/join-requests/list', jwtAuth, require('./group/join-requests/list'));
router.post('/group/join-requests/:userId/approve', jwtAuth, require('./group/join-requests/approve'));
router.post('/group/join-requests/:userId/deny', jwtAuth, require('./group/join-requests/deny'));

router.post('/conversation/hide', passport.authenticate('jwt', { session: false }, null), require('./conversation-hide'));
router.post('/conversation/unhide', passport.authenticate('jwt', { session: false }, null), require('./conversation-unhide'));
router.post('/conversation/delete', passport.authenticate('jwt', { session: false }, null), require('./conversation-delete'));

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

router.post('/rtc/create', passport.authenticate('jwt', { session: false }, null), require('./rtc/create'));
router.post('/rtc/join', passport.authenticate('jwt', { session: false }, null), require('./rtc/join'));
router.post('/rtc/peers', passport.authenticate('jwt', { session: false }, null), require('./rtc/peers'));

router.post('/meeting/get', passport.authenticate('jwt', { session: false }, null), require('./meeting/get'));
router.post('/meeting/call', passport.authenticate('jwt', { session: false }, null), require('./meeting/call'));
router.post('/meeting/add', passport.authenticate('jwt', { session: false }, null), require('./meeting/add'));
router.post('/meeting/answer', passport.authenticate('jwt', { session: false }, null), require('./meeting/answer'));
router.post('/meeting/close', passport.authenticate('jwt', { session: false }, null), require('./meeting/close'));
router.post('/meeting/list', passport.authenticate('jwt', { session: false }, null), require('./meeting/list'));
router.post('/meeting/delete', passport.authenticate('jwt', { session: false }, null), require('./meeting/delete'));

router.post('/auth/change', require('./auth/change'));
router.post('/auth/code', require('./auth/code'));
router.post('/auth/verify', require('./auth/verify'));

router.post(
  '/users/change-password',
  passport.authenticate('jwt', { session: false }, null),
  require('./users/change-password'),
);
router.post(
  '/users/change-username',
  passport.authenticate('jwt', { session: false }, null),
  require('./users/change-username'),
);
router.post(
  '/users/update-bio',
  passport.authenticate('jwt', { session: false }, null),
  require('./users/update-bio'),
);
router.post(
  '/users/delete-account',
  passport.authenticate('jwt', { session: false }, null),
  require('./users/delete-account'),
);

router.post('/ai/summarize', passport.authenticate('jwt', { session: false }, null), require('./ai/summarize'));
router.post('/ai/translate', passport.authenticate('jwt', { session: false }, null), require('./ai/translate'));
router.post('/ai/draft-reply', passport.authenticate('jwt', { session: false }, null), require('./ai/draft-reply'));

router.post('/logout', passport.authenticate('jwt', { session: false }, null), require('./logout'));
router.get('/sessions', passport.authenticate('jwt', { session: false }, null), require('./sessions/list'));
router.post('/sessions/revoke', passport.authenticate('jwt', { session: false }, null), require('./sessions/revoke'));

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

module.exports = router;
