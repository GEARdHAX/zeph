import axios from 'axios';
import Config from '../config';

const rewriteMessage = (text, tone, signal) => axios({
  method: 'post',
  url: `${Config.url || ''}/api/ai/rewrite`,
  data: { text, tone },
  signal,
});

export default rewriteMessage;
