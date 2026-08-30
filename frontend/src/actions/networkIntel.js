import axios from 'axios';
import Config from '../config';

export const getNetworkSummary = () => axios({
  method: 'get',
  url: `${Config.url || ''}/api/security/network/summary`,
});
