const store = require('../../store');
const logger = require('../../logger');
const { correlateEvent } = require('./correlation');
const { classifyIncidentPriority, PRIORITY_VALUES } = require('./priority');

// Called from securityEventService.js's record() after EVERY successfully
// persisted SecurityEvent (fire-and-forget, never awaited by the caller —
// same posture threatIntel/securityEventEnrichment.js's own hook already
// takes). correlateEvent() itself is a cheap no-op for the vast majority
// of event types (spec section 23: not every event is correlation-worthy —
// see correlation.js's CORRELATABLE_TYPES), so this adds negligible
// overhead to the common case (a login, a message-sent event, etc.).
//
// queues/securityAiQueue.js (which pulls in the `bullmq` package) is
// requireD LAZILY, inside the branch that actually needs it, not at this
// file's top level — bullmq's own require graph (bullmq -> ioredis and
// friends) took ~450ms to first-load in local measurement, which is
// significant added latency injected into securityEventService.js's
// record() callback if paid on literally the FIRST SecurityEvent ever
// recorded in a process, for every process, even when AI is disabled and
// this branch never runs. Deferring it here means that cost is only ever
// paid the first time an incident actually needs enqueuing.
const onSecurityEventForCorrelation = async (savedEvent) => {
  if (!store.config?.aiSecurityEnabled) return; // spec section 41 — AI-specific analysis disappears when disabled; correlation/incident tracking itself is arguably still useful, but gating it here too keeps "AI disabled" a single, simple, fully-honored switch rather than a partial one

  const incident = await correlateEvent(savedEvent);
  if (!incident) return;

  const priorityKey = classifyIncidentPriority(incident);
  if (!priorityKey) return; // not worth an AI call yet (spec section 23's own "single normal event -> no AI")

  try {
    // eslint-disable-next-line global-require
    const { enqueueIncidentAnalysis } = require('../../queues/securityAiQueue');
    await enqueueIncidentAnalysis(incident.incidentId, PRIORITY_VALUES[priorityKey]);
  } catch (err) {
    logger.warn({ err, incidentId: incident.incidentId }, 'security_ai_enqueue_failed');
  }
};

module.exports = { onSecurityEventForCorrelation };
