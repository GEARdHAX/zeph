import axios from 'axios';
import Config from '../config';

const resolveUser = (username) => {
  return axios({
    method: 'get',
    url: `${Config.url || ''}/api/users/${encodeURIComponent(username)}`,
  });
};

export default resolveUser;
