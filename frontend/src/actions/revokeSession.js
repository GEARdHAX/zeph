import axios from 'axios';
import Config from '../config';

const revokeSession = (id) => {
  return axios({
    method: 'post',
    url: `${Config.url || ''}/api/sessions/revoke`,
    data: { id },
  });
};

export default revokeSession;
