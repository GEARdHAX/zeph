const { buildCircuitBreaker, States } = require('../src/services/threatIntel/circuitBreaker');

describe('threatIntel circuit breaker', () => {
  it('starts CLOSED and allows attempts', () => {
    const breaker = buildCircuitBreaker();
    expect(breaker.getState()).toBe(States.CLOSED);
    expect(breaker.canAttempt()).toBe(true);
  });

  it('does NOT trip on a normal clean/malicious result (only recordFailure with a tripping reason matters)', () => {
    const breaker = buildCircuitBreaker({ failureThreshold: 2 });
    breaker.recordSuccess();
    breaker.recordSuccess();
    expect(breaker.getState()).toBe(States.CLOSED);
  });

  it('opens after reaching the failure threshold on a tripping reason', () => {
    const breaker = buildCircuitBreaker({ failureThreshold: 3, cooldownMs: 30000 });
    breaker.recordFailure('timeout');
    breaker.recordFailure('timeout');
    expect(breaker.getState()).toBe(States.CLOSED);
    breaker.recordFailure('timeout');
    expect(breaker.getState()).toBe(States.OPEN);
    expect(breaker.canAttempt()).toBe(false);
  });

  it('does not count a non-tripping reason (rejected/malformed_response) toward the threshold', () => {
    const breaker = buildCircuitBreaker({ failureThreshold: 2 });
    breaker.recordFailure('rejected');
    breaker.recordFailure('malformed_response');
    breaker.recordFailure('rejected');
    expect(breaker.getState()).toBe(States.CLOSED);
  });

  it.each(['timeout', 'network_error', 'server_error', 'rate_limited'])('treats %s as a tripping reason', (reason) => {
    const breaker = buildCircuitBreaker({ failureThreshold: 1 });
    breaker.recordFailure(reason);
    expect(breaker.getState()).toBe(States.OPEN);
  });

  it('moves to HALF_OPEN after the cooldown elapses, allowing exactly one trial', async () => {
    const breaker = buildCircuitBreaker({ failureThreshold: 1, cooldownMs: 50 });
    breaker.recordFailure('timeout');
    expect(breaker.canAttempt()).toBe(false);

    await new Promise((resolve) => { setTimeout(resolve, 60); });

    expect(breaker.canAttempt()).toBe(true);
    expect(breaker.getState()).toBe(States.HALF_OPEN);
  });

  it('a successful HALF_OPEN trial closes the circuit', async () => {
    const breaker = buildCircuitBreaker({ failureThreshold: 1, cooldownMs: 50 });
    breaker.recordFailure('timeout');
    await new Promise((resolve) => { setTimeout(resolve, 60); });
    breaker.canAttempt(); // transitions to HALF_OPEN
    breaker.recordSuccess();
    expect(breaker.getState()).toBe(States.CLOSED);
  });

  it('a failed HALF_OPEN trial re-opens the circuit', async () => {
    const breaker = buildCircuitBreaker({ failureThreshold: 1, cooldownMs: 50 });
    breaker.recordFailure('timeout');
    await new Promise((resolve) => { setTimeout(resolve, 60); });
    breaker.canAttempt();
    breaker.recordFailure('timeout');
    expect(breaker.getState()).toBe(States.OPEN);
  });

  it('a success resets the consecutive-failure counter (recovers without ever opening)', () => {
    const breaker = buildCircuitBreaker({ failureThreshold: 3 });
    breaker.recordFailure('timeout');
    breaker.recordFailure('timeout');
    breaker.recordSuccess();
    breaker.recordFailure('timeout');
    breaker.recordFailure('timeout');
    expect(breaker.getState()).toBe(States.CLOSED); // would have opened at 3 consecutive without the reset
  });
});
