const { spawn } = require('child_process');
const readline = require('readline');

// Spawns one bpftrace subprocess per .bt script (two total: process.bt,
// network.bt — see scripts/) and emits one parsed JSON object per stdout
// line via onEvent. `spawnFn` is injectable so tests can run this against a
// fake process instead of a real kernel/bpftrace binary (this dev machine
// and ZEPH's production host are both incapable of running real eBPF — see
// README.md's infrastructure findings — so the ONLY way this module is
// verifiable in CI/here is with a stubbed spawn).
class BpftraceRunner {
  constructor({
    scriptPath, bpftracePath = 'bpftrace', onEvent, onError, spawnFn = spawn,
  }) {
    this.scriptPath = scriptPath;
    this.bpftracePath = bpftracePath;
    this.onEvent = onEvent;
    this.onError = onError || (() => {});
    this.spawnFn = spawnFn;
    this.child = null;
  }

  start() {
    this.child = this.spawnFn(this.bpftracePath, [this.scriptPath]);

    const rl = readline.createInterface({ input: this.child.stdout });
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        this.onEvent(JSON.parse(trimmed));
      } catch (err) {
        // A malformed/partial line (bpftrace startup banner, a truncated
        // write) must never crash the sensor — skip it, report it, move on.
        this.onError(new Error(`unparseable bpftrace line: ${trimmed.slice(0, 200)}`));
      }
    });

    this.child.stderr.on('data', (chunk) => {
      this.onError(new Error(`bpftrace stderr: ${chunk.toString().slice(0, 500)}`));
    });

    this.child.on('exit', (code, signal) => {
      this.onError(new Error(`bpftrace exited unexpectedly (code=${code}, signal=${signal})`));
    });

    return this.child;
  }

  stop() {
    if (this.child && !this.child.killed) {
      this.child.kill('SIGTERM');
    }
  }
}

module.exports = BpftraceRunner;
