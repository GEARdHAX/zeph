// Meeting lifecycle shared by every call backend (mediasoup, Cloudflare Realtime):
// who may enter a meeting, join/leave/disconnect bookkeeping, Meeting document
// updates, presence ("busy" while in a call) and call history. Nothing in here
// touches the media plane, so it loads without mediasoup's native module.
//
// Backend-specific behavior plugs in through `hooks`:
//   onMediaCleanup(socketId)        release this socket's media resources
//   beforeJoin(socket, meetingId)   optionally veto a join -> { error } (room size, usage)
//   afterLeave(socket, meetingId)   observe a completed leave (usage accounting)
const mongoose = require('mongoose');
const store = require('../store');
const User = require('../models/User');
const Meeting = require('../models/Meeting');
const logger = require('../logger');
const { broadcastPresence } = require('../presence');
const groupPolicy = require('../authorization/groupPolicy');
const callHistoryService = require('../services/callHistoryService');

// Participants per meeting, as returned to a joiner (userID/socketID/user). Mirrors the
// room-keyed bookkeeping the mediasoup module kept before the lifecycle was extracted.
const consumersObjects = {};

// Phase 9 audit finding, CRITICAL: the mediasoup `join` handler previously
// trusted `data.roomID` (actually a Meeting._id) unconditionally — any
// authenticated socket could join, consume every existing participant's
// media, and produce its own into ANY meeting merely by knowing/guessing
// the id. meeting/call.js (the HTTP route that sends the "incoming call"
// socket event) already does real Room-membership + admin-boundary
// authorization, but that check was never re-applied at the point that
// actually matters: the media-plane socket handlers, which are reachable
// directly regardless of whether meeting/call.js ever ran. This closes
// that gap at its root — one check, called from every socket handler that
// grants access to a meeting's media, rather than one per handler.
//
// A caller is authorized if they are the 1:1 call's caller/callee, already
// a recorded participant (Meeting.users — covers rejoining after a drop),
// or — for a group call — a CURRENT member of the group the meeting
// belongs to (re-checked live via groupPolicy, not just Meeting.group's
// historical reference, so someone removed from the group after the call
// started is correctly denied on their next join attempt).
const authorizeMeetingJoin = async (meetingId, userId) => {
  if (!meetingId) return { ok: false, reason: 'no_meeting_id' };
  const meeting = await Meeting.findById(meetingId)
    .select('caller callee group users')
    .catch(() => null);
  if (!meeting) return { ok: false, reason: 'meeting_not_found' };

  const userIdStr = userId.toString();
  if (meeting.caller && meeting.caller.toString() === userIdStr) return { ok: true };
  if (meeting.callee && meeting.callee.toString() === userIdStr) return { ok: true };
  if ((meeting.users || []).some((u) => u.toString() === userIdStr)) return { ok: true };

  if (meeting.group) {
    const membership = await groupPolicy.getMembershipWithFallback(meeting.group, userIdStr);
    if (membership) return { ok: true };
  }

  return { ok: false, reason: 'not_a_participant' };
};

// Shared by the explicit 'leave' event and the new 'disconnect' handler
// above — same cleanup either way, so a client that leaves cleanly and one
// that just drops the connection are handled identically. `reason` is the
// ONLY thing that differs between call sites (spec §5's disconnectReason) —
// everything else about closing a call session is identical regardless of
// why it closed.
const leaveRoom = async (socket, roomID, reason = 'left', hooks = {}) => {
  await socket.leave(roomID || 'general');
  await store.peers.asyncRemove({ socketID: socket.id }, { multi: true });
  store.io.to(roomID || 'general').emit('leave', { socketID: socket.id });
  if (hooks.onMediaCleanup) hooks.onMediaCleanup(socket.id);

  store.roomIDs[socket.id] = null;

  if (store.consumerUserIDs[roomID])
    store.consumerUserIDs[roomID].splice(store.consumerUserIDs[roomID].indexOf(socket.id), 1);

  // Zeph AI Meeting AI (Phase 14): mark the meeting genuinely ended only
  // once the LAST participant has left (checked BEFORE the $pull below
  // removes this socket from peers, using consumerUserIDs — already pruned
  // above — as "who's actually still connected"). endedAt is the anchor
  // ai/eligibility.js uses for meeting-duration eligibility; setting it on
  // every individual departure (like lastLeave already does) would make a
  // meeting with one person briefly dropping and rejoining look "ended"
  // partway through.
  const stillHasParticipants = (store.consumerUserIDs[roomID] || []).length > 0;
  const meetingUpdate = { lastLeave: Date.now(), $pull: { peers: socket.id } };
  if (!stillHasParticipants) meetingUpdate.endedAt = new Date();

  // Call Timeline / Call History — closes whichever CallSession belongs to
  // THIS socket (spec §16: a user's other tab/device, if any, has its own
  // socketId and its own session, untouched here). `reason` distinguishes
  // an explicit leave from a network/tab-close disconnect (the two call
  // sites below pass different values); 'meeting_ended' overrides 'left'
  // specifically — the LAST participant's explicit leave IS what ends the
  // meeting, worth recording as more than a generic "left." A network drop
  // that happens to be the last participant stays 'network' — the more
  // specific and useful fact about THIS disconnect.
  if (roomID) {
    const effectiveReason = !stillHasParticipants && reason === 'left' ? 'meeting_ended' : reason;
    callHistoryService
      .recordDisconnected({ socketId: socket.id, reason: effectiveReason })
      .catch((err) => logger.error({ err, meetingId: roomID, socketId: socket.id }, 'Failed to record call DISCONNECTED'));
  }

  await Meeting.findOneAndUpdate({ _id: roomID }, meetingUpdate)
    .then((meeting) => {
      // Same string-vs-ObjectId fix as the join handler above.
      (meeting?.users || []).forEach((user) => {
        socket.to(user.toString()).emit('refresh-meetings', { timestamp: Date.now() });
      });
    })
    .catch((err) => logger.error({ err, meetingId: roomID }, 'Failed to update meeting on leave'));
  socket.to(roomID).emit('consumers', { content: store.consumerUserIDs[roomID], timestamp: Date.now() });

  socket.to(roomID).emit('leave', { socketID: socket.id });

  store.onlineUsers.delete(socket);
  store.onlineUsers.set(socket, { id: socket.decoded_token.id, status: 'online', level: socket.decoded_token.level });
  broadcastPresence().catch((err) => logger.error({ err }, 'Failed to broadcast presence'));
  if (hooks.afterLeave) hooks.afterLeave(socket, roomID);
};

const registerLifecycleHandlers = (socket, hooks = {}) => {
  hooks.onMediaCleanup = hooks.onMediaCleanup || (() => {});

  socket.on('create', async (data, callback) => {
    const room = await store.rooms.asyncInsert({ lastJoin: Date.now() });
    callback(room);
  });

  socket.on('join', async (data, callback) => {
    const authz = await authorizeMeetingJoin(data.roomID, socket.decoded_token.id).catch((err) => {
      logger.error(
        { err, meetingId: data.roomID, userId: socket.decoded_token.id },
        'Meeting join authorization check failed',
      );
      return { ok: false, reason: 'authorization_check_failed' };
    });
    if (!authz.ok) {
      logger.warn(
        { meetingId: data.roomID, userId: socket.decoded_token.id, reason: authz.reason },
        'Unauthorized mediasoup join attempt rejected',
      );
      if (typeof callback === 'function') callback({ error: 'unauthorized' });
      return;
    }

    // Backend-specific admission control (room size, usage guard). Runs after
    // authorization and before anything is announced or joined.
    if (hooks.beforeJoin) {
      const blocked = await hooks.beforeJoin(socket, data.roomID);
      if (blocked && blocked.error) {
        if (typeof callback === 'function') callback({ error: blocked.error });
        return;
      }
    }

    const user = await User.findOne({ _id: socket.decoded_token.id }, { password: 0 }).populate([
      { path: 'picture', strictPopulate: false },
    ]);
    socket.to(data.roomID).emit('newPeer', { userID: socket.decoded_token.id, socketID: socket.id, user });
    consumersObjects[data.roomID] = {
      ...(consumersObjects[data.roomID] || {}),
      [socket.id]: { userID: socket.decoded_token.id, socketID: socket.id, user },
    };

    await socket.join(data.roomID || 'general');
    if (data.roomID) await store.rooms.asyncUpdate({ _id: data.roomID }, { $set: { lastJoin: Date.now() } });
    const peers = await store.peers.asyncFind({ type: 'producer', roomID: data.roomID || 'general', pending: { $ne: true } });

    if (!store.consumerUserIDs[data.roomID]) store.consumerUserIDs[data.roomID] = [];
    store.consumerUserIDs[data.roomID].push(socket.id);

    socket.to(data.roomID).emit('consumers', { content: store.consumerUserIDs[data.roomID], timestamp: Date.now() });

    await Meeting.findOneAndUpdate(
      { _id: data.roomID },
      {
        lastEnter: Date.now(),
        $push: { peers: socket.id },
        $addToSet: { users: mongoose.Types.ObjectId(socket.decoded_token.id) },
      },
    )
      .then((meeting) => {
        // Personal-room delivery keys rooms by the plain string passed to
        // socket.join(id) in init.js (socket.decoded_token.id, a JWT-payload
        // string) — meeting.users is an array of raw Mongoose ObjectId
        // instances (never populated here), and Socket.IO's room lookup is
        // a string-keyed Map, so socket.to(objectIdInstance) silently
        // matched no room at all: every "someone joined/left" notification
        // was emitted into the void, and the sidebar's meeting list only
        // ever showed whatever getMeetings() happened to fetch once on
        // mount — exactly the reported "shows 0 participants until I
        // reopen/refresh" symptom.
        meeting.users.forEach((user) => {
          socket.to(user.toString()).emit('refresh-meetings', { timestamp: Date.now() });
        });
      })
      .catch((err) => logger.error({ err, meetingId: data.roomID }, 'Failed to update meeting on join'));

    store.roomIDs[socket.id] = data.roomID;

    store.onlineUsers.delete(socket);
    store.onlineUsers.set(socket, { id: socket.decoded_token.id, status: 'busy', level: socket.decoded_token.level });
    broadcastPresence().catch((err) => logger.error({ err }, 'Failed to broadcast presence'));

    // Call Timeline / Call History — this is the backend-confirmed point of
    // connection (spec §4): authorization already passed above AND
    // socket.join() has already succeeded, not merely "the frontend
    // attempted to join." data.roomID is only a real Meeting._id for an
    // actual meeting/call room, never the 'general' fallback lobby.
    if (data.roomID) {
      callHistoryService
        .recordConnected({ meetingId: data.roomID, userId: socket.decoded_token.id, socketId: socket.id })
        .catch((err) => logger.error({ err, meetingId: data.roomID, socketId: socket.id }, 'Failed to record call CONNECTED'));
    }

    callback({
      producers: peers,
      consumers: { content: store.consumerUserIDs[data.roomID], timestamp: Date.now() },
      peers: consumersObjects[data.roomID],
    });
  });

  socket.on('leave', async (data, callback) => {
    // Audit finding (Phase 10, N4): this trusted data.roomID from the
    // client, same as the 'disconnect' handler below does NOT (it already
    // correctly uses store.roomIDs[socket.id]). A client sending an
    // arbitrary/wrong roomID hit leaveRoom's
    // consumerUserIDs[roomID].splice(indexOf(socket.id), 1) — if this
    // socket isn't actually in THAT room's list, indexOf returns -1 and
    // splice(-1, 1) silently removes the room's LAST entry instead: some
    // other, unrelated participant's socket id. That can falsely flip
    // stillHasParticipants to empty, setting Meeting.endedAt and closing a
    // stranger's CallSession for a meeting the caller was never even
    // authorized into. Using the server's own record of this socket's
    // room (same source 'disconnect' already trusts) makes both the
    // authorization gap and the splice bug impossible: this will always be
    // either the room the socket actually joined, or null/undefined.
    await leaveRoom(socket, store.roomIDs[socket.id], 'left', hooks);
    if (callback) callback();
  });

  // Phase 7 audit finding: this handler did not exist — a client that
  // disconnects WITHOUT first emitting 'leave' (network loss, tab close,
  // crash) never ran ANY of the leave cleanup below. Its transports/
  // producers/consumers (real mediasoup UDP transports and C++ resources)
  // stayed open on the worker until the whole process restarted, and the
  // meeting/room bookkeeping (store.peers, store.consumerUserIDs,
  // Meeting.peers) never got pruned either. Reuses the exact same
  // leaveRoom() cleanup 'leave' already used, keyed off whatever room this
  // socket was last known to be in (store.roomIDs, set on join).
  socket.on('disconnect', async (socketIODisconnectReason) => {
    const roomID = store.roomIDs[socket.id];
    if (roomID) {
      // Socket.IO's own disconnect reason ('client namespace disconnect' /
      // 'server namespace disconnect' / 'ping timeout' / 'transport close'
      // / 'transport error' etc.) is the most specific signal available for
      // spec §5's disconnectReason enum — 'server namespace disconnect' is
      // this process calling socket.disconnect() itself (an explicit
      // server-side kick), everything else here is some flavor of the
      // connection dropping without the client cleanly emitting 'leave'.
      const reason = socketIODisconnectReason === 'server namespace disconnect' ? 'server' : 'network';
      await leaveRoom(socket, roomID, reason, hooks).catch((err) =>
        logger.error({ err, socketId: socket.id }, 'Failed to clean up mediasoup state on disconnect'),
      );
    } else {
      // Never joined a room (e.g. dropped mid-handshake) — still clear any
      // transports/producers/consumers this socket may have created.
      hooks.onMediaCleanup(socket.id);
    }
  });
};

module.exports = { authorizeMeetingJoin, leaveRoom, registerLifecycleHandlers };
