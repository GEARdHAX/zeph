import axios from 'axios';
import Config from '../config';

const markMessageRead = ({ roomID, messageID }) => {
  return axios({
    method: 'post',
    url: `${Config.url || ''}/api/message/read`,
    data: { roomID, messageID },
  });
};

export default markMessageRead;
