import axios from 'axios';
import Config from '../config';

const getVaultStatus = () => axios({
  method: 'get',
  url: `${Config.url || ''}/api/vault/status`,
});

export default getVaultStatus;
