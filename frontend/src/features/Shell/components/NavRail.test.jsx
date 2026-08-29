import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setGlobal, getGlobal } from 'reactn';
import { MemoryRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { createStore, combineReducers, applyMiddleware } from 'redux';
import thunk from 'redux-thunk';
import io from '../../../reducers/io';
import messages from '../../../reducers/messages';
import NavRail from './NavRail';

function renderRail() {
  const rootReducer = combineReducers({ io, messages });
  const store = createStore(rootReducer, applyMiddleware(thunk));
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/']}>
        <NavRail />
      </MemoryRouter>
    </Provider>,
  );
}

beforeEach(async () => {
  await setGlobal({ user: { id: 'user-1' }, nav: 'rooms' });
});

describe('NavRail brand logo', () => {
  // Regression: nav is a reactn global independent of the router (Panel
  // switches its content on `nav`, not the URL — see Panel/index.jsx and
  // useNavSync.js). Opening a non-route panel like Removed Conversations or
  // the Vault sets nav directly (TopBar.jsx's setNav('removed')/('vault'))
  // without changing the URL, so while already sitting at "/", clicking a
  // plain <NavLink to="/"> produces no location change and useNavSync's
  // effect never re-fires — leaving the user stuck with no way back to Chats.
  it('resets nav back to rooms even when already at "/" (no route change to rely on)', async () => {
    await setGlobal({ nav: 'removed' });
    const user = userEvent.setup();
    renderRail();

    await user.click(screen.getByRole('link', { name: /zeph/i }));

    expect(getGlobal().nav).toBe('rooms');
  });
});
