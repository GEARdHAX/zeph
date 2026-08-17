import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import {
  render, screen, act, fireEvent, waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { createStore, combineReducers, applyMiddleware } from 'redux';
import thunk from 'redux-thunk';
import io from '../../../reducers/io';
import messages from '../../../reducers/messages';
import rtc from '../../../reducers/rtc';
import emoji from '../../../reducers/emoji';
import AddPeople from './AddPeople';

vi.mock('../../../actions/search', () => ({ default: vi.fn() }));
vi.mock('../../../actions/resolveUser', () => ({ default: vi.fn() }));
vi.mock('../../../actions/sendFriendRequest', () => ({ default: vi.fn() }));
vi.mock('../../../actions/createRoom', () => ({ default: vi.fn() }));

// eslint-disable-next-line import/first
import search from '../../../actions/search';
// eslint-disable-next-line import/first
import resolveUser from '../../../actions/resolveUser';
// eslint-disable-next-line import/first
import sendFriendRequest from '../../../actions/sendFriendRequest';
// eslint-disable-next-line import/first
import createRoom from '../../../actions/createRoom';

function makeStore() {
  const rootReducer = combineReducers({
    emoji, io, messages, rtc,
  });
  return createStore(rootReducer, applyMiddleware(thunk));
}

function renderAddPeople(onClose = () => {}) {
  render(
    <Provider store={makeStore()}>
      <MemoryRouter>
        <AddPeople onClose={onClose} />
      </MemoryRouter>
    </Provider>,
  );
}

beforeEach(() => {
  search.mockReset();
  resolveUser.mockReset();
  sendFriendRequest.mockReset();
  createRoom.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AddPeople search', () => {
  it('does not search below the minimum query length', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderAddPeople();

    fireEvent.change(screen.getByPlaceholderText('Search @username...'), { target: { value: 'a' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(search).not.toHaveBeenCalled();
    expect(screen.getByText('Keep typing to search…')).toBeInTheDocument();
  });

  it('debounces the search call, only firing once after the user stops typing', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    search.mockResolvedValue({ data: { users: [] } });
    renderAddPeople();

    const input = screen.getByPlaceholderText('Search @username...');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'al' } });
      fireEvent.change(input, { target: { value: 'ali' } });
      fireEvent.change(input, { target: { value: 'alic' } });
    });

    expect(search).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('alic', undefined, expect.any(AbortSignal));
  });

  it('renders search results and opens a profile preview on click', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    search.mockResolvedValue({
      data: {
        users: [{
          _id: 'u2', username: 'bob', firstName: 'Bob', lastName: 'Builder',
        }],
      },
    });
    resolveUser.mockResolvedValue({
      data: {
        user: {
          _id: 'u2', username: 'bob', firstName: 'Bob', lastName: 'Builder',
        },
        relationship: null,
      },
    });

    const userEv = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderAddPeople();

    fireEvent.change(screen.getByPlaceholderText('Search @username...'), { target: { value: 'bob' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });

    expect(await screen.findByText('@bob')).toBeInTheDocument();

    await userEv.click(screen.getByText('@bob'));

    await waitFor(() => expect(resolveUser).toHaveBeenCalledWith('bob'));
    expect(await screen.findByRole('button', { name: /start chat/i })).toBeInTheDocument();
  });

  it('optimistically flips "Add Friend" to "Requested" (disabled) the instant it is clicked, before the network call resolves', async () => {
    resolveUser.mockResolvedValue({
      data: {
        user: {
          _id: 'u2', username: 'carol', firstName: 'Carol', lastName: '',
        },
        relationship: null,
      },
    });
    // Never resolves during this test — proves the label/disabled state
    // change is optimistic, not waiting on the response.
    let resolveSend;
    sendFriendRequest.mockImplementation(() => new Promise((resolve) => {
      resolveSend = resolve;
    }));

    const userEv = userEvent.setup();
    render(
      <Provider store={makeStore()}>
        <MemoryRouter>
          <AddPeople onClose={() => {}} />
        </MemoryRouter>
      </Provider>,
    );

    // Directly exercise ProfilePreview by triggering search -> click, using real timers
    // (no debounce assertions needed here — that's covered above).
    search.mockResolvedValue({
      data: {
        users: [{
          _id: 'u2', username: 'carol', firstName: 'Carol', lastName: '',
        }],
      },
    });
    await userEv.type(screen.getByPlaceholderText('Search @username...'), 'carol');
    await waitFor(() => expect(search).toHaveBeenCalled(), { timeout: 2000 });

    const result = await screen.findByText('@carol');
    await userEv.click(result);

    const addFriendButton = await screen.findByRole('button', { name: /add friend/i });
    await userEv.click(addFriendButton);

    // Still in-flight (resolveSend not called yet) — already disabled and relabeled.
    expect(await screen.findByRole('button', { name: /requested/i })).toBeDisabled();
    expect(sendFriendRequest).toHaveBeenCalledWith('carol');
    expect(sendFriendRequest).toHaveBeenCalledTimes(1);

    // A second click attempt while pending should be inert — the button is disabled.
    await userEv.click(screen.getByRole('button', { name: /requested/i }));
    expect(sendFriendRequest).toHaveBeenCalledTimes(1);

    resolveSend({ data: { relationship: { status: 'pending' } } });
  });

  it('reverts to "Add Friend" if sending the request fails outright (not a 409 conflict)', async () => {
    resolveUser.mockResolvedValue({
      data: {
        user: {
          _id: 'u3', username: 'dave', firstName: 'Dave', lastName: '',
        },
        relationship: null,
      },
    });
    sendFriendRequest.mockRejectedValue(new Error('network down'));

    const userEv = userEvent.setup();
    search.mockResolvedValue({
      data: {
        users: [{
          _id: 'u3', username: 'dave', firstName: 'Dave', lastName: '',
        }],
      },
    });
    render(
      <Provider store={makeStore()}>
        <MemoryRouter>
          <AddPeople onClose={() => {}} />
        </MemoryRouter>
      </Provider>,
    );

    await userEv.type(screen.getByPlaceholderText('Search @username...'), 'dave');
    await waitFor(() => expect(search).toHaveBeenCalled(), { timeout: 2000 });
    await userEv.click(await screen.findByText('@dave'));
    await userEv.click(await screen.findByRole('button', { name: /add friend/i }));

    expect(await screen.findByRole('button', { name: /add friend/i })).not.toBeDisabled();
  });
});

describe('AddPeople search result cards — already-mutual friends', () => {
  it('shows a "Friends" badge on a result the backend marked relationshipStatus: "accepted"', async () => {
    search.mockResolvedValue({
      data: {
        users: [{
          _id: 'u4', username: 'erin', firstName: 'Erin', lastName: '', relationshipStatus: 'accepted',
        }],
      },
    });
    const userEv = userEvent.setup();
    renderAddPeople();

    await userEv.type(screen.getByPlaceholderText('Search @username...'), 'erin');
    await waitFor(() => expect(search).toHaveBeenCalled(), { timeout: 2000 });

    expect(await screen.findByText('Friends')).toBeInTheDocument();
  });

  it('does not show a "Friends" badge for a non-friend result', async () => {
    search.mockResolvedValue({
      data: {
        users: [{
          _id: 'u5', username: 'frank', firstName: 'Frank', lastName: '', relationshipStatus: null,
        }],
      },
    });
    const userEv = userEvent.setup();
    renderAddPeople();

    await userEv.type(screen.getByPlaceholderText('Search @username...'), 'frank');
    await waitFor(() => expect(search).toHaveBeenCalled(), { timeout: 2000 });
    await screen.findByText('@frank');

    expect(screen.queryByText('Friends')).not.toBeInTheDocument();
  });

  it('clicking a friend\'s result card opens the DM directly, skipping the profile-preview dialog', async () => {
    search.mockResolvedValue({
      data: {
        users: [{
          _id: 'u6', username: 'grace', firstName: 'Grace', lastName: '', relationshipStatus: 'accepted',
        }],
      },
    });
    createRoom.mockResolvedValue({ data: { room: { _id: 'room-9', messages: [] } } });

    const userEv = userEvent.setup();
    renderAddPeople();

    await userEv.type(screen.getByPlaceholderText('Search @username...'), 'grace');
    await waitFor(() => expect(search).toHaveBeenCalled(), { timeout: 2000 });

    await userEv.click(await screen.findByText('@grace'));

    await waitFor(() => expect(createRoom).toHaveBeenCalledWith('u6'));
    // No profile-preview dialog ("Profile" title) should have opened.
    expect(screen.queryByText('Profile')).not.toBeInTheDocument();
    expect(resolveUser).not.toHaveBeenCalled();
  });

  it('clicking a non-friend\'s result card opens the profile preview instead of a DM', async () => {
    search.mockResolvedValue({
      data: {
        users: [{
          _id: 'u7', username: 'heidi', firstName: 'Heidi', lastName: '', relationshipStatus: null,
        }],
      },
    });
    resolveUser.mockResolvedValue({
      data: {
        user: {
          _id: 'u7', username: 'heidi', firstName: 'Heidi', lastName: '',
        },
        relationship: null,
      },
    });

    const userEv = userEvent.setup();
    renderAddPeople();

    await userEv.type(screen.getByPlaceholderText('Search @username...'), 'heidi');
    await waitFor(() => expect(search).toHaveBeenCalled(), { timeout: 2000 });

    await userEv.click(await screen.findByText('@heidi'));

    expect(await screen.findByText('Profile')).toBeInTheDocument();
    expect(createRoom).not.toHaveBeenCalled();
  });
});
