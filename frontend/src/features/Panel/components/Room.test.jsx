import {
  describe, it, expect, beforeEach, vi,
} from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setGlobal } from 'reactn';
import { MemoryRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { createStore, combineReducers, applyMiddleware } from 'redux';
import thunk from 'redux-thunk';
import axios from 'axios';
import io from '../../../reducers/io';
import messages from '../../../reducers/messages';
import rtc from '../../../reducers/rtc';
import emoji from '../../../reducers/emoji';
import Actions from '../../../constants/Actions';
import Room from './Room';

vi.mock('axios');

const ME = { id: 'user-1' };
const OTHER = { _id: 'user-2', firstName: 'Other', lastName: 'Person' };

const makeRoom = (overrides = {}) => ({
  _id: 'room-1', isGroup: false, people: [{ _id: 'user-1' }, OTHER], ...overrides,
});

function renderRoom(room, initialRooms = [room]) {
  const rootReducer = combineReducers({
    emoji, io, messages, rtc,
  });
  const store = createStore(rootReducer, applyMiddleware(thunk));
  store.dispatch({ type: Actions.SET_ROOMS, rooms: initialRooms });
  render(
    <Provider store={store}>
      <MemoryRouter>
        <Room room={room} />
      </MemoryRouter>
    </Provider>,
  );
  return store;
}

beforeEach(async () => {
  await setGlobal({ user: ME, over: null });
  axios.mockReset();
});

describe('Panel Room row — last message preview', () => {
  it('shows the message content when not deleted', () => {
    renderRoom(makeRoom({ lastMessage: { content: 'hello there', type: 'text', author: 'user-2', date: new Date().toISOString() } }));
    expect(screen.getByText('hello there')).toBeInTheDocument();
  });

  it('shows "This message was deleted" when the last message is tombstoned', () => {
    renderRoom(makeRoom({
      lastMessage: {
        content: null, deletedForEveryone: true, type: 'text', author: 'user-2', date: new Date().toISOString(),
      },
    }));
    expect(screen.getByText('This message was deleted')).toBeInTheDocument();
    expect(screen.queryByText('null')).not.toBeInTheDocument();
  });

  it('prefixes "You: " before the deleted placeholder when I authored the deleted message', () => {
    renderRoom(makeRoom({
      lastMessage: {
        content: null, deletedForEveryone: true, type: 'text', author: 'user-1', date: new Date().toISOString(),
      },
    }));
    expect(screen.getByText('You: This message was deleted')).toBeInTheDocument();
  });
});

describe('Panel Room row — remove from inbox (non-vault)', () => {
  it('calls conversation/delete and dispatches CONVERSATION_DELETED, which filters the room out of state.io.rooms', async () => {
    axios.mockResolvedValue({ data: { status: 'success' } });
    const user = userEvent.setup();
    const room = makeRoom();
    const store = renderRoom(room);

    expect(store.getState().io.rooms.map((r) => r._id)).toContain('room-1');

    await user.click(screen.getByRole('button', { name: 'Remove conversation' }));

    expect(axios).toHaveBeenCalledWith(expect.objectContaining({
      method: 'post',
      url: expect.stringContaining('/api/conversation/delete'),
      data: { conversationId: 'room-1' },
    }));
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    expect(store.getState().io.rooms.map((r) => r._id)).not.toContain('room-1');
  });

  it('does not touch state.io.rooms when the delete request fails', async () => {
    axios.mockRejectedValue(new Error('network error'));
    const user = userEvent.setup();
    const store = renderRoom(makeRoom());

    await user.click(screen.getByRole('button', { name: 'Remove conversation' }));
    await new Promise((resolve) => { setTimeout(resolve, 0); });

    expect(store.getState().io.rooms.map((r) => r._id)).toContain('room-1');
  });

  it('does not render a remove button for a vault row', () => {
    const rootReducer = combineReducers({
      emoji, io, messages, rtc,
    });
    const store = createStore(rootReducer, applyMiddleware(thunk));
    render(
      <Provider store={store}>
        <MemoryRouter>
          <Room room={makeRoom()} inVault vaultToken="tok" />
        </MemoryRouter>
      </Provider>,
    );

    expect(screen.queryByRole('button', { name: 'Remove conversation' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
  });
});
