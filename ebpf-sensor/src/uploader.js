// Batches events out of the local buffer and POSTs them to the backend's
// sensor ingestion endpoint, with bounded retry+backoff (spec section 18).
// `fetchFn` is injectable for tests (native fetch in real use — Node 18+,
// matching backend/'s own engines.node).
const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 500;

class Uploader {
  constructor({
    apiUrl, sensorId, credential, fetchFn = fetch, logger = console,
  }) {
    this.apiUrl = apiUrl;
    this.sensorId = sensorId;
    this.credential = credential;
    this.fetchFn = fetchFn;
    this.logger = logger;
  }

  // Sends one batch. Returns { ok, retryable } — retryable distinguishes
  // "network hiccup / 5xx / 429, worth retrying" from "401 invalid
  // credential / 400 malformed, retrying changes nothing" (spec section 18:
  // bounded retry, not infinite retry of a request that can never succeed).
  async sendOnce(events) {
    try {
      const res = await this.fetchFn(this.apiUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-zeph-sensor-id': this.sensorId,
          'x-zeph-sensor-credential': this.credential,
        },
        body: JSON.stringify({ events }),
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) return { ok: true };
      if (res.status === 401) {
        this.logger.error('ebpf-sensor: credential rejected (401) — check ZEPH_SENSOR_CREDENTIAL, not retrying this batch');
        return { ok: false, retryable: false };
      }
      // 429 (rate limited) and 5xx are worth retrying; anything else (400
      // malformed, 413 too large) means this exact batch can never succeed.
      return { ok: false, retryable: res.status === 429 || res.status >= 500 };
    } catch (err) {
      this.logger.warn(`ebpf-sensor: upload failed (${err.message})`);
      return { ok: false, retryable: true };
    }
  }

  // Retries with exponential backoff, capped at MAX_RETRIES. Returns true
  // if the batch was eventually accepted, false if it should be requeued
  // (caller's responsibility — see index.js's buffer.requeue on failure).
  async sendWithRetry(events) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop
      const result = await this.sendOnce(events);
      if (result.ok) return true;
      if (!result.retryable) return false;
      if (attempt < MAX_RETRIES) {
        const delay = BASE_BACKOFF_MS * 2 ** attempt;
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => { setTimeout(resolve, delay); });
      }
    }
    return false;
  }
}

module.exports = Uploader;
