import axios from 'axios';
import Config from '../config';

// GET /api/reports (admin-only, backend/src/routes/reports/list.js) — a
// query API like listSecurityEvents, not a mutation.
export const listReports = (params = {}) =>
  axios({
    method: 'get',
    url: `${Config.url || ''}/api/reports`,
    params,
  });

// POST /api/reports/:reportId/review — moves a report to REVIEWED/ACTIONED/
// DISMISSED (backend/src/routes/reports/review.js). Does not itself take
// any disciplinary action against the reported account — see that route's
// own comment on why review and account moderation stay separate concerns.
export const reviewReport = (reportId, status) =>
  axios({
    method: 'post',
    url: `${Config.url || ''}/api/reports/${reportId}/review`,
    data: { status },
  });

// POST /api/admin/user/suspend — the actual disciplinary action a reviewer
// takes against the REPORTED user's account (backend/src/routes/admin/
// user-suspend.js). Reversible (suspended: false reactivates); enforced
// immediately via the JWT passport strategy, not just on the account's next
// login. Kept as its own call from reviewReport above, not bundled into it —
// a report can be reviewed/dismissed with no account action at all.
export const suspendUser = (userId, suspended) =>
  axios({
    method: 'post',
    url: `${Config.url || ''}/api/admin/user/suspend`,
    data: { userId, suspended },
  });
