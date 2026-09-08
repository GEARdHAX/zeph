const { generateRegistrationOptions } = require('@simplewebauthn/server');
const PasskeyCredential = require('../../models/PasskeyCredential');
const User = require('../../models/User');
const config = require('../../../config');
const challenges = require('../../vault/webauthnChallenges');

// POST /api/passkey/register/options — start enrolling a login passkey for
// your own account. Authenticated (jwtAuth): you must already be signed in
// (with password) to add a passkey. A stolen JWT could enroll an attacker's
// authenticator here — that's an accepted risk at parity with the fact that
// a stolen JWT can already change the password (routes/change-password);
// the mitigation for both is session revocation, not a step-up on this route.
module.exports = async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ error: true });

  const existing = await PasskeyCredential.find({ user: req.user.id });

  const options = await generateRegistrationOptions({
    rpName: config.vaultRpName,
    rpID: config.vaultRpId,
    userID: Buffer.from(req.user.id.toString()),
    userName: user.username || user.email || req.user.id.toString(),
    userDisplayName: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username,
    attestationType: 'none',
    excludeCredentials: existing.map((c) => ({ id: c.credentialID, transports: c.transports })),
    // residentKey: 'required' makes the passkey discoverable — the browser
    // can offer it at sign-in with no username typed. userVerification
    // 'preferred' keeps it usable on authenticators without a biometric/PIN.
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
  });

  challenges.put(`passkey-reg:${req.user.id}`, options.challenge);
  res.status(200).json(options);
};
