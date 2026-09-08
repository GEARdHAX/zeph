import axios from 'axios';
import Config from '../config';

// Named export for consistency with the other action modules (more to come).
// eslint-disable-next-line import/prefer-default-export
export const getNetworkSummary = () =>
  axios({
    method: 'get',
    url: `${Config.url || ''}/api/security/network/summary`,
  });
