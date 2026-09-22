const Meeting = require('../models/Meeting');
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
  const meeting = await Meeting.findById(meetingId).select('caller callee group users title').catch(() => null);
  if (!meeting) return { meeting: null, authorized: false };
  const authorized = await isAuthorizedForMeeting(meeting, userId);
  return { meeting, authorized };
};

module.exports = { isAuthorizedForMeeting, loadAuthorizedMeeting };
