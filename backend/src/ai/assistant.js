const { getProvider } = require('./provider');

// Keeps prompts short and content bounded — this is a chat assistant, not an
// open-ended completion endpoint. No conversation memory/history is sent to the
// model beyond what's explicitly passed in (privacy: only what the caller opts into).
const MAX_INPUT_CHARS = 4000;

const truncate = (text) => (text.length > MAX_INPUT_CHARS ? `${text.slice(0, MAX_INPUT_CHARS)}...` : text);

const buildAssistant = (config) => {
  const provider = getProvider(config);

  return {
    enabled: provider.enabled,

    async summarize(messages) {
      const text = truncate(messages.map((m) => `${m.author}: ${m.content}`).join('\n'));
      const prompt = `Summarize this chat conversation in 2-3 sentences. Be concise and neutral.\n\n${text}\n\nSummary:`;
      return provider.generate(prompt);
    },

    async translate(text, targetLanguage) {
      const prompt = `Translate the following message to ${targetLanguage}. Reply with only the translation, no explanation.\n\nMessage: ${truncate(text)}\n\nTranslation:`;
      return provider.generate(prompt);
    },

    async draftReply(messages) {
      const text = truncate(messages.map((m) => `${m.author}: ${m.content}`).join('\n'));
      const prompt = `Based on this conversation, draft a short, natural reply the user could send next. Reply with only the draft message, no explanation.\n\n${text}\n\nDraft reply:`;
      return provider.generate(prompt);
    },
  };
};

module.exports = { buildAssistant };
