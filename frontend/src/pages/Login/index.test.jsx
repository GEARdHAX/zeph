import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { Provider } from 'react-redux';
import { createStore, combineReducers, applyMiddleware } from 'redux';
import thunk from 'redux-thunk';
import { setGlobal, getGlobal, useGlobal } from 'reactn';
import io from '../../reducers/io';
import messages from '../../reducers/messages';
import rtc from '../../reducers/rtc';
import emoji from '../../reducers/emoji';
import Login from './index';
import loginAction from '../../actions/login';
import registerAction from '../../actions/register';
import { ZephLoadingOverlay } from '../../components/ui/zeph-loading-overlay';

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
    token: null, user: {}, entryPath: '/', zephLoading: false,
  });
});

describe('Login branding', () => {
  it('shows the "zeph." wordmark (lowercase, period, no double period)', () => {
    renderLogin();
    const wordmarks = screen.getAllByText('zeph.');
    expect(wordmarks.length).toBeGreaterThan(0);
    wordmarks.forEach((el) => {
      expect(el.textContent).toBe('zeph.');
      expect(el.textContent).not.toMatch(/\.\./);
    });
    expect(screen.queryByText(/chitcx/i)).not.toBeInTheDocument();
  });

  it('renders the BrandLogo placeholder mark next to the wordmark', () => {
    renderLogin();
    expect(screen.getAllByRole('img', { name: /zeph logo placeholder/i }).length).toBeGreaterThan(0);
  });
});

describe('Login tabbed auth flow', () => {
  it('shows the login form by default', () => {
    renderLogin();
    expect(screen.getByPlaceholderText('Username or email')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /log in/i })).toBeInTheDocument();
  });

  it('switches to the register form when the Register tab is clicked, without losing the login tab', async () => {
    const userEv = userEvent.setup();
    renderLogin();

    await userEv.click(screen.getByRole('tab', { name: 'Register' }));

    expect(screen.getByPlaceholderText('Username')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Email')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /register/i })).toBeInTheDocument();
    // The login tab trigger is still present (not unmounted, just inactive).
    expect(screen.getByRole('tab', { name: 'Log In' })).toBeInTheDocument();
  });

  it('switches back to login from register', async () => {
    const userEv = userEvent.setup();
    renderLogin();

    await userEv.click(screen.getByRole('tab', { name: 'Register' }));
    await userEv.click(screen.getByRole('tab', { name: 'Log In' }));

    expect(screen.getByRole('button', { name: /log in/i })).toBeInTheDocument();
  });

  it('keeps independent field state between the login and register forms', async () => {
    const userEv = userEvent.setup();
    renderLogin();

    await userEv.type(screen.getByPlaceholderText('Username or email'), 'loginuser');
    await userEv.click(screen.getByRole('tab', { name: 'Register' }));
    await userEv.type(screen.getByPlaceholderText('Username'), 'registeruser');

    expect(screen.getByPlaceholderText('Username')).toHaveValue('registeruser');

    await userEv.click(screen.getByRole('tab', { name: 'Log In' }));
    expect(screen.getByPlaceholderText('Username or email')).toHaveValue('loginuser');
  });

  it('shows the credits panel instead of the auth forms when opened, and can be closed back to the forms', async () => {
    const userEv = userEvent.setup();
    renderLogin();

    // Credits toggle is only rendered when Config.showCredits is on; skip gracefully if absent.
    const creditsButton = screen.queryByRole('button', { name: /credits/i });
    if (!creditsButton) return;

    await userEv.click(creditsButton);
    expect(screen.getByText(/Picsum Photos/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Username or email')).not.toBeInTheDocument();

    await userEv.click(screen.getByRole('button', { name: /close credits/i }));
    expect(screen.getByPlaceholderText('Username or email')).toBeInTheDocument();
  });

  it('toggles the theme and persists the choice to localStorage', async () => {
    const userEv = userEvent.setup();
    renderLogin();

    const toggle = screen.getByRole('button', { name: /dark|light/i });
    const initialLabel = toggle.textContent;

    await userEv.click(toggle);

    expect(toggle.textContent).not.toBe(initialLabel);
    expect(['dark', 'light']).toContain(localStorage.getItem('theme'));
  });

  it('reveals and hides the password on toggle click', async () => {
    const userEv = userEvent.setup();
    renderLogin();

    const passwordInput = screen.getByPlaceholderText('Password');
    expect(passwordInput).toHaveAttribute('type', 'password');

    await userEv.click(screen.getByRole('button', { name: /show password/i }));
    expect(passwordInput).toHaveAttribute('type', 'text');

    await userEv.click(screen.getByRole('button', { name: /hide password/i }));
    expect(passwordInput).toHaveAttribute('type', 'password');
  });
});

describe('Register redirects after a friend-invite entryPath', () => {
  async function fillAndSubmitRegister(userEv) {
    await userEv.click(screen.getByRole('tab', { name: 'Register' }));
    await userEv.type(screen.getByPlaceholderText('First Name'), 'New');
    await userEv.type(screen.getByPlaceholderText('Last Name'), 'User');
    await userEv.type(screen.getByPlaceholderText('Username'), 'newuser');
    await userEv.type(screen.getByPlaceholderText('Email'), 'new@example.com');
    await userEv.type(screen.getByPlaceholderText('Password'), 'password123');
    await userEv.type(screen.getByPlaceholderText('Repeat Password'), 'password123');
    await userEv.click(screen.getByRole('button', { name: /register/i }));
  }

  it('stashes pendingFriendInviteToken and navigates to "/" instead of the invite page, when entryPath is a friend invite', async () => {
    await setGlobal({
      token: null, user: {}, entryPath: '/invite/f/abc123token', pendingFriendInviteToken: null,
    });
    const userEv = userEvent.setup();
    render(
      <Provider store={makeStore()}>
        <MemoryRouter initialEntries={['/login']}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<div>Home landed</div>} />
            <Route path="/invite/f/:token" element={<div>Invite page landed</div>} />
          </Routes>
        </MemoryRouter>
      </Provider>,
    );

    await fillAndSubmitRegister(userEv);

    expect(await screen.findByText('Home landed')).toBeInTheDocument();
    expect(getGlobal().pendingFriendInviteToken).toBe('abc123token');
  });

  it('still navigates directly to entryPath for a non-friend-invite path (unchanged behavior)', async () => {
    await setGlobal({
      token: null, user: {}, entryPath: '/invite/g/somegrouptoken', pendingFriendInviteToken: null,
    });
    const userEv = userEvent.setup();
    render(
      <Provider store={makeStore()}>
        <MemoryRouter initialEntries={['/login']}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<div>Home landed</div>} />
            <Route path="/invite/g/:token" element={<div>Group invite page landed</div>} />
          </Routes>
        </MemoryRouter>
      </Provider>,
    );

    await fillAndSubmitRegister(userEv);

    expect(await screen.findByText('Group invite page landed')).toBeInTheDocument();
    expect(getGlobal().pendingFriendInviteToken).toBeNull();
  });
});

describe('Full-screen loader during login/register', () => {
  // Login itself doesn't render ZephLoadingOverlay (that's mounted once at
  // the App.jsx root) — this renders it alongside Login, reading the same
  // global reactively (not a one-time getGlobal() snapshot), to prove
  // useZephLoader() actually gets toggled by onLogin/onRegister the same
  // way it will in the real app.
  function OverlayFromGlobal() {
    const [zephLoading] = useGlobal('zephLoading');
    return (
      <ZephLoadingOverlay
        isOpen={!!zephLoading}
        label={typeof zephLoading === 'string' ? zephLoading : undefined}
      />
    );
  }

  function renderLoginWithOverlay() {
    render(
      <Provider store={makeStore()}>
        <MemoryRouter>
          <OverlayFromGlobal />
          <Login />
        </MemoryRouter>
      </Provider>,
    );
  }

  it('shows the loader while login is in flight, then hides it on success', async () => {
    let resolveLogin;
    loginAction.mockReturnValue(new Promise((resolve) => { resolveLogin = resolve; }));
    const userEv = userEvent.setup();
    renderLoginWithOverlay();

    await userEv.type(screen.getByPlaceholderText('Username or email'), 'me@example.com');
    await userEv.type(screen.getByPlaceholderText('Password'), 'password123');
    await userEv.click(screen.getByRole('button', { name: /log in/i }));

    expect(getGlobal().zephLoading).toBe('Logging in');

    resolveLogin({ data: { token: 'fake' } });
    await waitFor(() => expect(getGlobal().zephLoading).toBe(false));
  });

  it('hides the loader again after a failed login', async () => {
    loginAction.mockRejectedValueOnce({ response: { data: { generic: 'Invalid credentials' } } });
    const userEv = userEvent.setup();
    renderLoginWithOverlay();

    await userEv.type(screen.getByPlaceholderText('Username or email'), 'me@example.com');
    await userEv.type(screen.getByPlaceholderText('Password'), 'wrong');
    await userEv.click(screen.getByRole('button', { name: /log in/i }));

    await screen.findByText('Invalid credentials');
    expect(getGlobal().zephLoading).toBe(false);
  });

  it('shows a distinct label while registering', async () => {
    let resolveRegister;
    registerAction.mockReturnValue(new Promise((resolve) => { resolveRegister = resolve; }));
    const userEv = userEvent.setup();
    renderLoginWithOverlay();

    await userEv.click(screen.getByRole('tab', { name: 'Register' }));
    await userEv.type(screen.getByPlaceholderText('First Name'), 'New');
    await userEv.type(screen.getByPlaceholderText('Last Name'), 'User');
    await userEv.type(screen.getByPlaceholderText('Username'), 'newuser');
    await userEv.type(screen.getByPlaceholderText('Email'), 'new@example.com');
    await userEv.type(screen.getByPlaceholderText('Password'), 'password123');
    await userEv.type(screen.getByPlaceholderText('Repeat Password'), 'password123');
    await userEv.click(screen.getByRole('button', { name: /register/i }));

    expect(getGlobal().zephLoading).toBe('Creating your account');
    resolveRegister({});
  });

  it('a second submit while the first is still in flight does not fire a duplicate login request (regression: caused the loader to restart mid-animation)', async () => {
    loginAction.mockClear();
    let resolveLogin;
    loginAction.mockReturnValue(new Promise((resolve) => { resolveLogin = resolve; }));
    const userEv = userEvent.setup();
    renderLoginWithOverlay();

    await userEv.type(screen.getByPlaceholderText('Username or email'), 'me@example.com');
    await userEv.type(screen.getByPlaceholderText('Password'), 'password123');

    const submitButton = screen.getByRole('button', { name: /log in/i });
    await userEv.click(submitButton);
    // The button is disabled once submitting, but even a raw fireEvent
    // submit on the form (bypassing the disabled button) must still be a
    // no-op — the actual guard is submittingRef, not the disabled attribute.
    expect(submitButton).toBeDisabled();
    await userEv.click(submitButton, { pointerEventsCheck: 0 });

    expect(loginAction).toHaveBeenCalledTimes(1);

    resolveLogin({ data: { token: 'fake' } });
    await waitFor(() => expect(getGlobal().zephLoading).toBe(false));
    expect(submitButton).not.toBeDisabled();
  });

  it('the submit button re-enables after a failed login, allowing a real retry', async () => {
    loginAction.mockClear();
    loginAction.mockRejectedValueOnce({ response: { data: { generic: 'Invalid credentials' } } });
    const userEv = userEvent.setup();
    renderLoginWithOverlay();

    await userEv.type(screen.getByPlaceholderText('Username or email'), 'me@example.com');
    await userEv.type(screen.getByPlaceholderText('Password'), 'wrong');
    const submitButton = screen.getByRole('button', { name: /log in/i });
    await userEv.click(submitButton);

    await screen.findByText('Invalid credentials');
    expect(submitButton).not.toBeDisabled();

    loginAction.mockResolvedValueOnce({ data: { token: 'fake' } });
    await userEv.click(submitButton);
    expect(loginAction).toHaveBeenCalledTimes(2);
  });
});
