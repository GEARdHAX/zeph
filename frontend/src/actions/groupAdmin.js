import axios from 'axios';
import Config from '../config';

export const getGroup = (id) => axios({
  method: 'post',
  url: `${Config.url || ''}/api/group/get`,
  data: { id },
});

export const listGroupMembers = (id, cursor) => axios({
  method: 'post',
  url: `${Config.url || ''}/api/group/members`,
  data: { id, cursor },
});

export const listJoinRequests = (groupId, cursor) => axios({
  method: 'post',
  url: `${Config.url || ''}/api/group/join-requests/list`,
  data: { groupId, cursor },
});

export const approveJoinRequest = (groupId, userId) => axios({
  method: 'post',
  url: `${Config.url || ''}/api/group/join-requests/${userId}/approve`,
  data: { groupId },
});

export const denyJoinRequest = (groupId, userId) => axios({
  method: 'post',
  url: `${Config.url || ''}/api/group/join-requests/${userId}/deny`,
  data: { groupId },
});

export const removeMember = (id, userId) => axios({
  method: 'post',
  url: `${Config.url || ''}/api/group/members/remove`,
  data: { id, userId },
});

export const banMember = (groupId, userId) => axios({
  method: 'post',
  url: `${Config.url || ''}/api/group/members/ban`,
  data: { groupId, userId },
});

export const changeMemberRole = (id, userId, role) => axios({
  method: 'post',
  url: `${Config.url || ''}/api/group/members/role`,
  data: { id, userId, role },
});

export const transferOwnership = (groupId, userId) => axios({
  method: 'post',
  url: `${Config.url || ''}/api/group/ownership/transfer`,
  data: { groupId, userId },
});

export const updateGroupSettings = (id, updates) => axios({
  method: 'post',
  url: `${Config.url || ''}/api/group/update`,
  data: { id, ...updates },
});

export const leaveGroup = (id) => axios({
  method: 'post',
  url: `${Config.url || ''}/api/group/leave`,
  data: { id },
});

export const deleteGroup = (id) => axios({
  method: 'post',
  url: `${Config.url || ''}/api/group/delete`,
  data: { id },
});
