import axios from 'axios';
import Config from '../config';

const getRemovedConversations = () => axios({
  method: 'post',
  url: `${Config.url || ''}/api/conversations/removed`,
  data: {},
});

export default getRemovedConversations;
