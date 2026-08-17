import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setGlobal } from 'reactn';
import { MemoryRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { createStore, combineReducers, applyMiddleware } from 'redux';
import thunk from 'redux-thunk';
import io from '../../../reducers/io';
import messages from '../../../reducers/messages';
import rtc from '../../../reducers/rtc';
import emoji from '../../../reducers/emoji';
import VaultUnlock from './VaultUnlock';

vi.mock('../../../actions/getVaultStatus', () => ({ default: vi.fn() }));
vi.mock('../../../actions/getVaultList', () => ({ default: vi.fn() }));
vi.mock('../../../actions/unlockVaultPin', () => ({ default: vi.fn() }));
vi.mock('../../../actions/setupVaultPin', () => ({ default: vi.fn() }));
vi.mock('../../../actions/vaultWebauthn', () => ({
  registerVaultPasskey: vi.fn(),
  unlockVaultWithPasskey: vi.fn(),
}));

// eslint-disable-next-line import/first
import getVaultStatus from '../../../actions/getVaultStatus';
// eslint-disable-next-line import/first
import getVaultList from '../../../actions/getVaultList';
// eslint-disable-next-line import/first
import unlockVaultPin from '../../../actions/unlockVaultPin';
// eslint-disable-next-line import/first
import setupVaultPin from '../../../actions/setupVaultPin';
// eslint-disable-next-line import/first
import { unlockVaultWithPasskey } from '../../../actions/vaultWebauthn';

function renderVaultUnlock() {
  const rootReducer = combineReducers({
    emoji, io, messages, rtc,
  });
  const store = createStore(rootReducer, applyMiddleware(thunk));
  render(
    <Provider store={store}>
      <MemoryRouter>
        <VaultUnlock />
      </MemoryRouter>
    </Provider>,
  );
}

beforeEach(async () => {
  await setGlobal({
    vaultToken: null, vaultRooms: [], user: { id: 'user-1' }, over: null,
  });
  getVaultStatus.mockReset();
  getVaultList.mockReset();
  unlockVaultPin.mockReset();
  setupVaultPin.mockReset();
  unlockVaultWithPasskey.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('VaultUnlock — first-time setup', () => {
  it('shows the PIN setup form when no vault secret is configured yet', async () => {
    getVaultStatus.mockResolvedValue({ data: { configured: false } });
    renderVaultUnlock();

    expect(await screen.findByText('Set up your Private Vault')).toBeInTheDocument();
  });

  it('rejects a PIN shorter than 4 digits without calling the API', async () => {
    const user = userEvent.setup();
    getVaultStatus.mockResolvedValue({ data: { configured: false } });
    renderVaultUnlock();

    await screen.findByText('Set up your Private Vault');
    await user.type(screen.getByLabelText('Vault PIN'), '12');
    await user.click(screen.getByRole('button', { name: 'Set PIN' }));

    expect(setupVaultPin).not.toHaveBeenCalled();
  });

  it('sets up and unlocks in one flow, then shows the (empty) vault list', async () => {
    const user = userEvent.setup();
    getVaultStatus.mockResolvedValue({ data: { configured: false } });
    setupVaultPin.mockResolvedValue({ data: { status: 'success' } });
    unlockVaultPin.mockResolvedValue({ data: { vaultToken: 'vt-123' } });
    getVaultList.mockResolvedValue({ data: { rooms: [] } });
    renderVaultUnlock();

    await screen.findByText('Set up your Private Vault');
    await user.type(screen.getByLabelText('Vault PIN'), '1234');
    await user.click(screen.getByRole('button', { name: 'Set PIN' }));

    await waitFor(() => expect(setupVaultPin).toHaveBeenCalledWith('1234'));
    await waitFor(() => expect(unlockVaultPin).toHaveBeenCalledWith('1234'));
    expect(await screen.findByText('No hidden conversations.')).toBeInTheDocument();
  });
});

describe('VaultUnlock — unlock (vault already configured)', () => {
  it('shows a PIN field when hasPin is true and a passkey button when hasPasskey is true', async () => {
    getVaultStatus.mockResolvedValue({ data: { configured: true, hasPin: true, hasPasskey: true } });
    renderVaultUnlock();

    expect(await screen.findByRole('button', { name: /Unlock with Passkey/ })).toBeInTheDocument();
    expect(screen.getByLabelText('PIN')).toBeInTheDocument();
  });

  it('unlocking with the wrong PIN shows an error and does not set a vault token', async () => {
    const user = userEvent.setup();
    getVaultStatus.mockResolvedValue({ data: { configured: true, hasPin: true, hasPasskey: false } });
    unlockVaultPin.mockRejectedValue(new Error('wrong pin'));
    renderVaultUnlock();

    await user.type(await screen.findByLabelText('PIN'), '0000');
    await user.click(screen.getByRole('button', { name: 'Unlock with PIN' }));

    await waitFor(() => expect(unlockVaultPin).toHaveBeenCalledWith('0000'));
    expect(screen.queryByText('No hidden conversations.')).not.toBeInTheDocument();
  });

  it('unlocking with the correct PIN loads and displays the hidden conversation list', async () => {
    const user = userEvent.setup();
    getVaultStatus.mockResolvedValue({ data: { configured: true, hasPin: true, hasPasskey: false } });
    unlockVaultPin.mockResolvedValue({ data: { vaultToken: 'vt-abc' } });
    getVaultList.mockResolvedValue({
      data: {
        rooms: [{
          _id: 'room-9', isGroup: false, people: [{ _id: 'user-1' }, { _id: 'user-2', firstName: 'Hidden', lastName: 'Friend' }],
        }],
      },
    });
    renderVaultUnlock();

    await user.type(await screen.findByLabelText('PIN'), '1234');
    await user.click(screen.getByRole('button', { name: 'Unlock with PIN' }));

    await waitFor(() => expect(getVaultList).toHaveBeenCalledWith('vt-abc'));
    expect(await screen.findByText('Private Vault unlocked')).toBeInTheDocument();
    expect(screen.getByText('Hidden Friend')).toBeInTheDocument();
  });

  it('unlocking with a passkey calls unlockVaultWithPasskey and loads the list', async () => {
    const user = userEvent.setup();
    getVaultStatus.mockResolvedValue({ data: { configured: true, hasPin: false, hasPasskey: true } });
    unlockVaultWithPasskey.mockResolvedValue({ data: { vaultToken: 'vt-passkey' } });
    getVaultList.mockResolvedValue({ data: { rooms: [] } });
    renderVaultUnlock();

    await user.click(await screen.findByRole('button', { name: /Unlock with Passkey/ }));

    await waitFor(() => expect(getVaultList).toHaveBeenCalledWith('vt-passkey'));
  });
});
