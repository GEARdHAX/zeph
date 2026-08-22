const Room = require('../models/Room');
const ConversationUserState = require('../models/ConversationUserState');
const GroupMember = require('../models/GroupMember');
const Relationship = require('../models/Relationship');
const forceLeaveGroupRoom = require('./forceLeaveGroupRoom');
const store = require('../store');

// Cleans up everything that would otherwise leave a dangling reference to a
// deleted account: 1:1 DMs are removed from the OTHER participant's inbox
// (same per-user tombstone conversation-delete.js already uses — the Room
// and its Messages are untouched, just no longer listed/reachable, matching
// this app's existing retention pattern). Group memberships are deactivated
// so the deleted user stops appearing as a participant, with a live socket
// force-leave for anyone currently connected (same mechanism
// members-remove.js uses). Relationship rows (friend requests/blocks) are
// removed since they reference an account that no longer exists.
//
// Shared by both the admin hard-delete route (user-delete.js) and the
// self-service account-delete route (users/delete-account.js) — same
// consequences either way, only who's authorized to trigger it differs.
// See DECISIONS.md.
const cleanupDeletedUser = async (userId) => {
  const rooms = await Room.find({ people: userId }).select('_id isGroup people');

  for (const room of rooms) {
    if (room.isGroup) {
      const others = room.people.filter((p) => p.toString() !== userId.toString());
      await GroupMember.updateOne(
        { group: room._id, user: userId },
        { $set: { active: false, updatedAt: new Date() } },
      );
      await Room.updateOne({ _id: room._id }, { $pull: { people: userId } });
      forceLeaveGroupRoom(userId.toString(), room._id.toString());
      others.forEach((otherId) => {
        store.io.to(otherId.toString()).emit('group:member:removed', { groupId: room._id, userId, self: false });
      });
    } else {
      const other = room.people.find((p) => p.toString() !== userId.toString());
      if (!other) continue;
      await ConversationUserState.findOneAndUpdate(
        { conversation: room._id, user: other },
        { $set: { deletedAt: new Date() } },
        { upsert: true },
      );
      store.io.to(other.toString()).emit('conversation-deleted', { conversationId: room._id.toString() });
    }
  }

  await Relationship.deleteMany({ $or: [{ requester: userId }, { recipient: userId }] });
};

module.exports = cleanupDeletedUser;
