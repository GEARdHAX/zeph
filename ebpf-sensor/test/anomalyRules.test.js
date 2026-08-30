const { AnomalyRules, EXEC_BURST_THRESHOLD, CONNECT_BURST_THRESHOLD } = require('../src/anomalyRules');

const execEvent = (parentPid) => ({
  type: 'PROCESS_EXEC', eventId: `e-${Math.random()}`, timestamp: new Date().toISOString(), process: { name: 'x', pid: 1, parentPid },
});

const connectEvent = () => ({
  type: 'NETWORK_CONNECTION', eventId: `n-${Math.random()}`, timestamp: new Date().toISOString(), network: { destinationIp: '1.2.3.4', destinationPort: 80, protocol: 'tcp' },
});

describe('AnomalyRules', () => {
  it('produces no anomaly for a handful of execs under the threshold', () => {
    const rules = new AnomalyRules();
    const anomalies = Array.from({ length: EXEC_BURST_THRESHOLD - 1 }, () => rules.evaluate(execEvent(1))).flat();
    expect(anomalies).toHaveLength(0);
  });

  it('produces a PROCESS_ANOMALY once exec burst exceeds the threshold for one parent', () => {
    const rules = new AnomalyRules();
    let anomalies = [];
    for (let i = 0; i < EXEC_BURST_THRESHOLD + 1; i += 1) {
      anomalies = anomalies.concat(rules.evaluate(execEvent(1)));
    }
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].type).toBe('PROCESS_ANOMALY');
  });

  it('tracks bursts per-parentPid independently — one busy parent does not flag a different parent', () => {
    const rules = new AnomalyRules();
    for (let i = 0; i < EXEC_BURST_THRESHOLD + 1; i += 1) rules.evaluate(execEvent(1));
    const anomalies = rules.evaluate(execEvent(2));
    expect(anomalies).toHaveLength(0);
  });

  it('produces a NETWORK_ANOMALY once connection burst exceeds the threshold', () => {
    const rules = new AnomalyRules();
    let anomalies = [];
    for (let i = 0; i < CONNECT_BURST_THRESHOLD + 1; i += 1) {
      anomalies = anomalies.concat(rules.evaluate(connectEvent()));
    }
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].type).toBe('NETWORK_ANOMALY');
  });

  it('ignores event types it has no rule for', () => {
    const rules = new AnomalyRules();
    expect(rules.evaluate({ type: 'PROCESS_EXIT' })).toEqual([]);
  });
});
