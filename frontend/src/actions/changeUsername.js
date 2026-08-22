import axios from 'axios';
import Config from '../config';

const changeUsername = (username) => axios({
  method: 'post',
  url: `${Config.url || ''}/api/users/change-username`,
  data: { username },
});

export default changeUsername;
