const pkg = require('../../package.json');
const store = require('../store');
const { aiTextEnabled } = require('../ai/providerRouter');
const storage = require('../storage');

module.exports = (req, res, next) => {
  const config = store.config;
  res.status(200).json({
    version: pkg.version,
    build: 8,
    nodemailerEnabled: config.nodemailerEnabled,
    aiEnabled: aiTextEnabled(config),
    // Meeting AI (transcription) needs either the Gemini multimodal model OR
    // Groq Whisper. Ollama has no bundled STT (see ai/provider.js's ollama
    // transcribe() stub). Reported separately from aiEnabled so the frontend
    // offers the meeting-recorder UI only when transcription will actually
    // work.
    meetingAiEnabled:
      (config.aiProvider === 'gemini' && !!config.geminiApiKey) ||
      (config.aiProvider === 'groq' && !!config.groqApiKey) ||
      (config.aiProvider === 'gemini' && !!config.groqApiKey),
    // Direct-to-R2 upload only exists when object storage is actually
    // configured — local-disk mode has no equivalent, so the frontend uses
    // this to choose between upload-media-presign.js's flow and the
    // original upload-media.js proxy-through-Node route. See DECISIONS.md.
    directUploadEnabled: storage.useObjectStorage,
  });
};
