import {
  describe, it, expect, beforeEach,
} from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { createStore, combineReducers, applyMiddleware } from 'redux';
import thunk from 'redux-thunk';
import { setGlobal } from 'reactn';
import moment from 'moment';
import io from '../../../reducers/io';
import messages from '../../../reducers/messages';
import rtc from '../../../reducers/rtc';
import emoji from '../../../reducers/emoji';
import Actions from '../../../constants/Actions';
import Messages from './Messages';

const ME = { id: 'user-1', firstName: 'Me', lastName: 'Self' };
const AUTHOR = { _id: 'user-2', firstName: 'Other', lastName: 'Person' };

const makeMessage = (overrides = {}) => ({
  _id: overrides._id || `m-${Math.random().toString(36).slice(2)}`,
  content: 'hello',
  type: 'text',
  author: AUTHOR,
  ...overrides,
});

function renderMessages(msgs, roomOverrides = {}) {
  const rootReducer = combineReducers({
    emoji, io, messages, rtc,
  });
  const store = createStore(rootReducer, applyMiddleware(thunk));
  store.dispatch({
    type: Actions.SET_ROOM,
    room: {
      _id: 'room-1', people: [{ _id: 'user-1' }, { _id: 'user-2' }], ...roomOverrides,
    },
  });
  store.dispatch({ type: Actions.SET_MESSAGES, messages: msgs });

  render(
    <Provider store={store}>
      <MemoryRouter>
        <Messages />
      </MemoryRouter>
    </Provider>,
  );
}

beforeEach(async () => {
  await setGlobal({ user: ME });
});

describe('Messages day separators', () => {
  it('shows a single "Today" separator before messages sent today', () => {
    renderMessages([
      makeMessage({ date: moment().hour(9).toISOString() }),
      makeMessage({ date: moment().hour(10).toISOString() }),
    ]);

    expect(screen.getAllByText('Today')).toHaveLength(1);
  });

  it('splits messages from different calendar days with separate separators, even a minute apart', () => {
    const midnight = moment().startOf('day');
    renderMessages([
      makeMessage({ date: midnight.clone().subtract(1, 'minute').toISOString() }), // 11:59pm yesterday
      makeMessage({ date: midnight.clone().add(1, 'minute').toISOString() }), // 12:01am today
    ]);

    expect(screen.getByText('Yesterday')).toBeInTheDocument();
    expect(screen.getByText('Today')).toBeInTheDocument();
  });

  it('shows the full date for messages older than yesterday', () => {
    const oldDate = moment().subtract(10, 'days');
    renderMessages([makeMessage({ date: oldDate.toISOString() })]);

    expect(screen.getByText(oldDate.format('MMMM D, YYYY'))).toBeInTheDocument();
    expect(screen.queryByText('Today')).not.toBeInTheDocument();
    expect(screen.queryByText('Yesterday')).not.toBeInTheDocument();
  });

  it('does not repeat the separator for consecutive messages on the same day', () => {
    renderMessages([
      makeMessage({ date: moment().hour(9).toISOString() }),
      makeMessage({ date: moment().hour(9).minute(5).toISOString() }),
      makeMessage({ date: moment().hour(20).toISOString() }),
    ]);

    expect(screen.getAllByText('Today')).toHaveLength(1);
  });
});

describe('type:system messages (moderation events)', () => {
  it('renders the system message content as a centered pill, not a chat bubble', () => {
    renderMessages([
      makeMessage({
        type: 'system', content: 'Tom Target was removed by Alice Owner', author: null,
      }),
    ]);

    expect(screen.getByText('Tom Target was removed by Alice Owner')).toBeInTheDocument();
  });

  it('does not show an author name header or avatar for a system message', () => {
    renderMessages([
      makeMessage({
        type: 'system', content: 'Jane Bad was banned by Bob Owner', author: null,
      }),
    ]);

    expect(screen.queryByText('Deleted')).not.toBeInTheDocument();
    expect(screen.queryByTitle(/View/)).not.toBeInTheDocument();
  });

  it('renders normally alongside a real message in the same list', () => {
    renderMessages([
      makeMessage({ content: 'hey', date: moment().hour(9).toISOString() }),
      makeMessage({
        type: 'system', content: 'Tom Target was removed by Alice Owner', author: null, date: moment().hour(9).minute(5).toISOString(),
      }),
    ]);

    expect(screen.getByText('hey')).toBeInTheDocument();
    expect(screen.getByText('Tom Target was removed by Alice Owner')).toBeInTheDocument();
  });
});

describe('Empty-state message reflects how the member joined (myJoinInfo)', () => {
  it('shows "You joined via invite link" with the inviter name for INVITE_LINK', () => {
    renderMessages([], { myJoinInfo: { method: 'INVITE_LINK', inviterName: 'Alice Owner' } });

    expect(screen.getByText('You joined via invite link')).toBeInTheDocument();
    expect(screen.getByText(/Invited by Alice Owner/)).toBeInTheDocument();
    expect(screen.queryByText('No messages here yet')).not.toBeInTheDocument();
  });

  it('shows "You were added to this group" for ADDED', () => {
    renderMessages([], { myJoinInfo: { method: 'ADDED', inviterName: 'Bob Admin' } });

    expect(screen.getByText('You were added to this group')).toBeInTheDocument();
  });

  it('shows "Your request to join was approved" for JOIN_REQUEST', () => {
    renderMessages([], { myJoinInfo: { method: 'JOIN_REQUEST', inviterName: 'Carol Owner' } });

    expect(screen.getByText('Your request to join was approved')).toBeInTheDocument();
  });

  it('omits the "Invited by" clause when inviterName is null (the group creator)', () => {
    renderMessages([], { myJoinInfo: { method: 'CREATED', inviterName: null } });

    expect(screen.queryByText(/Invited by/)).not.toBeInTheDocument();
    expect(screen.getByText('Send a message to start the conversation!')).toBeInTheDocument();
  });

  it('falls back to the generic empty state when myJoinInfo is absent (e.g. a DM)', () => {
    renderMessages([]);

    expect(screen.getByText('No messages here yet')).toBeInTheDocument();
  });
});
