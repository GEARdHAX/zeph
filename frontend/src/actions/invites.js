import axios from 'axios';
import Config from '../config';

export const createFriendInvite = () => axios({
  method: 'post',
  url: `${Config.url || ''}/api/friends/invites`,
});

export const previewFriendInvite = (token, signal) => axios({
  method: 'get',
  url: `${Config.url || ''}/api/friends/invites/${token}`,
  signal,
});

export const acceptFriendInvite = (token) => axios({
  method: 'post',
  url: `${Config.url || ''}/api/friends/invites/${token}/accept`,
});

export const createGroupInvite = (groupId, maxUses) => axios({
  method: 'post',
  url: `${Config.url || ''}/api/group/invites/create`,
  data: { groupId, maxUses },
});

export const previewGroupInvite = (token, signal) => axios({
  method: 'get',
  url: `${Config.url || ''}/api/group/invites/${token}`,
  signal,
});

export const joinGroupInvite = (token) => axios({
  method: 'post',
  url: `${Config.url || ''}/api/group/invites/${token}/join`,
});

// No-invite discovery path for a PRIVATE group the caller already knows the
// id of — distinct from joinGroupInvite above (an invite link IS the
// approval; this creates a PENDING row an admin must act on).
export const requestToJoinGroup = (groupId) => axios({
  method: 'post',
  url: `${Config.url || ''}/api/group/join-requests`,
  data: { groupId },
});
