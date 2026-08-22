import axios from 'axios';
import Config from '../config';

const deleteMeeting = (meetingId) => axios({
  method: 'post',
  url: `${Config.url || ''}/api/meeting/delete`,
  data: { meetingId },
});

export default deleteMeeting;
