import axios from 'axios';
import Config from '../config';

const changeUserPassword = (password, currentPassword) => {
  return axios({
    method: 'post',
    url: `${Config.url || ''}/api/users/change-password`,
    data: { password, currentPassword },
  });
};

export default changeUserPassword;
