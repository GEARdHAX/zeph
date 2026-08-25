// One-time migration: every GroupMember row created before D-037 (this
// session's status enum addition) has no `status` field persisted on
// disk — Mongoose's schema default masked this in memory (find().status
// silently reads as 'ACTIVE' even when nothing was ever written), which is
// how this went undetected until getMembership()'s new status:'ACTIVE'
// filter started 404ing real, valid memberships. See DECISIONS.md.
//
// active:true -> status:'ACTIVE' (unambiguous — matches the invariant every
// route since D-037 maintains: the two fields always agree).
// active:false -> status:'REMOVED' (a judgment call — historically `active`
// never distinguished self-leave from admin-removal, so LEFT vs REMOVED
// can't be recovered. REMOVED is picked over LEFT because it is the more
// conservative interpretation for anything gating a rejoin path.)
//
// Idempotent — reruns are no-ops (the $exists:false filter only ever
// matches rows this migration hasn't already touched).
//
// Usage: node src/scripts/backfillGroupMemberStatus.js
const mongoose = require('../models/mongoose');
const config = require('../../config');
const GroupMember = require('../models/GroupMember');

const run = async () => {
  await mongoose.connect(config.mongo.uri);

  const activeResult = await GroupMember.collection.updateMany(
    { status: { $exists: false }, active: true },
    { $set: { status: 'ACTIVE' } },
  );
  const inactiveResult = await GroupMember.collection.updateMany(
    { status: { $exists: false }, active: false },
    { $set: { status: 'REMOVED' } },
  );

  console.log(`Backfilled ${activeResult.modifiedCount} active row(s) to status:ACTIVE`);
  console.log(`Backfilled ${inactiveResult.modifiedCount} inactive row(s) to status:REMOVED`);

  await mongoose.disconnect();
};

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });
