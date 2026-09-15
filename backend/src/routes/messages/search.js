const Message = require('../../models/Message');
const Room = require('../../models/Room');
const ConversationUserState = require('../../models/ConversationUserState');
const sanitizeDeletedMessage = require('../../utils/sanitizeDeletedMessage');
const roomHasBoundaryViolation = require('../../utils/roomHasBoundaryViolation');
const groupPolicy = require('../../authorization/groupPolicy');
const { hasValidVaultToken } = require('../../vault/vaultToken');

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

// Message content search — POST /api/messages/search { query, roomID?, before?, limit? }
//
// roomID given: search within that one conversation (the common case — a
// user hits search inside a DM). roomID omitted: search across every room
// the user is currently a member of (global message search).
//
// Uses Mongo's native $text index (see Message.js) rather than a $regex
// collection scan — self-hosted Mongo already has this built in, no new
// infra (no Atlas Search / Elasticsearch / Meilisearch) needed at this
// scale, and it's a real index lookup so it stays fast as history grows.
module.exports = async (req, res) => {
  try {
    await handleSearch(req, res);
  } catch (err) {
    // Every sibling route (more-messages.js, sync-messages.js, message.js)
    // wraps its body the same way — without this, an unhandled rejection in
    // an async Express 4 handler never sends a response at all, so the
    // request just hangs client-side forever instead of surfacing an error.
    // The concrete trigger here: $text queries 500 with "text index required"
    // until the background index build (models/Message.js) actually
    // finishes on a freshly-restarted server — that's now a real error
    // response instead of a silent hang.
    res.status(500).json({ error: true });
  }
};

const handleSearch = async (req, res) => {
  let { query, roomID, before, limit } = req.fields;

  query = typeof query === 'string' ? query.trim().slice(0, 200) : '';
  if (!query) {
    return res.status(400).json({ error: true, reason: 'query_required' });
  }

  limit = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);

  let roomIDs;
  if (roomID) {
    const room = await Room.findOne({ _id: roomID });
    if (!room || room.disabledAt) {
      return res.status(404).json({ error: true });
    }
    const canRead = await groupPolicy.canReadRoomHistory(room, req.user.id);
    if (!canRead) {
      return res.status(403).json({ error: true });
    }
    const boundaryViolation = await roomHasBoundaryViolation({
      room,
      callerID: req.user.id,
      callerLevel: req.user.level,
    });
    if (boundaryViolation) {
      return res.status(404).json({ error: true });
    }
    // Vault-locked room, no vault token on this request — same gate
    // more-messages.js uses, so search can't be used to peek at a locked DM.
    const state = await ConversationUserState.findOne({ conversation: roomID, user: req.user.id }).select('isHidden');
    if (state?.isHidden && !hasValidVaultToken(req)) {
      return res.status(403).json({ error: true, reason: 'vault_locked' });
    }
    roomIDs = [room._id];
  } else {
    // Global search — every room the user is currently a member of, minus
    // any vault-locked ones (a locked DM must never surface content via the
    // global search box, only by unlocking it first and searching inside).
    const rooms = await Room.find({ people: req.user.id, disabledAt: { $exists: false } }).select('_id');
    const allIDs = rooms.map((r) => r._id);
    const lockedStates = hasValidVaultToken(req)
      ? []
      : await ConversationUserState.find({
          conversation: { $in: allIDs },
          user: req.user.id,
          isHidden: true,
        }).select('conversation');
    const lockedSet = new Set(lockedStates.map((s) => s.conversation.toString()));
    roomIDs = allIDs.filter((id) => !lockedSet.has(id.toString()));
  }

  if (roomIDs.length === 0) {
    return res.status(200).json({ query, hasMore: false, messages: [] });
  }

  const filter = {
    room: { $in: roomIDs },
    $text: { $search: query },
    // Must restate the text index's own partialFilterExpression (Message.js)
    // here — Mongo's planner refuses to use a PARTIAL text index for a
    // $text query unless the query itself logically guarantees that same
    // predicate; without this the query throws "failed to use text index"
    // at execution time (verified directly against the live collection).
    content: { $type: 'string' },
    deletedForEveryone: { $ne: true },
    deletedFor: { $ne: req.user.id },
  };
  if (before) {
    filter._id = { $lt: before };
  }

  const results = await Message.find(filter, { score: { $meta: 'textScore' } })
    .sort({ score: { $meta: 'textScore' }, _id: -1 })
    .limit(limit + 1)
    .populate({ path: 'author', select: 'firstName lastName picture' })
    .populate({ path: 'room', select: 'people isGroup title' })
    .lean();

  const hasMore = results.length > limit;
  const page = hasMore ? results.slice(0, limit) : results;

  res.status(200).json({
    query,
    hasMore,
    messages: page.map((m) => sanitizeDeletedMessage(m)),
  });
};
