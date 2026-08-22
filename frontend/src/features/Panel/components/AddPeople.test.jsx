import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import {
  render, screen, act, waitFor,
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

// Types text then presses Enter to explicitly submit the search — the new
// contract requires an explicit trigger, typing alone never fires a request.
const typeAndSubmit = async (userEv, text) => {
  const input = screen.getByPlaceholderText('Search @username, then press Enter...');
  await userEv.type(input, text);
  await userEv.keyboard('{Enter}');
};

beforeEach(() => {
  search.mockReset();
  resolveUser.mockReset();
  sendFriendRequest.mockReset();
  createRoom.mockReset();
});

describe('AddPeople search — explicit trigger only', () => {
  it('does not search while typing, below or above the minimum length', async () => {
    const userEv = userEvent.setup();
    renderAddPeople();

    await userEv.type(screen.getByPlaceholderText('Search @username, then press Enter...'), 'alice');

    expect(search).not.toHaveBeenCalled();
  });

  it('does not search on Enter below the minimum query length', async () => {
    const userEv = userEvent.setup();
    renderAddPeople();

    await typeAndSubmit(userEv, 'al');

    expect(search).not.toHaveBeenCalled();
    expect(screen.getByText(/keep typing/i)).toBeInTheDocument();
  });

  it('fires exactly one request on Enter once the minimum length is met', async () => {
    search.mockResolvedValue({ data: { users: [] } });
    const userEv = userEvent.setup();
    renderAddPeople();

    await typeAndSubmit(userEv, 'alice');

    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    expect(search).toHaveBeenCalledWith('alice', undefined, expect.any(AbortSignal));
  });

  it('fires exactly one request when the Search button is clicked', async () => {
    search.mockResolvedValue({ data: { users: [] } });
    const userEv = userEvent.setup();
    renderAddPeople();

    await userEv.type(screen.getByPlaceholderText('Search @username, then press Enter...'), 'bobby');
    await userEv.click(screen.getByRole('button', { name: /^search$/i }));

    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
  });

  it('a fresh cache hit for the same query fires zero additional requests', async () => {
    search.mockResolvedValue({
      data: { users: [{ _id: 'u1', username: 'carol', firstName: 'Carol', lastName: '' }] },
    });
    const userEv = userEvent.setup();
    renderAddPeople();

    await typeAndSubmit(userEv, 'carol');
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    await screen.findByText('@carol');

    // Clear and re-submit the exact same query — should serve from cache.
    await userEv.keyboard('{Enter}');

    expect(search).toHaveBeenCalledTimes(1);
    expect(screen.getByText('@carol')).toBeInTheDocument();
  });

  it('a new search aborts the previous in-flight request so the stale response cannot overwrite the newer result', async () => {
    let resolveFirst;
    let resolveSecond;
    search
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));

    const userEv = userEvent.setup();
    renderAddPeople();

    const input = screen.getByPlaceholderText('Search @username, then press Enter...');
    await userEv.type(input, 'alice');
    await userEv.keyboard('{Enter}');
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    const firstSignal = search.mock.calls[0][2];

    await userEv.clear(input);
    await userEv.type(input, 'brian');
    await userEv.keyboard('{Enter}');
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2));

    expect(firstSignal.aborted).toBe(true);

    // Late-resolving first ("alice") response must not win over the second.
    await act(async () => {
      resolveFirst({ data: { users: [{ _id: 'stale', username: 'alice', firstName: 'A', lastName: '' }] } });
      resolveSecond({ data: { users: [{ _id: 'fresh', username: 'brian', firstName: 'B', lastName: '' }] } });
      await Promise.resolve();
    });

    expect(await screen.findByText('@brian')).toBeInTheDocument();
    expect(screen.queryByText('@alice')).not.toBeInTheDocument();
  });

  it('renders search results and opens a profile preview on click', async () => {
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

    const userEv = userEvent.setup();
    renderAddPeople();

    await typeAndSubmit(userEv, 'bob');
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
    search.mockResolvedValue({
      data: {
        users: [{
          _id: 'u2', username: 'carol', firstName: 'Carol', lastName: '',
        }],
      },
    });

    const userEv = userEvent.setup();
    renderAddPeople();

    await typeAndSubmit(userEv, 'carol');
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
    search.mockResolvedValue({
      data: {
        users: [{
          _id: 'u3', username: 'dave', firstName: 'Dave', lastName: '',
        }],
      },
    });

    const userEv = userEvent.setup();
    renderAddPeople();

    await typeAndSubmit(userEv, 'dave');
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

    await typeAndSubmit(userEv, 'erin');

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

    await typeAndSubmit(userEv, 'frank');
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

    await typeAndSubmit(userEv, 'grace');
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

    await typeAndSubmit(userEv, 'heidi');
    await userEv.click(await screen.findByText('@heidi'));

    expect(await screen.findByText('Profile')).toBeInTheDocument();
    expect(createRoom).not.toHaveBeenCalled();
  });
});
