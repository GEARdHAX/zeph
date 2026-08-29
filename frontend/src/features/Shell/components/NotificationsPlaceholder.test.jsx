import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { createStore, combineReducers, applyMiddleware } from 'redux';
import thunk from 'redux-thunk';
import io from '../../../reducers/io';
import messages from '../../../reducers/messages';
import Actions from '../../../constants/Actions';
import getFriendRequests from '../../../actions/getFriendRequests';
import NotificationsPlaceholder from './NotificationsPlaceholder';

vi.mock('../../../actions/getFriendRequests', () => ({ default: vi.fn() }));
vi.mock('../../../actions/respondFriendRequest', () => ({ default: vi.fn() }));

function renderWithSocket(socket) {
  const rootReducer = combineReducers({ io, messages });
  const store = createStore(rootReducer, applyMiddleware(thunk));
  if (socket) store.dispatch({ type: Actions.IO_INIT, io: socket });

  render(
    <Provider store={store}>
      <MemoryRouter>
        <NotificationsPlaceholder />
      </MemoryRouter>
    </Provider>,
  );
}

// Minimal event-emitter stand-in — just enough for .on/.off/a manual fire.
function fakeSocket() {
  const handlers = {};
  return {
    id: 'sock-1',
    on: vi.fn((event, cb) => { handlers[event] = cb; }),
    off: vi.fn((event) => { delete handlers[event]; }),
    fire: (event, data) => handlers[event]?.(data),
  };
}

beforeEach(() => {
  getFriendRequests.mockResolvedValue({ data: { incoming: [] } });
});

describe('NotificationsPlaceholder — live friend-request updates', () => {
  it('appends a request that arrives via socket while the page is already open', async () => {
    const socket = fakeSocket();
    renderWithSocket(socket);

    await waitFor(() => expect(getFriendRequests).toHaveBeenCalled());

    socket.fire('friend-request:received', {
      relationship: { _id: 'r1', status: 'pending' },
      requester: { _id: 'u2', firstName: 'Rohan', lastName: 'K', username: 'rohan' },
    });

    expect(await screen.findByText('Rohan K')).toBeInTheDocument();
    expect(screen.getByText('Friend Requests (1)')).toBeInTheDocument();
  });

  it('does not add a duplicate if the same relationship id arrives twice', async () => {
    const socket = fakeSocket();
    renderWithSocket(socket);
    await waitFor(() => expect(getFriendRequests).toHaveBeenCalled());

    const payload = {
      relationship: { _id: 'r1', status: 'pending' },
      requester: { _id: 'u2', firstName: 'Rohan', lastName: 'K', username: 'rohan' },
    };
    socket.fire('friend-request:received', payload);
    socket.fire('friend-request:received', payload);

    await waitFor(() => expect(screen.getByText('Friend Requests (1)')).toBeInTheDocument());
  });

  it('never throws when no socket is connected yet', async () => {
    expect(() => renderWithSocket(null)).not.toThrow();
    await waitFor(() => expect(getFriendRequests).toHaveBeenCalled());
  });
});
