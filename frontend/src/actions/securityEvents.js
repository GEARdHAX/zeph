import axios from 'axios';
import Config from '../config';

// GET + query params — unlike most of this app's POST+req.fields actions,
// matching the backend route's own GET /api/security/events shape (a query
// API, not a mutation), same convention as /api/sessions and /api/friends.
export const listSecurityEvents = (params = {}) => axios({
  method: 'get',
  url: `${Config.url || ''}/api/security/events`,
  params,
});

export const getSecurityEvent = (eventId) => axios({
  method: 'get',
  url: `${Config.url || ''}/api/security/events/${eventId}`,
});
