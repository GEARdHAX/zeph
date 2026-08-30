const SensorCredential = require('../models/SensorCredential');
const logger = require('../logger');

// Sensor authentication (spec sections 12/30) — deliberately NOT
// passport.authenticate('jwt', ...). A sensor credential must be
// impossible to confuse with a user JWT and must carry zero user/admin
// privilege by construction: this middleware only ever attaches
// req.sensor = { sensorId, hostId } (never req.user), and no other route
// in this app reads req.sensor — the two authorization universes don't
// intersect. Header names deliberately distinct from `Authorization:
// Bearer` (which every JWT route uses) so a sensor credential can never be
// accidentally replayed against a user-authenticated endpoint or vice
// versa, and log lines/tooling can tell the two apart at a glance.
const SENSOR_ID_HEADER = 'x-zeph-sensor-id';
const SENSOR_CREDENTIAL_HEADER = 'x-zeph-sensor-credential';

const sensorAuth = async (req, res, next) => {
  const sensorId = req.headers[SENSOR_ID_HEADER];
  const rawCredential = req.headers[SENSOR_CREDENTIAL_HEADER];

  if (!sensorId || !rawCredential) {
    return res.status(401).json({ error: true, reason: 'sensor_credentials_required' });
  }

  let record;
  try {
    record = await SensorCredential.findOne({ sensorId, revokedAt: null });
  } catch (err) {
    logger.error({ err }, 'sensor_auth_lookup_failed');
    return res.status(503).json({ error: true, reason: 'auth_unavailable' });
  }

  // Same generic-failure posture as every other credential check in this
  // app (login.js, stepUp.js) — "no such sensor" and "wrong credential"
  // are indistinguishable to the caller, closing an enumeration side
  // channel for sensorId values.
  if (!record || record.credentialHash !== SensorCredential.hashCredential(rawCredential)) {
    // NEVER log rawCredential — only the sensorId that ATTEMPTED auth,
    // which is not a secret (it's meant to be operator-assigned and
    // knowable, only the credential paired with it is sensitive).
    logger.warn({ sensorId }, 'sensor_auth_failed');
    return res.status(401).json({ error: true, reason: 'invalid_sensor_credential' });
  }

  record.lastUsedAt = new Date();
  record.save().catch((err) => logger.warn({ err, sensorId }, 'Failed to update sensor lastUsedAt'));

  // Least privilege (spec section 30): req.sensor, never req.user — a
  // handler downstream that accidentally checked req.user (expecting a
  // Passport-authenticated request) simply sees undefined, not a forged
  // identity. There is no capability/role field here at all because a
  // sensor has exactly one permission it will ever need: submit telemetry.
  req.sensor = { sensorId: record.sensorId, hostId: record.hostId };
  return next();
};

module.exports = { sensorAuth, SENSOR_ID_HEADER, SENSOR_CREDENTIAL_HEADER };
