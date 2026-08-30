const SecurityEvent = require('../../models/SecurityEvent');
const { isPrivileged } = require('../../authorization/policy');

// Single-event detail view (spec section 17: GET /api/security/events/:eventId)
// — includes metadata, which the list view (events-list.js) deliberately
// omits. Looked up by the public eventId, not the Mongo _id.
module.exports = async (req, res) => {
  if (!isPrivileged(req.user)) return res.status(404).json({ error: true });

  const { eventId } = req.params;
  const event = await SecurityEvent.findOne({ eventId }).lean();
  if (!event) return res.status(404).json({ error: true });

  res.status(200).json({ event });
};
