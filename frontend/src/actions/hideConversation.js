import axios from 'axios';
import Config from '../config';

const hideConversation = (conversationId) => axios({
  method: 'post',
  url: `${Config.url || ''}/api/conversation/hide`,
  data: { conversationId },
});

export default hideConversation;
