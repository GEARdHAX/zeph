import axios from 'axios';
import Config from '../config';

const extractTopics = (roomID, signal) => axios({
  method: 'post',
  url: `${Config.url || ''}/api/ai/topics`,
  data: { roomID },
  signal,
});

export default extractTopics;
