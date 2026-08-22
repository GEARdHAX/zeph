import axios from 'axios';
import Config from '../config';

const deleteAccount = (password) => axios({
  method: 'post',
  url: `${Config.url || ''}/api/users/delete-account`,
  data: { password },
});

export default deleteAccount;
