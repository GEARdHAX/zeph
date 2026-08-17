import axios from 'axios';
import Config from '../config';

const unlockVaultPin = (pin) => axios({
  method: 'post',
  url: `${Config.url || ''}/api/vault/unlock/pin`,
  data: { pin },
});

export default unlockVaultPin;
