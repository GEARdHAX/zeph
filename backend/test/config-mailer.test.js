// config.js reads MAILER_* once at require time, so each case needs a fresh
// module load with its own process.env — this covers the exact Brevo SMTP
// shape (host+port+secure, no MAILER_SERVICE) reaching nodemailerTransport
// unchanged, which is what sendMail.js hands straight to
// nodemailer.createTransport.
const ORIGINAL_ENV = process.env;

const loadConfigWith = (envOverrides) => {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, AUTH_SECRET: 'test-secret-for-jest-only', ...envOverrides };
  // eslint-disable-next-line global-require
  return require('../config');
};

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe('config.js — MAILER_* wiring', () => {
  it('is disabled by default (MAILER_ENABLED unset)', () => {
    const config = loadConfigWith({ MAILER_ENABLED: undefined });
    expect(config.nodemailerEnabled).toBe(false);
  });

  it('enables sending only when MAILER_ENABLED=true', () => {
    const config = loadConfigWith({ MAILER_ENABLED: 'true' });
    expect(config.nodemailerEnabled).toBe(true);
  });

  it('builds a Brevo-shaped SMTP transport from MAILER_HOST/PORT/SECURE/USERNAME/PASSWORD', () => {
    const config = loadConfigWith({
      MAILER_ENABLED: 'true',
      MAILER_HOST: 'smtp-relay.brevo.com',
      MAILER_PORT: '587',
      MAILER_SECURE: 'false',
      MAILER_USERNAME: 'brevo-login@example.com',
      MAILER_PASSWORD: 'brevo-smtp-key',
      MAILER_FROM: 'zeph. <no-reply@zeph.app>',
      MAILER_SERVICE: undefined,
    });

    expect(config.nodemailerTransport).toEqual({
      service: undefined,
      host: 'smtp-relay.brevo.com',
      port: 587,
      secure: false,
      auth: { user: 'brevo-login@example.com', pass: 'brevo-smtp-key' },
    });
    expect(config.nodemailer.from).toBe('zeph. <no-reply@zeph.app>');
  });

  it('sender falls back to a generic default only when MAILER_FROM is unset (never a hardcoded brand-specific address)', () => {
    const config = loadConfigWith({ MAILER_FROM: undefined });
    expect(config.nodemailer.from).toBe('admin@example.com');
  });
});
