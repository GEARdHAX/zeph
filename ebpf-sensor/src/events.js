const crypto = require('crypto');

// Turns a raw bpftrace-emitted line (see scripts/process.bt, network.bt)
// into the exact shape backend/src/services/ebpf/sensorEventValidation.js
// accepts. eventId is minted HERE (not by bpftrace, which has no UUID
// primitive) — it's what the backend's dedup keys on (spec section 19), so
// it must be stable across a retry of the SAME observation, not
// regenerated per HTTP attempt. Deriving it from the observation's own
// content (kind+pid+ts, hashed) gives that stability for free — the exact
// same raw line always produces the exact same eventId, so a retried
// upload naturally dedups server-side instead of needing the sensor to
// remember "have I already minted an id for this."
const deriveEventId = (raw) => crypto.createHash('sha256').update(JSON.stringify(raw)).digest('hex').slice(0, 32);

// IPv4 u32 (network.bt's raw skc_daddr, host-byte-order from BPF) -> dotted
// quad. bpftrace has no inet_ntop; doing this one conversion in Node is far
// simpler than hand-rolling byte-order math in bpftrace's own language.
const u32ToIp = (n) => [
  n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff,
].join('.');

// bpftrace's skc_dport is stored big-endian (network byte order) even
// though bpftrace prints it as a plain decimal of the raw 16-bit value —
// swap the bytes back to host order to get the real port number.
const swapPort = (n) => ((n & 0xff) << 8) | ((n >> 8) & 0xff);

const SENSOR_VERSION = require('../package.json').version;

// Returns a validated-shape event, or null if this raw line isn't something
// worth reporting (unrecognized kind — forward-compatible: a newer .bt
// script emitting a kind this version doesn't know is silently skipped,
// not a crash).
const normalizeRawEvent = (raw) => {
  if (!raw || typeof raw !== 'object') return null;

  const base = {
    eventId: deriveEventId(raw),
    timestamp: new Date().toISOString(), // sensor's own wall-clock receipt time — nsecs from bpftrace is boot-relative, not wall-clock, so it's not usable as-is here
    sensorVersion: SENSOR_VERSION,
    eventSchemaVersion: 1,
  };

  if (raw.kind === 'exec') {
    return {
      ...base,
      type: 'PROCESS_EXEC',
      process: {
        name: raw.comm, pid: raw.pid, parentPid: raw.ppid,
      },
    };
  }

  if (raw.kind === 'exit') {
    return {
      ...base,
      type: 'PROCESS_EXIT',
      process: {
        name: raw.comm, pid: raw.pid, parentPid: raw.ppid,
      },
    };
  }

  if (raw.kind === 'connect') {
    return {
      ...base,
      type: 'NETWORK_CONNECTION',
      process: { name: raw.comm, pid: raw.pid },
      network: {
        destinationIp: u32ToIp(raw.daddr),
        destinationPort: swapPort(raw.dport),
        protocol: 'tcp',
      },
    };
  }

  // Phase 5 — aggregated flow summary (scripts/network.bt's tcp_close
  // hook). ONE event per closed connection (spec section 7/30 — "favor
  // useful summaries over enormous event volume"), not one per packet.
  // bytes_acked/bytes_received are the kernel's OWN running counters for
  // this socket, read once at close — never a running per-packet tally
  // this sensor itself maintains.
  if (raw.kind === 'flow') {
    return {
      ...base,
      type: 'NETWORK_FLOW',
      flow: {
        destinationIp: u32ToIp(raw.daddr),
        destinationPort: swapPort(raw.dport),
        protocol: 'TCP',
        direction: 'OUTBOUND', // tcp_connect/tcp_close both fire on the CONNECTING side — this sensor does not currently track inbound (accept()) flows, see the final report's scope note
        bytesSent: raw.bytes_sent,
        bytesReceived: raw.bytes_received,
        durationMs: raw.duration_ms,
        pid: raw.pid,
        processName: raw.comm,
      },
    };
  }

  // Phase 5 — DNS query observation (scripts/dns.bt's getaddrinfo()
  // uprobe). No queryType/nxdomain in this pass — see dns.bt's own
  // comment on why the matching uretprobe (which would carry that) is
  // deliberately deferred.
  if (raw.kind === 'dns') {
    return {
      ...base,
      type: 'DNS_QUERY',
      dns: {
        domain: raw.domain,
        pid: raw.pid,
        processName: raw.comm,
      },
    };
  }

  return null;
};

module.exports = {
  normalizeRawEvent, deriveEventId, u32ToIp, swapPort,
};
