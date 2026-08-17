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

const ME = { id: 'user-1', firstName: 'Me', lastName: 'Self' };
const OTHER = {
  _id: 'user-2', firstName: 'Other', lastName: 'Person', username: 'other',
};
const ROOM = { _id: 'room-1', people: [ME, OTHER], isGroup: false };

function makeStore() {
  const rootReducer = combineReducers({
    emoji, io, messages, rtc,
  });
  const store = createStore(rootReducer, applyMiddleware(thunk));
  store.dispatch({ type: Actions.SET_ROOM, room: ROOM });
  return store;
}

function renderTopBar() {
  render(
    <Provider store={makeStore()}>
      <MemoryRouter>
        <TopBar back={() => {}} loading={false} aiEnabled={false} />
      </MemoryRouter>
    </Provider>,
  );
}

beforeEach(async () => {
  await setGlobal({ user: ME, favorites: [], showDetails: false });
  hideConversation.mockReset();
  deleteConversation.mockReset();
  setupVaultPin.mockReset();
  getVaultStatus.mockReset();
  blockUser.mockReset();
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
