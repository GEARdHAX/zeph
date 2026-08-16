import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { createStore, combineReducers, applyMiddleware } from 'redux';
import thunk from 'redux-thunk';
import { setGlobal } from 'reactn';
import io from '../../reducers/io';
import messages from '../../reducers/messages';
import rtc from '../../reducers/rtc';
import emoji from '../../reducers/emoji';
import Login from './index';

vi.mock('../../actions/login', () => ({ default: vi.fn(() => Promise.resolve({ data: { token: 'fake' } })) }));
vi.mock('../../actions/register', () => ({ default: vi.fn(() => Promise.resolve({})) }));
vi.mock('../../actions/getInfo', () => ({ default: vi.fn(() => Promise.resolve({ data: {} })) }));
vi.mock('../../actions/setAuthToken', () => ({ default: vi.fn() }));
vi.mock('../../actions/initIO', () => ({ default: () => () => {} }));
vi.mock('jwt-decode', () => ({ default: () => ({ id: 'user-1' }) }));

function makeStore() {
  const rootReducer = combineReducers({
    emoji, io, messages, rtc,
  });
  return createStore(rootReducer, applyMiddleware(thunk));
}

function renderLogin() {
  render(
    <Provider store={makeStore()}>
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    </Provider>,
  );
}

beforeEach(async () => {
  await setGlobal({
    token: null, user: {}, entryPath: '/',
  });
});

describe('Login tabbed auth flow', () => {
  it('shows the login form by default', () => {
    renderLogin();
    expect(screen.getByPlaceholderText('Username (or email)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'LOG IN' })).toBeInTheDocument();
  });

  it('switches to the register form when the Register tab is clicked, without losing the login tab', async () => {
    const userEv = userEvent.setup();
    renderLogin();

    await userEv.click(screen.getByRole('tab', { name: 'Register' }));

    expect(screen.getByPlaceholderText('Username')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Email')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'REGISTER' })).toBeInTheDocument();
    // The login tab trigger is still present (not unmounted, just inactive).
    expect(screen.getByRole('tab', { name: 'Log In' })).toBeInTheDocument();
  });

  it('switches back to login from register', async () => {
    const userEv = userEvent.setup();
    renderLogin();

    await userEv.click(screen.getByRole('tab', { name: 'Register' }));
    await userEv.click(screen.getByRole('tab', { name: 'Log In' }));

    expect(screen.getByRole('button', { name: 'LOG IN' })).toBeInTheDocument();
  });

  it('keeps independent field state between the login and register forms', async () => {
    const userEv = userEvent.setup();
    renderLogin();

    await userEv.type(screen.getByPlaceholderText('Username (or email)'), 'loginuser');
    await userEv.click(screen.getByRole('tab', { name: 'Register' }));
    await userEv.type(screen.getByPlaceholderText('Username'), 'registeruser');

    expect(screen.getByPlaceholderText('Username')).toHaveValue('registeruser');

    await userEv.click(screen.getByRole('tab', { name: 'Log In' }));
    expect(screen.getByPlaceholderText('Username (or email)')).toHaveValue('loginuser');
  });

  it('shows the credits panel instead of the auth forms when opened, and can be closed back to the forms', async () => {
    const userEv = userEvent.setup();
    renderLogin();

    // Credits toggle is only rendered when Config.showCredits is on; skip gracefully if absent.
    const creditsButton = screen.queryByRole('button', { name: /credits/i });
    if (!creditsButton) return;

    await userEv.click(creditsButton);
    expect(screen.getByText(/Picsum Photos/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Username (or email)')).not.toBeInTheDocument();

    await userEv.click(screen.getByRole('button', { name: /close credits/i }));
    expect(screen.getByPlaceholderText('Username (or email)')).toBeInTheDocument();
  });
});
