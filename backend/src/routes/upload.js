const { Readable } = require('stream');
const sharp = require('sharp');
const Image = require('../models/Image');
const storage = require('../storage');
const store = require('../store');
const { avatarKey } = require('../storageKeys');
const logger = require('../logger');
const randomstring = require('randomstring');

// Every picture gets a new key, so a stored avatar never changes: safe to cache for a year.
const AVATAR_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

module.exports = async (req, res) => {
  const image = req.files.image;
  const { crop } = req.fields;
  const path = image.path;

  if (!image) {
    return res.status(500).json({ status: 500, error: 'FILE_REQUIRED' });
  }

  if (image.size > MAX_IMAGE_SIZE) {
    return res.status(413).json({ status: 413, error: 'FILE_TOO_LARGE' });
  }

  if (!ALLOWED_MIME_TYPES.has(image.type)) {
    return res.status(415).json({ status: 415, error: 'FILE_TYPE_NOT_ALLOWED' });
  }

  const shield = randomstring.generate({ length: 120, charset: 'alphanumeric', capitalization: 'lowercase' });

  const imageObject = new Image({
    name: image.name,
    author: req.user.id,
    size: image.size,
    shield,
  });

  await imageObject.save();

  const shieldedID = shield + imageObject._id;
  // Same relative-key convention as upload-media.js's storageKey — resolved
  // by storage.js via R2 (when configured) or local disk otherwise, unlike
  // the old direct-fs write this replaces which only ever worked on a
  // persistent local disk (broken on Render's ephemeral filesystem). See
  // Image.js's storageKey comment / DECISIONS.md.
  const baseKey = avatarKey(req.user.id, shieldedID);

  try {
    const mainBuffer = await sharp(path).rotate().toBuffer();
    await storage.putObject(baseKey, Readable.from(mainBuffer), 'image/jpeg', { cacheControl: AVATAR_CACHE_CONTROL });

    await Promise.all(
      store.config.sizes.map(async (size) => {
        const sizedKey = `${baseKey.slice(0, -4)}-${size}.jpg`;
        const dimensions = crop === 'square' ? { width: size, height: size } : { width: size };
        const resizedBuffer = await sharp(path).rotate().resize(dimensions).toBuffer();
        await storage.putObject(sizedKey, Readable.from(resizedBuffer), 'image/jpeg', { cacheControl: AVATAR_CACHE_CONTROL });
      }),
    );
  } catch (err) {
    logger.error({ err, imageId: imageObject._id }, 'Failed to write image to storage');
    return res.status(500).json({ status: 500, error: 'WRITE_ERROR' });
  }

  imageObject.storageKey = baseKey;
  imageObject.shieldedID = shieldedID;

  try {
    await imageObject.save();
  } catch (err) {
    res.status(500).json({ status: 500, error: 'DATABASE_ERROR' });
  }

  res.status(200).json({ status: 200, image: imageObject });
};
