import axios from 'axios';
import Config from '../config';

// GET /api/calls/history — the authenticated user's OWN call history
// (userId is derived server-side from the JWT, never sent by this client —
// see backend/src/routes/calls/history.js). meetingId narrows to a single
// meeting's timeline (used by CallTimelinePopup.jsx); omit it for the
// paginated cross-meeting history list.
const getCallHistory = ({ meetingId, cursor, limit } = {}) =>
  axios({
    method: 'get',
    url: `${Config.url || ''}/api/calls/history`,
    params: { meetingId, cursor, limit },
  });

export default getCallHistory;
