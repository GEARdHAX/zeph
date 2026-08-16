const pkg = require('../../package.json');
const store = require('../store');
const { buildAssistant } = require('../ai/assistant');

module.exports = (req, res, next) => {
  res.status(200).json({
    version: pkg.version,
    build: 8,
    nodemailerEnabled: store.config.nodemailerEnabled,
    aiEnabled: buildAssistant(store.config).enabled,
  });
};
