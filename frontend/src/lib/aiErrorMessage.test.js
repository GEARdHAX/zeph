import { describe, it, expect } from 'vitest';
import { getAiErrorMessage, MESSAGES } from './aiErrorMessage';

describe('getAiErrorMessage', () => {
  it('prefers the backend-provided message for INSUFFICIENT_CONTEXT (has the exact threshold)', () => {
    const err = {
      response: {
        data: { reason: 'INSUFFICIENT_CONTEXT', message: 'Zeph needs at least 30 messages.' },
      },
    };
    expect(getAiErrorMessage(err)).toBe('Zeph needs at least 30 messages.');
  });

  it('maps every known reason code to its own distinct message', () => {
    Object.keys(MESSAGES).forEach((reason) => {
      const err = { response: { data: { reason } } };
      expect(getAiErrorMessage(err)).toBe(MESSAGES[reason]);
    });
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
      expect(message.toLowerCase()).not.toContain('groq');
      expect(message.toLowerCase()).not.toContain('redis');
      expect(message.toLowerCase()).not.toContain('bullmq');
    });
  });
});
