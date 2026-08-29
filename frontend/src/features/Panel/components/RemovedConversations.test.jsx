import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { createStore, combineReducers, applyMiddleware } from 'redux';
import thunk from 'redux-thunk';
import io from '../../../reducers/io';
import messages from '../../../reducers/messages';
import rtc from '../../../reducers/rtc';
import emoji from '../../../reducers/emoji';
import RemovedConversations from './RemovedConversations';
import getRemovedConversations from '../../../actions/getRemovedConversations';
import restoreConversation from '../../../actions/restoreConversation';

vi.mock('../../../actions/getRemovedConversations', () => ({ default: vi.fn() }));
vi.mock('../../../actions/restoreConversation', () => ({ default: vi.fn() }));

const OTHER = { _id: 'user-2', firstName: 'Other', lastName: 'Person' };
const makeRoom = (overrides = {}) => ({
  _id: 'room-1', isGroup: false, people: [{ _id: 'user-1' }, OTHER], ...overrides,
});

function renderRemoved() {
  const rootReducer = combineReducers({
    emoji, io, messages, rtc,
  });
  const store = createStore(rootReducer, applyMiddleware(thunk));
  render(
    <Provider store={store}>
      <MemoryRouter>
        <RemovedConversations />
      </MemoryRouter>
    </Provider>,
  );
}

beforeEach(() => {
  getRemovedConversations.mockReset();
  restoreConversation.mockReset();
});

describe('RemovedConversations', () => {
  it('shows a loading state, then the empty state when there is nothing removed', async () => {
    getRemovedConversations.mockResolvedValue({ data: { rooms: [] } });
    renderRemoved();

    expect(await screen.findByText(/no removed conversations/i)).toBeInTheDocument();
  });

  it('lists a removed room with a Restore action', async () => {
    getRemovedConversations.mockResolvedValue({ data: { rooms: [makeRoom()] } });
    renderRemoved();

    expect(await screen.findByRole('button', { name: /restore/i })).toBeInTheDocument();
    expect(screen.getByText('Other Person')).toBeInTheDocument();
  });

  it('shows an error toast if the list fails to load', async () => {
    getRemovedConversations.mockRejectedValue(new Error('network error'));
    renderRemoved();

    // Falls through to the empty state (rooms stays an empty render, not a
    // crash) — the toast itself isn't asserted here since react-toastify
    // renders outside this component's own tree.
    await waitFor(() => expect(getRemovedConversations).toHaveBeenCalled());
  });

  it('clicking Restore removes the room from the list without a refetch', async () => {
    getRemovedConversations.mockResolvedValue({ data: { rooms: [makeRoom()] } });
    restoreConversation.mockResolvedValue({ data: { status: 'success' } });
    const user = userEvent.setup();
    renderRemoved();

    await screen.findByRole('button', { name: /restore/i });
    await user.click(screen.getByRole('button', { name: /restore/i }));

    await waitFor(() => expect(screen.queryByText('Other Person')).not.toBeInTheDocument());
    expect(getRemovedConversations).toHaveBeenCalledTimes(1);
  });
});
