// Retries an async fn with exponential backoff (1s, 2s, 4s, ...), capped at maxAttempts.
// No new dependency — plain setTimeout is enough for this.
const retryWithBackoff = async (fn, { maxAttempts = 4, baseDelayMs = 1000 } = {}) => {
  let lastError;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
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
