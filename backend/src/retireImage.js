// Replacing a profile picture should replace it, not pile up: when a user switches to a new picture
// (or removes theirs) the old image's objects and record are deleted.
//
// A new picture always gets a NEW key (never an overwrite of the old one): public image URLs are
// cached for a year (immutable) in browsers and at the CDN edge, so rewriting the same key would keep
// showing the old picture. "Replace" therefore means: point the user at the new image, then delete the
// old one.
//
// Deleting is deliberately conservative. The old image is kept if
//   - it was not uploaded by this user (a picture id is client-supplied; never delete someone else's),
//   - a chat message still shows it (legacy image messages reference the image by shieldedID), or
//   - another user or a group is still using it as their picture.
const Image = require('./models/Image');
const Message = require('./models/Message');
const Room = require('./models/Room');
const User = require('./models/User');
const storage = require('./storage');
const store = require('./store');
const logger = require('./logger');

// Main object plus every resized copy, as written by routes/upload.js.
const keysFor = (image) => {
  if (!image.storageKey) return []; // legacy local-disk row: nothing in object storage to remove
  const base = image.storageKey.slice(0, -4);
  return [image.storageKey, ...(store.config.sizes || []).map((size) => `${base}-${size}.jpg`)];
};

// Never throws: a failed cleanup must not fail the picture change itself.
const retireImage = async (oldImageId, newImageId, userId) => {
  try {
    if (!oldImageId || String(oldImageId) === String(newImageId || '')) return false;

    const image = await Image.findById(oldImageId);
    if (!image || String(image.author) !== String(userId)) return false;

    const [inMessage, inRoom, usedByOther] = await Promise.all([
      Message.exists({ content: image.shieldedID }),
      Room.exists({ picture: image._id }),
      User.exists({ picture: image._id, _id: { $ne: userId } }),
    ]);
    if (inMessage || inRoom || usedByOther) return false;

    await Promise.all(
      keysFor(image).map((key) =>
        storage.deleteObject(key).catch((err) => logger.warn({ err, imageId: image._id }, 'Failed to delete old picture object')),
      ),
    );
    await Image.deleteOne({ _id: image._id });
    return true;
  } catch (err) {
    logger.warn({ err, userId }, 'Failed to retire the previous profile picture');
    return false;
  }
};

module.exports = { retireImage, keysFor };
