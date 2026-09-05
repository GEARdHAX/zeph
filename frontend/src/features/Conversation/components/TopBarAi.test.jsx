import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { createStore, combineReducers, applyMiddleware } from 'redux';
import thunk from 'redux-thunk';
import { setGlobal } from 'reactn';
import { toast } from 'react-toastify';
import io from '../../../reducers/io';
import messages from '../../../reducers/messages';
import rtc from '../../../reducers/rtc';
import emoji from '../../../reducers/emoji';
import Actions from '../../../constants/Actions';
import TopBar from './TopBar';

// Zeph AI — Phase 10: Summarize / Extract Topics menu actions.
vi.mock('../../../actions/hideConversation', () => ({ default: vi.fn() }));
vi.mock('../../../actions/deleteConversation', () => ({ default: vi.fn() }));
vi.mock('../../../actions/setupVaultPin', () => ({ default: vi.fn() }));
vi.mock('../../../actions/getVaultStatus', () => ({ default: vi.fn(() => Promise.resolve({ data: { configured: true } })) }));
vi.mock('../../../actions/blockUser', () => ({ default: vi.fn() }));
vi.mock('../../../actions/unblockUser', () => ({ default: vi.fn() }));
vi.mock('../../../actions/getMeetingRoom', () => ({ default: vi.fn() }));
vi.mock('../../../actions/postCall', () => ({ default: vi.fn() }));
vi.mock('../../../actions/summarizeConversation', () => ({ default: vi.fn() }));
vi.mock('../../../actions/extractTopics', () => ({ default: vi.fn() }));
vi.mock('react-toastify', () => ({
  toast: {
    warn: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn(),
  },
}));

// eslint-disable-next-line import/first
import summarizeConversation from '../../../actions/summarizeConversation';
// eslint-disable-next-line import/first
import extractTopics from '../../../actions/extractTopics';

const ME = { id: 'user-1', firstName: 'Me', lastName: 'Self' };
const OTHER = {
  _id: 'user-2', firstName: 'Other', lastName: 'Person', username: 'other',
};
const DM_ROOM = {
  _id: 'room-1', people: [ME, OTHER], isGroup: false,
};
const GROUP_ROOM = {
  _id: 'room-2', people: [ME, OTHER], isGroup: true, title: 'Team Chat',
};

function makeStore(room) {
  const rootReducer = combineReducers({
    emoji, io, messages, rtc,
  });
  const store = createStore(rootReducer, applyMiddleware(thunk));
  store.dispatch({ type: Actions.SET_ROOM, room });
  store.dispatch({ type: Actions.ONLINE_USERS, data: [{ id: OTHER._id, status: 'online' }] });
  return store;
}

function renderTopBar(room, aiEnabled = true) {
  const store = makeStore(room);
  render(
    <Provider store={store}>
      <MemoryRouter>
        <TopBar back={() => {}} loading={false} aiEnabled={aiEnabled} />
      </MemoryRouter>
    </Provider>,
  );
  return store;
}

beforeEach(async () => {
  await setGlobal({ user: ME, favorites: [], showDetails: false });
  summarizeConversation.mockReset();
  extractTopics.mockReset();
  toast.error.mockReset();
  toast.info.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TopBar — Summarize (AI), eligibility and states', () => {
  it('does not show Summarize/Extract topics when AI is disabled', async () => {
    const user = userEvent.setup();
    renderTopBar(DM_ROOM, false);
    await user.click(screen.getByRole('button', { name: 'More options' }));
    expect(screen.queryByText('Summarize conversation')).not.toBeInTheDocument();
  });

  it('shows the summary dialog with an AI-generated disclaimer on success', async () => {
    summarizeConversation.mockResolvedValueOnce({
      status: 200, data: { summary: 'Alice and Bob discussed the project timeline.', cached: false },
    });
    const user = userEvent.setup();
    renderTopBar(DM_ROOM);

    await user.click(screen.getByRole('button', { name: 'More options' }));
    await user.click(await screen.findByText('Summarize conversation'));

    expect(await screen.findByText('Conversation Summary')).toBeInTheDocument();
    expect(screen.getByText('Alice and Bob discussed the project timeline.')).toBeInTheDocument();
    expect(screen.getByText('AI-generated — may be inaccurate.')).toBeInTheDocument();
  });

  it('explains an eligibility failure with the exact backend-provided threshold message', async () => {
    summarizeConversation.mockRejectedValueOnce({
      response: {
        status: 422,
        data: {
          reason: 'INSUFFICIENT_CONTEXT',
          message: 'Not enough conversation yet. Zeph needs at least 30 messages to generate a useful conversation summary.',
        },
      },
    });
    const user = userEvent.setup();
    renderTopBar(DM_ROOM);

    await user.click(screen.getByRole('button', { name: 'More options' }));
    await user.click(await screen.findByText('Summarize conversation'));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('at least 30 messages'));
    });
  });

  it('shows a queued/"check back shortly" info toast on 202 GENERATING (BullMQ path)', async () => {
    summarizeConversation.mockResolvedValueOnce({
      status: 202,
      data: { status: 'GENERATING', message: 'Summary is being generated. Check back shortly.', previousSummary: null },
    });
    const user = userEvent.setup();
    renderTopBar(DM_ROOM);

    await user.click(screen.getByRole('button', { name: 'More options' }));
    await user.click(await screen.findByText('Summarize conversation'));

    await waitFor(() => {
      expect(toast.info).toHaveBeenCalledWith(expect.stringContaining('being generated'));
    });
  });

  it('shows a provider-unavailable message distinctly from an eligibility failure', async () => {
    summarizeConversation.mockRejectedValueOnce({
      response: { status: 502, data: { reason: 'PROVIDER_UNAVAILABLE' } },
    });
    const user = userEvent.setup();
    renderTopBar(DM_ROOM);

    await user.click(screen.getByRole('button', { name: 'More options' }));
    await user.click(await screen.findByText('Summarize conversation'));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('temporarily unavailable'));
    });
  });

  it('prevents a duplicate submission — a second menu trigger while one call is in flight makes only one request', async () => {
    let resolveRequest;
    summarizeConversation.mockImplementationOnce(() => new Promise((resolve) => { resolveRequest = resolve; }));
    const user = userEvent.setup();
    renderTopBar(DM_ROOM);

    // Clicking the menu item closes the menu (setMenuOpen(false) fires
    // immediately on click) — reopening it and clicking again is the real
    // "user tries twice" scenario; the summarizing-in-flight guard inside
    // summarize() itself (not a disabled DOM attribute) is what's under test.
    await user.click(screen.getByRole('button', { name: 'More options' }));
    await user.click(await screen.findByText('Summarize conversation'));

    await user.click(screen.getByRole('button', { name: 'More options' }));
    // Still mid-flight — the item now reads "Summarizing…", not the idle
    // label; clicking it again must not fire a second request.
    await user.click(await screen.findByText('Summarizing…'));

    expect(summarizeConversation).toHaveBeenCalledTimes(1);

    resolveRequest({ status: 200, data: { summary: 'done' } });
    await waitFor(() => expect(screen.getByText('Conversation Summary')).toBeInTheDocument());
  });
});

describe('TopBar — Extract topics (AI, group-only)', () => {
  it('is not offered for a DM (group-only feature)', async () => {
    const user = userEvent.setup();
    renderTopBar(DM_ROOM);
    await user.click(screen.getByRole('button', { name: 'More options' }));
    expect(screen.queryByText('Extract topics')).not.toBeInTheDocument();
  });

  it('is offered for a group and shows results as a topic list', async () => {
    extractTopics.mockResolvedValueOnce({ data: { topics: ['budget', 'hiring', 'roadmap'] } });
    const user = userEvent.setup();
    renderTopBar(GROUP_ROOM);

    await user.click(screen.getByRole('button', { name: 'More options' }));
    await user.click(await screen.findByText('Extract topics'));

    expect(await screen.findByText('Conversation Topics')).toBeInTheDocument();
    expect(screen.getByText('budget')).toBeInTheDocument();
    expect(screen.getByText('hiring')).toBeInTheDocument();
    expect(screen.getByText('roadmap')).toBeInTheDocument();
  });

  it('explains a group-topic eligibility failure', async () => {
    extractTopics.mockRejectedValueOnce({
      response: {
        status: 422,
        data: { reason: 'INSUFFICIENT_CONTEXT', message: 'Not enough conversation yet. Zeph needs at least 50 messages to extract topics.' },
      },
    });
    const user = userEvent.setup();
    renderTopBar(GROUP_ROOM);

    await user.click(screen.getByRole('button', { name: 'More options' }));
    await user.click(await screen.findByText('Extract topics'));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('at least 50 messages'));
    });
  });
});
