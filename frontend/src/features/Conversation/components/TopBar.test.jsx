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

vi.mock('../../../actions/hideConversation', () => ({ default: vi.fn() }));
vi.mock('../../../actions/deleteConversation', () => ({ default: vi.fn() }));
vi.mock('../../../actions/setupVaultPin', () => ({ default: vi.fn() }));
vi.mock('../../../actions/getVaultStatus', () => ({ default: vi.fn() }));
vi.mock('../../../actions/blockUser', () => ({ default: vi.fn() }));
vi.mock('../../../actions/unblockUser', () => ({ default: vi.fn() }));
vi.mock('../../../actions/getMeetingRoom', () => ({ default: vi.fn() }));
vi.mock('../../../actions/postCall', () => ({ default: vi.fn() }));
vi.mock('react-toastify', () => ({ toast: { warn: vi.fn(), error: vi.fn(), success: vi.fn() } }));

// eslint-disable-next-line import/first
import hideConversation from '../../../actions/hideConversation';
// eslint-disable-next-line import/first
import deleteConversation from '../../../actions/deleteConversation';
// eslint-disable-next-line import/first
import setupVaultPin from '../../../actions/setupVaultPin';
// eslint-disable-next-line import/first
import getVaultStatus from '../../../actions/getVaultStatus';
// eslint-disable-next-line import/first
import blockUser from '../../../actions/blockUser';
// eslint-disable-next-line import/first
import unblockUser from '../../../actions/unblockUser';
// eslint-disable-next-line import/first
import getMeetingRoom from '../../../actions/getMeetingRoom';
// eslint-disable-next-line import/first
import postCall from '../../../actions/postCall';

const ME = { id: 'user-1', firstName: 'Me', lastName: 'Self' };
const OTHER = {
  _id: 'user-2', firstName: 'Other', lastName: 'Person', username: 'other',
};
const ROOM = { _id: 'room-1', people: [ME, OTHER], isGroup: false };

function makeStore(room = ROOM) {
  const rootReducer = combineReducers({
    emoji, io, messages, rtc,
  });
  const store = createStore(rootReducer, applyMiddleware(thunk));
  store.dispatch({ type: Actions.SET_ROOM, room });
  // Marks OTHER as online so the client-side pre-flight "offline" check in
  // TopBar's call() doesn't short-circuit before reaching the (mocked)
  // server call — these tests are asserting the server-reason-driven toast,
  // a separate path from the offline pre-flight.
  store.dispatch({ type: Actions.ONLINE_USERS, data: [{ id: OTHER._id, status: 'online' }] });
  return store;
}

function renderTopBar(room) {
  const store = makeStore(room);
  render(
    <Provider store={store}>
      <MemoryRouter>
        <TopBar back={() => {}} loading={false} aiEnabled={false} />
      </MemoryRouter>
    </Provider>,
  );
  return store;
}

beforeEach(async () => {
  await setGlobal({ user: ME, favorites: [], showDetails: false });
  hideConversation.mockReset();
  deleteConversation.mockReset();
  setupVaultPin.mockReset();
  getVaultStatus.mockReset();
  blockUser.mockReset();
  unblockUser.mockReset();
  getMeetingRoom.mockReset();
  postCall.mockReset();
  toast.error.mockReset();
  toast.warn.mockReset();
  toast.success.mockReset();
  getVaultStatus.mockResolvedValue({ data: { configured: true } });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Conversation TopBar — privacy menu', () => {
  it('renders all six menu items in order, with Search/Mute/Report disabled', async () => {
    const user = userEvent.setup();
    renderTopBar();

    await user.click(screen.getByRole('button', { name: 'More options' }));

    expect(await screen.findByText('Search')).toHaveAttribute('data-disabled');
    expect(screen.getByText('Mute')).toHaveAttribute('data-disabled');
    expect(screen.getByText('Hide / Lock DM')).not.toHaveAttribute('data-disabled');
    expect(screen.getByText('Delete DM')).not.toHaveAttribute('data-disabled');
    expect(screen.getByText('Block')).not.toHaveAttribute('data-disabled');
    expect(screen.getByText('Report')).toHaveAttribute('data-disabled');
  });

  it('"Hide / Lock DM" opens the confirmation dialog and calls hideConversation on confirm when a vault already exists', async () => {
    const user = userEvent.setup();
    hideConversation.mockResolvedValue({ data: { status: 'success' } });
    renderTopBar();

    await user.click(screen.getByRole('button', { name: 'More options' }));
    await user.click(await screen.findByText('Hide / Lock DM'));

    expect(await screen.findByText('Hide this conversation?')).toBeInTheDocument();
    expect(hideConversation).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Hide / Lock DM' }));
    await waitFor(() => expect(hideConversation).toHaveBeenCalledWith('room-1'));
  });

  it('"Hide / Lock DM" shows first-time PIN setup when no vault is configured yet', async () => {
    const user = userEvent.setup();
    getVaultStatus.mockResolvedValue({ data: { configured: false } });
    setupVaultPin.mockResolvedValue({ data: { status: 'success' } });
    hideConversation.mockResolvedValue({ data: { status: 'success' } });
    renderTopBar();

    await user.click(screen.getByRole('button', { name: 'More options' }));
    await user.click(await screen.findByText('Hide / Lock DM'));

    expect(await screen.findByText('Set up your Private Vault')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Vault PIN'), '1234');
    await user.click(screen.getByRole('button', { name: 'Set PIN & Hide' }));

    await waitFor(() => expect(setupVaultPin).toHaveBeenCalledWith('1234'));
    await waitFor(() => expect(hideConversation).toHaveBeenCalledWith('room-1'));
  });

  it('"Delete DM" requires confirmation before calling deleteConversation', async () => {
    const user = userEvent.setup();
    deleteConversation.mockResolvedValue({ data: { status: 'success' } });
    renderTopBar();

    await user.click(screen.getByRole('button', { name: 'More options' }));
    await user.click(await screen.findByText('Delete DM'));

    expect(await screen.findByText('Delete this conversation?')).toBeInTheDocument();
    expect(deleteConversation).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Delete DM' }));
    await waitFor(() => expect(deleteConversation).toHaveBeenCalledWith('room-1'));
  });

  it('"Block" calls blockUser with the other participant\'s username, no confirmation dialog', async () => {
    const user = userEvent.setup();
    blockUser.mockResolvedValue({ data: { status: 'success' } });
    renderTopBar();

    await user.click(screen.getByRole('button', { name: 'More options' }));
    await user.click(await screen.findByText('Block'));

    await waitFor(() => expect(blockUser).toHaveBeenCalledWith('other'));
  });

  it('shows "Unblock" instead of "Block" when the other participant is already blocked by me', async () => {
    const user = userEvent.setup();
    unblockUser.mockResolvedValue({ data: { ok: true } });
    const blockedOther = { ...OTHER, blockedByMe: true };
    renderTopBar({ ...ROOM, people: [ME, blockedOther] });

    await user.click(screen.getByRole('button', { name: 'More options' }));

    expect(screen.queryByText('Block')).not.toBeInTheDocument();
    await user.click(await screen.findByText('Unblock'));

    await waitFor(() => expect(unblockUser).toHaveBeenCalledWith('other'));
  });

  it('disables "Block" (does not call blockUser) when the other participant has blocked me', async () => {
    const user = userEvent.setup();
    const blockedMeOther = { ...OTHER, blockedMe: true };
    renderTopBar({ ...ROOM, people: [ME, blockedMeOther] });

    await user.click(screen.getByRole('button', { name: 'More options' }));
    await user.click(await screen.findByText('Block'));

    expect(blockUser).not.toHaveBeenCalled();
  });

  it('disabled Search/Mute/Report items do not trigger any action', async () => {
    const user = userEvent.setup();
    renderTopBar();

    await user.click(screen.getByRole('button', { name: 'More options' }));
    await user.click(await screen.findByText('Search'));

    expect(hideConversation).not.toHaveBeenCalled();
    expect(deleteConversation).not.toHaveBeenCalled();
    expect(blockUser).not.toHaveBeenCalled();
  });
});

describe('Conversation TopBar — call authorization', () => {
  it('shows "account no longer available" when the server rejects a call with recipient_unavailable', async () => {
    const user = userEvent.setup();
    getMeetingRoom.mockResolvedValue({ data: { _id: 'meeting-1' } });
    postCall.mockRejectedValue({ response: { data: { reason: 'recipient_unavailable' } } });
    renderTopBar();

    await user.click(screen.getByRole('button', { name: 'Audio Call' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("This person's account is no longer available."));
  });

  it('shows "can\'t call this person" when the server rejects a call as blocked', async () => {
    const user = userEvent.setup();
    getMeetingRoom.mockResolvedValue({ data: { _id: 'meeting-1' } });
    postCall.mockRejectedValue({ response: { data: { reason: 'blocked' } } });
    renderTopBar();

    await user.click(screen.getByRole('button', { name: 'Audio Call' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("You can't call this person."));
  });

  it('falls back to a generic error for an unrecognized/network failure', async () => {
    const user = userEvent.setup();
    getMeetingRoom.mockRejectedValue(new Error('network down'));
    renderTopBar();

    await user.click(screen.getByRole('button', { name: 'Audio Call' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Server error. Unable to initiate call.'));
  });
});
