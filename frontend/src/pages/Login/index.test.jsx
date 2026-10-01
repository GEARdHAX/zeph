import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setGlobal } from 'reactn';
import { MemoryRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { createStore, combineReducers, applyMiddleware } from 'redux';
import thunk from 'redux-thunk';
import io from '../../reducers/io';
import Login from './index';
import getInfo from '../../actions/getInfo';

vi.mock('../../actions/getInfo', () => ({
  default: vi.fn(() => Promise.reject(new Error('not needed for this test'))),
}));

function renderLogin() {
  const store = createStore(combineReducers({ io }), applyMiddleware(thunk));
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/login']}>
        <Login />
      </MemoryRouter>
    </Provider>,
  );
}

beforeEach(async () => {
  await setGlobal({ zephLoading: false, zephLoaderLabel: null, theme: 'dark' });
  getInfo.mockClear();
});

describe('Login — forgot password link', () => {
  it('links to /forgot-password', () => {
    renderLogin();
    expect(screen.getByRole('link', { name: /forgot password/i })).toHaveAttribute('href', '/forgot-password');
  });
});

// Regression: Login/index.jsx passed showPasswordToggle/isPasswordVisible
// to Login/components/Input.jsx, which actually reads isPassword/
// showPassword — the mismatched prop names meant isPassword was always
// undefined, so the show/hide toggle button never rendered at all despite
// the feature appearing fully wired (state, handler, icon import all present).
describe('Login — show/hide password toggle', () => {
  it('renders a toggle button on the login password field and it actually reveals the password', async () => {
    const user = userEvent.setup();
    renderLogin();

    const passwordInput = screen.getByPlaceholderText('Password');
    expect(passwordInput).toHaveAttribute('type', 'password');

    const toggle = screen.getByRole('button', { name: /show password/i });
    await user.click(toggle);

    expect(passwordInput).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: /hide password/i })).toBeInTheDocument();
  });
});
