import axios from 'axios';
import Config from '../config';

const getFriends = () => {
  return axios({
    method: 'get',
    url: `${Config.url || ''}/api/friends`,
  });
};

export default getFriends;
