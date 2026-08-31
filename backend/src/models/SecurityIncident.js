const mongoose = require('./mongoose');
const Schema = mongoose.Schema;

// Correlated multi-event incident (spec sections 31-33) — the ONE new
// model this phase introduces. Individual AI analyses already live as
// SecurityEvent documents (AI_SECURITY_ANALYSIS/AI_ANOMALY_DETECTED —
// spec section 32: "do not duplicate existing security-event storage
// unnecessarily"); this model exists for the thing SecurityEvent's flat,
// one-row-per-event shape genuinely cannot represent: MANY correlated
// events (10,000 related events -> ONE incident, spec section 33), with a
// single AI-generated narrative summary attached, that persists and can be
// looked up/updated as evidence accumulates over its lifetime.
const SecurityIncidentSchema = new Schema({
  incidentId: { type: String, required: true, unique: true },

  startedAt: { type: Date, required: true },
  lastSeenAt: { type: Date, required: true },

  severity: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'], // same vocabulary as SecurityEvent.severity
    default: 'low',
  },

  // Deterministic correlation key (spec section 33: "use deterministic
  // correlation keys where appropriate") — how the correlation layer
  // decided these events belong together (e.g. sensorId+hostId within a
  // time window). Not exposed as anything more than a debugging/dedup
  // aid; the actual grouping logic lives in correlation.js, not here.
  correlationKey: { type: String, required: true, index: true },

  signals: [{ type: String }], // bounded set of signal labels — same allowlisted vocabulary sanitizer.js's ALLOWED_SIGNAL_LABELS uses, not arbitrary free text
  hosts: [{ type: String }],
  sensorIds: [{ type: String }],
  sources: [{ type: String }], // which subsystems contributed evidence: 'ebpf' | 'network_sensor' | 'threat_intelligence' | 'app'

  // How many underlying SecurityEvent documents this incident represents —
  // NOT a list of their _ids (spec section 29/64: do not duplicate/store
  // unnecessary raw data) — an admin drilling into an incident queries
  // SecurityEvent directly by correlationKey/time-range/hosts, this is
  // just a cheap displayed count.
  eventCount: { type: Number, default: 0 },

  // Advisory AI analysis attached to this incident (spec section 32's own
  // worked example) — same normalized shape schema.js validates, PLUS the
  // audit metadata spec section 43 asks for. anomalous:null / confidence:
  // null / summary:null means "no AI analysis has run for this incident
  // yet" (AI disabled, provider unavailable, or not yet processed) —
  // distinct from a real analysis that concluded anomalous:false.
  aiAnalysis: {
    analysisId: { type: String, default: null },
    anomalous: { type: Boolean, default: null },
    confidence: { type: Number, min: 0, max: 100, default: null },
    category: { type: String, default: null },
    summary: { type: String, default: null }, // the INCIDENT_SUMMARY analysisType's explanation field
    model: { type: String, default: null },
    modelTier: { type: String, default: null },
    promptVersion: { type: Number, default: null },
    schemaVersion: { type: Number, default: null },
    analyzedAt: { type: Date, default: null },
  },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// lastSeenAt+severity: the admin incident list's default sort/filter.
SecurityIncidentSchema.index({ lastSeenAt: -1, severity: 1 });

module.exports = mongoose.model('securityIncidents', SecurityIncidentSchema);
