import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { createStore, combineReducers, applyMiddleware } from 'redux';
import thunk from 'redux-thunk';
import { MemoryRouter } from 'react-router-dom';
import { setGlobal } from 'reactn';
import { toast } from 'react-toastify';
import io from '../../../reducers/io';
import messages from '../../../reducers/messages';
import rtc from '../../../reducers/rtc';
import emoji from '../../../reducers/emoji';
import Message from './Message';

vi.mock('react-toastify', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, toast: { ...actual.toast, success: vi.fn(), error: vi.fn() } };
});

const ME = { id: 'user-1', firstName: 'Me', lastName: 'Self' };
const AUTHOR = { _id: 'user-1', firstName: 'Me', lastName: 'Self' };

const TEXT_MESSAGE = {
  _id: 'm1', type: 'text', content: 'hello **world**', author: AUTHOR, date: new Date().toISOString(),
};
const IMAGE_MESSAGE = {
  _id: 'm2', type: 'image', content: 'shielded-1', author: AUTHOR, date: new Date().toISOString(),
};

function renderMessage(message) {
  const rootReducer = combineReducers({
    emoji, io, messages, rtc,
  });
  const store = createStore(rootReducer, applyMiddleware(thunk));
  render(
    <Provider store={store}>
      <MemoryRouter>
        <Message message={message} onOpen={vi.fn()} roomID="room-1" />
      </MemoryRouter>
    </Provider>,
  );
}

beforeEach(async () => {
  await setGlobal({ user: ME });
  toast.success.mockReset();
  toast.error.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Message — text rendering uses the shared bio/message formatting parser', () => {
  it('renders **bold** syntax as a real <strong> element, not literal asterisks', () => {
    renderMessage(TEXT_MESSAGE);
    const strong = screen.getByText('world', { selector: 'strong' });
    expect(strong).toBeInTheDocument();
  });

  it('renders a literal HTML tag as inert visible text, never as real markup (no dangerouslySetInnerHTML)', () => {
    const message = {
      _id: 'm6', type: 'text', content: '<img src=x onerror=alert(1)>', author: AUTHOR, date: new Date().toISOString(),
    };
    renderMessage(message);
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img')).not.toBeInTheDocument();
  });
});

describe('Message — Copy option', () => {
  it('shows a Copy option for a text message and writes both text/plain and text/html to the clipboard', async () => {
    const user = userEvent.setup();
    const writeSpy = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('ClipboardItem', class { constructor(items) { this.items = items; } });
    Object.defineProperty(navigator, 'clipboard', {
      value: { write: writeSpy, writeText: vi.fn() },
      configurable: true,
    });

    renderMessage(TEXT_MESSAGE);
    await user.click(screen.getByRole('button', { name: 'Message options' }));
    await user.click(screen.getByRole('button', { name: 'Copy' }));

    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith('Message copied.');
  });

  it('falls back to writeText when the ClipboardItem API is unavailable', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('ClipboardItem', undefined);
    const writeTextSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextSpy },
      configurable: true,
    });

    renderMessage(TEXT_MESSAGE);
    await user.click(screen.getByRole('button', { name: 'Message options' }));
    await user.click(screen.getByRole('button', { name: 'Copy' }));

    // Plain-text copy is the raw content verbatim (the app's own markdown-
    // like syntax, the same thing that's actually stored) — not stripped
    // of ** markers, since text/plain has no way to represent bold anyway
    // and the raw syntax is the most faithful plain-text representation.
    expect(writeTextSpy).toHaveBeenCalledWith('hello **world**');
  });

  it('does not show a Copy option for an image message', async () => {
    const user = userEvent.setup();
    renderMessage(IMAGE_MESSAGE);
    await user.click(screen.getByRole('button', { name: 'Message options' }));

    expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument();
  });

  it('shows an error toast when the clipboard write rejects', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });
    vi.stubGlobal('ClipboardItem', undefined);

    renderMessage(TEXT_MESSAGE);
    await user.click(screen.getByRole('button', { name: 'Message options' }));
    await user.click(screen.getByRole('button', { name: 'Copy' }));

    expect(toast.error).toHaveBeenCalledWith('Could not copy message.');
  });
});
