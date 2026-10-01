const Meeting = require('../models/Meeting');
const MeetingParticipant = require('../models/MeetingParticipant');
const groupPolicy = require('./groupPolicy');

// Who may CREATE an invite for a meeting, and who is already an authorized
// participant (so accept.js can skip re-adding them to Meeting.users).
// Deliberately mirrors mediasoup/index.js's authorizeMeetingJoin exactly —
// that function is exported only under __testHelpers (a test-only escape
// hatch, not a real public API), so this is a small standalone copy rather
// than reaching into mediasoup's internals from a plain HTTP route. Meeting
// has no HOST/CO-HOST/PARTICIPANT role field (see Meeting.js) — "authorized
// to invite" is the same set as "authorized to join": the 1:1 caller/callee,
// any already-recorded participant, or — for a group meeting — any CURRENT
// group member (matches GroupInvite's own CREATE_INVITE capability, which
// every role including MEMBER holds).
const isAuthorizedForMeeting = async (meeting, userId) => {
  const userIdStr = userId.toString();
  if (meeting.caller && meeting.caller.toString() === userIdStr) return true;
  if (meeting.callee && meeting.callee.toString() === userIdStr) return true;
  if ((meeting.users || []).some((u) => u.toString() === userIdStr)) return true;
  if (meeting.group) {
    const membership = await groupPolicy.getMembershipWithFallback(meeting.group, userIdStr);
    if (membership) return true;
  }
  return false;
};

const loadAuthorizedMeeting = async (meetingId, userId) => {
  const meeting = await Meeting.findById(meetingId).select('caller callee group users title endedAt').catch(() => null);
  if (!meeting) return { meeting: null, authorized: false };
  const authorized = await isAuthorizedForMeeting(meeting, userId);
  return { meeting, authorized };
};

// Who may access a meeting's PAST artifacts (its summary, its participant
// list) once the meeting is over. Narrower than isAuthorizedForMeeting
// above, which also grants access to anyone CURRENTLY eligible to join a
// live call (any current group member) — correct for "can I get into the
// call," wrong for "can I read what happened in a call I never attended."
//
// Audit finding (Phase 10, N1): the previous version of this check (three
// near-identical copies in meeting/summarize.js, meeting/get-summary.js,
// and meeting/participants.js) used Meeting.users — the same append-only
// eligibility set that invite ACCEPTANCE writes to
// (meetings/invites/accept.js's $addToSet). That let a current group
// member create a meeting invite, accept it themselves, and read a
// summary for a call they never joined: acceptance never requires an
// actual mediasoup connection (see accept.js's own comment on why it
// never writes CallSession/MeetingParticipant), so Meeting.users records
// "eligible to join," not "actually attended."
//
// MeetingParticipant is the correct source of truth instead — written
// from exactly one place, callHistoryService.recordConnected, itself only
// called from mediasoup/index.js's 'join' socket handler AFTER
// authorizeMeetingJoin has already passed and a real Socket.IO room join
// has already succeeded. A row existing is proof of an actual
// backend-confirmed connection, not merely invite-accept eligibility.
const isAuthorizedForMeetingHistory = async (meeting, userId) => {
  const userIdStr = userId.toString();
  if (meeting.caller && meeting.caller.toString() === userIdStr) return true;
  if (meeting.callee && meeting.callee.toString() === userIdStr) return true;
  const participant = await MeetingParticipant.exists({ meeting: meeting._id, user: userId });
  return !!participant;
};

module.exports = { isAuthorizedForMeeting, loadAuthorizedMeeting, isAuthorizedForMeetingHistory };
