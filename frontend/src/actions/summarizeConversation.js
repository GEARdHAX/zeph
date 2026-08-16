import axios from 'axios';
import Config from '../config';

const summarizeConversation = (roomID) => {
  return axios({
    method: 'post',
    url: `${Config.url || ''}/api/ai/summarize`,
    data: { roomID },
  });
};

export default summarizeConversation;
