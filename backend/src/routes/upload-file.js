const fs = require('fs');
const path = require('path');
const File = require('../models/File');
const storage = require('../storage');
const logger = require('../logger');
const randomstring = require('randomstring');

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB, matches the frontend's existing client-side check
const BLOCKED_EXTENSIONS = new Set([
  '.exe',
  '.bat',
  '.cmd',
  '.sh',
  '.msi',
  '.com',
  '.scr',
  '.js',
  '.jar',
  '.ps1',
  '.vbs',
  '.dll',
  '.app',
]);

module.exports = async (req, res) => {
  const file = req.files.file;

  if (!file) {
    return res.status(500).json({ status: 500, error: 'FILE_REQUIRED' });
  }

  if (file.size > MAX_FILE_SIZE) {
    return res.status(413).json({ status: 413, error: 'FILE_TOO_LARGE' });
  }

  const originalExtension = path.extname(file.name || '').toLowerCase();
  if (BLOCKED_EXTENSIONS.has(originalExtension)) {
    return res.status(415).json({ status: 415, error: 'FILE_TYPE_NOT_ALLOWED' });
  }

  const shield = randomstring.generate({ length: 120, charset: 'alphanumeric', capitalization: 'lowercase' });

  const fileObject = new File({
    name: file.name,
    author: req.user.id,
    size: file.size,
    type: file.type,
    shield,
  });

  await fileObject.save();

  const shieldedID = shield + fileObject._id;
  const safeExtension = originalExtension && originalExtension.length <= 10 ? originalExtension : '.bin';
  // See upload.js/Image.js's storageKey comment — same rationale, same
  // convention as upload-media.js.
  const storageKey = `${req.user.id}/${shieldedID}${safeExtension}`;

  try {
    await storage.putObject(storageKey, fs.createReadStream(file.path), file.type);
  } catch (err) {
    logger.error({ err, fileId: fileObject._id }, 'Failed to write file to storage');
    return res.status(500).json({ status: 500, error: 'WRITE_ERROR' });
  }

  fileObject.storageKey = storageKey;
  fileObject.shieldedID = shieldedID;

  try {
    await fileObject.save();
  } catch (err) {
    res.status(500).json({ status: 500, error: 'DATABASE_ERROR' });
  }

  res.status(200).json({ status: 200, file: fileObject });
};
