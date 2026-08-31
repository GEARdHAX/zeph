const { isPrivileged } = require('../../authorization/policy');
const securityAiService = require('../../services/securityAi/securityAiService');

const VALID_ANALYSIS_TYPES = new Set(['ANOMALY', 'RISK_EXPLANATION', 'INCIDENT_SUMMARY']);

// Manual analyst-triggered analysis (spec sections 47-48) — admin-only,
// rate-limited (see routes/index.js's aiAnalyzeLimit), and bounded: the
// request body is NOT passed through to securityAiService.analyze()
// as-is — it goes through the exact same sanitizeContext() allowlist
// every automated caller's context does (inside analyze() itself), so an
// admin cannot submit arbitrary massive/unbounded data to Ollama any more
// than the automated pipeline can. req.fields (express-formidable) is
// already size-limited at the app level, same as every other POST route.
module.exports = async (req, res) => {
  if (!isPrivileged(req.user)) return res.status(404).json({ error: true });

  const { analysisType, context } = req.fields;

  if (!VALID_ANALYSIS_TYPES.has(analysisType)) {
    return res.status(400).json({ error: true, reason: 'INVALID_ANALYSIS_TYPE' });
  }
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    return res.status(400).json({ error: true, reason: 'INVALID_CONTEXT' });
  }

  const analysis = await securityAiService.analyze({ context, analysisType });

  if (!analysis.ok) {
    return res.status(200).json({ status: 'unavailable', reason: analysis.reason });
  }

  res.status(200).json({ status: 'success', result: analysis.result, cached: analysis.cached });
};
