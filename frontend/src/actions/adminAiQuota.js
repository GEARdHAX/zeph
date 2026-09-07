import axios from 'axios';
import Config from '../config';

// Zeph AI — admin: inspect / reset a user's AI usage quota.
export const getUserAiQuota = (userId) => axios({
  method: 'get',
  url: `${Config.url || ''}/api/admin/ai-quota/${userId}`,
});

// types: array subset of ['minute','day','concurrent'], or ['all'].
export const resetUserAiQuota = (userId, types) => axios({
  method: 'post',
  url: `${Config.url || ''}/api/admin/ai-quota/reset`,
  data: { userId, types: Array.isArray(types) ? types.join(',') : types },
});
