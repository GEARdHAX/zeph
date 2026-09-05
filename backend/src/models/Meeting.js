const mongoose = require('./mongoose');
const Schema = mongoose.Schema;

const MeetingSchema = new Schema({
  title: {
    type: String,
    required: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  startedAt: {
    type: Date,
    default: Date.now,
  },
  lastEnter: {
    type: Date,
    default: Date.now,
  },
  lastLeave: {
    type: Date,
    default: Date.now,
  },
  startedAsCall: {
    type: Boolean,
    default: false,
  },
  caller: { type: Schema.ObjectId, ref: 'users' },
  callee: { type: Schema.ObjectId, ref: 'users' },
  callToGroup: {
    type: Boolean,
    default: false,
  },
  group: { type: Schema.ObjectId, ref: 'rooms' },
  peers: {
    type: Array,
    default: [],
  },
  users: [{ type: Schema.ObjectId, ref: 'users' }],
  // Zeph AI Meeting AI (Phase 14) — set once the meeting genuinely ends
  // (mediasoup/index.js's leaveRoom, when the last participant leaves), so
  // eligibility (ai/eligibility.js's checkMeetingSummaryEligibility) can
  // compute a real duration without depending on a live socket state.
  // null/unset means "still ongoing or never properly closed" — never
  // guessed from lastLeave, which updates on every individual departure,
  // not just the final one.
  endedAt: { type: Date, default: null },
});

module.exports = User = mongoose.model('meetings', MeetingSchema);
