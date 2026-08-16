import axios from 'axios';
import Config from '../config';

const getSessions = () => {
  return axios({
    method: 'get',
    url: `${Config.url || ''}/api/sessions`,
  });
};

export default getSessions;
