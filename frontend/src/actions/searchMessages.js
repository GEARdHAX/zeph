import axios from 'axios';
import Config from '../config';

// POST /api/messages/search — full-text search over this user's own DM/group
// history (backend/src/routes/messages/search.js). roomID scopes to one
// conversation (the normal case, triggered from TopBar's Search action);
// omit it for a global search across every room the user belongs to.
const searchMessages = ({ query, roomID, before, limit } = {}, signal) =>
  axios({
    method: 'post',
    url: `${Config.url || ''}/api/messages/search`,
    data: { query, roomID, before, limit },
    signal,
  });

export default searchMessages;
