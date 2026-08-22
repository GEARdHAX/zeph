import axios from 'axios';
import Config from '../config';

const markMessageRead = ({ roomID, messageID, messageIDs }) => {
  return axios({
    method: 'post',
    url: `${Config.url || ''}/api/message/read`,
    data: { roomID, messageID, messageIDs },
  });
};

export default markMessageRead;
