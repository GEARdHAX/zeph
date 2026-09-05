import axios from 'axios';
import Config from '../config';

const draftReply = (roomID, signal) => axios({
  method: 'post',
  url: `${Config.url || ''}/api/ai/draft-reply`,
  data: { roomID },
  signal,
});

export default draftReply;
