// sensorRateLimit.js keeps its buckets in module-level state (globalBucket,
// perSensorBuckets) — same shape as inviteRateLimit.js. Reset the module
// between tests so each test gets a fresh global bucket instead of bleeding
// count across unrelated assertions.
let sensorRateLimit;
beforeEach(() => {
  jest.resetModules();
  // eslint-disable-next-line global-require
  sensorRateLimit = require('../src/lib/sensorRateLimit');
});

const mockRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const call = (middleware, sensorId) => {
  const req = { sensor: { sensorId } };
  const res = mockRes();
  const next = jest.fn();
  middleware(req, res, next);
  return { res, next };
};

describe('sensorRateLimit', () => {
  it('allows requests under the per-sensor max', () => {
    const limit = sensorRateLimit({ perSensorMax: 3, globalMax: 100, windowMs: 60000 });
    const { res, next } = call(limit, 'sensor-x');
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects with 429 SENSOR_RATE_LIMITED once a single sensor exceeds its own bucket', () => {
    const limit = sensorRateLimit({ perSensorMax: 2, globalMax: 100, windowMs: 60000 });
    call(limit, 'sensor-y');
    call(limit, 'sensor-y');
    const { res, next } = call(limit, 'sensor-y');
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ reason: 'SENSOR_RATE_LIMITED' }));
  });

  it('one sensor exceeding its own bucket does not block a DIFFERENT sensor', () => {
    const limit = sensorRateLimit({ perSensorMax: 1, globalMax: 100, windowMs: 60000 });
    call(limit, 'sensor-a');
    call(limit, 'sensor-a'); // sensor-a now blocked
    const { res, next } = call(limit, 'sensor-b');
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects with 429 GLOBAL_RATE_LIMITED once the shared bucket is exceeded, even across many distinct sensors', () => {
    const limit = sensorRateLimit({ perSensorMax: 1000, globalMax: 2, windowMs: 60000 });
    call(limit, 'sensor-1');
    call(limit, 'sensor-2');
    const { res, next } = call(limit, 'sensor-3');
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ reason: 'GLOBAL_RATE_LIMITED' }));
  });
});
