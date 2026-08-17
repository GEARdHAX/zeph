import {
  describe, it, expect, beforeEach,
} from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
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

function renderMessages(msgs) {
  const rootReducer = combineReducers({
    emoji, io, messages, rtc,
  });
  const store = createStore(rootReducer, applyMiddleware(thunk));
  store.dispatch({ type: Actions.SET_ROOM, room: { _id: 'room-1', people: [{ _id: 'user-1' }, { _id: 'user-2' }] } });
  store.dispatch({ type: Actions.SET_MESSAGES, messages: msgs });

  render(
    <Provider store={store}>
      <Messages />
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
