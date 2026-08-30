const logger = require('../../logger');

// Provider circuit breaker (spec section 13 of the hardening addendum) —
// in-process state, deliberately NOT Redis-backed. A circuit breaker
// protects THIS process's outbound calls to AbuseIPDB; sharing that state
// across processes via Redis would add a coordination dependency for a
// mechanism whose whole job is "cope when a dependency is unhealthy" —
// each process independently and quickly learns the provider is down and
// opens its own circuit, which is simpler, has one less failure mode, and
// converges to the same practical effect (no process keeps hammering a
// dead provider) without Redis being on the critical path of "is Redis
// itself part of why I'm failing."
//
// CLOSED: normal — calls go through.
// OPEN: provider recently failed repeatedly — calls are skipped entirely
//   (no network attempt at all) until cooldownMs elapses.
// HALF_OPEN: cooldown elapsed — exactly ONE trial call is allowed through;
//   its outcome decides CLOSED (success) or back to OPEN (failure).
const States = Object.freeze({ CLOSED: 'CLOSED', OPEN: 'OPEN', HALF_OPEN: 'HALF_OPEN' });

// Only these failure reasons trip the breaker (spec: "trigger for repeated
// timeouts, 5xx, persistent 429s, network failures... do NOT open the
// circuit for normal clean/malicious results" — a normal CLEAN/MALICIOUS
// verdict is `ok:true` and never reaches recordFailure at all; this list is
// the abuseIpDb.js `reason` values that count as the provider itself being
// unhealthy, not the indicator being bad).
const TRIPPING_REASONS = new Set(['timeout', 'network_error', 'server_error', 'rate_limited']);

const buildCircuitBreaker = ({ failureThreshold = 5, cooldownMs = 30000 } = {}) => {
  let state = States.CLOSED;
  let consecutiveFailures = 0;
  let openedAt = null;

  const canAttempt = () => {
    if (state === States.CLOSED) return true;
    if (state === States.OPEN) {
      if (Date.now() - openedAt >= cooldownMs) {
        state = States.HALF_OPEN;
        return true; // the one trial call
      }
      return false;
    }
    return state === States.HALF_OPEN; // a trial is already in flight; a second concurrent request also gets to try (deliberately simple — see file header on why this stays in-process/uncoordinated) rather than queuing
  };

  const recordSuccess = () => {
    consecutiveFailures = 0;
    if (state !== States.CLOSED) logger.info({ previousState: state }, 'threatintel_circuit_closed');
    state = States.CLOSED;
  };

  const recordFailure = (reason) => {
    if (!TRIPPING_REASONS.has(reason)) return; // a rejected/malformed_response failure is a config/data problem, not provider unavailability — doesn't count toward tripping
    consecutiveFailures += 1;
    if (state === States.HALF_OPEN || consecutiveFailures >= failureThreshold) {
      if (state !== States.OPEN) logger.warn({ consecutiveFailures, reason }, 'threatintel_circuit_open');
      state = States.OPEN;
      openedAt = Date.now();
    }
  };

  return {
    canAttempt, recordSuccess, recordFailure, getState: () => state,
  };
};

module.exports = { buildCircuitBreaker, States };
