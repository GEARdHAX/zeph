import axios from 'axios';
import Config from '../config';

// mediaId is required on the first call (the just-uploaded recording);
// omit it to retry summary generation from an already-transcribed meeting.
const summarizeMeeting = (meetingId, mediaId, signal) => axios({
  method: 'post',
  url: `${Config.url || ''}/api/meeting/${meetingId}/summarize`,
  data: mediaId ? { mediaId } : {},
  signal,
});

export default summarizeMeeting;
