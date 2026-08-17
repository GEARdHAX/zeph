import {
  describe, it, expect, beforeEach, vi,
} from 'vitest';
import {
  render, screen, waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { createStore, combineReducers, applyMiddleware } from 'redux';
import thunk from 'redux-thunk';
import { setGlobal } from 'reactn';
import moment from 'moment';
import io from '../../../reducers/io';
import messages from '../../../reducers/messages';
import rtc from '../../../reducers/rtc';
import emoji from '../../../reducers/emoji';
import deleteMessage from '../../../actions/deleteMessage';
import Message from './Message';

vi.mock('../../../actions/deleteMessage');

const ME = { id: 'user-1', firstName: 'Me', lastName: 'Self' };
const OTHER_AUTHOR = { _id: 'user-2', firstName: 'Other', lastName: 'Person' };
const MY_AUTHOR = { _id: 'user-1', firstName: 'Me', lastName: 'Self' };

const timestampFor = (isoDate) => moment(isoDate).format('MMM DD - h:mm A');

const makeMessage = (overrides = {}) => ({
  _id: 'm1',
  content: 'hello world',
  type: 'text',
  date: '2026-01-01T12:00:00.000Z',
  author: OTHER_AUTHOR,
  ...overrides,
});

function renderMessage(props) {
  const rootReducer = combineReducers({
    emoji, io, messages, rtc,
  });
  const store = createStore(rootReducer, applyMiddleware(thunk));
  return render(
    <Provider store={store}>
      <Message roomID="room-1" onOpen={() => {}} {...props} />
    </Provider>,
  );
}

beforeEach(async () => {
  await setGlobal({ user: ME });
  deleteMessage.mockReset();
});

describe('Message bubble grouping', () => {
  it('renders a timestamp when the message is not attached to the next one', () => {
    const message = makeMessage();
    renderMessage({ message, previous: null, next: null });
    expect(screen.getByText(timestampFor(message.date))).toBeInTheDocument();
  });

  it('omits the timestamp when grouped with the following message from the same author within 3 minutes', () => {
    const message = makeMessage({ date: '2026-01-01T12:00:00.000Z' });
    const next = makeMessage({ date: '2026-01-01T12:01:00.000Z', author: OTHER_AUTHOR });
    renderMessage({ message, previous: null, next });
    expect(screen.queryByText(timestampFor(message.date))).not.toBeInTheDocument();
  });

  it('does not group with a following message from a different author, even within 3 minutes', () => {
    const message = makeMessage({ date: '2026-01-01T12:00:00.000Z', author: OTHER_AUTHOR });
    const next = makeMessage({ date: '2026-01-01T12:01:00.000Z', author: MY_AUTHOR });
    renderMessage({ message, previous: null, next });
    expect(screen.getByText(timestampFor(message.date))).toBeInTheDocument();
  });

  it('does not group with a following message more than 3 minutes later', () => {
    const message = makeMessage({ date: '2026-01-01T12:00:00.000Z' });
    const next = makeMessage({ date: '2026-01-01T12:05:00.000Z', author: OTHER_AUTHOR });
    renderMessage({ message, previous: null, next });
    expect(screen.getByText(timestampFor(message.date))).toBeInTheDocument();
  });

  it('falls back to "Deleted User" when the author is missing, without throwing', () => {
    const message = makeMessage({ author: null, content: 'orphaned message' });
    renderMessage({ message, previous: null, next: null });
    expect(screen.getByText('orphaned message')).toBeInTheDocument();
  });

  it('strips disallowed tags from text content while keeping their inner text (striptags default)', () => {
    renderMessage({
      message: makeMessage({ content: '<script>alert(1)</script>hello' }),
      previous: null,
      next: null,
    });
    // striptags removes the tag markup itself but is not an HTML sanitizer that
    // deletes disallowed elements' text content — the raw text survives, just unwrapped.
    expect(screen.getByText('alert(1)hello')).toBeInTheDocument();
    expect(document.querySelector('script')).not.toBeInTheDocument();
  });

  it('auto-links bare URLs in text content', () => {
    renderMessage({
      message: makeMessage({ content: 'see https://example.com for more' }),
      previous: null,
      next: null,
    });
    const link = screen.getByRole('link', { name: 'https://example.com' });
    expect(link).toHaveAttribute('href', 'https://example.com');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('renders only the emoji (no chat-bubble background) when the message is only emoji', () => {
    const { container } = renderMessage({
      message: makeMessage({ content: '🎉' }),
      previous: null,
      next: null,
    });
    // Emoji-only messages skip the bubble background container entirely.
    expect(container.querySelector('.bg-muted')).not.toBeInTheDocument();
    expect(screen.getByText('🎉')).toBeInTheDocument();
  });
});

describe('Message deletion UI', () => {
  it('shows the "This message was deleted" placeholder instead of content when deletedForEveryone', () => {
    const message = makeMessage({ deletedForEveryone: true, content: null });
    renderMessage({ message, previous: null, next: null });
    expect(screen.getByText('This message was deleted')).toBeInTheDocument();
    expect(screen.queryByText('hello world')).not.toBeInTheDocument();
  });

  it('does not show the options menu trigger for an already-deleted message', () => {
    const message = makeMessage({ deletedForEveryone: true, content: null });
    renderMessage({ message, previous: null, next: null });
    expect(screen.queryByRole('button', { name: 'Message options' })).not.toBeInTheDocument();
  });

  it('offers "Delete for everyone" only when the message is mine', async () => {
    const user = userEvent.setup();
    const mine = makeMessage({ author: MY_AUTHOR });
    renderMessage({ message: mine, previous: null, next: null });
    await user.click(screen.getByRole('button', { name: 'Message options' }));
    expect(await screen.findByText('Delete for me')).toBeInTheDocument();
    expect(screen.getByText('Delete for everyone')).toBeInTheDocument();
  });

  it('does not offer "Delete for everyone" for someone else\'s message', async () => {
    const user = userEvent.setup();
    const theirs = makeMessage({ author: OTHER_AUTHOR });
    renderMessage({ message: theirs, previous: null, next: null });
    await user.click(screen.getByRole('button', { name: 'Message options' }));
    expect(await screen.findByText('Delete for me')).toBeInTheDocument();
    expect(screen.queryByText('Delete for everyone')).not.toBeInTheDocument();
  });

  it('calls deleteMessage with forEveryone:false immediately for "Delete for me" (no confirmation)', async () => {
    const user = userEvent.setup();
    deleteMessage.mockResolvedValue({ data: { status: 'success' } });
    const theirs = makeMessage({ author: OTHER_AUTHOR });
    renderMessage({ message: theirs, previous: null, next: null });
    await user.click(screen.getByRole('button', { name: 'Message options' }));
    await user.click(await screen.findByText('Delete for me'));
    await waitFor(() => expect(deleteMessage).toHaveBeenCalledWith({
      roomID: 'room-1', messageID: 'm1', forEveryone: false,
    }));
  });

  it('requires confirmation before calling deleteMessage with forEveryone:true', async () => {
    const user = userEvent.setup();
    deleteMessage.mockResolvedValue({ data: { status: 'success', deletedAt: '2026-01-01T12:00:01.000Z' } });
    const mine = makeMessage({ author: MY_AUTHOR });
    renderMessage({ message: mine, previous: null, next: null });
    await user.click(screen.getByRole('button', { name: 'Message options' }));
    await user.click(await screen.findByText('Delete for everyone'));

    // Clicking the menu item only opens the confirmation dialog — no call yet.
    expect(deleteMessage).not.toHaveBeenCalled();
    expect(await screen.findByText('Delete for everyone?')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete for everyone' }));
    await waitFor(() => expect(deleteMessage).toHaveBeenCalledWith({
      roomID: 'room-1', messageID: 'm1', forEveryone: true,
    }));
  });

  it('shows an error toast and does not throw when the deletion window has expired', async () => {
    const user = userEvent.setup();
    deleteMessage.mockRejectedValue({ response: { data: { reason: 'deletion_window_expired' } } });
    const mine = makeMessage({ author: MY_AUTHOR });
    renderMessage({ message: mine, previous: null, next: null });
    await user.click(screen.getByRole('button', { name: 'Message options' }));
    await user.click(await screen.findByText('Delete for everyone'));
    await screen.findByText('Delete for everyone?');
    await user.click(screen.getByRole('button', { name: 'Delete for everyone' }));
    await waitFor(() => expect(deleteMessage).toHaveBeenCalled());
  });
});
