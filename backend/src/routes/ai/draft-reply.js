const Message = require('../../models/Message');
const Room = require('../../models/Room');
const store = require('../../store');
const { buildAssistant } = require('../../ai/assistant');

module.exports = async (req, res, next) => {
  const { roomID } = req.fields;

  if (!roomID) {
    return res.status(400).json({ error: true });
  }

  const assistant = buildAssistant(store.config);
  if (!assistant.enabled) {
    return res.status(503).json({ error: true, message: 'AI features are not enabled on this server.' });
  }

  let room;
  try {
    room = await Room.findOne({ _id: roomID });
  } catch (e) {
    return res.status(404).json({ error: true });
  }

  if (!room) {
    return res.status(404).json({ error: true });
  }

  const isMember = room.people.some((person) => person.toString() === req.user.id.toString());
  if (!isMember) {
    return res.status(403).json({ error: true });
  }

  const messages = await Message.find({ room: roomID, type: 'text' })
    .sort({ _id: -1 })
    .limit(20)
    .populate({ path: 'author', select: 'firstName lastName' })
    .lean();
  messages.reverse();

  if (!messages.length) {
    return res.status(400).json({ error: true, message: 'No text messages to draft a reply from.' });
  }

  try {
    const draft = await assistant.draftReply(
      messages.map((m) => ({ author: m.author ? m.author.firstName : 'Deleted User', content: m.content })),
    );
    res.status(200).json({ draft });
  } catch (err) {
    res.status(502).json({ error: true, message: 'AI provider request failed.' });
  }
};
