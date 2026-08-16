import axios from 'axios';
import Config from '../config';

const draftReply = (roomID) => {
  return axios({
    method: 'post',
    url: `${Config.url || ''}/api/ai/draft-reply`,
    data: { roomID },
  });
};

export default draftReply;
