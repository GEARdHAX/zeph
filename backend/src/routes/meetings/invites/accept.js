const MeetingInvite = require('../../../models/MeetingInvite');
const MeetingInviteAcceptance = require('../../../models/MeetingInviteAcceptance');
const Meeting = require('../../../models/Meeting');
const CallSession = require('../../../models/CallSession');
const { hashToken } = require('../../../lib/inviteToken');
const logger = require('../../../logger');

// POST /api/meeting-invites/:token/accept — the ONLY write path in this
// invite system. Authenticated (mounted with jwtAuth in routes/index.js);
// the accepting identity comes exclusively from req.user, never a body
// field — see routes/index.js's mount and the spec's explicit warning
// against trusting a client-supplied userId.
//
// What this route does NOT do, on purpose: it never creates a CallSession
// or MeetingParticipant row. Those are written from exactly one place —
// mediasoup/index.js's 'join' socket handler, after a real WebRTC
// connection is established (see that file's own comment on
// authorizeMeetingJoin). Accepting an invite only grants ELIGIBILITY to
// pass that later check, by adding the user to Meeting.users — the same
// field a rejoin-after-drop already relies on. INVITE ACCEPTED ≠ MEETING
// CONNECTED falls out of this for free; no extra guard needed.
module.exports = async (req, res) => {
  const { token } = req.params;
  const userId = req.user.id;
  const tokenHash = hashToken(token);

  // Atomic claim, same TOCTOU-safe pattern as group/invites/join.js — the
  // filter itself enforces "not revoked, not expired, not exhausted," so a
  // race between two concurrent accepts (or an accept landing exactly as
  // the invite expires) can never slip through between a check and a write.
  const invite = await MeetingInvite.findOneAndUpdate(
    {
      tokenHash,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
      $or: [{ maxUses: null }, { $expr: { $lt: ['$useCount', '$maxUses'] } }],
    },
    { $inc: { useCount: 1 } },
    { new: true },
  );
  if (!invite) {
    logger.warn({ userId, reason: 'invalid_or_expired' }, 'meeting_invite_rejected');
    return res.status(404).json({ error: true, reason: 'INVITE_NOT_FOUND' });
  }

  const meeting = await Meeting.findById(invite.meeting).catch(() => null);
  if (!meeting) {
    logger.warn({ inviteId: invite._id, userId, reason: 'meeting_not_found' }, 'meeting_invite_rejected');
    return res.status(404).json({ error: true, reason: 'MEETING_NOT_FOUND' });
  }

  // Audit finding (Phase 10, N2): accept never checked whether the meeting
  // had already ended. A stranger could accept a still-"valid" (not
  // expired/revoked) invite link to a meeting that finished hours earlier,
  // which — before the MeetingParticipant-based authorization fix above —
  // granted retroactive summary access, and still pointlessly pollutes
  // Meeting.users (the live-join eligibility set) for a meeting that's
  // over. Refunds the use-count the atomic claim above already consumed,
  // same pattern as the ALREADY_IN_MEETING rejection below.
  if (meeting.endedAt) {
    await MeetingInvite.updateOne({ _id: invite._id }, { $inc: { useCount: -1 } });
    logger.info({ meetingId: meeting._id, inviteId: invite._id, userId }, 'meeting_invite_rejected_meeting_ended');
    return res.status(410).json({ error: true, reason: 'MEETING_ENDED' });
  }

  // Real bug this guards against: the invite creator (or anyone already on
  // the call) opens their own invite link — e.g. a second tab/device, or
  // just re-clicking a link they shared — and the accept-then-navigate flow
  // pushes them through callManager.join() a SECOND time. That's a genuine
  // second mediasoup socket for the same user (multi-device join is
  // intentionally supported, see CallSession's own model comment), but the
  // second tab typically has no fresh camera/mic grant, producing a real
  // peer entry with zero media tracks — a "ghost" tile in the grid with no
  // video/audio, indistinguishable from a broken participant. This refunds
  // the use-count it just atomically claimed above and refuses acceptance
  // outright rather than silently letting a redundant join happen — an
  // already-active participant doesn't need to "accept" anything, they're
  // already in the meeting.
  const activeSession = await CallSession.findOne({ meeting: meeting._id, user: userId, status: 'ACTIVE' });
  if (activeSession) {
    await MeetingInvite.updateOne({ _id: invite._id }, { $inc: { useCount: -1 } });
    logger.info({ meetingId: meeting._id, inviteId: invite._id, userId }, 'meeting_invite_rejected_already_active');
    return res.status(409).json({
      error: true,
      reason: 'ALREADY_IN_MEETING',
      meeting: { id: meeting._id, title: meeting.title || 'Zeph meeting' },
    });
  }

  // Idempotent: a repeat accept of the same invite by the same user must
  // never double-count against maxUses or create a second acceptance row.
  // The unique {invite,user} index is the real guard; this upsert just
  // makes a second call a no-op instead of a duplicate-key error.
  let acceptance;
  let wasNew = false;
  try {
    const before = await MeetingInviteAcceptance.findOne({ invite: invite._id, user: userId });
    acceptance = await MeetingInviteAcceptance.findOneAndUpdate(
      { invite: invite._id, user: userId },
      { $setOnInsert: { meeting: meeting._id, acceptedAt: new Date() } },
      { upsert: true, new: true },
    );
    wasNew = !before;
  } catch (err) {
    if (err.code === 11000) {
      acceptance = await MeetingInviteAcceptance.findOne({ invite: invite._id, user: userId });
    } else {
      logger.error({ err, inviteId: invite._id, userId }, 'Failed to record meeting invite acceptance');
      return res.status(500).json({ error: true });
    }
  }

  // A repeat accept still refunds the useCount this call just incremented
  // above — the atomic claim happens before we know whether this is a
  // duplicate, so an already-accepted user re-opening the link must not
  // silently eat into a limited-use invite's remaining budget.
  if (!wasNew) {
    await MeetingInvite.updateOne({ _id: invite._id }, { $inc: { useCount: -1 } });
  }

  // Grants eligibility for the NEXT real join attempt (authorizeMeetingJoin
  // in mediasoup/index.js checks Meeting.users) — never grants HOST/admin
  // standing, since Meeting has no such field to escalate into (spec §8).
  await Meeting.updateOne({ _id: meeting._id }, { $addToSet: { users: userId } });

  logger.info({ meetingId: meeting._id, inviteId: invite._id, userId, wasNew }, 'meeting_invite_accepted');
  res.status(200).json({
    status: 'success',
    meeting: { id: meeting._id, title: meeting.title || 'Zeph meeting' },
    acceptedAt: acceptance.acceptedAt,
  });
};
