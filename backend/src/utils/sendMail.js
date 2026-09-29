const nodemailer = require('nodemailer');
const store = require('../store');
const logger = require('../logger');

// Parses "Name <email@domain>" (what MAILER_FROM/Email.from already store)
// into Brevo's { name, email } sender shape. Falls back to a bare email if
// there's no display name.
const parseFrom = (from) => {
  const match = /^(.*?)\s*<(.+)>$/.exec(from || '');
  return match ? { name: match[1].trim() || undefined, email: match[2].trim() } : { email: from };
};

// Brevo's transactional email HTTP API (port 443) — used instead of SMTP
// (port 587) when BREVO_API_KEY is set. Some hosts (Render's free tier
// confirmed) block or badly throttle outbound SMTP ports, which surfaced as
// silent "Connection timeout" failures piling up in the Email outbox. HTTPS
// egress isn't subject to the same restriction.
const sendViaBrevoApi = async (data) => {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': store.config.brevoApiKey,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sender: parseFrom(data.from),
      to: [{ email: data.to }],
      subject: data.subject,
      htmlContent: data.html,
    }),
  });

  if (!res.ok) {
    // Brevo's error body is JSON with a `message` field — never includes
    // the API key, so safe to surface as-is (same reasoning as the SMTP
    // path below never leaking MAILER_PASSWORD).
    const body = await res.text().catch(() => '');
    throw new Error(`Brevo API error ${res.status}: ${body || res.statusText}`);
  }
};

const sendViaSmtp = (data) => {
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
            resolve();
          }
        });
      }
    });
  });
};

const sendMail = async (data) => {
  if (store.config.brevoApiKey) {
    await sendViaBrevoApi(data);
  } else {
    await sendViaSmtp(data);
  }
  logger.info({ to: data.to, subject: data.subject }, 'Email sent');
};

module.exports = sendMail;
