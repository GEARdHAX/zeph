const store = require('../store');
const Room = require('../models/Room');
const groupPolicy = require('../authorization/groupPolicy');
const roomHasBoundaryViolation = require('../utils/roomHasBoundaryViolation');

// Phase 7 audit findings fixed here: (1) no null-check on Room.findById —
// a bad/missing roomID threw on room.people.forEach (unhandled rejection,
// not a clean error response); (2) no membership check at all — any
// authenticated user could broadcast a typing event into any room they
// could guess the id of. Same membership/boundary pattern as
// events/message-delivered.js.
module.exports = async (req, res) => {
  const roomObj = req.fields.room;
  if (!roomObj) return res.status(400).send('room id required');

  const roomID = roomObj._id;
  const isTyping = req.fields.isTyping;

  if (!roomID) return res.status(400).send('room id required');

  const room = await Room.findOne({ _id: roomID });
  if (!room || room.disabledAt) return res.status(404).json({ error: true });

  if (room.isGroup) {
    const membership = await groupPolicy.getMembershipWithFallback(room._id, req.user.id);
    if (!membership) return res.status(403).json({ error: true });
  } else {
    const isMember = room.people.some((person) => person.toString() === req.user.id.toString());
    if (!isMember) return res.status(403).json({ error: true });
    const boundaryViolation = await roomHasBoundaryViolation({
      room, callerID: req.user.id, callerLevel: req.user.level,
    });
    if (boundaryViolation) return res.status(404).json({ error: true });
  }

  room.people.forEach((person) => {
    if (person.toString() !== req.user.id.toString())
      store.io.to(person.toString()).emit('typing', { id: req.user.id, roomID, isTyping });
  });

  return res.status(200).send('ok');
};
