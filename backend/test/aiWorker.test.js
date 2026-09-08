// Zeph AI — BullMQ worker: transient-vs-permanent failure handling. A
// transient failure (rate limit, provider down) must REMOVE the job so its
// dedupe id is free for the user's retry; a permanent one (or a success)
// must NOT, so the dedupe/cache still works.
jest.mock('../src/ai/summaryService');
jest.mock('../src/models/Message');

const { generateAndPersistSummary } = require('../src/ai/summaryService');
const Message = require('../src/models/Message');
const { processSummaryJob } = require('../src/queues/aiWorker');

const makeJob = (overrides = {}) => ({
  data: {
    roomId: 'room-1',
    userId: 'u1',
    conversationType: 'group',
    requestId: 'r1',
    ...overrides.data,
  },
  timestamp: Date.now() - 100,
  attemptsMade: 0,
  remove: jest.fn().mockResolvedValue(undefined),
  ...overrides,
});

beforeEach(() => {
  Message.countDocuments = jest.fn().mockResolvedValue(120);
  generateAndPersistSummary.mockReset();
});

describe('processSummaryJob — transient failure', () => {
  it('removes the job on RATE_LIMITED (frees the dedupe id for a retry)', async () => {
    generateAndPersistSummary.mockResolvedValue({ ok: false, reason: 'RATE_LIMITED' });
    const job = makeJob();
    await processSummaryJob(job);
    expect(job.remove).toHaveBeenCalledTimes(1);
  });

  it('removes the job on PROVIDER_UNAVAILABLE', async () => {
    generateAndPersistSummary.mockResolvedValue({ ok: false, reason: 'PROVIDER_UNAVAILABLE' });
    const job = makeJob();
    await processSummaryJob(job);
    expect(job.remove).toHaveBeenCalledTimes(1);
  });

  it('removes the job on QUOTA_EXCEEDED', async () => {
    generateAndPersistSummary.mockResolvedValue({ ok: false, reason: 'QUOTA_EXCEEDED' });
    const job = makeJob();
    await processSummaryJob(job);
    expect(job.remove).toHaveBeenCalledTimes(1);
  });
});

describe('processSummaryJob — permanent failure / success', () => {
  it('does NOT remove the job on INSUFFICIENT_CONTEXT (retrying changes nothing)', async () => {
    generateAndPersistSummary.mockResolvedValue({ ok: false, reason: 'INSUFFICIENT_CONTEXT' });
    const job = makeJob();
    await processSummaryJob(job);
    expect(job.remove).not.toHaveBeenCalled();
  });

  it('does NOT remove the job on INVALID_OUTPUT', async () => {
    generateAndPersistSummary.mockResolvedValue({ ok: false, reason: 'INVALID_OUTPUT' });
    const job = makeJob();
    await processSummaryJob(job);
    expect(job.remove).not.toHaveBeenCalled();
  });

  it('does NOT remove the job on success (dedupe/cache must keep working)', async () => {
    generateAndPersistSummary.mockResolvedValue({ ok: true, text: 'a summary' });
    const job = makeJob();
    await processSummaryJob(job);
    expect(job.remove).not.toHaveBeenCalled();
  });

  it('swallows a job.remove() failure (a stuck-job cleanup miss is not fatal)', async () => {
    generateAndPersistSummary.mockResolvedValue({ ok: false, reason: 'RATE_LIMITED' });
    const job = makeJob({ remove: jest.fn().mockRejectedValue(new Error('redis gone')) });
    await expect(processSummaryJob(job)).resolves.toBeUndefined();
  });
});
