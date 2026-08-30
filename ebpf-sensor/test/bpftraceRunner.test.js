const { EventEmitter, Readable } = require('stream');
const BpftraceRunner = require('../src/bpftraceRunner');

// A fake child_process.ChildProcess: real bpftrace isn't runnable on this
// dev machine (Windows) or on ZEPH's production host (Render) — see
// README.md's infrastructure findings — so this is the only way this
// module's line-parsing/error-handling logic is verifiable here. Functional
// verification against a real bpftrace binary requires a real Linux host.
const makeFakeChild = () => {
  const child = new EventEmitter();
  child.stdout = new Readable({ read() {} });
  child.stderr = new Readable({ read() {} });
  child.killed = false;
  child.kill = jest.fn(() => { child.killed = true; });
  return child;
};

describe('BpftraceRunner', () => {
  it('parses well-formed JSON lines from stdout and calls onEvent', () => {
    const child = makeFakeChild();
    const spawnFn = jest.fn(() => child);
    const onEvent = jest.fn();
    const runner = new BpftraceRunner({
      scriptPath: '/x.bt', onEvent, onError: () => {}, spawnFn,
    });
    runner.start();

    child.stdout.push('{"kind":"exec","pid":1}\n');
    child.stdout.push(null);

    return new Promise((resolve) => {
      setImmediate(() => {
        expect(onEvent).toHaveBeenCalledWith({ kind: 'exec', pid: 1 });
        resolve();
      });
    });
  });

  it('reports an unparseable line via onError without crashing or calling onEvent for it', () => {
    const child = makeFakeChild();
    const spawnFn = jest.fn(() => child);
    const onEvent = jest.fn();
    const onError = jest.fn();
    const runner = new BpftraceRunner({
      scriptPath: '/x.bt', onEvent, onError, spawnFn,
    });
    runner.start();

    child.stdout.push('not json at all\n');
    child.stdout.push(null);

    return new Promise((resolve) => {
      setImmediate(() => {
        expect(onEvent).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalled();
        resolve();
      });
    });
  });

  it('reports stderr output via onError', () => {
    const child = makeFakeChild();
    const spawnFn = jest.fn(() => child);
    const onError = jest.fn();
    const runner = new BpftraceRunner({
      scriptPath: '/x.bt', onEvent: () => {}, onError, spawnFn,
    });
    runner.start();

    child.stderr.push('permission denied: CAP_BPF required\n');

    return new Promise((resolve) => {
      setImmediate(() => {
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({
          message: expect.stringContaining('permission denied'),
        }));
        resolve();
      });
    });
  });

  it('reports an unexpected exit via onError', () => {
    const child = makeFakeChild();
    const spawnFn = jest.fn(() => child);
    const onError = jest.fn();
    const runner = new BpftraceRunner({
      scriptPath: '/x.bt', onEvent: () => {}, onError, spawnFn,
    });
    runner.start();

    child.emit('exit', 1, null);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('code=1'),
    }));
  });

  it('stop() sends SIGTERM to a running child', () => {
    const child = makeFakeChild();
    const spawnFn = jest.fn(() => child);
    const runner = new BpftraceRunner({
      scriptPath: '/x.bt', onEvent: () => {}, spawnFn,
    });
    runner.start();
    runner.stop();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('stop() is a no-op if the child already exited', () => {
    const child = makeFakeChild();
    child.killed = true;
    const spawnFn = jest.fn(() => child);
    const runner = new BpftraceRunner({
      scriptPath: '/x.bt', onEvent: () => {}, spawnFn,
    });
    runner.start();
    runner.stop();
    expect(child.kill).not.toHaveBeenCalled();
  });
});
