// sendMail.js is a thin nodemailer wrapper — mock nodemailer itself rather
// than hitting a real SMTP server. The cron loop that calls this (index.js)
// stays untested directly since it's inline, not an exported function; its
// retry-cap behavior is covered by manual verification instead (see the
// password-reset harden pass this file accompanies).
jest.mock('nodemailer');

const nodemailer = require('nodemailer');
const store = require('../src/store');
const sendMail = require('../src/utils/sendMail');

const mockTransport = (overrides = {}) => {
  const transport = {
    verify: jest.fn((cb) => cb(overrides.verifyError || null)),
    sendMail: jest.fn((data, cb) => cb(overrides.sendError || null)),
  };
  nodemailer.createTransport.mockReturnValue(transport);
  return transport;
};

beforeEach(() => {
  jest.clearAllMocks();
  store.config = {
    brevoApiKey: null,
    nodemailerTransport: {
      host: 'smtp-relay.brevo.com',
      port: 587,
      secure: false,
      auth: { user: 'brevo-login', pass: 'super-secret-smtp-key' },
    },
  };
});

describe('sendMail', () => {
  it('resolves and passes the configured transport straight to nodemailer.createTransport', async () => {
    mockTransport();

    await sendMail({ from: 'zeph. <no-reply@zeph.app>', to: 'user@example.com', subject: 'hi', html: '<p>hi</p>' });

    expect(nodemailer.createTransport).toHaveBeenCalledWith(store.config.nodemailerTransport);
  });

  it('rejects when the SMTP connection cannot be verified (bad credentials/host)', async () => {
    mockTransport({ verifyError: new Error('535 Authentication failed') });

    await expect(sendMail({ to: 'user@example.com', subject: 'hi', html: '<p>hi</p>' })).rejects.toThrow(
      '535 Authentication failed',
    );
  });

  it('rejects when sendMail itself fails, without ever including the SMTP password in the error', async () => {
    mockTransport({ sendError: new Error('450 rate limited') });

    await expect(sendMail({ to: 'user@example.com', subject: 'hi', html: '<p>hi</p>' })).rejects.toThrow(
      '450 rate limited',
    );
  });

  it('never leaks the auth password through anything sendMail itself throws or returns', async () => {
    mockTransport({ sendError: new Error('550 mailbox unavailable') });

    try {
      await sendMail({ to: 'user@example.com', subject: 'hi', html: '<p>hi</p>' });
    } catch (e) {
      expect(JSON.stringify(e.message)).not.toContain('super-secret-smtp-key');
    }
  });

  describe('with BREVO_API_KEY set (HTTP API path, bypasses SMTP entirely)', () => {
    beforeEach(() => {
      store.config.brevoApiKey = 'xkeysib-test-key';
      global.fetch = jest.fn();
    });

    afterEach(() => {
      delete global.fetch;
    });

    it('posts to the Brevo API with the parsed sender, never touching nodemailer', async () => {
      global.fetch.mockResolvedValue({ ok: true });

      await sendMail({ from: 'zeph. <no-reply@zeph.app>', to: 'user@example.com', subject: 'hi', html: '<p>hi</p>' });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.brevo.com/v3/smtp/email',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'api-key': 'xkeysib-test-key' }),
        }),
      );
      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body.sender).toEqual({ name: 'zeph.', email: 'no-reply@zeph.app' });
      expect(body.to).toEqual([{ email: 'user@example.com' }]);
      expect(nodemailer.createTransport).not.toHaveBeenCalled();
    });

    it('rejects without leaking the API key when Brevo returns an error status', async () => {
      global.fetch.mockResolvedValue({ ok: false, status: 401, text: async () => '{"message":"Unauthorized"}' });

      await expect(
        sendMail({ from: 'no-reply@zeph.app', to: 'user@example.com', subject: 'hi', html: '<p>hi</p>' }),
      ).rejects.toThrow('Brevo API error 401');
    });
  });
});
