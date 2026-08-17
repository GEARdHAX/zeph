import axios from 'axios';
import Config from '../config';

const getRoom = (id, vaultToken) => {
  return axios({
    method: 'post',
    url: `${Config.url || ''}/api/room/join`,
    data: { id },
    headers: vaultToken ? { 'X-Vault-Token': vaultToken } : undefined,
  });
};

export default getRoom;
