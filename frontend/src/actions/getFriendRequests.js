import axios from 'axios';
import Config from '../config';

const getFriendRequests = () => {
  return axios({
    method: 'get',
    url: `${Config.url || ''}/api/friend-requests`,
  });
};

export default getFriendRequests;
