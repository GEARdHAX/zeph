const pkg = require('../../package.json');
const store = require('../store');
const { buildAssistant } = require('../ai/assistant');
const storage = require('../storage');

module.exports = (req, res, next) => {
  res.status(200).json({
    version: pkg.version,
    build: 8,
    nodemailerEnabled: store.config.nodemailerEnabled,
    aiEnabled: buildAssistant(store.config).enabled,
    // Direct-to-R2 upload only exists when object storage is actually
    // configured — local-disk mode has no equivalent, so the frontend uses
    // this to choose between upload-media-presign.js's flow and the
    // original upload-media.js proxy-through-Node route. See DECISIONS.md.
    directUploadEnabled: storage.useObjectStorage,
  });
};
