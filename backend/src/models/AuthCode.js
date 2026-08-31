const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const ObjectId = Schema.Types.ObjectId;

const AuthCodeSchema = new Schema({
  expires: {
    type: Date,
    default: Date.now(),
  },
  user: {
    type: ObjectId,
    ref: 'users',
    required: false,
  },
  code: String,
  valid: Boolean,
  email: String,
});

// Phase 7 audit finding: this collection had ZERO indexes — every
// password-reset/login-code verification (routes/auth/change.js's
// AuthCode.findOne({ code, user, valid: true })) did a full collection
// scan, and the collection had no TTL cleanup either (unlike the sibling
// GroupInvite/StepUpToken models, which both already use an
// expireAfterSeconds:0 TTL index on their own expiry field).
//
// { user: 1, valid: 1 } covers BOTH real query shapes: the verification
// findOne({ code, user, valid: true }) (code itself isn't in the index —
// codes are low-cardinality 6-digit values, so leading with the highly
// selective user+valid pair before a final in-memory code match is more
// useful than indexing code, which would do little to narrow a scan on
// its own) and auth/code.js's invalidate-previous
// updateMany({ user }, ...), which the same index also covers as a
// prefix match.
AuthCodeSchema.index({ user: 1, valid: 1 });
// TTL cleanup — expires is already the field this schema uses for expiry
// (default Date.now(), same intent as GroupInvite's expiresAt), it just
// never had a TTL index attached. expireAfterSeconds:0 means "delete at
// the timestamp stored in the field itself," matching the sibling models'
// convention exactly.
AuthCodeSchema.index({ expires: 1 }, { expireAfterSeconds: 0 });

const AuthCode = mongoose.model('AuthCode', AuthCodeSchema);

module.exports = AuthCode;
