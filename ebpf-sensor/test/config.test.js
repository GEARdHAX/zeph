const { validateConfig } = require('../src/config');

describe('validateConfig', () => {
  it('throws when required fields are missing', () => {
    expect(() => validateConfig({})).toThrow(/missing required config/);
  });

  it('does not throw when all required fields are present', () => {
    expect(() => validateConfig({
      apiUrl: 'http://x', sensorId: 's', hostId: 'h', credential: 'c',
    })).not.toThrow();
  });

  it('lists which fields are missing', () => {
    try {
      validateConfig({ apiUrl: 'http://x' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.message).toMatch(/SENSOR_ID/);
      expect(err.message).toMatch(/HOST_ID/);
      expect(err.message).toMatch(/CREDENTIAL/);
    }
  });
});
