const { buildPolicy, REJECTION_REASONS } = require('../src/ai/policy');

describe('buildPolicy', () => {
  it('applies portfolio-safe defaults when config provides none', () => {
    const policy = buildPolicy({});
    expect(policy.groupSummary.minMessages).toBe(100);
    expect(policy.dmSummary.minMessages).toBe(30);
    expect(policy.conversationTitle.minMessages).toBe(5);
    expect(policy.groupTopicExtraction.minMessages).toBe(50);
    expect(policy.summaryFreshness.minNewMessages).toBe(25);
  });

  it('has no minimum for smartReply/messageRewrite/translation', () => {
    const policy = buildPolicy({});
    expect(policy.smartReply.minMessages).toBeUndefined();
    expect(policy.messageRewrite.minMessages).toBeUndefined();
    expect(policy.translation.minMessages).toBeUndefined();
  });

  it('honors configured overrides', () => {
    const policy = buildPolicy({ aiPolicyGroupSummaryMinMessages: 10 });
    expect(policy.groupSummary.minMessages).toBe(10);
  });
});

describe('REJECTION_REASONS', () => {
  it('exposes the machine-readable reason set', () => {
    expect(REJECTION_REASONS.INSUFFICIENT_CONTEXT).toBe('INSUFFICIENT_CONTEXT');
    expect(REJECTION_REASONS.QUOTA_EXCEEDED).toBe('QUOTA_EXCEEDED');
    expect(REJECTION_REASONS.RATE_LIMITED).toBe('RATE_LIMITED');
    expect(REJECTION_REASONS.AI_DISABLED).toBe('AI_DISABLED');
    expect(REJECTION_REASONS.PROVIDER_UNAVAILABLE).toBe('PROVIDER_UNAVAILABLE');
  });
});
