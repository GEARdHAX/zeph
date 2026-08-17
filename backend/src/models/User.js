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
    default: 'New Chitcx User',
  },
  picture: { type: Schema.ObjectId, ref: 'images' },
  lastOnline: {
    type: Date,
  },
  // argon2 hash of the Private Vault PIN, same library/pattern as the login
  // password (see routes/users/change-password.js). null = vault not set up
  // yet. Never store or log the plaintext PIN.
  vaultPinHash: { type: String, default: null },
});

UserSchema.pre('save', function preSave(next) {
  if (this.isModified('username')) {
    this.usernameNormalized = this.username ? this.username.toLowerCase() : undefined;
  }
  next();
});

module.exports = User = mongoose.model('users', UserSchema);
