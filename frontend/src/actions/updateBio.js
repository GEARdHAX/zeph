import axios from 'axios';
import Config from '../config';

const updateBio = (bio) => axios({
  method: 'post',
  url: `${Config.url || ''}/api/users/update-bio`,
  data: { bio },
});

export default updateBio;
