const fs = require('fs');
const Images = require('../models/Image');
const storage = require('../storage');
const cdn = require('../cdn');
const logger = require('../logger');

module.exports = async (req, res) => {
  const { id, size } = req.params;

  let descriptor;
  try {
    descriptor = await Images.findOne({ shieldedID: id });
  } catch (err) {
    logger.error({ err, imageId: id }, 'Failed to look up image descriptor');
    return res.status(404).send('Not Found');
  }
  if (!descriptor) return res.status(500);

  res.set('Content-type', 'image/jpeg');

  // storageKey rows (uploaded since the storage.js migration) resolve via
  // R2 or local disk transparently; a legacy row (upload.js pre-migration)
  // only ever has `location`, a full local-disk path — served the old way
  // since storage.js's key format assumes a relative key, not an absolute
  // path. See Image.js's storageKey comment.
  if (descriptor.storageKey) {
    const key = size ? `${descriptor.storageKey.slice(0, -4)}-${size}.jpg` : descriptor.storageKey;

    // New-scheme public images are immutable (a changed picture is a new shieldedID, hence a new
    // key), so hand the browser to the CDN edge instead of streaming through Node. Old keys and a
    // disabled CDN fall through to the original streaming path below.
    const cdnUrl = cdn.createPublicUrl(key);
    if (cdnUrl) {
      res.set('Cache-Control', 'public, max-age=3600');
      return res.redirect(302, cdnUrl);
    }

    try {
      const stream = await storage.getObjectStream(key);
      stream.pipe(res);
      stream.on('error', (err) => {
        logger.error({ err, imageId: id, key }, 'Error streaming image from storage');
        if (!res.headersSent) res.status(500).end();
      });
    } catch (err) {
      logger.warn({ err, imageId: id, key }, 'Image missing from storage');
      return res.status(404).send('Not Found');
    }
    return undefined;
  }

  let location = descriptor.location;
  if (size) {
    location = `${location.substr(0, location.length - 4)}-${size}.jpg`;
  }

  fs.access(location, fs.constants.F_OK, (err) => {
    if (err) {
      logger.warn({ err, imageId: id, location }, 'Image missing on disk');
      return res.status(404).send('Not Found');
    }
    fs.createReadStream(location).pipe(res);
  });
  return undefined;
};
