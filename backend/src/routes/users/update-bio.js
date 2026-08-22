const User = require('../../models/User');

// Must match frontend/src/features/Panel/components/EditBioPopup.jsx and
// frontend/src/lib/parseBio.js's own limits — no shared constant across the
// Node/browser boundary, so keep these three in sync by hand.
const MAX_WORDS = 150;
const MAX_CHARS = 1000;

const wordCount = (text) => text.trim().split(/\s+/).filter(Boolean).length;

module.exports = async (req, res) => {
  // No HTML sanitization needed — bio is stored as the ORIGINAL raw string
  // using the app's own **bold**/*italic*/@mention/#hashtag syntax (see
  // parseBio.js), never HTML. It is only ever parsed into safe React
  // elements at render time, client-side, so there is no HTML-injection
  // surface to sanitize against here: a literal "<script>" typed into a
  // bio is stored and later rendered as inert, visible text.
  const raw = typeof req.fields.bio === 'string' ? req.fields.bio : '';

  if (raw.length > MAX_CHARS) {
    return res.status(400).json({ error: true, reason: 'bio_too_long', maxWords: MAX_WORDS, maxChars: MAX_CHARS });
  }
  if (wordCount(raw) > MAX_WORDS) {
    return res.status(400).json({ error: true, reason: 'bio_too_long', maxWords: MAX_WORDS, maxChars: MAX_CHARS });
  }

  const updated = await User.findOneAndUpdate(
    { _id: req.user.id },
    { $set: { bio: raw } },
    { new: true },
  ).select('-email -password -friends -__v -vaultPinHash');

  res.status(200).json({ status: 'success', user: updated });
};
