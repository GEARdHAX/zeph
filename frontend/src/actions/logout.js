import axios from 'axios';
import Config from '../config';

const logout = () => {
  return axios({
    method: 'post',
    url: `${Config.url || ''}/api/logout`,
  });
};

export default logout;
