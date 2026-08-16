const File = require('../models/File');
const mkdirp = require('mkdirp');
const fs = require('fs');
const path = require('path');
const store = require('../store');
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

  const filePath = file.path;
  const shield = randomstring.generate({ length: 120, charset: 'alphanumeric', capitalization: 'lowercase' });

  let fileObject;

  fileObject = new File({
    name: file.name,
    author: req.user.id,
    size: file.size,
    file: file.type,
    shield,
  });

  await fileObject.save();

  const folder = `${store.config.dataFolder}/${req.user.id}`;

  try {
    await mkdirp(folder);
  } catch (err) {
    return res.status(500).json({ status: 500, error: 'WRITE_ERROR' });
  }

  const shieldedID = shield + file._id;
  const safeExtension = originalExtension && originalExtension.length <= 10 ? originalExtension : '.bin';

  const location = `${folder}/${shieldedID}${safeExtension}`;

  const stream = fs.createWriteStream(location);
  const reader = fs.createReadStream(filePath);
  reader.pipe(stream);

  fileObject.location = location;
  fileObject.shieldedID = shieldedID;

  try {
    await fileObject.save();
  } catch (err) {
    res.status(500).json({ status: 500, error: 'DATABASE_ERROR' });
  }

  res.status(200).json({ status: 200, file: fileObject });
};
