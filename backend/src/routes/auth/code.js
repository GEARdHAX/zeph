const router = require('express').Router();
const AuthCode = require('../../models/AuthCode');
const Email = require('../../models/Email');
const User = require('../../models/User');
const config = require('../../../config');
const randomstring = require('randomstring');
const moment = require('moment');
const isEmpty = require('../../utils/isEmpty');
const authCodeRateLimit = require('../../lib/authCodeRateLimit');
const SecurityEventService = require('../../services/securityEventService');
const securityEventContext = require('../../utils/securityEventContext');

const allowRequest = authCodeRateLimit({ max: 5, windowMs: 60 * 60 * 1000 });

// Generic response for every outcome (unknown email, deleted/deactivated
// account, rate-limited, or a real code actually queued) — never reveal
// whether an account exists. See auth/change.js for the matching consume
// side of this flow.
const GENERIC_RESPONSE = {
  status: 'status',
  message: 'If an account exists for this email, a code has been sent.',
};

router.post('*', async (req, res) => {
  let { email } = req.fields;

  if (isEmpty(email)) {
    return res.status(400).json({ status: 'error', email: 'email required' });
  }

  email = email.trim().toLowerCase();

  if (!allowRequest(email)) {
    // Same generic response even when rate-limited — a 429 here would tell
    // an attacker the email is being actively targeted/exists. The
    // telemetry event still fires though (severity/type visible only
    // server-side, same split as the HTTP response staying generic above).
    SecurityEventService.record({
      type: 'RATE_LIMIT_TRIGGERED',
      severity: 'medium',
      source: securityEventContext(req),
      target: { resource: '/api/auth/code', action: 'request_reset_code' },
      result: 'blocked',
      metadata: { limiter: 'auth_code' },
    });
    return res.status(200).json(GENERIC_RESPONSE);
  }

  let user;

  try {
    user = await User.findOne({ email });
  } catch (e) {
    return res.status(200).json(GENERIC_RESPONSE);
  }

  if (!user || user.accountStatus !== 'ACTIVE') {
    return res.status(200).json(GENERIC_RESPONSE);
  }

  await AuthCode.updateMany({ user }, { $set: { valid: false } });

  const authCode = AuthCode({
    code: randomstring.generate({ charset: 'numeric', length: 6 }),
    valid: true,
    user: user._id,
    expires: moment().add(10, 'minutes').toDate(),
  });

  await authCode.save();
  SecurityEventService.record({
    type: 'PASSWORD_RESET_REQUESTED',
    severity: 'medium',
    actor: { userId: user._id.toString() },
    source: securityEventContext(req),
    target: { resource: '/api/auth/code', action: 'request_reset_code' },
    result: 'success',
  });

  const entry = Email({
    from: config.nodemailer.from,
    to: user.email,
    subject: `${config.appTitle || config.appName || 'zeph.'} - Authentication Code`,
    html: `<p>Hello ${user.firstName},<br/><br/>Here is your authentication code: ${authCode.code}<br/><br/>This code expires in 10 minutes.<br/><br/>If you didn't request this, you can safely ignore this email.</p>`,
  });

  entry.save();

  res.status(200).json(GENERIC_RESPONSE);
});

module.exports = router;
