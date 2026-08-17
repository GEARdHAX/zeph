import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { setGlobal } from 'reactn';
import { MemoryRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { createStore, combineReducers, applyMiddleware } from 'redux';
import thunk from 'redux-thunk';
import io from '../../../reducers/io';
import messages from '../../../reducers/messages';
import rtc from '../../../reducers/rtc';
import emoji from '../../../reducers/emoji';
import Room from './Room';

const ME = { id: 'user-1' };
const OTHER = { _id: 'user-2', firstName: 'Other', lastName: 'Person' };

const makeRoom = (overrides = {}) => ({
  _id: 'room-1', isGroup: false, people: [{ _id: 'user-1' }, OTHER], ...overrides,
});

function renderRoom(room) {
  const rootReducer = combineReducers({
    emoji, io, messages, rtc,
  });
  const store = createStore(rootReducer, applyMiddleware(thunk));
  render(
    <Provider store={store}>
      <MemoryRouter>
        <Room room={room} />
      </MemoryRouter>
    </Provider>,
  );
}

beforeEach(async () => {
  await setGlobal({ user: ME, over: null });
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
