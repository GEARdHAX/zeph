import axios from 'axios';
import Config from '../config';

const unblockUser = (username) => {
  return axios({
    method: 'post',
    url: `${Config.url || ''}/api/unblock`,
    data: { username },
  });
};

export default unblockUser;
