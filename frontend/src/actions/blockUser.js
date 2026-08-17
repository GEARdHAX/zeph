import axios from 'axios';
import Config from '../config';

const blockUser = (username) => {
  return axios({
    method: 'post',
    url: `${Config.url || ''}/api/block`,
    data: { username },
  });
};

export default blockUser;
