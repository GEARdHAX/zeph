const crypto = require('crypto');
const { generateAuthenticationOptions } = require('@simplewebauthn/server');
const validator = require('validator');
const PasskeyCredential = require('../../models/PasskeyCredential');
const User = require('../../models/User');
const config = require('../../../config');
const challenges = require('../../vault/webauthnChallenges');

// POST /api/passkey/login/options — public.
//
// Usernameless by default: call with no body and the browser will offer
// every discoverable passkey saved for this site; login/verify resolves the
// account from the assertion's credential id.
//
// Optional { email } (username OR email) narrows allowCredentials for older
// non-resident passkeys — but the response shape is identical either way so
// a caller still can't tell "no such user" from "user has no passkey".
//
// The challenge is stored server-side under a random flowId returned as
// `flowId`; the client passes it back on verify. Single-use, never trusts a
// client-supplied challenge.
module.exports = async (req, res) => {
  const raw = (req.fields.email || '').toString().trim().toLowerCase();

  let allowCredentials = [];
  if (raw) {
    const query = validator.isEmail(raw) ? { email: raw } : { usernameNormalized: raw };
    const user = await User.findOne(query).select('_id').lean().catch(() => null);
    if (user) {
      const creds = await PasskeyCredential.find({ user: user._id }).select('credentialID transports').lean();
      allowCredentials = creds.map((c) => ({ id: c.credentialID, transports: c.transports }));
    }
  }

  const options = await generateAuthenticationOptions({
    rpID: config.vaultRpId,
    allowCredentials,
    userVerification: 'preferred',
  });

  const flowId = crypto.randomUUID();
  challenges.put(`passkey-login-flow:${flowId}`, options.challenge);

  res.status(200).json({ ...options, flowId });
};
