// Policy categories (spec section 16) — only for operations that actually
// exist as routes in this codebase today (spec: "do not invent routes that
// aren't part of ZEPH"). Each entry names the resource+action pair the
// zeroTrust() middleware (lib/zeroTrust.js) is mounted with on that route,
// and the category determines how strict policyEngine.js's risk gate is
// (see POLICY_THRESHOLDS below) — normal operations tolerate more risk
// before requiring step-up than sensitive/administrative ones do.
const PolicyCategory = Object.freeze({
  NORMAL: 'NORMAL',
  SENSITIVE: 'SENSITIVE',
  ADMINISTRATIVE: 'ADMINISTRATIVE',
});

// resource:action -> category. Every key here corresponds to a REAL route
// this phase wires zeroTrust() onto (see the route files themselves for the
// mount points) — nothing speculative. NORMAL-category actions are listed
// for completeness/documentation but are not actually wrapped with the
// middleware (see lib/zeroTrust.js's own comment on why NORMAL is a no-op
// fast path) — evaluating Zero Trust risk on every message read/send would
// itself violate spec section 31's "do not add expensive checks to every
// request."
const POLICY_CATEGORIES = Object.freeze({
  'account:change_password': PolicyCategory.SENSITIVE,
  'account:delete_account': PolicyCategory.SENSITIVE,
  'account:manage_sessions': PolicyCategory.SENSITIVE,
  'group:create': PolicyCategory.SENSITIVE,
  'group:change_role': PolicyCategory.SENSITIVE,
  'group:ban_member': PolicyCategory.SENSITIVE,
  'security_events:view': PolicyCategory.ADMINISTRATIVE,
});

// Risk score ceiling below which a request in this category is ALLOWed
// outright; above it, STEP_UP; a hardcoded absolute ceiling (not
// per-category) always forces DENY regardless of category — see
// policyEngine.js. Matches spec section 13's LOW/MEDIUM/HIGH/CRITICAL bands
// loosely but is intentionally a SEPARATE, per-category threshold, not a
// hardcoded reuse of those band boundaries — a SENSITIVE action should
// demand step-up at a lower score than a NORMAL one would, which is exactly
// why this table exists instead of one global cutoff.
const POLICY_THRESHOLDS = Object.freeze({
  [PolicyCategory.NORMAL]: { allowBelow: 80 },
  [PolicyCategory.SENSITIVE]: { allowBelow: 50 },
  [PolicyCategory.ADMINISTRATIVE]: { allowBelow: 40 },
});

// Absolute ceiling — no category ever ALLOWs or STEP_UPs above this; it's
// an automatic DENY (spec section 13's CRITICAL band floor). A revoked
// session's RISK_WEIGHTS.REVOKED_SESSION weight (100) is specifically sized
// to always land here on its own.
const DENY_ABOVE = 80;

const categoryFor = (resource, action) => POLICY_CATEGORIES[`${resource}:${action}`] || PolicyCategory.NORMAL;

module.exports = {
  PolicyCategory, POLICY_CATEGORIES, POLICY_THRESHOLDS, DENY_ABOVE, categoryFor,
};
