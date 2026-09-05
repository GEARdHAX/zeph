import axios from 'axios';
import Config from '../config';

const getMeetingSummary = (meetingId, signal) => axios({
  method: 'get',
  url: `${Config.url || ''}/api/meeting/${meetingId}/summary`,
  signal,
});

export default getMeetingSummary;
