const nodemailer = require('nodemailer');
const store = require('../store');
const logger = require('../logger');

const sendMail = (data) => {
  return new Promise((resolve, reject) => {
    const transport = nodemailer.createTransport(store.config.nodemailerTransport);

    transport.verify((error) => {
      if (error) {
        logger.error({ err: error }, 'Error while connecting to SMTP server');
        reject(error);
      } else {
        transport.sendMail(data, (err) => {
          if (err) {
            logger.error({ err, to: data.to, subject: data.subject }, 'Error while sending email');
            reject(err);
          } else {
            logger.info({ to: data.to, subject: data.subject }, 'Email sent');
            resolve();
          }
        });
      }
    });
  });
};

module.exports = sendMail;
