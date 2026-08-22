const User = require('../../models/User');
const store = require('../../store');
const { isPrivileged } = require('../../authorization/policy');

// Same defensive treatment as meeting/add.js — this route is independently
// reachable with an arbitrary userID, so it re-checks the admin-privacy
// boundary itself rather than assuming the call it's answering already
// passed it elsewhere. Silent no-op (still 200) on a violation, matching
// the fire-and-forget shape the rest of the call-signaling routes use.
module.exports = async (req, res, next) => {
  let { userID, meetingID, answer } = req.fields;

  const target = await User.findById(userID).select('_id level');
  if (!target) return res.status(200).json({ ok: true });
  if (isPrivileged(target) && !isPrivileged(req.user)) {
    return res.status(200).json({ ok: true });
  }

  store.io.to(userID).emit('answer', { status: 200, meetingID, answer, callee: req.user.id });

  res.status(200).json({ ok: true });
};
