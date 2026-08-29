import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { setGlobal } from 'reactn';
import { MemoryRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { createStore, combineReducers, applyMiddleware } from 'redux';
import thunk from 'redux-thunk';
import io from '../../reducers/io';
import Login from './index';
import getInfo from '../../actions/getInfo';

vi.mock('../../actions/getInfo', () => ({ default: vi.fn(() => Promise.reject(new Error('not needed for this test'))) }));

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
