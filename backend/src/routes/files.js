const fs = require('fs');
const File = require('../models/File');
const storage = require('../storage');
const logger = require('../logger');

module.exports = async (req, res) => {
  const { id } = req.params;

  let descriptor;
  try {
    descriptor = await File.findOne({ shieldedID: id });
  } catch (err) {
    logger.error({ err, fileId: id }, 'Failed to look up file descriptor');
    return res.status(404).send('Not Found');
  }
  if (!descriptor) return res.status(500);

  res.set('Content-type', descriptor.type);

  // See images.js's identical storageKey/location split.
  if (descriptor.storageKey) {
    try {
      const stream = await storage.getObjectStream(descriptor.storageKey);
      stream.pipe(res);
      stream.on('error', (err) => {
        logger.error({ err, fileId: id }, 'Error streaming file from storage');
        if (!res.headersSent) res.status(500).end();
      });
    } catch (err) {
      logger.warn({ err, fileId: id }, 'File missing from storage');
      return res.status(404).send('Not Found');
    }
    return undefined;
  }

  const location = descriptor.location;
  fs.access(location, fs.constants.F_OK, (err) => {
    if (err) {
      logger.warn({ err, fileId: id, location }, 'File missing on disk');
    }
    fs.createReadStream(location).pipe(res);
  });
  return undefined;
};
