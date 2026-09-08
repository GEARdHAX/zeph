import { describe, it, expect, vi, afterEach } from 'vitest';
import { getAiErrorMessage, MESSAGES, formatComeBack } from './aiErrorMessage';

describe('getAiErrorMessage', () => {
  it('prefers the backend-provided message for eligibility failures (has the exact threshold)', () => {
    const err = {
      response: { data: { reason: 'INSUFFICIENT_CONTEXT', message: 'Zeph needs at least 30 messages.' } },
    };
    expect(getAiErrorMessage(err)).toBe('Zeph needs at least 30 messages.');
  });

  it('uses the backend meeting-eligibility message verbatim', () => {
    const err = {
      response: {
        data: {
          reason: 'MEETING_TOO_SHORT',
          message: 'This meeting was too short to summarize. Minimum duration: 5 minutes.',
        },
      },
    };
    expect(getAiErrorMessage(err)).toContain('too short');
  });

  it('maps non-quota reason codes to their own distinct message', () => {
    ['AI_DISABLED', 'PROVIDER_UNAVAILABLE', 'GENERATION_IN_PROGRESS', 'INVALID_OUTPUT', 'INPUT_TOO_LARGE'].forEach(
      (reason) => {
        const err = { response: { data: { reason } } };
        expect(getAiErrorMessage(err)).toBe(MESSAGES[reason]);
      },
    );
  });

  it('falls back to a backend-provided message for an unrecognized reason', () => {
    const err = { response: { data: { reason: 'SOMETHING_NEW', message: 'custom backend text' } } };
    expect(getAiErrorMessage(err)).toBe('custom backend text');
  });

  it('falls back to a generic message when nothing is available', () => {
    expect(getAiErrorMessage({})).toBe('Something went wrong. Please try again.');
    expect(getAiErrorMessage(undefined)).toBe('Something went wrong. Please try again.');
  });

  it('never leaks provider/internal implementation details', () => {
    Object.values(MESSAGES).forEach((message) => {
      const m = message.toLowerCase();
      expect(m).not.toContain('groq');
      expect(m).not.toContain('gemini');
      expect(m).not.toContain('redis');
      expect(m).not.toContain('bullmq');
    });
  });
});

describe('getAiErrorMessage — quota (429) messages include a concrete "come back"', () => {
  it('RATE_LIMITED with a short retryAfter -> "in about N seconds"', () => {
    const err = { response: { data: { reason: 'RATE_LIMITED', retryAfter: 37 } } };
    const msg = getAiErrorMessage(err);
    expect(msg).toContain('using AI a bit fast');
    expect(msg).toMatch(/in about \d+ seconds/);
  });

  it('QUOTA_EXCEEDED with a resetAt tomorrow -> "resets tomorrow"', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(3, 0, 0, 0);
    const err = {
      response: { data: { reason: 'QUOTA_EXCEEDED', retryAfter: 60000, resetAt: tomorrow.toISOString() } },
    };
    expect(getAiErrorMessage(err)).toContain('resets tomorrow');
  });

  it('RATE_LIMITED with no timing info still returns a usable sentence', () => {
    const err = { response: { data: { reason: 'RATE_LIMITED' } } };
    const msg = getAiErrorMessage(err);
    expect(msg).toContain('using AI a bit fast');
    expect(msg.length).toBeGreaterThan(20);
  });
});

describe('formatComeBack', () => {
  afterEach(() => vi.useRealTimers());

  it('rounds short waits up to the nearest 5 seconds, floor 5', () => {
    expect(formatComeBack(3)).toBe('Try again in about 5 seconds.');
    expect(formatComeBack(41)).toBe('Try again in about 45 seconds.');
  });

  it('uses minutes for waits over ~90s', () => {
    expect(formatComeBack(200)).toBe('Try again in about 4 minutes.');
  });

  it('says "resets tomorrow" for a wait landing after local midnight', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(2, 0, 0, 0);
    expect(formatComeBack(99999, tomorrow.toISOString())).toBe('The daily AI limit resets tomorrow.');
  });

  it('handles missing/garbage input without throwing', () => {
    expect(formatComeBack(undefined, undefined)).toBe('Please try again later.');
    expect(formatComeBack(null, 'not-a-date')).toBe('Please try again later.');
  });
});
