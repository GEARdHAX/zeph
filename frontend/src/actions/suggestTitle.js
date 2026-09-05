import axios from 'axios';
import Config from '../config';

const suggestTitle = (roomID, signal) => axios({
  method: 'post',
  url: `${Config.url || ''}/api/ai/title`,
  data: { roomID },
  signal,
});

export default suggestTitle;
