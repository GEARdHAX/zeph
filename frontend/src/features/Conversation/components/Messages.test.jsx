import {
  describe, it, expect, beforeEach, vi,
} from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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
import getMoreMessages from '../../../actions/getMoreMessages';
import Messages from './Messages';

vi.mock('../../../actions/getMoreMessages', () => ({ default: vi.fn() }));

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

  const utils = render(
    <Provider store={store}>
      <MemoryRouter>
        <Messages />
      </MemoryRouter>
    </Provider>,
  );

  return { store, ...utils };
}

beforeEach(async () => {
  await setGlobal({ user: ME });
  getMoreMessages.mockReset();
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

describe('older-history loading preserves scroll position (does not jump to bottom)', () => {
  const setScrollMetrics = (el, { scrollTop, scrollHeight }) => {
    Object.defineProperty(el, 'scrollTop', { value: scrollTop, writable: true, configurable: true });
    Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, writable: true, configurable: true });
  };

  it('scrolling near the top requests older messages once scrollTop is within the trigger distance', async () => {
    getMoreMessages.mockResolvedValue({ data: { messages: [], hasMore: false } });
    renderMessages([makeMessage({ _id: 'm-1' })]);
    const scrollEl = screen.getByText('hello').closest('[class*="overflow-y-auto"]');

    setScrollMetrics(scrollEl, { scrollTop: 150, scrollHeight: 2000 });
    fireEvent.scroll(scrollEl);

    await waitFor(() => expect(getMoreMessages).toHaveBeenCalledWith({ roomID: 'room-1', firstMessageID: 'm-1' }));
  });

  it('shows a spinner while older messages are being fetched, and clears it once they land', async () => {
    let resolveFetch;
    getMoreMessages.mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; }));
    renderMessages([makeMessage({ _id: 'm-1' })]);
    const scrollEl = screen.getByText('hello').closest('[class*="overflow-y-auto"]');

    setScrollMetrics(scrollEl, { scrollTop: 150, scrollHeight: 2000 });
    fireEvent.scroll(scrollEl);

    expect(await screen.findByRole('status', { name: /loading older messages/i })).toBeInTheDocument();

    resolveFetch({ data: { messages: [], hasMore: false } });
    await waitFor(() => expect(screen.queryByRole('status', { name: /loading older messages/i })).not.toBeInTheDocument());
  });

  it('does not show the pagination spinner during the room-load loading state (only messages.length===0 uses that)', () => {
    renderMessages([]);
    expect(screen.queryByRole('status', { name: /loading older messages/i })).not.toBeInTheDocument();
  });

  it('does not request history when scrollTop is beyond the trigger distance', () => {
    renderMessages([makeMessage({ _id: 'm-1' })]);
    const scrollEl = screen.getByText('hello').closest('[class*="overflow-y-auto"]');

    setScrollMetrics(scrollEl, { scrollTop: 500, scrollHeight: 2000 });
    fireEvent.scroll(scrollEl);

    expect(getMoreMessages).not.toHaveBeenCalled();
  });

  it('after older messages are prepended, scrollTop is adjusted by the height delta instead of jumping to the bottom', async () => {
    // jsdom never actually grows scrollHeight as content is added, so this
    // stubs scrollHeight to report growth once the second message is in the
    // DOM — standing in for what a real browser's layout would already have
    // done by the time React's effect runs.
    getMoreMessages.mockResolvedValue({
      data: { messages: [makeMessage({ _id: 'm-0', content: 'older' })], hasMore: true },
    });
    renderMessages([makeMessage({ _id: 'm-1' })]);
    const scrollEl = screen.getByText('hello').closest('[class*="overflow-y-auto"]');

    setScrollMetrics(scrollEl, { scrollTop: 50, scrollHeight: 2000 });
    let scrollHeight = 2000;
    Object.defineProperty(scrollEl, 'scrollHeight', { get: () => scrollHeight, configurable: true });
    fireEvent.scroll(scrollEl);

    scrollHeight = 2600; // grows once the older message is about to render
    await waitFor(() => expect(screen.getByText('older')).toBeInTheDocument());

    // 50 (old scrollTop) + (2600 - 2000) delta = 650, NOT scrollHeight
    // (a bottom-jump would land there instead).
    await waitFor(() => expect(scrollEl.scrollTop).toBe(650));
  });

  it('stops requesting once hasMore is false', async () => {
    getMoreMessages.mockResolvedValue({ data: { messages: [], hasMore: false } });
    renderMessages([makeMessage({ _id: 'm-1' })]);
    const scrollEl = screen.getByText('hello').closest('[class*="overflow-y-auto"]');

    setScrollMetrics(scrollEl, { scrollTop: 50, scrollHeight: 2000 });
    fireEvent.scroll(scrollEl);
    await waitFor(() => expect(getMoreMessages).toHaveBeenCalledTimes(1));

    fireEvent.scroll(scrollEl);
    expect(getMoreMessages).toHaveBeenCalledTimes(1);
  });
});
