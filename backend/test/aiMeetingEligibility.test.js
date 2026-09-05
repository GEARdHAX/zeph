const { buildPolicy } = require('../src/ai/policy');
const { checkMeetingSummaryEligibility } = require('../src/ai/eligibility');

const policy = buildPolicy({});

const baseMeeting = (overrides = {}) => ({
  startedAt: new Date('2026-01-01T10:00:00Z'),
  endedAt: new Date('2026-01-01T10:06:00Z'), // 6 minutes — above the 5-minute default
  users: ['u1', 'u2'],
  ...overrides,
});

describe('checkMeetingSummaryEligibility — meeting not ended', () => {
  it('rejects when endedAt is not set (meeting still ongoing)', () => {
    const result = checkMeetingSummaryEligibility(policy, baseMeeting({ endedAt: null }), 200);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('MEETING_NOT_ENDED');
  });
});

describe('checkMeetingSummaryEligibility — duration (below/at/above threshold)', () => {
  it('rejects a 2-minute meeting (below the 5-minute minimum)', () => {
    const meeting = baseMeeting({ endedAt: new Date('2026-01-01T10:02:00Z') });
    const result = checkMeetingSummaryEligibility(policy, meeting, 200);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('MEETING_TOO_SHORT');
  });

  it('accepts a meeting at exactly the 5-minute minimum', () => {
    const meeting = baseMeeting({ endedAt: new Date('2026-01-01T10:05:00Z') });
    const result = checkMeetingSummaryEligibility(policy, meeting, 200);
    expect(result.eligible).toBe(true);
  });

  it('accepts a 30-minute meeting', () => {
    const meeting = baseMeeting({ endedAt: new Date('2026-01-01T10:30:00Z') });
    const result = checkMeetingSummaryEligibility(policy, meeting, 200);
    expect(result.eligible).toBe(true);
    expect(result.durationSeconds).toBe(1800);
  });
});

describe('checkMeetingSummaryEligibility — participants', () => {
  it('rejects a meeting with only 1 participant', () => {
    const meeting = baseMeeting({ users: ['u1'] });
    const result = checkMeetingSummaryEligibility(policy, meeting, 200);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('INSUFFICIENT_PARTICIPANTS');
  });

  it('accepts a meeting with exactly 2 participants (the default minimum)', () => {
    const meeting = baseMeeting({ users: ['u1', 'u2'] });
    const result = checkMeetingSummaryEligibility(policy, meeting, 200);
    expect(result.eligible).toBe(true);
  });

  it('accepts a meeting with 4 participants', () => {
    const meeting = baseMeeting({ users: ['u1', 'u2', 'u3', 'u4'] });
    const result = checkMeetingSummaryEligibility(policy, meeting, 200);
    expect(result.eligible).toBe(true);
  });
});

describe('checkMeetingSummaryEligibility — transcript content', () => {
  it('rejects a meeting with a transcript under 100 words', () => {
    const result = checkMeetingSummaryEligibility(policy, baseMeeting(), 50);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('INSUFFICIENT_TRANSCRIPT');
  });

  it('accepts a meeting with exactly 100 transcribed words', () => {
    const result = checkMeetingSummaryEligibility(policy, baseMeeting(), 100);
    expect(result.eligible).toBe(true);
  });

  it('accepts a meeting with a long, substantive transcript', () => {
    const result = checkMeetingSummaryEligibility(policy, baseMeeting(), 500);
    expect(result.eligible).toBe(true);
    expect(result.transcriptWordCount).toBe(500);
  });
});

describe('checkMeetingSummaryEligibility — the documented example scenarios', () => {
  it('a 2-minute meeting with 3 participants -> not eligible', () => {
    const meeting = baseMeeting({ endedAt: new Date('2026-01-01T10:02:00Z'), users: ['u1', 'u2', 'u3'] });
    expect(checkMeetingSummaryEligibility(policy, meeting, 300).eligible).toBe(false);
  });

  it('a 30-minute meeting with 4 participants and sufficient transcript -> eligible', () => {
    const meeting = baseMeeting({ endedAt: new Date('2026-01-01T10:30:00Z'), users: ['u1', 'u2', 'u3', 'u4'] });
    expect(checkMeetingSummaryEligibility(policy, meeting, 300).eligible).toBe(true);
  });
});
