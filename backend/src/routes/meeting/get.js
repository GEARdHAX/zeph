const Meeting = require('../../models/Meeting');
const xss = require('xss');

module.exports = (req, res, next) => {
  let { title, callee, startedAsCall, callToGroup, group } = req.fields;
  const caller = req.user.id;

  Meeting({ title: xss(title), caller, callee, startedAsCall, callToGroup, group })
    .save()
    .then((meeting) => {
      res.status(200).json(meeting);
    });
};
