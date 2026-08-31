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

// Phase 8 audit finding: list-rooms.js's admin-privacy-boundary check runs
// `User.find({level: {$ne: 'standard'}})` on EVERY inbox load for every
// standard user — confirmed via a real explain() against seeded data:
// COLLSCAN, examining every user document to find the handful of
// privileged ones. A partialFilterExpression excluding level:'standard'
// would be the tightest fix, but MongoDB's partial-index expressions don't
// support $ne/$not (confirmed via a real CannotCreateIndex error) — and
// `level` has no fixed enum in this schema (isPrivileged() just checks
// !== 'standard', so any future level value must keep working without
// updating this index), so a hardcoded $in of today's known values
// ('root') would silently stop covering a new level added later. A plain
// full index on this low-cardinality field is still a real win: an
// index-only scan replacing a full collection scan, index size bounded by
// distinct level values (not total user count) same as any other field
// this small.
UserSchema.index({ level: 1 });

module.exports = User = mongoose.model('users', UserSchema);
