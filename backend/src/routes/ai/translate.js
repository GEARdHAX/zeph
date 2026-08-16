const store = require('../../store');
const { buildAssistant } = require('../../ai/assistant');

module.exports = async (req, res, next) => {
  const { text, targetLanguage } = req.fields;

  if (!text || !targetLanguage) {
    return res.status(400).json({ error: true });
  }

  const assistant = buildAssistant(store.config);
  if (!assistant.enabled) {
    return res.status(503).json({ error: true, message: 'AI features are not enabled on this server.' });
  }

  try {
    const translation = await assistant.translate(text, targetLanguage);
    res.status(200).json({ translation });
  } catch (err) {
    res.status(502).json({ error: true, message: 'AI provider request failed.' });
  }
};
