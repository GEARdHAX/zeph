const Meeting = require('../../models/Meeting');
const Room = require('../../models/Room');
const xss = require('xss');

// Phase 9 audit finding, CRITICAL (compounds the mediasoup join fix — see
// mediasoup/index.js's authorizeMeetingJoin): this route previously
// created a Meeting document from a fully client-supplied `group`/`callee`
// with zero verification the caller actually belongs to that Room —
// combined with the (now-fixed) missing join-time check, an attacker could
// fabricate a Meeting naming any group/user and enter it. `group` is
// always the caller's own Room._id in the real flow (TopBar.jsx's call()
// passes `group: room._id` for both 1:1 and group calls — Room IS the
// authorization anchor meeting/call.js already checks for the subsequent
// "ring" step; this route runs BEFORE that and had no check of its own).
module.exports = async (req, res, next) => {
  let { title, callee, startedAsCall, callToGroup, group } = req.fields;
  const caller = req.user.id;

  if (!group) return res.status(400).json({ error: true, reason: 'group_required' });

  const room = await Room.findOne({ _id: group }).select('people disabledAt').catch(() => null);
  if (!room || room.disabledAt) return res.status(404).json({ error: true });

  const isMember = room.people.some((personId) => personId.toString() === caller.toString());
  if (!isMember) return res.status(403).json({ error: true });

  Meeting({ title: xss(title), caller, callee, startedAsCall, callToGroup, group })
    .save()
    .then((meeting) => {
      res.status(200).json(meeting);
    })
    .catch(() => res.status(500).json({ error: true }));
};
