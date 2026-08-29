const mongoose = require('./mongoose');
const Schema = mongoose.Schema;

const UserSchema = new Schema({
  email: { type: String, unique: true, sparse: true },
  firstName: String,
  level: {
    type: String,
    default: 'standard',
  },
  password: String,
  phone: String,
  lastName: String,
  username: { type: String, unique: true, sparse: true },
  // Lowercased mirror of `username`, kept in sync by the pre-save hook below.
  // Lets username lookup/uniqueness be case-insensitive ("Alice" and "alice"
  // are the same handle) without a case-insensitive index, which Mongo
  // doesn't support directly on a unique index.
  usernameNormalized: { type: String, unique: true, sparse: true },
  discoveryEnabled: { type: Boolean, default: true },
  fullName: String,
  favorites: [{ type: Schema.ObjectId, ref: 'rooms' }],
  tagLine: {
    type: String,
    default: 'New zeph User',
  },
  // Raw bio text using the app's own custom formatting syntax (**bold**,
  // *italic*, @mentions, #hashtags, etc. — see frontend/src/lib/parseBio.js)
  // — never HTML, never rendered via dangerouslySetInnerHTML. The ORIGINAL
  // raw string is stored as-is (word/char limits enforced in
  // users/update-bio.js at write time); parsing into safe display tokens
  // happens only at render time, client-side, via parseBio.js.
  bio: {
    type: String,
    default: '',
  },
  picture: { type: Schema.ObjectId, ref: 'images' },
  lastOnline: {
    type: Date,
  },
  // argon2 hash of the Private Vault PIN, same library/pattern as the login
  // password (see routes/users/change-password.js). null = vault not set up
  // yet. Never store or log the plaintext PIN.
  vaultPinHash: { type: String, default: null },
  // Explicit account lifecycle state. Only ACTIVE->DELETED is actually
  // wired up today (a hard-deleted document has no accountStatus to read at
  // all — this field only matters for a document that still exists).
  // DEACTIVATED is reserved schema-only: no self-service deactivation route
  // exists yet, but message.js/meeting/call.js already branch on this field
  // so that feature won't need a second migration later. See DECISIONS.md.
  accountStatus: {
    type: String,
    enum: ['ACTIVE', 'DEACTIVATED', 'DELETED'],
    default: 'ACTIVE',
  },
});

UserSchema.pre('save', function preSave(next) {
  if (this.isModified('username')) {
    this.usernameNormalized = this.username ? this.username.toLowerCase() : undefined;
  }
  next();
});

module.exports = User = mongoose.model('users', UserSchema);
