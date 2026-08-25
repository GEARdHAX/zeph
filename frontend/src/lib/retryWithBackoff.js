// Retries an async fn with exponential backoff (1s, 2s, 4s, ...), capped at maxAttempts.
// No new dependency — plain setTimeout is enough for this.
//
// A 4xx response (other than 429) means the request is invalid, not that
// the network is flaky — retrying it just repeats the same failure. 429
// (rate limit / slow mode) is retryable in principle but the caller almost
// always wants to surface it immediately rather than silently burn several
// seconds of backoff first, so it's excluded too — see BottomBar.jsx's
// slow-mode toast, which needs the real error on the first attempt.
const isNonRetryable = (err) => {
  const status = err?.response?.status;
  return status >= 400 && status < 500;
};

const retryWithBackoff = async (fn, { maxAttempts = 4, baseDelayMs = 1000 } = {}) => {
  let lastError;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (isNonRetryable(err)) throw err;
      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) => {
          setTimeout(resolve, baseDelayMs * 2 ** attempt);
        });
      }
    }
  }
  throw lastError;
};

export default retryWithBackoff;
