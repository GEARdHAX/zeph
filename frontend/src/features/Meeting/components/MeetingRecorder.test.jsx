import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setGlobal } from 'reactn';
import { toast } from 'react-toastify';
import MeetingRecorder from './MeetingRecorder';

// Zeph AI — Meeting AI (Phase 14) frontend states: record/stop, uploading,
// processing (sync + async/polled), success, error, eligibility rejection.
vi.mock('../../../actions/uploadMedia', () => ({ default: vi.fn() }));
vi.mock('../../../actions/summarizeMeeting', () => ({ default: vi.fn() }));
vi.mock('../../../actions/getMeetingSummary', () => ({ default: vi.fn() }));
vi.mock('react-toastify', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

// eslint-disable-next-line import/first
import uploadMedia from '../../../actions/uploadMedia';
// eslint-disable-next-line import/first
import summarizeMeeting from '../../../actions/summarizeMeeting';
// eslint-disable-next-line import/first
import getMeetingSummary from '../../../actions/getMeetingSummary';

// jsdom has no real MediaRecorder — a minimal fake that captures the
// handlers and lets tests drive start()/stop() deterministically.
class FakeMediaRecorder {
  constructor(stream) {
    this.stream = stream;
    this.state = 'inactive';
    FakeMediaRecorder.instances.push(this);
  }

  start() { this.state = 'recording'; }

  stop() {
    this.state = 'inactive';
    if (this.ondataavailable) this.ondataavailable({ data: new Blob(['fake audio'], { type: 'audio/webm' }) });
    if (this.onstop) this.onstop();
  }
}
FakeMediaRecorder.instances = [];

beforeEach(async () => {
  uploadMedia.mockReset();
  summarizeMeeting.mockReset();
  getMeetingSummary.mockReset();
  toast.error.mockClear();
  FakeMediaRecorder.instances = [];
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const FAKE_STREAM = {}; // MediaRecorder is faked, so the real MediaStream shape is irrelevant here

describe('MeetingRecorder — no microphone stream', () => {
  it('shows an error toast instead of starting when there is no audioStream', async () => {
    await setGlobal({ audioStream: null });
    const user = userEvent.setup();
    render(<MeetingRecorder meetingId="meeting-1" />);

    await user.click(screen.getByRole('button', { name: 'Record meeting for an AI summary' }));

    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('microphone'));
    expect(FakeMediaRecorder.instances).toHaveLength(0);
  });
});

describe('MeetingRecorder — record, upload, synchronous summary', () => {
  it('uploads the recording and shows the summary dialog on success', async () => {
    await setGlobal({ audioStream: FAKE_STREAM });
    uploadMedia.mockResolvedValueOnce({ data: { media: { _id: 'media-1' } } });
    summarizeMeeting.mockResolvedValueOnce({ status: 200, data: { summary: 'Key decisions were made.' } });

    const user = userEvent.setup();
    render(<MeetingRecorder meetingId="meeting-1" />);

    await user.click(screen.getByRole('button', { name: 'Record meeting for an AI summary' }));
    await user.click(screen.getByRole('button', { name: 'Stop recording & summarize' }));

    await waitFor(() => {
      expect(screen.getByText('Meeting Summary')).toBeInTheDocument();
      expect(screen.getByText('Key decisions were made.')).toBeInTheDocument();
    });
    expect(uploadMedia).toHaveBeenCalledTimes(1);
    expect(summarizeMeeting).toHaveBeenCalledWith('meeting-1', 'media-1', expect.anything());
  });

  it('shows an eligibility rejection with the exact backend message', async () => {
    await setGlobal({ audioStream: FAKE_STREAM });
    uploadMedia.mockResolvedValueOnce({ data: { media: { _id: 'media-1' } } });
    summarizeMeeting.mockRejectedValueOnce({
      response: { status: 422, data: { reason: 'MEETING_TOO_SHORT', message: 'This meeting was too short to summarize. Minimum duration: 5 minutes.' } },
    });

    const user = userEvent.setup();
    render(<MeetingRecorder meetingId="meeting-1" />);

    await user.click(screen.getByRole('button', { name: 'Record meeting for an AI summary' }));
    await user.click(screen.getByRole('button', { name: 'Stop recording & summarize' }));

    await waitFor(() => {
      expect(screen.getByText('This meeting was too short to summarize. Minimum duration: 5 minutes.')).toBeInTheDocument();
    });
  });
});

describe('MeetingRecorder — asynchronous (BullMQ) path with polling', () => {
  it('polls GET summary until SUMMARIZED, then shows the result', async () => {
    await setGlobal({ audioStream: FAKE_STREAM });
    uploadMedia.mockResolvedValueOnce({ data: { media: { _id: 'media-1' } } });
    summarizeMeeting.mockResolvedValueOnce({ status: 202, data: { status: 'PROCESSING' } });
    getMeetingSummary
      .mockResolvedValueOnce({ data: { status: 'SUMMARIZING' } })
      .mockResolvedValueOnce({ data: { status: 'SUMMARIZED', summary: 'Finished summary.' } });

    const user = userEvent.setup();
    render(<MeetingRecorder meetingId="meeting-1" />);

    await user.click(screen.getByRole('button', { name: 'Record meeting for an AI summary' }));
    await user.click(screen.getByRole('button', { name: 'Stop recording & summarize' }));

    await waitFor(() => expect(getMeetingSummary).toHaveBeenCalledTimes(1), { timeout: 6000 });
    await waitFor(() => expect(getMeetingSummary).toHaveBeenCalledTimes(2), { timeout: 6000 });
    await waitFor(() => {
      expect(screen.getByText('Finished summary.')).toBeInTheDocument();
    });
  }, 15000);

  it('shows an error when polling reports FAILED', async () => {
    await setGlobal({ audioStream: FAKE_STREAM });
    uploadMedia.mockResolvedValueOnce({ data: { media: { _id: 'media-1' } } });
    summarizeMeeting.mockResolvedValueOnce({ status: 202, data: { status: 'PROCESSING' } });
    getMeetingSummary.mockResolvedValueOnce({ data: { status: 'FAILED' } });

    const user = userEvent.setup();
    render(<MeetingRecorder meetingId="meeting-1" />);

    await user.click(screen.getByRole('button', { name: 'Record meeting for an AI summary' }));
    await user.click(screen.getByRole('button', { name: 'Stop recording & summarize' }));

    await waitFor(() => {
      expect(screen.getByText('Could not generate a summary for this meeting.')).toBeInTheDocument();
    });
  });
});

describe('MeetingRecorder — upload failure', () => {
  it('shows an error toast-equivalent dialog when the upload itself fails', async () => {
    await setGlobal({ audioStream: FAKE_STREAM });
    uploadMedia.mockRejectedValueOnce({ response: { status: 500, data: {} } });

    const user = userEvent.setup();
    render(<MeetingRecorder meetingId="meeting-1" />);

    await user.click(screen.getByRole('button', { name: 'Record meeting for an AI summary' }));
    await user.click(screen.getByRole('button', { name: 'Stop recording & summarize' }));

    await waitFor(() => {
      expect(screen.getByText('Something went wrong. Please try again.')).toBeInTheDocument();
    });
    expect(summarizeMeeting).not.toHaveBeenCalled();
  });
});
