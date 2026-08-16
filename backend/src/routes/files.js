const File = require('../models/File');
const fs = require('fs');
const logger = require('../logger');

module.exports = (req, res, next) => {
  const { id } = req.params;

  File.findOne({ shieldedID: id })
    .then((descriptor) => {
      if (!descriptor) return res.status(500);

      let location = descriptor.location;

      fs.access(location, fs.constants.F_OK, (err) => {
        if (err) {
          logger.warn({ err, fileId: id }, 'File missing on disk');
          // TODO handle missing file
        }

        fs.createReadStream(location).pipe(res);
        res.set('Content-type', descriptor.type);
        res.status(200);
      });
    })
    .catch((err) => {
      logger.error({ err, fileId: id }, 'Failed to look up file descriptor');
      // TODO handle missing database entry
    });
};
