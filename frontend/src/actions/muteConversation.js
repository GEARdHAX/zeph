import axios from 'axios';
import Config from '../config';

// POST /api/conversation/mute — toggles mute for one conversation
// (backend/src/routes/conversation-mute.js). Mute suppresses sound/toast for
// new messages (initIO.jsx's message-in handler) without hiding the
// conversation or its unread badge.
const muteConversation = (conversationId, muted) =>
  axios({
    method: 'post',
    url: `${Config.url || ''}/api/conversation/mute`,
    data: { conversationId, muted },
  });

export default muteConversation;
