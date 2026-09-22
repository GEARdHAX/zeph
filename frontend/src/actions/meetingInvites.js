import axios from 'axios';
import Config from '../config';

// expiresIn is a validated KEY (see backend's EXPIRY_OPTIONS_MS in
// routes/meetings/invites/create.js), never a raw timestamp — the server
// computes expiresAt itself, spec §3/§20.
export const createMeetingInvite = (meetingId, { expiresIn, maxUses } = {}) =>
  axios({
    method: 'post',
    url: `${Config.url || ''}/api/meetings/${meetingId}/invites`,
    data: { expiresIn, maxUses },
  });

export const listMeetingInvites = (meetingId) =>
  axios({
    method: 'get',
    url: `${Config.url || ''}/api/meetings/${meetingId}/invites`,
  });

// Unauthenticated-safe — used by the /invite/m/:token preview page before
// the visitor has signed in.
export const previewMeetingInvite = (token, signal) =>
  axios({
    method: 'get',
    url: `${Config.url || ''}/api/meeting-invites/${token}`,
    signal,
  });

export const acceptMeetingInvite = (token) =>
  axios({
    method: 'post',
    url: `${Config.url || ''}/api/meeting-invites/${token}/accept`,
  });

export const revokeMeetingInvite = (inviteId) =>
  axios({
    method: 'post',
    url: `${Config.url || ''}/api/meeting-invites/${inviteId}/revoke`,
  });
