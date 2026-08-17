import axios from 'axios';
import Config from '../config';

const sendFriendRequest = (username) => {
  return axios({
    method: 'post',
    url: `${Config.url || ''}/api/friend-requests`,
    data: { username },
  });
};

export default sendFriendRequest;
