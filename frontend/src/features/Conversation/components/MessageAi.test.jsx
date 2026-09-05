import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

// Zeph AI — Phase 10: per-message Translate action.
vi.mock('../../../actions/translateMessage', () => ({ default: vi.fn() }));
vi.mock('react-toastify', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, toast: { ...actual.toast, success: vi.fn(), error: vi.fn() } };
});

// eslint-disable-next-line import/first
import translateMessage from '../../../actions/translateMessage';

const ME = { id: 'user-1', firstName: 'Me', lastName: 'Self' };
const AUTHOR = { _id: 'user-1', firstName: 'Me', lastName: 'Self' };
const TEXT_MESSAGE = {
  _id: 'm1', type: 'text', content: 'hello there', author: AUTHOR, date: new Date().toISOString(),
};

function renderMessage(message, aiEnabled = true) {
  const rootReducer = combineReducers({
    emoji, io, messages, rtc,
  });
  const store = createStore(rootReducer, applyMiddleware(thunk));
  render(
    <Provider store={store}>
      <MemoryRouter>
        <Message message={message} onOpen={vi.fn()} roomID="room-1" aiEnabled={aiEnabled} />
      </MemoryRouter>
    </Provider>,
  );
}

beforeEach(async () => {
  await setGlobal({ user: ME });
  translateMessage.mockReset();
  toast.error.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Message — Translate (AI)', () => {
  it('does not offer Translate when AI is disabled', async () => {
    const user = userEvent.setup();
    renderMessage(TEXT_MESSAGE, false);
    await user.click(screen.getByRole('button', { name: 'Message options' }));
    expect(screen.queryByText('Translate')).not.toBeInTheDocument();
  });

  it('shows a language list, then displays the translation beneath the message on success', async () => {
    translateMessage.mockResolvedValueOnce({ data: { translation: 'hola' } });
    const user = userEvent.setup();
    renderMessage(TEXT_MESSAGE);

    await user.click(screen.getByRole('button', { name: 'Message options' }));
    await user.click(screen.getByText('Translate'));

    const spanishOption = await screen.findByText('Spanish');
    await user.click(spanishOption);

    await waitFor(() => {
      expect(screen.getByText('hola')).toBeInTheDocument();
    });
    expect(translateMessage).toHaveBeenCalledWith('hello there', 'Spanish', expect.anything());
  });

  it('"← Back" returns to the main menu without translating', async () => {
    const user = userEvent.setup();
    renderMessage(TEXT_MESSAGE);

    await user.click(screen.getByRole('button', { name: 'Message options' }));
    await user.click(screen.getByText('Translate'));
    await user.click(await screen.findByText('← Back'));

    expect(screen.getByText('Translate')).toBeInTheDocument();
    expect(translateMessage).not.toHaveBeenCalled();
  });

  it('shows a rate-limited error message distinctly from a generic failure', async () => {
    translateMessage.mockRejectedValueOnce({
      response: { status: 429, data: { reason: 'RATE_LIMITED' } },
    });
    const user = userEvent.setup();
    renderMessage(TEXT_MESSAGE);

    await user.click(screen.getByRole('button', { name: 'Message options' }));
    await user.click(screen.getByText('Translate'));
    await user.click(await screen.findByText('French'));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('wait a moment'));
    });
  });

  it('prevents a duplicate submission while a translation is already in flight', async () => {
    let resolveRequest;
    translateMessage.mockImplementationOnce(() => new Promise((resolve) => { resolveRequest = resolve; }));
    const user = userEvent.setup();
    renderMessage(TEXT_MESSAGE);

    await user.click(screen.getByRole('button', { name: 'Message options' }));
    await user.click(screen.getByText('Translate'));
    await user.click(await screen.findByText('German'));

    // Menu closes after picking a language; reopening and trying Translate
    // again while the first call is still in flight must not fire a second
    // request — handleTranslate's own `if (translating) return` guard.
    await user.click(screen.getByRole('button', { name: 'Message options' }));
    await user.click(await screen.findByText('Translating…'));

    expect(translateMessage).toHaveBeenCalledTimes(1);

    resolveRequest({ data: { translation: 'hallo' } });
    await waitFor(() => expect(screen.getByText('hallo')).toBeInTheDocument());
  });
});
