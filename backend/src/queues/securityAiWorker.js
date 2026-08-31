const { Worker } = require('bullmq');
const SecurityIncident = require('../models/SecurityIncident');
const logger = require('../logger');
const { getQueueConnection } = require('./connection');
const { QUEUE_NAME } = require('./securityAiQueue');
const { contextForIncident } = require('../services/securityAi/correlation');
const securityAiService = require('../services/securityAi/securityAiService');

// Processes one INCIDENT_SUMMARY analysis per job (spec section 22's
// SECURITY_AI_ANALYSIS pipeline). Idempotent (spec section 22): re-running
// this job for the same incidentId (a BullMQ retry after a transient
// failure) just re-analyzes and overwrites aiAnalysis with a fresh result
// — never creates a duplicate incident or duplicate SecurityEvent beyond
// what securityAiService.analyze() itself already records once per call.
const processIncidentAnalysis = async (job) => {
  const { incidentId } = job.data;

  const incident = await SecurityIncident.findOne({ incidentId });
  if (!incident) {
    logger.warn({ incidentId }, 'security_ai_worker_incident_not_found');
    return; // incident may have been pruned/never existed — not a retry-worthy failure
  }

  const context = contextForIncident(incident);
  const analysis = await securityAiService.analyze({ context, analysisType: 'INCIDENT_SUMMARY' });

  if (!analysis.ok) {
    // A failed/unavailable AI analysis is NOT a job failure worth BullMQ
    // retrying with backoff — securityAiService.analyze() has already
    // logged/recorded the failure (AI_ANALYSIS_FAILED etc.) and the
    // deterministic incident record itself is unaffected either way (spec
    // section 35: "AI unavailable -> deterministic security controls
    // continue"). Retrying a 'provider_disabled' or 'circuit_open' result
    // three times with exponential backoff would just hammer an already-
    // known-unavailable provider for no benefit.
    logger.info({ incidentId, reason: analysis.reason }, 'security_ai_worker_analysis_unavailable');
    return;
  }

  await SecurityIncident.updateOne({ incidentId }, {
    $set: {
      'aiAnalysis.analysisId': analysis.result.analysisId,
      'aiAnalysis.anomalous': analysis.result.anomalous,
      'aiAnalysis.confidence': analysis.result.confidence,
      'aiAnalysis.category': analysis.result.category,
      'aiAnalysis.summary': analysis.result.explanation,
      'aiAnalysis.model': analysis.result.model,
      'aiAnalysis.modelTier': analysis.result.modelTier,
      'aiAnalysis.promptVersion': analysis.result.promptVersion,
      'aiAnalysis.schemaVersion': analysis.result.schemaVersion,
      'aiAnalysis.analyzedAt': new Date(),
      updatedAt: new Date(),
    },
  });

  logger.info({ incidentId, analysisId: analysis.result.analysisId, anomalous: analysis.result.anomalous }, 'security_ai_incident_analyzed');
};

// Only started when Redis is configured — same best-effort posture as
// groupCleanupWorker.js. No worker means enqueued jobs simply wait until a
// worker process picks them up; incidents themselves are still recorded
// (correlation.js runs synchronously in the request path's fire-and-forget
// hook, not inside this worker) — only their AI summary is deferred.
const startSecurityAiWorker = () => {
  const connection = getQueueConnection();
  if (!connection) {
    logger.info('Security AI worker not started — Redis not configured');
    return null;
  }
  // concurrency:2 — an LLM call is the bottleneck resource here (Ollama is
  // typically single-model-at-a-time on modest hardware), not I/O; a low
  // concurrency avoids saturating it with parallel requests it can't
  // actually serve concurrently, matching spec section 66's "configure
  // concurrency... do not allow infinite retries."
  const worker = new Worker(QUEUE_NAME, processIncidentAnalysis, { connection, concurrency: 2 });
  worker.on('failed', (job, err) => logger.error({ err, incidentId: job?.data?.incidentId }, 'security_ai_worker_job_failed'));
  logger.info('Security AI worker started');
  return worker;
};

module.exports = { processIncidentAnalysis, startSecurityAiWorker };
