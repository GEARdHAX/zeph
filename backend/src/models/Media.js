const mongoose = require('./mongoose');
const Schema = mongoose.Schema;

// Unified metadata-only model for every NEW attachment (image/video/audio/
// pdf/document/archive/text) uploaded via upload-media.js — the actual
// binary lives in object storage (storage.js), never in this document. The
// legacy `images`/`files` collections stay untouched for existing messages
// (see DECISIONS.md's media-architecture entry) — this is additive, not a
// migration.
const MediaSchema = new Schema({
  uploaderId: { type: Schema.ObjectId, ref: 'users' },
  originalName: String,
  mimeType: String,
  category: {
    type: String,
    enum: ['image', 'video', 'audio', 'pdf', 'document', 'archive', 'text'],
  },
  size: Number,
  width: Number,
  height: Number,
  duration: Number,
  storageKey: String,
  thumbnailKey: { type: String, default: null },
  status: {
    type: String,
    enum: ['UPLOADING', 'PROCESSING', 'READY', 'FAILED'],
    default: 'READY',
  },
  createdAt: { type: Date, default: Date.now },
});

// media.js looks up by _id (route param) — the default _id index already
// covers that; no additional index needed for the current access pattern.

module.exports = mongoose.model('media', MediaSchema);
