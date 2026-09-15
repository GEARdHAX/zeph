import axios from 'axios';
import Config from '../config';

// POST /api/messages/around — a window of history centered on one message
// (backend/src/routes/messages/around.js), used to seed Messages.jsx when
// jumping to a search hit instead of paging through messages/more one
// screen at a time.
const getMessagesAround = ({ roomID, messageID }) =>
  axios({
    method: 'post',
    url: `${Config.url || ''}/api/messages/around`,
    data: { roomID, messageID },
  });

export default getMessagesAround;
