import axios from 'axios';
import Config from '../config';

// Meeting-recording-specific alternative to actions/uploadMedia.js, used
// only when the browser couldn't produce an Ogg/Opus recording (see
// MeetingRecorder.jsx and backend/src/routes/meeting/upload-recording.js
// for why WebM/MP4 audio can't go through the general upload pipeline).
const uploadMeetingRecording = (meetingId, file) => {
  const data = new FormData();
  data.append('file', file, file.name);
  return axios.post(`${Config.url || ''}/api/meeting/${meetingId}/upload-recording`, data);
};

export default uploadMeetingRecording;
