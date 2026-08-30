import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import {
  render, screen, act, fireEvent, waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { createStore, combineReducers, applyMiddleware } from 'redux';
import thunk from 'redux-thunk';
import { setGlobal } from 'reactn';
import io from '../../../reducers/io';
import messages from '../../../reducers/messages';
import rtc from '../../../reducers/rtc';
import emoji from '../../../reducers/emoji';
import Actions from '../../../constants/Actions';
import BottomBar from './BottomBar';

vi.mock('../../../actions/message', () => ({ default: vi.fn() }));
vi.mock('../../../actions/getRooms', () => ({ default: vi.fn(() => Promise.resolve({ data: { rooms: [] } })) }));
vi.mock('../../../actions/typing', () => ({ default: () => () => {} }));
vi.mock('../../../actions/uploadImage', () => ({ default: vi.fn() }));
vi.mock('../../../actions/uploadMedia', () => ({ default: vi.fn() }));
vi.mock('../../../actions/deleteConversation', () => ({ default: vi.fn() }));
vi.mock('react-toastify', () => ({ toast: { warn: vi.fn(), error: vi.fn(), success: vi.fn() } }));
// @emoji-mart/react needs a peer `emoji-mart` package that Vite's browser bundling
// resolves but Vitest's Node module resolution doesn't — not exercised by this test.
vi.mock('@emoji-mart/react', () => ({ default: () => null }));
// The real editor drags in react-easy-crop's canvas/drag internals, which
// aren't under test here — only BottomBar's queue wiring is. A stub that
// immediately "finishes" with a renamed File stands in for the modal.
vi.mock('./ImageEditorModal', () => ({
  default: ({ file, onDone, onCancel }) => (
    <div>
      <span>
        Editing
        {' '}
        {file.name}
      </span>
      <button type="button" onClick={() => onDone(new File([file], `edited-${file.name}`, { type: file.type }))}>
        Done editing
      </button>
      <button type="button" onClick={onCancel}>Cancel editing</button>
    </div>
  ),
}));
// Same isolation rationale as ImageEditorModal above — VideoEditorModal's
// real MediaRecorder/captureStream flow is covered by its own test file.
vi.mock('./VideoEditorModal', () => ({
  default: ({ file, onDone, onCancel }) => (
    <div>
      <span>
        Trimming
        {' '}
        {file.name}
      </span>
      <button
        type="button"
        onClick={() => onDone(
          new File([file], `trimmed-${file.name}`, { type: 'video/webm' }),
          new Blob(['poster'], { type: 'image/jpeg' }),
        )}
      >
        Done trimming
      </button>
      <button type="button" onClick={onCancel}>Cancel trimming</button>
    </div>
  ),
}));

// eslint-disable-next-line import/first
import message from '../../../actions/message';
// eslint-disable-next-line import/first
import uploadImage from '../../../actions/uploadImage';
// eslint-disable-next-line import/first
import uploadMedia from '../../../actions/uploadMedia';
// eslint-disable-next-line import/first
import deleteConversation from '../../../actions/deleteConversation';
// eslint-disable-next-line import/first
import { toast } from 'react-toastify';

const ROOM = { _id: 'room-1', people: ['user-1', 'user-2'] };
const ME = { id: 'user-1', firstName: 'Me', lastName: 'Self' };

function makeStore() {
  const rootReducer = combineReducers({
    emoji, io, messages, rtc,
  });
  const store = createStore(rootReducer, applyMiddleware(thunk));
  store.dispatch({ type: Actions.SET_ROOM, room: ROOM });
  return store;
}

function renderBottomBar() {
  const store = makeStore();
  render(
    <Provider store={store}>
      <MemoryRouter>
        <BottomBar />
      </MemoryRouter>
    </Provider>,
  );
  return store;
}

beforeEach(async () => {
  await setGlobal({
    ref: 'ref', user: ME, isPicker: false,
  });
  message.mockReset();
  message.mockResolvedValue({ data: { message: { _id: 'server-id' } } });
  uploadImage.mockReset();
  uploadMedia.mockReset();
  toast.error.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('BottomBar offline-retry send flow', () => {
  it('optimistically appends the message with a clientID, then swaps in the server _id and marks it sent', async () => {
    const userEv = userEvent.setup();
    message.mockResolvedValueOnce({ data: { message: { _id: 'server-id-1' } } });

    const store = renderBottomBar();
    const input = screen.getByRole('textbox', { name: 'Type something to send...' });

    await userEv.type(input, 'hello there');
    await userEv.click(screen.getByRole('button', { name: 'Send message' }));

    // Input clears immediately, independent of the network result.
    expect(input.textContent).toBe('');

    await waitFor(() => {
      expect(store.getState().io.messages[0].status).toBe('sent');
    });
    const [sent] = store.getState().io.messages;
    expect(sent.content).toBe('hello there');
    expect(sent.clientID).toBeTruthy();
    expect(sent._id).toBe('server-id-1');
  });

  it('shows the optimistic message as "sending" while the request is in flight', async () => {
    let resolveRequest;
    message.mockImplementationOnce(() => new Promise((resolve) => {
      resolveRequest = resolve;
    }));

    const userEv = userEvent.setup();
    const store = renderBottomBar();
    const input = screen.getByRole('textbox', { name: 'Type something to send...' });

    await userEv.type(input, 'hold on');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    });

    expect(store.getState().io.messages[0].status).toBe('sending');

    await act(async () => {
      resolveRequest({ data: { message: { _id: 'server-id-2' } } });
    });

    await waitFor(() => {
      expect(store.getState().io.messages[0].status).toBe('sent');
    });
  });

  it('retries on failure and eventually marks the message failed after exhausting retries', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    message.mockRejectedValue(new Error('network down'));

    const userEv = userEvent.setup({ delay: null });
    const store = renderBottomBar();
    const input = screen.getByRole('textbox', { name: 'Type something to send...' });

    await userEv.type(input, 'will fail');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    });

    expect(store.getState().io.messages[0].status).toBe('sending');

    // 4 attempts total = up to 1s + 2s + 4s of backoff between them.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000 + 2000 + 4000 + 100);
    });

    expect(message).toHaveBeenCalledTimes(4);
    expect(store.getState().io.messages[0].status).toBe('failed');
  });

  it('does not send an empty message', async () => {
    const userEv = userEvent.setup();
    const store = renderBottomBar();

    await userEv.click(screen.getByRole('button', { name: 'Send message' }));

    expect(store.getState().io.messages).toHaveLength(0);
    expect(message).not.toHaveBeenCalled();
  });
});

describe('BottomBar image editor queue', () => {
  function getImageInput(container) {
    return container.querySelector('input[type="file"][accept="image/*"]');
  }

  it('selecting an image opens the editor and uploads nothing until Done is clicked', async () => {
    const userEv = userEvent.setup();
    const file = new File(['x'], 'photo.png', { type: 'image/png' });
    const { container } = render(
      <Provider store={makeStore()}><MemoryRouter><BottomBar /></MemoryRouter></Provider>,
    );

    await userEv.upload(getImageInput(container), file);

    expect(await screen.findByText('Editing photo.png')).toBeInTheDocument();
    expect(uploadImage).not.toHaveBeenCalled();
    expect(message).not.toHaveBeenCalled();
  });

  it('Done sends the edited file through the existing upload+message pipeline', async () => {
    const userEv = userEvent.setup();
    const file = new File(['x'], 'photo.png', { type: 'image/png' });
    uploadImage.mockResolvedValue({ data: { image: { _id: 'img-1', shieldedID: 'shielded-1' } } });
    const { container } = render(
      <Provider store={makeStore()}><MemoryRouter><BottomBar /></MemoryRouter></Provider>,
    );

    await userEv.upload(getImageInput(container), file);
    await userEv.click(await screen.findByText('Done editing'));

    await waitFor(() => expect(uploadImage).toHaveBeenCalledTimes(1));
    expect(uploadImage.mock.calls[0][0].name).toBe('edited-photo.png');
    await waitFor(() => expect(message).toHaveBeenCalledWith(expect.objectContaining({
      type: 'image', content: 'shielded-1', imageID: 'img-1',
    })));
    expect(screen.queryByText('Editing photo.png')).not.toBeInTheDocument();
  });

  it('editing multiple images in sequence uploads and sends each one, in order, only after all are done', async () => {
    const userEv = userEvent.setup();
    const files = [
      new File(['a'], 'one.png', { type: 'image/png' }),
      new File(['b'], 'two.png', { type: 'image/png' }),
    ];
    uploadImage
      .mockResolvedValueOnce({ data: { image: { _id: 'img-1', shieldedID: 'shielded-1' } } })
      .mockResolvedValueOnce({ data: { image: { _id: 'img-2', shieldedID: 'shielded-2' } } });
    const { container } = render(
      <Provider store={makeStore()}><MemoryRouter><BottomBar /></MemoryRouter></Provider>,
    );

    await userEv.upload(getImageInput(container), files);
    expect(await screen.findByText('Editing one.png')).toBeInTheDocument();

    await userEv.click(screen.getByText('Done editing'));
    expect(await screen.findByText('Editing two.png')).toBeInTheDocument();
    expect(uploadImage).not.toHaveBeenCalled();

    await userEv.click(screen.getByText('Done editing'));

    await waitFor(() => expect(uploadImage).toHaveBeenCalledTimes(2));
    expect(uploadImage.mock.calls[0][0].name).toBe('edited-one.png');
    expect(uploadImage.mock.calls[1][0].name).toBe('edited-two.png');
  });

  it('Cancel discards the entire remaining queue — nothing uploads or sends', async () => {
    const userEv = userEvent.setup();
    const files = [
      new File(['a'], 'one.png', { type: 'image/png' }),
      new File(['b'], 'two.png', { type: 'image/png' }),
    ];
    const { container } = render(
      <Provider store={makeStore()}><MemoryRouter><BottomBar /></MemoryRouter></Provider>,
    );

    await userEv.upload(getImageInput(container), files);
    await userEv.click(await screen.findByText('Cancel editing'));

    expect(screen.queryByText(/Editing/)).not.toBeInTheDocument();
    expect(uploadImage).not.toHaveBeenCalled();
    expect(message).not.toHaveBeenCalled();
  });

  it('rejects an oversized file with a toast and never opens the editor', async () => {
    const userEv = userEvent.setup();
    const big = new File([new Uint8Array(11 * 1024 * 1024)], 'huge.png', { type: 'image/png' });
    const { container } = render(
      <Provider store={makeStore()}><MemoryRouter><BottomBar /></MemoryRouter></Provider>,
    );

    await userEv.upload(getImageInput(container), big);

    expect(screen.queryByText(/Editing/)).not.toBeInTheDocument();
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it('rejects an unsupported file type with a toast and never opens the editor', async () => {
    const userEv = userEvent.setup();
    const bad = new File(['x'], 'clip.mp4', { type: 'video/mp4' });
    const { container } = render(
      <Provider store={makeStore()}><MemoryRouter><BottomBar /></MemoryRouter></Provider>,
    );

    await userEv.upload(getImageInput(container), bad);

    expect(screen.queryByText(/Editing/)).not.toBeInTheDocument();
    expect(uploadImage).not.toHaveBeenCalled();
  });
});

describe('BottomBar upload progress (real-world network buffering)', () => {
  function getImageInput(container) {
    return container.querySelector('input[type="file"][accept="image/*"]');
  }

  it('shows a live percentage while uploadImage reports progress, then clears it once the send completes', async () => {
    const userEv = userEvent.setup();
    const file = new File(['x'], 'photo.png', { type: 'image/png' });
    let capturedOnProgress;
    let resolveUpload;
    uploadImage.mockImplementation((_file, _token, onProgress) => {
      capturedOnProgress = onProgress;
      return new Promise((resolve) => { resolveUpload = resolve; });
    });
    const { container } = render(
      <Provider store={makeStore()}><MemoryRouter><BottomBar /></MemoryRouter></Provider>,
    );

    await userEv.upload(getImageInput(container), file);
    await userEv.click(await screen.findByText('Done editing'));

    await waitFor(() => expect(uploadImage).toHaveBeenCalledTimes(1));
    expect(screen.getByText('edited-photo.png')).toBeInTheDocument();
    expect(screen.getByText('0%')).toBeInTheDocument();

    act(() => { capturedOnProgress({ loaded: 42, total: 100 }); });
    expect(await screen.findByText('42%')).toBeInTheDocument();

    resolveUpload({ data: { image: { _id: 'img-1', shieldedID: 'shielded-1' } } });
    await waitFor(() => expect(screen.queryByText('edited-photo.png')).not.toBeInTheDocument());
  });

  it('clears the progress bar even when the upload fails', async () => {
    const userEv = userEvent.setup();
    const file = new File(['x'], 'photo.png', { type: 'image/png' });
    uploadImage.mockRejectedValue(new Error('network error'));
    const { container } = render(
      <Provider store={makeStore()}><MemoryRouter><BottomBar /></MemoryRouter></Provider>,
    );

    await userEv.upload(getImageInput(container), file);
    await userEv.click(await screen.findByText('Done editing'));

    await waitFor(() => expect(uploadImage).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText('edited-photo.png')).not.toBeInTheDocument());
    // Regression: sendImages() used to be called fire-and-forget with no
    // caller-side catch — an upload failure threw uncaught and silently, no
    // toast, nothing visible to the user at all.
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining('Could not send image'),
    ));
  });
});

describe('BottomBar general attach — category routing', () => {
  function getFileInput(container) {
    return container.querySelector('input[type="file"]:not([accept="image/*"])');
  }

  it('routes a video through VideoEditorModal, uploading nothing until Done', async () => {
    const userEv = userEvent.setup();
    const video = new File(['x'], 'clip.mp4', { type: 'video/mp4' });
    const { container } = render(
      <Provider store={makeStore()}><MemoryRouter><BottomBar /></MemoryRouter></Provider>,
    );

    await userEv.upload(getFileInput(container), video);

    expect(await screen.findByText('Trimming clip.mp4')).toBeInTheDocument();
    expect(uploadMedia).not.toHaveBeenCalled();
    expect(message).not.toHaveBeenCalled();
  });

  it('Done trimming uploads the trimmed file + poster and sends a message with mediaID', async () => {
    const userEv = userEvent.setup();
    const video = new File(['x'], 'clip.mp4', { type: 'video/mp4' });
    uploadMedia.mockResolvedValue({ data: { media: { _id: 'media-1', category: 'video' } } });
    const { container } = render(
      <Provider store={makeStore()}><MemoryRouter><BottomBar /></MemoryRouter></Provider>,
    );

    await userEv.upload(getFileInput(container), video);
    await userEv.click(await screen.findByText('Done trimming'));

    await waitFor(() => expect(uploadMedia).toHaveBeenCalledTimes(1));
    const [uploadedFile, , posterBlob] = uploadMedia.mock.calls[0];
    expect(uploadedFile.name).toBe('trimmed-clip.mp4');
    expect(posterBlob).toBeInstanceOf(Blob);
    await waitFor(() => expect(message).toHaveBeenCalledWith(expect.objectContaining({
      type: 'file', mediaID: 'media-1',
    })));
  });

  it('routes a document straight to upload with no editor step', async () => {
    const userEv = userEvent.setup();
    const doc = new File(['x'], 'report.pdf', { type: 'application/pdf' });
    uploadMedia.mockResolvedValue({ data: { media: { _id: 'media-2', category: 'pdf' } } });
    const { container } = render(
      <Provider store={makeStore()}><MemoryRouter><BottomBar /></MemoryRouter></Provider>,
    );

    await userEv.upload(getFileInput(container), doc);

    expect(screen.queryByText(/Trimming/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Editing/)).not.toBeInTheDocument();
    await waitFor(() => expect(uploadMedia).toHaveBeenCalledTimes(1));
    expect(uploadMedia.mock.calls[0][0].name).toBe('report.pdf');
    await waitFor(() => expect(message).toHaveBeenCalledWith(expect.objectContaining({
      type: 'file', mediaID: 'media-2',
    })));
  });

  it('a mixed selection routes each file independently (image to editor, document straight to upload)', async () => {
    const userEv = userEvent.setup();
    const image = new File(['x'], 'photo.png', { type: 'image/png' });
    const doc = new File(['x'], 'notes.txt', { type: 'text/plain' });
    uploadMedia.mockResolvedValue({ data: { media: { _id: 'media-3', category: 'document' } } });
    const { container } = render(
      <Provider store={makeStore()}><MemoryRouter><BottomBar /></MemoryRouter></Provider>,
    );

    await userEv.upload(getFileInput(container), [image, doc]);

    expect(await screen.findByText('Editing photo.png')).toBeInTheDocument();
    await waitFor(() => expect(uploadMedia).toHaveBeenCalledTimes(1));
    expect(uploadMedia.mock.calls[0][0].name).toBe('notes.txt');
  });

  it('Cancel on the video editor uploads nothing', async () => {
    const userEv = userEvent.setup();
    const video = new File(['x'], 'clip.mp4', { type: 'video/mp4' });
    const { container } = render(
      <Provider store={makeStore()}><MemoryRouter><BottomBar /></MemoryRouter></Provider>,
    );

    await userEv.upload(getFileInput(container), video);
    await userEv.click(await screen.findByText('Cancel trimming'));

    expect(screen.queryByText(/Trimming/)).not.toBeInTheDocument();
    expect(uploadMedia).not.toHaveBeenCalled();
    expect(message).not.toHaveBeenCalled();
  });

  it('rejects a blocked/oversized file with a toast and uploads nothing', async () => {
    const userEv = userEvent.setup();
    const huge = new File([new Uint8Array(26 * 1024 * 1024)], 'huge.pdf', { type: 'application/pdf' });
    const { container } = render(
      <Provider store={makeStore()}><MemoryRouter><BottomBar /></MemoryRouter></Provider>,
    );

    await userEv.upload(getFileInput(container), huge);

    expect(uploadMedia).not.toHaveBeenCalled();
    expect(message).not.toHaveBeenCalled();
  });
});

describe('BottomBar — access revoked (removed/banned from the open group)', () => {
  function makeRevokedStore(accessRevoked) {
    const rootReducer = combineReducers({
      emoji, io, messages, rtc,
    });
    const store = createStore(rootReducer, applyMiddleware(thunk));
    store.dispatch({ type: Actions.SET_ROOM, room: { ...ROOM, accessRevoked } });
    return store;
  }

  beforeEach(() => {
    deleteConversation.mockReset();
  });

  it('hides the composer entirely and shows who removed the user', async () => {
    render(
      <Provider store={makeRevokedStore({ reason: 'removed', actorName: 'Alice Owner' })}>
        <MemoryRouter><BottomBar /></MemoryRouter>
      </Provider>,
    );

    expect(screen.getByText('You were removed from this group by Alice Owner')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Type something to send...' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send message' })).not.toBeInTheDocument();
  });

  it('shows "banned" wording distinctly from "removed"', async () => {
    render(
      <Provider store={makeRevokedStore({ reason: 'banned', actorName: 'Bob Admin' })}>
        <MemoryRouter><BottomBar /></MemoryRouter>
      </Provider>,
    );

    expect(screen.getByText('You were banned from this group by Bob Admin')).toBeInTheDocument();
  });

  it('omits the actor clause when actorName is unknown', async () => {
    render(
      <Provider store={makeRevokedStore({ reason: 'removed', actorName: null })}>
        <MemoryRouter><BottomBar /></MemoryRouter>
      </Provider>,
    );

    expect(screen.getByText('You were removed from this group')).toBeInTheDocument();
  });

  it('Delete Group DM calls deleteConversation with the room id', async () => {
    deleteConversation.mockResolvedValue({ data: { status: 'success' } });
    const userEv = userEvent.setup();
    render(
      <Provider store={makeRevokedStore({ reason: 'banned', actorName: 'Bob Admin' })}>
        <MemoryRouter><BottomBar /></MemoryRouter>
      </Provider>,
    );

    await userEv.click(screen.getByRole('button', { name: /delete group dm/i }));

    await waitFor(() => expect(deleteConversation).toHaveBeenCalledWith(ROOM._id));
  });
});
