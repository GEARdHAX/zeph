// In-process, single-use challenge store for WebAuthn ceremonies. A signed
// JWT challenge would be time-limited but replayable any number of times
// within its TTL — this Map is deleted-on-read instead, so a captured
// register/verify or auth/verify request can never be replayed even inside
// the TTL window. Same lightweight-in-process-state style already used for
// store.onlineUsers; like that state, this doesn't survive a multi-instance
// deploy (a challenge issued on instance A isn't visible to instance B) —
// an existing ceiling of this app's current single-process architecture,
// not a new one introduced here.
const TTL_MS = 2 * 60 * 1000;

const challenges = new Map();

const put = (userID, challenge) => {
  challenges.set(userID.toString(), { challenge, expiresAt: Date.now() + TTL_MS });
};

// Read-and-delete: the second call for the same user (replay, or a second
// legitimate attempt after a failed one) gets nothing back and must request
// a fresh challenge.
const take = (userID) => {
  const key = userID.toString();
  const entry = challenges.get(key);
  challenges.delete(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) return null;
  return entry.challenge;
};

module.exports = { put, take };
