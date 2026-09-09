// Zeph AI — BullMQ job-id format. BullMQ 6.x throws "Custom Id cannot
// contain :" — this regression-guards that none of the AI queues use ':'
// in their custom job ids (they use '-' instead; Redis LOCK keys in
// ai/dedup.js still idiomatically use ':', which is fine — those aren't
// BullMQ job ids).
jest.mock('../src/queues/connection', () => ({
  getQueueConnection: () => ({}),
  closeQueueConnection: jest.fn(),
}));
jest.mock('bullmq', () => {
  const add = jest.fn().mockResolvedValue(undefined);
  return {
    Queue: jest.fn().mockImplementation(() => ({ add })),
    Worker: jest.fn(),
    __add: add,
  };
});

const bullmq = require('bullmq');
const { enqueueSummaryJob } = require('../src/queues/aiQueue');
const { enqueueMeetingSummaryJob } = require('../src/queues/meetingAiQueue');
const { enqueueIncidentAnalysis } = require('../src/queues/securityAiQueue');

const addMock = bullmq.__add;

beforeEach(() => addMock.mockClear());

const lastJobId = () => addMock.mock.calls[addMock.mock.calls.length - 1][2].jobId;

describe('AI queue job ids never contain ":"', () => {
  it('summary job id', async () => {
    await enqueueSummaryJob({
      roomId: 'room-1',
      conversationType: 'group',
      userId: 'u1',
      messageCountAtSummary: 120,
      requestId: 'r1',
    });
    expect(lastJobId()).toBe('summary-room-1-120');
    expect(lastJobId()).not.toContain(':');
  });

  it('meeting summary job id — unique per enqueue, no ":"', async () => {
    await enqueueMeetingSummaryJob({
      meetingId: 'meet-1',
      mediaId: 'm1',
      userId: 'u1',
      requestId: 'r1',
    });
    // A timestamp suffix is deliberate — a fixed `meeting-{id}` id let
    // BullMQ silently drop retries (see meetingAiQueue.js). Duplicate
    // prevention moved to the route's transcript-status check.
    expect(lastJobId()).toMatch(/^meeting-meet-1-\d+$/);
    expect(lastJobId()).not.toContain(':');
  });

  it('security-ai incident job id', async () => {
    await enqueueIncidentAnalysis('inc-1', 2);
    expect(lastJobId()).toBe('incident-inc-1');
    expect(lastJobId()).not.toContain(':');
  });
});
