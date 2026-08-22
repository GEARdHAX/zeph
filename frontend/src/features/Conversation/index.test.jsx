import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import {
  MemoryRouter, Routes, Route, useNavigate,
} from 'react-router-dom';
import { createStore, combineReducers, applyMiddleware } from 'redux';
import thunk from 'redux-thunk';
import { setGlobal } from 'reactn';
import io from '../../reducers/io';
import messages from '../../reducers/messages';
import rtc from '../../reducers/rtc';
import emoji from '../../reducers/emoji';
import Conversation from './index';

vi.mock('../../actions/getRoom', () => ({ default: vi.fn() }));
vi.mock('../../actions/getInfo', () => ({ default: vi.fn(() => Promise.resolve({ data: { aiEnabled: false } })) }));
vi.mock('../../actions/markMessageRead', () => ({ default: vi.fn(() => Promise.resolve()) }));
vi.mock('../../actions/typing', () => ({ default: () => () => {} }));
vi.mock('../../actions/message', () => ({ default: vi.fn() }));
vi.mock('../../actions/getRooms', () => ({ default: vi.fn(() => Promise.resolve({ data: { rooms: [] } })) }));

// eslint-disable-next-line import/first
import getRoom from '../../actions/getRoom';

const ME = { id: 'user-1', firstName: 'Me', lastName: 'Self' };

function renderAtRoom(roomId) {
  const rootReducer = combineReducers({
    emoji, io, messages, rtc,
  });
  const store = createStore(rootReducer, applyMiddleware(thunk));
  const view = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[`/room/${roomId}`]}>
        <Routes>
          <Route path="/room/:id" element={<Conversation />} />
          <Route path="/" element={<div>Home screen</div>} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
  return { store, ...view };
}

const roomResponse = (id) => ({
  data: {
    room: {
      _id: id, isGroup: false, people: [{ _id: 'user-1' }, { _id: 'user-2' }], messages: [],
    },
  },
});

beforeEach(async () => {
  await setGlobal({ user: ME, over: null, vaultToken: null });
  getRoom.mockReset();
});

describe('Conversation — room state cleanup', () => {
  it('resets state.io.room/messages to null on unmount, so a stale room does not leak into whatever renders next', async () => {
    getRoom.mockResolvedValue(roomResponse('room-1'));
    const { store, unmount } = renderAtRoom('room-1');

    await waitFor(() => expect(store.getState().io.room?._id).toBe('room-1'));

    // Navigating away unmounts Conversation entirely — its cleanup must
    // clear the room/messages, not leave "room-1" sitting in Redux
    // indefinitely for whatever the user navigates to next (Details
    // panel, Home) to read stale data from.
    unmount();

    expect(store.getState().io.room).toBeNull();
    expect(store.getState().io.messages).toEqual([]);
  });
});

describe('Conversation — stale-response race protection', () => {
  it('does not let an in-flight fetch for a previous room overwrite the newly-navigated room once it resolves late', async () => {
    let resolveRoomA;
    getRoom.mockImplementationOnce(() => new Promise((resolve) => {
      resolveRoomA = resolve;
    }));
    getRoom.mockResolvedValueOnce(roomResponse('room-b'));

    const rootReducer = combineReducers({
      emoji, io, messages, rtc,
    });
    const store = createStore(rootReducer, applyMiddleware(thunk));

    function App() {
      const navigate = useNavigate();
      return (
        <>
          <button type="button" onClick={() => navigate('/room/room-b')}>Go to room-b</button>
          <Routes>
            <Route path="/room/:id" element={<Conversation />} />
          </Routes>
        </>
      );
    }

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/room/room-a']}>
          <App />
        </MemoryRouter>
      </Provider>,
    );

    // Navigate to room-b before room-a's fetch resolves — this unmounts
    // room-a's Conversation instance (running its cleanup) and mounts a
    // fresh one for room-b, exactly like clicking a different chat in the
    // sidebar before the previous one finished loading.
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Go to room-b' }));

    await waitFor(() => expect(store.getState().io.room?._id).toBe('room-b'));

    // room-a's fetch finally resolves late — it must NOT clobber room-b.
    resolveRoomA(roomResponse('room-a'));
    await new Promise((resolve) => { setTimeout(resolve, 10); });

    expect(store.getState().io.room?._id).toBe('room-b');
  });
});
