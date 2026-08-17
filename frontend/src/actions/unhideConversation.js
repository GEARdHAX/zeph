import axios from 'axios';
import Config from '../config';

const unhideConversation = (conversationId, vaultToken) => axios({
  method: 'post',
  url: `${Config.url || ''}/api/conversation/unhide`,
  data: { conversationId },
  headers: { 'X-Vault-Token': vaultToken },
});

export default unhideConversation;
