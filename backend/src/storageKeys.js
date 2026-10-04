// Object-key scheme for everything stored in object storage (R2 or the local-disk fallback).
//
//   public/users/{userId}/avatar/{id}.jpg            profile / room pictures (+ -{size}.jpg copies)
//   private/users/{userId}/attachments/{uuid}{ext}   chat attachments (+ -thumb.jpg)
//
// The first segment IS the visibility: the CDN Worker only ever serves `public/` (long-lived,
// cacheable) and `private/` (signed, short-lived) keys, and refuses to treat one as the other.
// The original filename is never part of a key; it lives on the Media document.
// Objects uploaded before this scheme keep their old keys and are still streamed through Node.
const crypto = require('crypto');

const PUBLIC_PREFIX = 'public/';
const PRIVATE_PREFIX = 'private/';

const avatarKey = (userId, id) => `${PUBLIC_PREFIX}users/${userId}/avatar/${id}.jpg`;

const attachmentKey = (userId, extension = '') => `${PRIVATE_PREFIX}users/${userId}/attachments/${crypto.randomUUID()}${extension}`;

const isPublicKey = (key) => typeof key === 'string' && key.startsWith(PUBLIC_PREFIX);
const isPrivateKey = (key) => typeof key === 'string' && key.startsWith(PRIVATE_PREFIX);

module.exports = { PUBLIC_PREFIX, PRIVATE_PREFIX, avatarKey, attachmentKey, isPublicKey, isPrivateKey };
