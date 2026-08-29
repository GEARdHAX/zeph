import {
  describe, it, expect, beforeEach, vi,
} from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setGlobal } from 'reactn';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
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

// Surfaces the current router path as text so a redirect can be asserted
// on directly, instead of only inferring it from side effects.
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{location.pathname}</div>;
}

function renderRoom(room, initialRooms = [room], initialPath = '/') {
  const rootReducer = combineReducers({
    emoji, io, messages, rtc,
  });
  const store = createStore(rootReducer, applyMiddleware(thunk));
  store.dispatch({ type: Actions.SET_ROOMS, rooms: initialRooms });
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[initialPath]}>
        <LocationProbe />
        <Routes>
          <Route path="*" element={<Room room={room} />} />
        </Routes>
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

  it('redirects to / when the deleted room is the one currently open', async () => {
    axios.mockResolvedValue({ data: { status: 'success' } });
    const user = userEvent.setup();
    renderRoom(makeRoom(), [makeRoom()], '/room/room-1');

    expect(screen.getByTestId('location-probe').textContent).toBe('/room/room-1');
    await user.click(screen.getByRole('button', { name: 'Remove conversation' }));
    await new Promise((resolve) => { setTimeout(resolve, 0); });

    expect(screen.getByTestId('location-probe').textContent).toBe('/');
  });

  it('does not redirect when a different room is currently open', async () => {
    axios.mockResolvedValue({ data: { status: 'success' } });
    const user = userEvent.setup();
    renderRoom(makeRoom(), [makeRoom()], '/room/some-other-room');

    await user.click(screen.getByRole('button', { name: 'Remove conversation' }));
    await new Promise((resolve) => { setTimeout(resolve, 0); });

    expect(screen.getByTestId('location-probe').textContent).toBe('/room/some-other-room');
  });

  it('does not redirect when the delete request fails, even if this room is open', async () => {
    axios.mockRejectedValue(new Error('network error'));
    const user = userEvent.setup();
    renderRoom(makeRoom(), [makeRoom()], '/room/room-1');

    await user.click(screen.getByRole('button', { name: 'Remove conversation' }));
    await new Promise((resolve) => { setTimeout(resolve, 0); });

    expect(screen.getByTestId('location-probe').textContent).toBe('/room/room-1');
  });

  it('positions the delete button to align with the date text it replaces on hover (regression: was measured against the outer wrapper while the date text was measured against the inner padded button, so on hover the icon visibly overlapped "Aug 29" / "7:24 PM" instead of cleanly swapping with it)', () => {
    renderRoom(makeRoom());
    const deleteButton = screen.getByRole('button', { name: 'Remove conversation' });

    // right-4/top-1/2/-translate-y-1/2 was the old, wrapper-relative
    // positioning that caused the overlap — asserting its absence, not just
    // the new classes' presence, so a future edit can't silently reintroduce
    // the same mismatch under a different class combination.
    expect(deleteButton.className).not.toMatch(/\bright-4\b/);
    expect(deleteButton.className).not.toMatch(/\btop-1\/2\b/);
    expect(deleteButton.className).not.toMatch(/-translate-y-1\/2/);

    // The date span (what the button visually replaces) must fade out on
    // hover for a non-vault row — if it didn't, the two would still overlap
    // regardless of where the button itself sits. makeRoom() has no
    // lastMessage, so Room.jsx falls back to rendering "Today" as the date.
    const dateSpan = screen.getByText('Today');
    expect(dateSpan.className).toMatch(/group-hover\/row:opacity-0/);
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
    // Nothing to swap with on hover (no delete button here), so the date
    // text must stay a plain, always-visible span.
    expect(screen.getByText('Today').className).not.toMatch(/group-hover\/row:opacity-0/);
  });
});

describe('Panel Room row — removed-conversations list (restore)', () => {
  function renderRemovedRow(room, onRestored) {
    const rootReducer = combineReducers({
      emoji, io, messages, rtc,
    });
    const store = createStore(rootReducer, applyMiddleware(thunk));
    render(
      <Provider store={store}>
        <MemoryRouter>
          <Room room={room} removed onRestored={onRestored} />
        </MemoryRouter>
      </Provider>,
    );
    return store;
  }

  it('renders a Restore button, not the normal remove-from-inbox trash icon', () => {
    renderRemovedRow(makeRoom());
    expect(screen.getByRole('button', { name: /restore/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove conversation' })).not.toBeInTheDocument();
  });

  it('clicking the row does not navigate (same as an inVault row — no click-through into a hidden/removed conversation)', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <Provider store={createStore(combineReducers({
        emoji, io, messages, rtc,
      }), applyMiddleware(thunk))}
      >
        <MemoryRouter initialEntries={['/']}>
          <LocationProbe />
          <Routes>
            <Route path="*" element={<Room room={makeRoom()} removed />} />
          </Routes>
        </MemoryRouter>
      </Provider>,
    );

    // The row's outer selectable button has no accessible name of its own
    // (the row's text content is inside it, not an aria-label) — select it
    // structurally instead, matching how it's the first button and the
    // Restore button is the second/last.
    const rowButton = container.querySelectorAll('button')[0];
    await user.click(rowButton);
    expect(screen.getByTestId('location-probe').textContent).toBe('/');
  });

  it('calling restore hits conversation/restore and calls onRestored with the room id', async () => {
    axios.mockResolvedValue({ data: { status: 'success' } });
    const onRestored = vi.fn();
    const user = userEvent.setup();
    renderRemovedRow(makeRoom(), onRestored);

    await user.click(screen.getByRole('button', { name: /restore/i }));

    expect(axios).toHaveBeenCalledWith(expect.objectContaining({
      method: 'post',
      url: expect.stringContaining('/api/conversation/restore'),
      data: { conversationId: 'room-1' },
    }));
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    expect(onRestored).toHaveBeenCalledWith('room-1');
  });

  it('does not call onRestored when the restore request fails', async () => {
    axios.mockRejectedValue(new Error('network error'));
    const onRestored = vi.fn();
    const user = userEvent.setup();
    renderRemovedRow(makeRoom(), onRestored);

    await user.click(screen.getByRole('button', { name: /restore/i }));
    await new Promise((resolve) => { setTimeout(resolve, 0); });

    expect(onRestored).not.toHaveBeenCalled();
  });
});
