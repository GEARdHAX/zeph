const store = require('./store');
const { isPrivileged } = require('./authorization/policy');
const Relationship = require('./models/Relationship');

// Admin privacy boundary for presence — every write to store.onlineUsers
// used to be followed by a single global store.io.emit('onlineUsers', [...]),
// meaning every connected socket (standard users included) received the
// full online/busy status of every other connected user, admins included,
// with zero filtering. This is the caller-scoped replacement: each
// currently-connected socket gets its own filtered view — a privileged
// socket sees everyone (consistent with the same "no separate route,
// caller's own level decides" principle used in search.js), a standard
// socket never sees a privileged user's presence entry at all. See
// DECISIONS.md.
//
// A blocked relationship must also hide presence, in both directions —
// otherwise a blocked user still shows as "online" in the other party's UI
// even though messaging/calling them is already denied by policy.js's
// isBlocked(). One query fetches every 'blocked' row touching a currently
// connected user, rather than a per-socket relationship lookup.
const broadcastPresence = async () => {
  const allEntries = Array.from(store.onlineUsers.values());
  const onlineIds = allEntries.map((e) => e.id);

  const blockedRelationships = await Relationship.find({
    status: 'blocked',
    $or: [{ requester: { $in: onlineIds } }, { recipient: { $in: onlineIds } }],
  }).select('requester recipient').lean();

  // Map of userId -> Set of peer ids they've blocked or been blocked by.
  const blockedPeersOf = new Map();
  blockedRelationships.forEach(({ requester, recipient }) => {
    const a = requester.toString();
    const b = recipient.toString();
    if (!blockedPeersOf.has(a)) blockedPeersOf.set(a, new Set());
    if (!blockedPeersOf.has(b)) blockedPeersOf.set(b, new Set());
    blockedPeersOf.get(a).add(b);
    blockedPeersOf.get(b).add(a);
  });

  const privilegedIds = new Set(
    allEntries.filter((e) => isPrivileged({ level: e.level })).map((e) => e.id),
  );

  // Never send `level` itself to the client — it's server-side-only
  // filtering metadata, not something any socket needs to render presence.
  const strip = (entries) => entries.map(({ level, ...rest }) => rest);

  Object.values(store.sockets || {}).forEach((socket) => {
    if (!socket || !socket.decoded_token) return;
    const viewerId = socket.decoded_token.id;
    const blockedPeers = blockedPeersOf.get(viewerId);
    const visible = isPrivileged(socket.decoded_token)
      ? allEntries
      : allEntries.filter((e) => !privilegedIds.has(e.id));
    const view = blockedPeers
      ? visible.filter((e) => !blockedPeers.has(e.id))
      : visible;
    socket.emit('onlineUsers', strip(view));
  });
};

module.exports = { broadcastPresence };
