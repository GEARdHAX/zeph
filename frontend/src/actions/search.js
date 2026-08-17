import axios from 'axios';
import Config from '../config';

const search = (text, limit, signal) => {
  return axios({
    method: 'post',
    url: `${Config.url || ''}/api/search`,
    data: { limit: limit || 30, search: text || '' },
    signal,
  });
};

export default search;
