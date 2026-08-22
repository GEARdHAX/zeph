const User = require('../models/User');
const { isPrivileged } = require('../authorization/policy');

// Admin privacy boundary for existing 1:1 conversations — a standard user's
// DM with a privileged (admin/root) account must behave as if it doesn't
// exist: not just newly-blocked from creation (create-room.js), but also
// inaccessible via a direct room id, pagination, or reconnect/resync on a
// conversation that predates this check. Every read route that touches an
// existing room (join-room, get-room, more-messages, sync-messages,
// list-rooms) calls this independently — same "no route may assume a
// sibling route already enforced it" principle as requireVisibleConversation.
//
// Deliberately scoped to 1:1 rooms only (room.isGroup === false). Group
// membership is a shared space, not a discovery surface — a standard user
// legitimately sharing a group with an admin does not lose the whole group
// because of it (locked product decision, see DECISIONS.md). Only a genuine
// 1:1 DM is treated as a discovery/interaction surface subject to the
// boundary.
//
// Returns true when the room must be treated as invisible to callerLevel.
const roomHasBoundaryViolation = async ({ room, callerID, callerLevel }) => {
  if (!room || room.isGroup) return false;
  if (isPrivileged({ level: callerLevel })) return false;

  const otherID = (room.people || [])
    .map((p) => (p && p._id ? p._id : p))
    .find((p) => p && p.toString() !== callerID.toString());
  if (!otherID) return false;

  const other = await User.findById(otherID).select('level');
  return isPrivileged(other);
};

module.exports = roomHasBoundaryViolation;
