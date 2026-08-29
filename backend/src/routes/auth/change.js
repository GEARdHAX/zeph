const router = require('express').Router();
const AuthCode = require('../../models/AuthCode');
const Email = require('../../models/Email');
const User = require('../../models/User');
const Session = require('../../models/Session');
const config = require('../../../config');
const moment = require('moment');
const argon2 = require('argon2');
const logger = require('../../logger');

// Same generic error for every rejection reason (missing/unknown/expired/
// already-used code) — don't let an attacker distinguish them.
const INVALID_CODE_RESPONSE = { status: 'error', code: 'Invalid or expired code.' };

router.post('*', async (req, res) => {
  let { code, email, password } = req.fields;

  let user;
  let authCode;

  if (!email) {
    return res.status(404).json({ status: 'error', code: 'email required' });
  }

  if (!code) {
    return res.status(404).json({ status: 'error', code: 'auth code required' });
  }

  email = email.trim().toLowerCase();

  try {
    user = await User.findOne({ email });
  } catch (e) {
    return res.status(404).json(INVALID_CODE_RESPONSE);
  }

  if (!user || user.accountStatus !== 'ACTIVE') {
    return res.status(404).json(INVALID_CODE_RESPONSE);
  }

  try {
    authCode = await AuthCode.findOne({ code, user, valid: true });
  } catch (e) {
    return res.status(404).json(INVALID_CODE_RESPONSE);
  }

  if (!authCode) {
    return res.status(404).json(INVALID_CODE_RESPONSE);
  }

  if (moment(authCode.expires).isBefore(moment())) {
    return res.status(404).json(INVALID_CODE_RESPONSE);
  }

  if (password.length < 6) {
    return res.status(400).json({ status: 'error', password: 'password too short, must be at least 6 characters' });
  }

  // Atomically consume the code — a losing concurrent request (replay, or
  // two simultaneous submits of the same code) sees valid:false and falls
  // through to the same generic invalid/expired response above.
  const consumed = await AuthCode.findOneAndUpdate(
    { _id: authCode._id, valid: true },
    { $set: { valid: false } },
  );
  if (!consumed) {
    return res.status(404).json(INVALID_CODE_RESPONSE);
  }

  user.password = await argon2.hash(password);
  await user.save();

  // Force re-login everywhere — matches "logout all devices" semantics
  // already enforced by the JWT strategy's revokedAt check in init.js.
  await Session.updateMany({ user: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });

  logger.info({ userId: user._id.toString() }, 'PASSWORD_RESET_SUCCESS');

  const entry = Email({
    from: config.nodemailer.from,
    to: user.email,
    subject: `${config.appTitle || config.appName || 'zeph.'} - Password changed`,
    html: `<p>Hello ${user.firstName},<br/><br/>Your password has been changed and you have been signed out of all devices.<br/><br/>If you didn't request this, please contact support immediately.<br/><br/>Timestamp: ${moment().format(
      'HH:mm - D MMMM YYYY',
    )}</p>`,
  });

  entry.save();

  res.status(200).json({ status: 'status', message: 'email queued' });
});

module.exports = router;
