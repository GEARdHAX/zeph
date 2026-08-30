const mongoose = require('./mongoose');
const Schema = mongoose.Schema;

// Persistent, normalized threat intelligence (spec section 4/12) — MongoDB
// is the source-of-truth history; Redis (threatIntel/cache.js) is the
// short-lived lookup-latency cache in front of it. One document per unique
// (type, normalizedIndicator) pair, kept up to date rather than duplicated
// on every re-check (see ThreatIntelService.js's upsert).
const ThreatIndicatorSchema = new Schema({
  // Original, as first submitted/observed — display-only, never used for
  // lookups (normalizedIndicator is, via the unique index below).
  indicator: { type: String, required: true },

  normalizedIndicator: { type: String, required: true },

  type: {
    type: String,
    enum: ['IP', 'DOMAIN', 'URL', 'HASH'], // matches indicators.js's IndicatorTypes exactly
    required: true,
  },

  // Three-state, not boolean — spec section 15 (Phase 2) and this phase's
  // own "UNKNOWN is not CLEAN" rule (section 15) both depend on this NOT
  // collapsing to true/false. malicious:false in the old two-state sense
  // would be indistinguishable from "never checked" or "provider had no
  // opinion" — status makes that distinction explicit and queryable.
  status: {
    type: String,
    enum: ['CLEAN', 'MALICIOUS', 'UNKNOWN'],
    default: 'UNKNOWN',
  },

  // 0-100, normalized regardless of the source provider's own scale (spec
  // section 21) — see threatIntel/confidence.js for the documented mapping.
  confidence: { type: Number, min: 0, max: 100, default: 0 },

  severity: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'], // same vocabulary as SecurityEvent.severity — one severity scale across the whole security layer, not a second one to reconcile
    default: 'low',
  },

  // Provider-reported categories, normalized to this closed set (spec
  // section 22) — "only use categories the provider actually establishes,"
  // so this stays empty rather than guessing when a provider gives none.
  categories: [{
    type: String,
    enum: ['MALWARE', 'PHISHING', 'BOTNET', 'C2', 'SCANNING', 'SPAM', 'ABUSE', 'UNKNOWN'],
  }],

  source: { type: String, required: true }, // e.g. 'abuseipdb' — see threatIntel/providers/

  // Provider's own record/report id, where it has one (AbuseIPDB doesn't
  // expose a stable per-lookup id; kept for a future provider that does,
  // e.g. a VirusTotal analysis id).
  sourceId: { type: String, default: null },

  firstSeen: { type: Date, default: Date.now },
  lastSeen: { type: Date, default: Date.now },

  // When this record should be treated as stale and re-checked (spec
  // section 26) — NOT a Mongo TTL index (see the comment below the schema):
  // this phase must keep the record queryable/visible after expiry,
  // "expired" is a display/re-lookup-trigger state, not a deletion trigger.
  expiresAt: { type: Date, required: true },

  // Lifecycle (spec section 27) — separate axis from status. ACTIVE/
  // EXPIRED are derived from expiresAt at read time in practice (see
  // ThreatIntelService.js), but kept as a real field too so a future
  // explicit REVOKED (a provider retracting a report, a confirmed false
  // positive) has somewhere to live without a schema change.
  lifecycle: {
    type: String,
    enum: ['ACTIVE', 'EXPIRED', 'REVOKED'],
    default: 'ACTIVE',
  },

  // Small, normalized provider detail worth keeping (e.g. AbuseIPDB's
  // reportCount/countryCode) — NEVER the raw provider response wholesale
  // (spec section 4's own instruction: "do not duplicate the complete
  // provider response... store only useful normalized information").
  // ThreatIntelService.js is the enforcement point for what goes in here,
  // same "sanitize before persisting" split Phase 1's SecurityEventService
  // already established for its own metadata field.
  metadata: { type: Schema.Types.Mixed, default: {} },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// The one-document-per-indicator invariant — every lookup/upsert in
// ThreatIntelService.js goes through this compound key.
ThreatIndicatorSchema.index({ normalizedIndicator: 1, type: 1 }, { unique: true });
// Admin search API filters (spec section 28).
ThreatIndicatorSchema.index({ type: 1, status: 1, updatedAt: -1 });
ThreatIndicatorSchema.index({ severity: 1, updatedAt: -1 });
ThreatIndicatorSchema.index({ source: 1 });
// "which indicators need a refresh" — the BullMQ refresh job's own query.
ThreatIndicatorSchema.index({ expiresAt: 1 });

// No Mongo TTL here — unlike a cache row, an expired ThreatIndicator is
// still meaningful historical evidence (spec section 27: "do not delete
// historical security evidence unnecessarily"; section 26: "do not blindly
// treat old indicators as permanently malicious" — the fix for staleness is
// re-checking and updating status/lifecycle, never silently disappearing
// the record). Same reasoning SecurityEvent.js's own no-TTL decision
// documents.

module.exports = mongoose.model('threatIndicators', ThreatIndicatorSchema);
