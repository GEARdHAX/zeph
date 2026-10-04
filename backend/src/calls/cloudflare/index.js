// Cloudflare Realtime call backend: the socket-side half. The browser holds one
// RTCPeerConnection to Cloudflare's SFU (a "session"); this module is the
// authorized gateway to Cloudflare's HTTPS API. Meeting membership, room size
// and usage limits stay Zeph's job — Cloudflare has no notion of rooms.
//
// Each published Cloudflare track is exposed as a "producer" with the same
// socket events the mediasoup path emits (newProducer / remove, plus the
// store.peers records `join` returns), so the Redux store, initIO and the
// Meeting UI are identical for both backends.
//
// Socket events (all acked; error acks are { error: '<code>' }):
//   call:config      -> { backend, iceServers, limits }
//   cf:session:new  { renew?, sendOnly? }  -> { sessionId, pullSessionId }   (renew: start over after a failed connection;
//                   sendOnly: new SEND session only, used when the old one has no tracks left - Cloudflare tears down a
//                   session's transport when its last track is closed, so tracks published afterwards never arrive)
//                   Two Cloudflare sessions per socket: one PeerConnection only SENDS (push/close), the other
//                   only RECEIVES (pull/renegotiate). Mixing both directions on one connection let Cloudflare's
//                   answers clash with the receive sections, which Chrome rejects for good (see D-049).
//   cf:tracks:push  { sessionDescription, tracks:[{ mid, trackName, kind, isScreen }] }
//                   -> { sessionDescription (answer), producerIDs, rejected }
//   cf:tracks:ready { producerIDs }   publisher finished negotiating; announce to the room
//   cf:tracks:pull  { producerIDs }   -> { sessionDescription (offer), requiresImmediateRenegotiation, tracks }
//   cf:renegotiate  { sessionDescription (answer) }
//   cf:tracks:close { closes:[{ producerID, mid }] }   forced close, no renegotiation -> { ok }
//
// Security model: every handler re-runs authorizeMeetingJoin against the
// server's own record of the socket's room (store.roomIDs, only set by an
// authorized `join`). Clients never name a Cloudflare session — pulls are
// resolved from Zeph's registry, scoped to the caller's meeting, so a
// participant can't subscribe to another meeting's media.
const store = require('../../store');
const logger = require('../../logger');
const { authorizeMeetingJoin, registerLifecycleHandlers } = require('../roomLifecycle');
const { createCloudflareClient, FALLBACK_ICE_SERVERS } = require('./client');
const usageGuard = require('./usageGuard');

// Sender caps the client applies. Defaults are 720p / 1.5 Mbps: noticeably sharp in a normal
// call tile while staying modest. Tunable via CALL_MAX_VIDEO_HEIGHT / CALL_MAX_VIDEO_KBPS.
const getLimits = () => ({
  maxVideoHeight: (store.config && store.config.callMaxVideoHeight) || 720,
  maxVideoBitrate: (store.config && store.config.callMaxVideoBitrate) || 1500000,
  maxScreenBitrate: 2500000,
  maxAudioBitrate: 48000,
});

const MAX_SDP_CHARS = 100000;
const MAX_TRACKS_PER_PUSH = 3;
const MAX_PUBLISHED_PER_SOCKET = 6;
const MAX_PULL_BATCH = 8;
const MAX_PULLED_PER_SESSION = 24;
const TRACK_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const MID = /^[A-Za-z0-9_-]{1,16}$/;
const PRODUCER_ID = /^[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,64}$/;

let client = null;
const getClient = () => {
  if (!client) client = createCloudflareClient(store.config?.cloudflareRealtime || {});
  return client;
};

const sessions = new Map(); // socket.id -> { sessionId (send), pullSessionId (receive), roomId, pulled:Set<producerID> }
const joinedAt = new Map(); // socket.id -> ms

// Errors with a code the client may see; anything else becomes a generic failure
// (Cloudflare's own error text can contain account details).
class CallRequestError extends Error {
  constructor(code) {
    super(code);
    this.expose = true;
  }
}
const bad = (code = 'bad_request') => new CallRequestError(code);

const withMeeting = (socket, handler) => async (data, callback) => {
  const reply = typeof callback === 'function' ? callback : () => {};
  try {
    const roomId = store.roomIDs[socket.id];
    const userId = socket.decoded_token.id;
    const authz = await authorizeMeetingJoin(roomId, userId);
    if (!authz.ok) {
      logger.warn({ meetingId: roomId, userId, reason: authz.reason }, 'Unauthorized Cloudflare call request rejected');
      reply({ error: 'unauthorized' });
      return;
    }
    await handler({ roomId, userId }, data && typeof data === 'object' ? data : {}, reply);
  } catch (err) {
    if (!err.expose) logger.error({ err, socketId: socket.id }, 'Cloudflare call request failed');
    reply({ error: err.expose ? err.message : 'call_request_failed' });
  }
};

const requireSession = (socket, roomId) => {
  const session = sessions.get(socket.id);
  if (!session || session.roomId !== roomId) throw bad('no_session');
  return session;
};

const requireSdp = (value) => {
  if (typeof value !== 'string' || !value.length || value.length > MAX_SDP_CHARS) throw bad('bad_sdp');
  return value;
};

const requireIds = (value, max) => {
  if (!Array.isArray(value) || !value.length || value.length > max) throw bad();
  if (!value.every((id) => typeof id === 'string' && PRODUCER_ID.test(id))) throw bad();
  return [...new Set(value)];
};

const validateTracks = (tracks) => {
  if (!Array.isArray(tracks) || !tracks.length || tracks.length > MAX_TRACKS_PER_PUSH) throw bad();
  return tracks.map((t) => {
    if (!t || typeof t !== 'object') throw bad();
    const mid = String(t.mid);
    if (!MID.test(mid) || typeof t.trackName !== 'string' || !TRACK_NAME.test(t.trackName)) throw bad();
    if (t.kind !== 'audio' && t.kind !== 'video') throw bad();
    return { mid, trackName: t.trackName, kind: t.kind, isScreen: t.isScreen === true };
  });
};

const sdpOf = (description) => (description && description.sdp) || null;

// ---- lifecycle hooks (see ../roomLifecycle.js) --------------------------------
const beforeJoin = async (socket, meetingId) => {
  if (!getClient().isConfigured()) return { error: 'calls_not_configured' };
  const max = store.config?.callMaxParticipants || 4;
  const inRoom = store.consumerUserIDs[meetingId] || [];
  if (!inRoom.includes(socket.id) && inRoom.length >= max) return { error: 'room_full' };
  if (!(await usageGuard.isAllowed())) return { error: 'monthly_limit_reached' };
  joinedAt.set(socket.id, Date.now());
  return null;
};

const afterLeave = (socket) => {
  const started = joinedAt.get(socket.id);
  joinedAt.delete(socket.id);
  if (started) usageGuard.recordMinutes((Date.now() - started) / 60000);
};

const onMediaCleanup = (socketId) => {
  sessions.delete(socketId);
};

const initSocket = (socket) => {
  registerLifecycleHandlers(socket, { onMediaCleanup, beforeJoin, afterLeave });

  socket.on(
    'call:config',
    withMeeting(socket, async (ctx, data, reply) => {
      const cf = getClient();
      if (!cf.isConfigured()) {
        reply({ backend: 'cloudflare', error: 'calls_not_configured' });
        return;
      }
      let iceServers;
      try {
        iceServers = await cf.getIceServers();
      } catch (err) {
        logger.warn({ err }, 'Cloudflare TURN credentials unavailable, falling back to STUN only');
        iceServers = FALLBACK_ICE_SERVERS;
      }
      reply({ backend: 'cloudflare', iceServers, limits: getLimits() });
    }),
  );

  socket.on(
    'cf:session:new',
    withMeeting(socket, async (ctx, data, reply) => {
      const existing = sessions.get(socket.id);
      if (existing && existing.roomId === ctx.roomId && data.sendOnly) {
        // The browser dropped its (empty) send connection: any track records still on the old send
        // session are dead, and the receive session stays exactly as it is.
        const stale = await store.peers.asyncFind({ type: 'producer', socketID: socket.id });
        if (stale.length) {
          await store.peers.asyncRemove({ type: 'producer', socketID: socket.id }, { multi: true });
          stale.forEach((p) => store.io.to(ctx.roomId).emit('remove', { producerID: p.producerID, socketID: socket.id }));
        }
        existing.sessionId = await getClient().newSession();
        reply({ sessionId: existing.sessionId, pullSessionId: existing.pullSessionId });
        return;
      }
      if (existing && existing.roomId === ctx.roomId && !data.renew) {
        reply({ sessionId: existing.sessionId, pullSessionId: existing.pullSessionId });
        return;
      }
      if (existing && data.renew) {
        // The browser's connection to Cloudflare failed but the socket (and meeting
        // membership) is fine: drop this socket's tracks from the room, then start over.
        const stale = await store.peers.asyncFind({ type: 'producer', socketID: socket.id });
        await store.peers.asyncRemove({ type: 'producer', socketID: socket.id }, { multi: true });
        stale.forEach((p) => store.io.to(ctx.roomId).emit('remove', { producerID: p.producerID, socketID: socket.id }));
        sessions.delete(socket.id);
      }
      const sessionId = await getClient().newSession();
      const pullSessionId = await getClient().newSession();
      sessions.set(socket.id, { sessionId, pullSessionId, roomId: ctx.roomId, pulled: new Set() });
      reply({ sessionId, pullSessionId });
    }),
  );

  socket.on(
    'cf:tracks:push',
    withMeeting(socket, async (ctx, data, reply) => {
      const session = requireSession(socket, ctx.roomId);
      const sdp = requireSdp(data.sessionDescription);
      const tracks = validateTracks(data.tracks);

      const mine = await store.peers.asyncFind({ type: 'producer', socketID: socket.id });
      if (mine.length + tracks.length > MAX_PUBLISHED_PER_SOCKET) throw bad('too_many_tracks');
      if (tracks.some((t) => mine.some((m) => m.trackName === t.trackName))) throw bad('duplicate_track');

      const out = await getClient().pushTracks(session.sessionId, { sdp, tracks });
      const results = out.tracks || [];
      const failed = (t) => results.some((r) => (r.mid === t.mid || r.trackName === t.trackName) && r.errorCode);
      const accepted = tracks.filter((t) => !failed(t));
      const rejected = tracks.filter(failed).map((t) => t.trackName);

      // Registered as pending: invisible to `join` and not announced until the
      // publisher confirms its negotiation (cf:tracks:ready), so subscribers
      // never pull a track that isn't actually live yet.
      const producerIDs = [];
      for (const t of accepted) {
        const producerID = `${session.sessionId}/${t.trackName}`;
        await store.peers.asyncInsert({
          type: 'producer',
          socketID: socket.id,
          userID: ctx.userId,
          roomID: ctx.roomId,
          producerID,
          isScreen: t.isScreen,
          kind: t.kind,
          sessionId: session.sessionId,
          trackName: t.trackName,
          pending: true,
        });
        producerIDs.push(producerID);
      }
      reply({ sessionDescription: sdpOf(out.sessionDescription), producerIDs, rejected });
    }),
  );

  socket.on(
    'cf:tracks:ready',
    withMeeting(socket, async (ctx, data, reply) => {
      const ids = requireIds(data.producerIDs, MAX_TRACKS_PER_PUSH);
      const pending = await store.peers.asyncFind({
        type: 'producer',
        socketID: socket.id,
        producerID: { $in: ids },
        pending: true,
      });
      await store.peers.asyncUpdate(
        { type: 'producer', socketID: socket.id, producerID: { $in: ids }, pending: true },
        { $unset: { pending: true } },
        { multi: true },
      );
      pending.forEach((p) => {
        socket.to(ctx.roomId).emit('newProducer', {
          userID: ctx.userId,
          roomID: ctx.roomId,
          socketID: socket.id,
          producerID: p.producerID,
          isScreen: p.isScreen,
          kind: p.kind,
        });
      });
      reply({ announced: pending.length });
    }),
  );

  socket.on(
    'cf:tracks:pull',
    withMeeting(socket, async (ctx, data, reply) => {
      const session = requireSession(socket, ctx.roomId);
      const ids = requireIds(data.producerIDs, MAX_PULL_BATCH);

      const records = await store.peers.asyncFind({
        type: 'producer',
        roomID: ctx.roomId,
        producerID: { $in: ids },
        pending: { $ne: true },
      });
      const pullable = records.filter((r) => r.socketID !== socket.id && r.sessionId && !session.pulled.has(r.producerID));
      if (!pullable.length) throw bad('producer_not_found');
      if (session.pulled.size + pullable.length > MAX_PULLED_PER_SESSION) throw bad('too_many_tracks');

      const out = await getClient().pullTracks(
        session.pullSessionId,
        pullable.map((r) => ({ sessionId: r.sessionId, trackName: r.trackName })),
      );
      const tracks = (out.tracks || []).map((t) => {
        const producerID = `${t.sessionId}/${t.trackName}`;
        const record = pullable.find((r) => r.producerID === producerID);
        if (record && !t.errorCode) session.pulled.add(producerID);
        return { mid: t.mid, producerID, socketID: record && record.socketID, kind: record && record.kind, error: t.errorCode || undefined };
      });
      reply({
        sessionDescription: sdpOf(out.sessionDescription),
        requiresImmediateRenegotiation: !!out.requiresImmediateRenegotiation,
        tracks,
      });
    }),
  );

  socket.on(
    'cf:renegotiate',
    withMeeting(socket, async (ctx, data, reply) => {
      const session = requireSession(socket, ctx.roomId);
      await getClient().renegotiate(session.pullSessionId, requireSdp(data.sessionDescription));
      reply({ ok: true });
    }),
  );

  socket.on(
    'cf:tracks:close',
    withMeeting(socket, async (ctx, data, reply) => {
      const session = requireSession(socket, ctx.roomId);
      if (!Array.isArray(data.closes) || !data.closes.length || data.closes.length > MAX_PUBLISHED_PER_SOCKET) throw bad();
      const closes = data.closes.map((c) => {
        if (!c || typeof c.producerID !== 'string' || !PRODUCER_ID.test(c.producerID) || !MID.test(String(c.mid))) throw bad();
        return { producerID: c.producerID, mid: String(c.mid) };
      });
      const ids = closes.map((c) => c.producerID);

      // Only a socket's own tracks may be closed (same rule as mediasoup's `remove`).
      const owned = await store.peers.asyncFind({ type: 'producer', socketID: socket.id, producerID: { $in: ids } });
      if (owned.length !== new Set(ids).size) {
        logger.warn({ socketId: socket.id, ids }, 'Unauthorized Cloudflare track close attempt rejected - not the track owner');
        throw bad('unauthorized');
      }

      await getClient().closeTracks(session.sessionId, { mids: closes.map((c) => c.mid) });
      await store.peers.asyncRemove({ type: 'producer', socketID: socket.id, producerID: { $in: ids } }, { multi: true });
      ids.forEach((producerID) => store.io.to(ctx.roomId).emit('remove', { producerID, socketID: socket.id }));
      reply({ ok: true });
    }),
  );
};

const init = () => {
  const cf = getClient();
  if (cf.isConfigured()) {
    logger.info({ turn: cf.turnConfigured() }, 'Cloudflare Realtime call backend enabled');
  } else {
    logger.warn('CALL_BACKEND=cloudflare but CF_REALTIME_APP_ID / CF_REALTIME_APP_SECRET are not set - joining a call will fail with calls_not_configured');
  }
};

const close = async () => {
  sessions.clear();
  joinedAt.clear();
};

module.exports = {
  init,
  initSocket,
  close,
  __testHelpers: {
    sessions,
    joinedAt,
    getLimits,
    setClientForTests: (c) => {
      client = c;
    },
  },
};
