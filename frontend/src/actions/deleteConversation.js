import axios from 'axios';
import Config from '../config';

const deleteConversation = (conversationId, vaultToken) => axios({
  method: 'post',
  url: `${Config.url || ''}/api/conversation/delete`,
  data: { conversationId },
  headers: vaultToken ? { 'X-Vault-Token': vaultToken } : undefined,
});

export default deleteConversation;
