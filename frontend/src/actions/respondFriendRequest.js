import axios from 'axios';
import Config from '../config';

const respondFriendRequest = (id, action) => {
  return axios({
    method: 'post',
    url: `${Config.url || ''}/api/friend-requests/${id}/${action}`,
  });
};

export default respondFriendRequest;
