const crypto = require('crypto');
const SecurityEvent = require('../models/SecurityEvent');
const logger = require('../logger');
const { SecurityEventTypes, SecurityEventSeverities, SecurityEventResults } = require('../constants/securityEventTypes');

const VALID_TYPES = new Set(Object.values(SecurityEventTypes));

// Fields that must never end up in a persisted/logged security event, even
// nested inside caller-supplied metadata — this is the enforcement point
// spec section 6C / 21 describe, not something left to each call site's
// discipline. Matches on key name, case-insensitively, anywhere in the
// metadata object graph (arbitrary nesting depth).
const FORBIDDEN_METADATA_KEYS = [
  'password', 'passwordhash', 'newpassword', 'oldpassword',
  'token', 'accesstoken', 'refreshtoken', 'jwt',
  'otp', 'code', 'authcode', 'secret', 'apikey', 'privatekey',
  'content', 'messagecontent', 'body',
];

const isForbiddenKey = (key) => {
  const normalized = key.toLowerCase();
  return FORBIDDEN_METADATA_KEYS.some((forbidden) => normalized.includes(forbidden));
};

// Deep-sanitizes metadata before it ever reaches Mongo or Pino — strips any
// key matching the denylist above (replacing the value with a marker, not
// silently dropping the key, so a caller can tell sanitization happened
// rather than assume the field was simply absent), recurses into nested
// objects/arrays, and caps recursion depth so a pathological caller-supplied
// object can't blow the stack.
const MAX_DEPTH = 6;
const sanitizeMetadata = (value, depth = 0) => {
  if (depth > MAX_DEPTH) return '[max depth exceeded]';
  if (Array.isArray(value)) return value.map((item) => sanitizeMetadata(item, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    Object.keys(value).forEach((key) => {
      out[key] = isForbiddenKey(key) ? '[redacted]' : sanitizeMetadata(value[key], depth + 1);
    });
    return out;
  }
  return value;
};

// Central writer for every security-relevant event in the app — see
// SecurityEventTypes.js for the taxonomy. Dual-write, same intent as
// GroupAuditLog's existing pattern: a structured Pino log line (operational,
// always attempted) plus a persisted SecurityEvent document (queryable
// history, best-effort). Deliberately NOT a BullMQ-backed queue for Phase 1
// — there's no real enrichment step yet to defer to a worker (that's
// Phase 3/6's job), and the spec this implements explicitly warns against
// adding queue complexity merely for its own sake. record() is always
// fire-and-forget from the caller's perspective (never awaited, never
// throws) so a Mongo/logging hiccup can never fail the user-facing request
// that triggered the event.
const record = (event) => {
  const {
    type, severity = 'low', actor = {}, source = {}, target = {}, result = 'unknown', metadata = {}, requestId = null,
    sourceSystem = 'app',
  } = event || {};

  if (!VALID_TYPES.has(type)) {
    logger.warn({ type }, 'security_event_rejected_invalid_type');
    return;
  }
  if (!SecurityEventSeverities.includes(severity)) {
    logger.warn({ type, severity }, 'security_event_rejected_invalid_severity');
    return;
  }
  if (!SecurityEventResults.includes(result)) {
    logger.warn({ type, result }, 'security_event_rejected_invalid_result');
    return;
  }

  const safeMetadata = sanitizeMetadata(metadata);
  const eventId = crypto.randomUUID();
  const timestamp = new Date();

  // Structured Pino log — always attempted synchronously, matches the
  // fields shape spec section 9 asks for. This is the operational log; the
  // Mongo write below is the queryable audit trail (same "pino is the
  // operational log, Mongo is the in-app audit trail" split GroupAuditLog's
  // own comment documents).
  logger.info({
    event: type,
    severity,
    userId: actor.userId || null,
    sessionId: actor.sessionId || null,
    sourceIp: source.ip || null,
    requestId,
    result,
    resource: target.resource || null,
    action: target.action || null,
  }, 'security_event');

  // Never awaited by the caller — a Mongo outage must not turn a login/
  // upload/permission-check into a 500. Failure is itself logged (spec
  // section 20: "do not silently swallow errors") but never re-thrown.
  SecurityEvent.create({
    eventId,
    timestamp,
    type,
    severity,
    actor: { userId: actor.userId || null, sessionId: actor.sessionId || null },
    source: { ip: source.ip || null, userAgent: source.userAgent || null, deviceId: source.deviceId || null },
    target: { resource: target.resource || null, resourceId: target.resourceId || null, action: target.action || null },
    result,
    metadata: safeMetadata,
    requestId,
    sourceSystem,
  }).then((saved) => {
    // Phase 3 — Threat Intelligence enrichment (spec section 15). Deferred
    // require (not a top-of-file import) breaks what would otherwise be a
    // circular require: this module -> securityEventEnrichment.js ->
    // threatIntelService.js -> back to this module (THREAT_INTEL_MATCH
    // etc. are themselves recorded through record()). By the time record()
    // actually runs, both modules have already finished loading, so the
    // cycle never actually bites — this is purely to keep the require
    // GRAPH acyclic at load time, not a runtime concern.
    // eslint-disable-next-line global-require
    const { enrichSecurityEvent } = require('./threatIntel/securityEventEnrichment');
    enrichSecurityEvent(saved).catch((err) => {
      logger.warn({ err, type, eventId }, 'security_event_enrichment_dispatch_failed');
    });
  }).catch((err) => {
    logger.error({ err, type, eventId }, 'security_event_persist_failed');
  });

  return eventId;
};

module.exports = { record, sanitizeMetadata };
