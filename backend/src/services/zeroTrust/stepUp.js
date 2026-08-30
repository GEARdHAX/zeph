const crypto = require('crypto');
const argon2 = require('argon2');
const StepUpToken = require('../../models/StepUpToken');
const User = require('../../models/User');

// STEP_UP's actual verification mechanism (spec section 17): re-entering
// the account password, verified via the SAME argon2 path every other auth
// flow in this app already uses (login.js, users/delete-account.js,
// users/change-password.js). This is NOT a second factor / MFA — ZEPH has
// no MFA today, and spec section 17 is explicit: "If MFA does not currently
// exist in ZEPH, do NOT pretend it exists." What this genuinely is: proof
// the caller still holds the account credential, right now, for this
// specific sensitive action — a real, if modest, step up from "a JWT that
// might be 60 days old" (login.js's token expiry). A future phase can plug
// a stronger verifier in here (WebAuthn, TOTP) without changing this
// module's public shape — issueStepUpToken's signature doesn't assume
// "password" is the only possible proof, only that SOME proof was checked.

const TOKEN_TTL_MS = 5 * 60 * 1000; // short-lived (spec section 18) — long enough to complete the one follow-up request, not a general-purpose session extension.

// Verifies the caller's password against their own account (never another
// user's — userId always comes from req.user, the already-authenticated
// identity, never from client input) and, on success, mints a single-use
// token bound to exactly this user+session+resource+action.
const issueStepUpToken = async ({
  userId, sessionId, resource, action, password,
}) => {
  const user = await User.findById(userId).select('password');
  if (!user) return { ok: false, reason: 'user_not_found' };

  const correct = await argon2.verify(user.password, password);
  if (!correct) return { ok: false, reason: 'incorrect_password' };

  const rawToken = crypto.randomBytes(32).toString('base64url');
  await StepUpToken.create({
    tokenHash: StepUpToken.hashToken(rawToken),
    user: userId,
    sessionId: sessionId || null,
    resource,
    action,
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
  });

  // rawToken is returned to the caller (the HTTP response) exactly once and
  // never stored anywhere in this process beyond this return — the caller
  // (lib/zeroTrust.js's step-up route, or a route calling this directly)
  // must never pass it to logger/SecurityEventService.
  return { ok: true, token: rawToken, expiresAt: new Date(Date.now() + TOKEN_TTL_MS) };
};

// Atomically consumes a step-up token — a CAS on usedAt, same race-safe
// idiom Phase 1's password-reset AuthCode consumption already established
// (backend/src/routes/auth/change.js), so a token can never authorize two
// requests even under concurrent replay. Verifies user+session+resource+
// action all match what the token was actually issued for.
const verifyAndConsumeStepUpToken = async ({
  rawToken, userId, sessionId, resource, action,
}) => {
  if (!rawToken) return { ok: false, reason: 'missing_token' };

  const tokenHash = StepUpToken.hashToken(rawToken);
  const record = await StepUpToken.findOne({ tokenHash });
  if (!record) return { ok: false, reason: 'invalid_token' };
  if (record.usedAt) return { ok: false, reason: 'already_used' };
  if (record.expiresAt < new Date()) return { ok: false, reason: 'expired' };
  if (record.user.toString() !== userId?.toString()) return { ok: false, reason: 'user_mismatch' };
  if (record.resource !== resource || record.action !== action) return { ok: false, reason: 'scope_mismatch' };
  if (sessionId && record.sessionId && record.sessionId.toString() !== sessionId.toString()) {
    return { ok: false, reason: 'session_mismatch' };
  }

  const consumed = await StepUpToken.findOneAndUpdate(
    { _id: record._id, usedAt: null },
    { $set: { usedAt: new Date() } },
  );
  if (!consumed) return { ok: false, reason: 'already_used' }; // lost a concurrent race

  return { ok: true };
};

module.exports = { issueStepUpToken, verifyAndConsumeStepUpToken, TOKEN_TTL_MS };
