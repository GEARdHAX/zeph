import axios from 'axios';
import Config from '../config';

const summarizeConversation = (roomID, signal) => axios({
  method: 'post',
  url: `${Config.url || ''}/api/ai/summarize`,
  data: { roomID },
  signal,
});

export default summarizeConversation;
