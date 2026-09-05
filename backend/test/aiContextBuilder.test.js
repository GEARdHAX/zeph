const { buildBoundedContext, estimateTokens, MAX_MESSAGE_CHARS } = require('../src/ai/contextBuilder');

describe('estimateTokens', () => {
  it('estimates roughly chars/4', () => {
    expect(estimateTokens('a'.repeat(400))).toBe(100);
  });

  it('handles empty/undefined input', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens(undefined)).toBe(0);
  });
});

describe('buildBoundedContext', () => {
  it('includes all messages when under the token budget', () => {
    const messages = [{ author: 'Alice', content: 'hi' }, { author: 'Bob', content: 'hello' }];
    const result = buildBoundedContext(messages, { aiMaxInputTokens: 4000 });
    expect(result.messagesUsed).toBe(2);
    expect(result.text).toContain('Alice: hi');
  });

  it('drops the oldest messages to stay within the token budget, keeping the most recent', () => {
    const messages = Array.from({ length: 500 }, (_, i) => ({ author: 'U', content: `message number ${i} with some padding text` }));
    const result = buildBoundedContext(messages, { aiMaxInputTokens: 100 });
    expect(result.inputTokenEstimate).toBeLessThanOrEqual(100);
    expect(result.messagesUsed).toBeLessThan(500);
    // the most recent message must survive the trim
    expect(result.text).toContain('message number 499');
    expect(result.text).not.toContain('message number 0 ');
  });

  it('never drops below a single message even if it alone exceeds the budget', () => {
    const messages = [{ author: 'U', content: 'x'.repeat(1000) }];
    const result = buildBoundedContext(messages, { aiMaxInputTokens: 10 });
    expect(result.messagesUsed).toBe(1);
  });

  // Phase 13 hardening regression: a single oversized message used to sail
  // through untouched because the "drop oldest message" loop can't shrink a
  // lone message — messagesUsed never goes below 1, so the while loop's
  // condition was always false after one iteration. Verifies the fix.
  describe('huge single-message input (Phase 13 hardening)', () => {
    it('hard-truncates a multi-megabyte single message to the token budget', () => {
      const huge = 'x'.repeat(2_000_000);
      const result = buildBoundedContext([{ author: 'user', content: huge }], { aiMaxInputTokens: 4000 });
      expect(result.inputTokenEstimate).toBeLessThanOrEqual(4000);
      expect(result.text.length).toBeLessThanOrEqual(4000 * 4);
    });

    it('per-message truncation caps content at MAX_MESSAGE_CHARS before the budget loop runs', () => {
      const huge = 'y'.repeat(100000);
      const result = buildBoundedContext([{ author: 'user', content: huge }], { aiMaxInputTokens: 1000000 }); // budget deliberately huge so only the per-message cap applies
      expect(result.text.length).toBeLessThanOrEqual(MAX_MESSAGE_CHARS + 'user: ...'.length);
    });

    it('a normal budget-sized single message is never clipped by the per-message cap', () => {
      const normal = 'hello world '.repeat(50); // well under MAX_MESSAGE_CHARS
      const result = buildBoundedContext([{ author: 'user', content: normal }], { aiMaxInputTokens: 4000 });
      expect(result.text).toContain(normal.trim());
    });
  });
});
