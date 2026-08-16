import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import {
  render, screen, act, fireEvent, waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { createStore, combineReducers, applyMiddleware } from 'redux';
import thunk from 'redux-thunk';
import { setGlobal } from 'reactn';
import io from '../../../reducers/io';
import messages from '../../../reducers/messages';
import rtc from '../../../reducers/rtc';
import emoji from '../../../reducers/emoji';
import Actions from '../../../constants/Actions';
import BottomBar from './BottomBar';

vi.mock('../../../actions/message', () => ({ default: vi.fn() }));
vi.mock('../../../actions/getRooms', () => ({ default: vi.fn(() => Promise.resolve({ data: { rooms: [] } })) }));
vi.mock('../../../actions/typing', () => ({ default: () => () => {} }));
// @emoji-mart/react needs a peer `emoji-mart` package that Vite's browser bundling
// resolves but Vitest's Node module resolution doesn't — not exercised by this test.
vi.mock('@emoji-mart/react', () => ({ default: () => null }));

// eslint-disable-next-line import/first
import message from '../../../actions/message';

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

function renderBottomBar() {
  const store = makeStore();
  render(
    <Provider store={store}>
      <BottomBar />
    </Provider>,
  );
  return store;
}

beforeEach(async () => {
  await setGlobal({
    ref: 'ref', user: ME, isPicker: false,
  });
  message.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('BottomBar offline-retry send flow', () => {
  it('optimistically appends the message with a clientID, then swaps in the server _id and marks it sent', async () => {
    const userEv = userEvent.setup();
    message.mockResolvedValueOnce({ data: { message: { _id: 'server-id-1' } } });

    const store = renderBottomBar();
    const input = screen.getByPlaceholderText('Type something to send...');

    await userEv.type(input, 'hello there');
    await userEv.click(screen.getByRole('button', { name: 'Send message' }));

    // Input clears immediately, independent of the network result.
    expect(input.value).toBe('');

    await waitFor(() => {
      expect(store.getState().io.messages[0].status).toBe('sent');
    });
    const [sent] = store.getState().io.messages;
    expect(sent.content).toBe('hello there');
    expect(sent.clientID).toBeTruthy();
    expect(sent._id).toBe('server-id-1');
  });

  it('shows the optimistic message as "sending" while the request is in flight', async () => {
    let resolveRequest;
    message.mockImplementationOnce(() => new Promise((resolve) => {
      resolveRequest = resolve;
    }));

    const store = renderBottomBar();
    const input = screen.getByPlaceholderText('Type something to send...');

    await act(async () => {
      fireEvent.change(input, { target: { value: 'hold on' } });
      fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    });

    expect(store.getState().io.messages[0].status).toBe('sending');

    await act(async () => {
      resolveRequest({ data: { message: { _id: 'server-id-2' } } });
    });

    await waitFor(() => {
      expect(store.getState().io.messages[0].status).toBe('sent');
    });
  });

  it('retries on failure and eventually marks the message failed after exhausting retries', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    message.mockRejectedValue(new Error('network down'));

    const store = renderBottomBar();
    const input = screen.getByPlaceholderText('Type something to send...');

    await act(async () => {
      fireEvent.change(input, { target: { value: 'will fail' } });
      fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    });

    expect(store.getState().io.messages[0].status).toBe('sending');

    // 4 attempts total = up to 1s + 2s + 4s of backoff between them.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000 + 2000 + 4000 + 100);
    });

    expect(message).toHaveBeenCalledTimes(4);
    expect(store.getState().io.messages[0].status).toBe('failed');
  });

  it('does not send an empty message', async () => {
    const userEv = userEvent.setup();
    const store = renderBottomBar();

    await userEv.click(screen.getByRole('button', { name: 'Send message' }));

    expect(store.getState().io.messages).toHaveLength(0);
    expect(message).not.toHaveBeenCalled();
  });
});
