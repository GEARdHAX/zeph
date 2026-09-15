import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { createStore, combineReducers, applyMiddleware } from 'redux';
import thunk from 'redux-thunk';
import { MemoryRouter } from 'react-router-dom';
import { setGlobal } from 'reactn';
import rtc from '../../../reducers/rtc';
import Meeting from './Meeting';

// Meeting-summary-persistence pass (spec sections 5/6/10) — the meetings
// list card's Summary/Generating…/Summary unavailable affordance, driven
// entirely by the lightweight `meeting.summary` metadata GET /meeting/list
// now attaches (never the summary text itself — see MeetingSummaryPopup.jsx
// for where that's actually fetched, on demand).
vi.mock('../../../actions/getMeetingSummary', () => ({ default: vi.fn() }));
// eslint-disable-next-line import/first
import getMeetingSummary from '../../../actions/getMeetingSummary';

// Call Timeline / Call History — the "Joined N times · Xm" line and its
// on-demand CallTimelinePopup.
vi.mock('../../../actions/getCallHistory', () => ({ default: vi.fn() }));
// eslint-disable-next-line import/first
import getCallHistory from '../../../actions/getCallHistory';

// Regression: closing the summary popup (the Close button, or Radix's own
// X/Escape/overlay-click) used to bubble through React's synthetic event
// tree into the card's own onClick={handleClick} — "click Close" ended up
// also re-joining/initializing the meeting. useNavigate is what
// handleClick calls to do that, so asserting it's never invoked is the
// most direct way to catch the bug returning.
const navigateSpy = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => navigateSpy };
});

const BASE_MEETING = {
  _id: 'meeting-1',
  caller: { _id: 'user-1', firstName: 'Me', lastName: 'Self' },
  callee: { _id: 'user-2', firstName: 'Other', lastName: 'Person' },
  startedAsCall: true,
  peers: [],
  users: [],
};

function renderMeeting(meetingOverrides = {}) {
  const store = createStore(combineReducers({ rtc }), applyMiddleware(thunk));
  return render(
    <Provider store={store}>
      <MemoryRouter>
        <Meeting meeting={{ ...BASE_MEETING, ...meetingOverrides }} onDeleted={vi.fn()} />
      </MemoryRouter>
    </Provider>,
  );
}

beforeEach(async () => {
  await setGlobal({ user: { id: 'user-1' } });
  getMeetingSummary.mockReset();
  getCallHistory.mockReset();
  navigateSpy.mockReset();
});

describe('Meeting card — summary availability states', () => {
  it('shows no Summary affordance when meeting.summary is absent (no transcript exists yet)', () => {
    renderMeeting();
    expect(screen.queryByRole('button', { name: 'Summary' })).not.toBeInTheDocument();
    expect(screen.queryByText('Generating…')).not.toBeInTheDocument();
    expect(screen.queryByText('Summary unavailable')).not.toBeInTheDocument();
  });

  it('shows the Summary button when status is SUMMARIZED', () => {
    renderMeeting({ summary: { available: true, status: 'SUMMARIZED' } });
    expect(screen.getByRole('button', { name: 'Summary' })).toBeInTheDocument();
  });

  it('shows "Generating…" for TRANSCRIBING/TRANSCRIBED/SUMMARIZING', () => {
    renderMeeting({ summary: { available: false, status: 'SUMMARIZING' } });
    expect(screen.getByText('Generating…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Summary' })).not.toBeInTheDocument();
  });

  it('shows "Summary unavailable" for FAILED', () => {
    renderMeeting({ summary: { available: false, status: 'FAILED' } });
    expect(screen.getByText('Summary unavailable')).toBeInTheDocument();
  });

  it('clicking Summary opens the popup and fetches the content, without navigating into the meeting', async () => {
    getMeetingSummary.mockResolvedValueOnce({ data: { status: 'SUMMARIZED', summary: 'the real summary text' } });
    const user = userEvent.setup();
    renderMeeting({ summary: { available: true, status: 'SUMMARIZED' } });

    await user.click(screen.getByRole('button', { name: 'Summary' }));

    expect(getMeetingSummary).toHaveBeenCalledWith('meeting-1');
    expect(await screen.findByText('the real summary text')).toBeInTheDocument();
  });

  it('closing the summary popup does NOT re-trigger the card and navigate into the meeting (bug regression)', async () => {
    getMeetingSummary.mockResolvedValueOnce({ data: { status: 'SUMMARIZED', summary: 'the real summary text' } });
    const user = userEvent.setup();
    renderMeeting({ summary: { available: true, status: 'SUMMARIZED' } });

    await user.click(screen.getByRole('button', { name: 'Summary' }));
    await screen.findByText('the real summary text');
    expect(navigateSpy).not.toHaveBeenCalled();

    const closeButtons = screen.getAllByRole('button', { name: 'Close' });
    await user.click(closeButtons[closeButtons.length - 1]); // the popup's own explicit Close button, not Radix's sr-only X

    expect(screen.queryByText('the real summary text')).not.toBeInTheDocument();
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});

describe('Meeting card — Call Timeline / Call History (spec §19)', () => {
  it('shows no participation line when meeting.participation is absent (no CallSession for this user)', () => {
    renderMeeting();
    expect(screen.queryByText(/Joined \d+ times/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Your participation:/)).not.toBeInTheDocument();
  });

  it('shows "Your participation: Xm" for a single session', () => {
    renderMeeting({ participation: { sessionCount: 1, totalDurationSeconds: 1920 } });
    expect(screen.getByText('Your participation: 32 min')).toBeInTheDocument();
  });

  it('shows "Joined N times · Xm" for multiple sessions', () => {
    renderMeeting({ participation: { sessionCount: 2, totalDurationSeconds: 1920 } });
    expect(screen.getByText('Joined 2 times · 32 min')).toBeInTheDocument();
  });

  it('clicking the participation line opens the timeline popup without navigating into the meeting', async () => {
    getCallHistory.mockResolvedValueOnce({
      data: {
        history: [
          {
            meetingId: 'meeting-1',
            sessions: [{ connectedAt: '2026-01-01T10:00:00Z', disconnectedAt: '2026-01-01T10:32:00Z', durationSeconds: 1920, disconnectReason: 'left' }],
            timeline: [
              { eventType: 'CONNECTED', timestamp: '2026-01-01T10:00:00Z', metadata: {} },
              { eventType: 'DISCONNECTED', timestamp: '2026-01-01T10:32:00Z', metadata: { reason: 'left' } },
            ],
          },
        ],
      },
    });
    const user = userEvent.setup();
    renderMeeting({ participation: { sessionCount: 1, totalDurationSeconds: 1920 } });

    await user.click(screen.getByText('Your participation: 32 min'));

    expect(getCallHistory).toHaveBeenCalledWith({ meetingId: 'meeting-1' });
    expect(await screen.findByText('Call Timeline')).toBeInTheDocument();
    expect(screen.getAllByText('Connected')).toHaveLength(1);
    expect(screen.getAllByText('Disconnected')).toHaveLength(1);
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});
