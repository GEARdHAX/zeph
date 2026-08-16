import axios from 'axios';
import Config from '../config';

const syncMessages = ({ roomID, lastMessageID }) => {
  return axios({
    method: 'post',
    url: `${Config.url || ''}/api/messages/sync`,
    data: { roomID, lastMessageID },
  });
};

export default syncMessages;
