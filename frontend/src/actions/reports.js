import axios from 'axios';
import Config from '../config';

// POST /api/reports — file a report against another user, from inside a
// shared conversation (backend/src/routes/reports/create.js).
const createReport = ({ roomID, reportedUserId, reason, details }) =>
  axios({
    method: 'post',
    url: `${Config.url || ''}/api/reports`,
    data: { roomID, reportedUserId, reason, details },
  });

export default createReport;
