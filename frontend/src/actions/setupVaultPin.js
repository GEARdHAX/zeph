import axios from 'axios';
import Config from '../config';

const setupVaultPin = (pin, vaultToken) => axios({
  method: 'post',
  url: `${Config.url || ''}/api/vault/pin/setup`,
  data: { pin },
  headers: vaultToken ? { 'X-Vault-Token': vaultToken } : undefined,
});

export default setupVaultPin;
