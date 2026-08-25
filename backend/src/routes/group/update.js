const Room = require('../../models/Room');
const xss = require('xss');
const groupPolicy = require('../../authorization/groupPolicy');
const GroupAuditLog = require('../../models/GroupAuditLog');
const logger = require('../../logger');
const store = require('../../store');

const ALLOWED_PRIVACY = ['PUBLIC', 'PRIVATE', 'INVITE_ONLY'];
// Configurable slow-mode intervals, per spec — 0 means off.
const ALLOWED_SLOW_MODE_SECONDS = [0, 5, 10, 30, 60, 300];

module.exports = async (req, res) => {
  const {
    id, name, description, privacy, picture, slowModeSeconds,
  } = req.fields;

  const room = await Room.findOne({ _id: id, isGroup: true }).catch(() => null);
  if (!room || room.disabledAt) return res.status(404).json({ error: true });

  const membership = await groupPolicy.getMembership(room._id, req.user.id);
  if (!membership) return res.status(404).json({ error: true });

  if (!groupPolicy.hasCapability(membership.role, groupPolicy.Capabilities.EDIT_GROUP)) {
    logger.warn({ groupId: room._id, actorId: req.user.id, reason: 'missing_capability' }, 'group_unauthorized_access_attempt');
    return res.status(403).json({ error: true });
  }

  const update = {};
  if (typeof name === 'string') update.title = xss(name);
  if (typeof description === 'string') update.description = xss(description);
  if (typeof picture === 'string') update.picture = picture;
  if (typeof privacy === 'string' && ALLOWED_PRIVACY.includes(privacy)) update.privacy = privacy;
  if (slowModeSeconds !== undefined) {
    const parsed = Number(slowModeSeconds);
    if (!ALLOWED_SLOW_MODE_SECONDS.includes(parsed)) {
      return res.status(400).json({ error: true, reason: 'INVALID_SLOW_MODE' });
    }
    update['settings.slowModeSeconds'] = parsed;
  }

  await Room.updateOne({ _id: room._id }, { $set: update });
  await GroupAuditLog.create({
    group: room._id, actor: req.user.id, action: 'settings_changed', metadata: update,
  });

  store.io.to(`group:${room._id}`).emit('group:updated', { groupId: room._id, ...update });

  res.status(200).json({ status: 'success' });
};
