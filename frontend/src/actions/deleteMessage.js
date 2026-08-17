import axios from 'axios';
import Config from '../config';

const deleteMessage = ({ roomID, messageID, forEveryone }) => {
  return axios({
    method: 'post',
    url: `${Config.url || ''}/api/message/delete`,
    data: { roomID, messageID, forEveryone },
  });
};

export default deleteMessage;
