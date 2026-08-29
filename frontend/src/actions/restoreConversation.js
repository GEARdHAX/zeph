import axios from 'axios';
import Config from '../config';

const restoreConversation = (conversationId) => axios({
  method: 'post',
  url: `${Config.url || ''}/api/conversation/restore`,
  data: { conversationId },
});

export default restoreConversation;
