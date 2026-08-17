import axios from 'axios';
import Config from '../config';

const getVaultList = (vaultToken) => axios({
  method: 'get',
  url: `${Config.url || ''}/api/vault/list`,
  headers: { 'X-Vault-Token': vaultToken },
});

export default getVaultList;
