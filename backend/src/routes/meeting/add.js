const User = require('../../models/User');
const store = require('../../store');
const { isPrivileged } = require('../../authorization/policy');

// Pre-existing gap fixed in passing: this route previously trusted a raw
// client-supplied userID with zero validation (not existence, not the
// admin-privacy-boundary). A call-add is fire-and-forget from the client's
// perspective (this route always returns 200 on success today), so the
// correct anti-enumeration shape for a boundary violation is a silent
// no-op — do not emit the call, but still return the same 200 — rather
// than a distinguishable error response. See DECISIONS.md.
module.exports = async (req, res, next) => {
  let { userID, meetingID } = req.fields;

  const target = await User.findById(userID).select('_id level');
  if (!target) return res.status(200).json({ ok: true });
  if (isPrivileged(target) && !isPrivileged(req.user)) {
    return res.status(200).json({ ok: true });
  }

  const user = await User.findOne({ _id: req.user.id }, {
    email: 0, password: 0, friends: 0, __v: 0, vaultPinHash: 0,
  }).populate([
    { path: 'picture', strictPopulate: false },
  ]);

  store.io
    .to(userID)
    .emit('call', { status: 200, meetingID, roomID: null, caller: req.user.id, counterpart: user, added: true });

  res.status(200).json({ ok: true });
};
