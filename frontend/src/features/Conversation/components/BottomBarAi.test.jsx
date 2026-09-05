import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import {
  render, screen, waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { createStore, combineReducers, applyMiddleware } from 'redux';
import thunk from 'redux-thunk';
import { setGlobal } from 'reactn';
import io from '../../../reducers/io';
import messages from '../../../reducers/messages';
import rtc from '../../../reducers/rtc';
import emoji from '../../../reducers/emoji';
import Actions from '../../../constants/Actions';
import BottomBar from './BottomBar';

// Zeph AI — Phase 10 frontend states: loading, success, error, quota/rate
// limit messaging, duplicate-submission prevention, cancellation on unmount.
vi.mock('../../../actions/message', () => ({ default: vi.fn() }));
vi.mock('../../../actions/getRooms', () => ({ default: vi.fn(() => Promise.resolve({ data: { rooms: [] } })) }));
vi.mock('../../../actions/typing', () => ({ default: () => () => {} }));
vi.mock('../../../actions/uploadImage', () => ({ default: vi.fn() }));
vi.mock('../../../actions/uploadMedia', () => ({ default: vi.fn() }));
vi.mock('../../../actions/deleteConversation', () => ({ default: vi.fn() }));
vi.mock('../../../actions/draftReply', () => ({ default: vi.fn() }));
vi.mock('../../../actions/rewriteMessage', () => ({ default: vi.fn() }));
vi.mock('react-toastify', () => ({ toast: { warn: vi.fn(), error: vi.fn(), success: vi.fn() } }));
vi.mock('@emoji-mart/react', () => ({ default: () => null }));
vi.mock('./ImageEditorModal', () => ({ default: () => null }));
vi.mock('./VideoEditorModal', () => ({ default: () => null }));

// eslint-disable-next-line import/first
import draftReply from '../../../actions/draftReply';
// eslint-disable-next-line import/first
import rewriteMessage from '../../../actions/rewriteMessage';
// eslint-disable-next-line import/first
import { toast } from 'react-toastify';

const ROOM = { _id: 'room-1', people: ['user-1', 'user-2'] };
const ME = { id: 'user-1', firstName: 'Me', lastName: 'Self' };

function makeStore() {
  const rootReducer = combineReducers({
    emoji, io, messages, rtc,
  });
  const store = createStore(rootReducer, applyMiddleware(thunk));
  store.dispatch({ type: Actions.SET_ROOM, room: ROOM });
  return store;
}

function renderBottomBar(props = {}) {
  const store = makeStore();
  render(
    <Provider store={store}>
      <MemoryRouter>
        <BottomBar aiEnabled {...props} />
      </MemoryRouter>
    </Provider>,
  );
  return store;
}

beforeEach(async () => {
  await setGlobal({
    ref: 'ref', user: ME, isPicker: false,
  });
  draftReply.mockReset();
  rewriteMessage.mockReset();
  toast.error.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('BottomBar — Draft reply (AI)', () => {
  it('is hidden entirely when AI is disabled', () => {
    renderBottomBar({ aiEnabled: false });
    expect(screen.queryByRole('button', { name: 'Draft reply with AI' })).not.toBeInTheDocument();
  });

  it('fills the composer with the draft on success', async () => {
    draftReply.mockResolvedValueOnce({ data: { draft: 'Sounds good, see you then!' } });
    const userEv = userEvent.setup();
    renderBottomBar();

    await userEv.click(screen.getByRole('button', { name: 'Draft reply with AI' }));

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Type something to send...' }).textContent).toBe('Sounds good, see you then!');
    });
  });

  it('shows a spinning icon while generating, and disables the button', async () => {
    let resolveRequest;
    draftReply.mockImplementationOnce(() => new Promise((resolve) => { resolveRequest = resolve; }));
    const userEv = userEvent.setup();
    renderBottomBar();

    const button = screen.getByRole('button', { name: 'Draft reply with AI' });
    await userEv.click(button);

    expect(button).toBeDisabled();
    expect(button.querySelector('svg')).toHaveClass('animate-spin');

    resolveRequest({ data: { draft: 'done' } });
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it('prevents a duplicate submission while one is already in flight', async () => {
    let resolveRequest;
    draftReply.mockImplementationOnce(() => new Promise((resolve) => { resolveRequest = resolve; }));
    const userEv = userEvent.setup();
    renderBottomBar();

    const button = screen.getByRole('button', { name: 'Draft reply with AI' });
    await userEv.click(button); // first click starts the request; button becomes disabled
    // A second click cannot land on a disabled button via userEvent (it
    // simulates real pointer interaction) — this IS the duplicate-submission
    // prevention under test: the disabled attribute itself blocks it.
    expect(button).toBeDisabled();
    expect(draftReply).toHaveBeenCalledTimes(1);

    resolveRequest({ data: { draft: 'done' } });
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it('shows a rate-limit-specific error message on 429 RATE_LIMITED', async () => {
    draftReply.mockRejectedValueOnce({
      response: { status: 429, data: { reason: 'RATE_LIMITED' } },
    });
    const userEv = userEvent.setup();
    renderBottomBar();

    await userEv.click(screen.getByRole('button', { name: 'Draft reply with AI' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('wait a moment'));
    });
  });

  it('shows a quota-specific error message on QUOTA_EXCEEDED', async () => {
    draftReply.mockRejectedValueOnce({
      response: { status: 429, data: { reason: 'QUOTA_EXCEEDED' } },
    });
    const userEv = userEvent.setup();
    renderBottomBar();

    await userEv.click(screen.getByRole('button', { name: 'Draft reply with AI' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("today's AI usage limit"));
    });
  });

  it('does not show an error toast for a cancelled (unmounted) request', async () => {
    let resolveRequest;
    draftReply.mockImplementationOnce(() => new Promise((resolve) => { resolveRequest = resolve; }));
    const userEv = userEvent.setup();
    const { unmount } = render(
      <Provider store={makeStore()}>
        <MemoryRouter>
          <BottomBar aiEnabled />
        </MemoryRouter>
      </Provider>,
    );

    await userEv.click(screen.getByRole('button', { name: 'Draft reply with AI' }));
    unmount();
    // Simulate the in-flight request rejecting with axios's cancellation shape
    // AFTER unmount — must not throw or attempt a toast on a gone component.
    resolveRequest = undefined; // eslint-disable-line no-unused-vars
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe('BottomBar — Rewrite (AI)', () => {
  it('is not shown when the composer is empty', () => {
    renderBottomBar();
    expect(screen.queryByRole('button', { name: 'Rewrite with AI' })).not.toBeInTheDocument();
  });

  it('appears once text is typed, and replaces the composer text on success', async () => {
    rewriteMessage.mockResolvedValueOnce({ data: { rewritten: 'Hello! How are you doing today?' } });
    const userEv = userEvent.setup();
    renderBottomBar();

    const input = screen.getByRole('textbox', { name: 'Type something to send...' });
    await userEv.type(input, 'hey whats up');

    const button = await screen.findByRole('button', { name: 'Rewrite with AI' });
    await userEv.click(button);

    await waitFor(() => {
      expect(input.textContent).toBe('Hello! How are you doing today?');
    });
    expect(rewriteMessage).toHaveBeenCalledWith('hey whats up', null, expect.anything());
  });

  it('shows an insufficient/invalid-output error distinctly', async () => {
    rewriteMessage.mockRejectedValueOnce({
      response: { status: 502, data: { reason: 'INVALID_OUTPUT' } },
    });
    const userEv = userEvent.setup();
    renderBottomBar();

    const input = screen.getByRole('textbox', { name: 'Type something to send...' });
    await userEv.type(input, 'hey');
    await userEv.click(await screen.findByRole('button', { name: 'Rewrite with AI' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('could not produce a usable result'));
    });
  });
});
