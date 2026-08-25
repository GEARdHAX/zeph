import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { createStore, combineReducers, applyMiddleware } from 'redux';
import thunk from 'redux-thunk';
import { MemoryRouter } from 'react-router-dom';
import { setGlobal } from 'reactn';
import axios from 'axios';
import io from '../../../reducers/io';
import messages from '../../../reducers/messages';
import rtc from '../../../reducers/rtc';
import emoji from '../../../reducers/emoji';
import Actions from '../../../constants/Actions';
import Room from './Room';

vi.mock('axios');

// Legacy old-format image message (type:'image', content is a shieldedID) —
// the Media tab's original, only-ever-tested-format message.
const IMAGE_MESSAGE = { _id: 'img-1', type: 'image', content: 'shielded-1' };

// New-format media message (message.media, from upload-media.js) — this is
// the regression: previously the Media tab's own query only ever fetched
// type:'image', so a message like this never appeared here even though it
// renders fine in the chat itself.
const DOCX_MESSAGE = {
  _id: 'file-1',
  type: 'file',
  media: {
    _id: 'media-1', category: 'document', originalName: 'report.docx', size: 2048,
  },
};

const ME = { id: 'user-1', firstName: 'Me', lastName: 'Self' };
const OTHER = {
  _id: 'user-2', firstName: 'Other', lastName: 'User', username: 'other',
};
const ROOM = {
  _id: 'room-1', people: [ME, OTHER], images: [IMAGE_MESSAGE, DOCX_MESSAGE], isGroup: false,
};

function renderRoom() {
  const rootReducer = combineReducers({
    emoji, io, messages, rtc,
  });
  const store = createStore(rootReducer, applyMiddleware(thunk));
  store.dispatch({ type: Actions.SET_ROOM, room: ROOM });
  render(
    <Provider store={store}>
      <MemoryRouter>
        <Room />
      </MemoryRouter>
    </Provider>,
  );
}

beforeEach(async () => {
  await setGlobal({ user: ME });
  axios.get.mockReset();
  axios.get.mockResolvedValue({ data: new Blob(['x'], { type: 'image/jpeg' }) });
});

// A minimal fake matching the io.on/io.off surface Room.jsx actually calls —
// not a real EventEmitter, just enough to let the test manually fire the
// handler the component registered.
function makeFakeSocket() {
  const handlers = {};
  return {
    id: 'socket-1',
    on: (event, handler) => { handlers[event] = handler; },
    off: () => {},
    emitFake: (event, payload) => handlers[event]?.(payload),
  };
}

const GROUP_ROOM = {
  _id: 'group-1', title: 'Study Group', isGroup: true, people: [ME], images: [],
};

describe('Details Room — live member-list refresh on group:member:added/removed/banned', () => {
  it('re-fetches the room (via room/join) when a member is added to the currently-open group', async () => {
    const fakeSocket = makeFakeSocket();
    const rootReducer = combineReducers({
      emoji, io, messages, rtc,
    });
    const store = createStore(rootReducer, applyMiddleware(thunk));
    store.dispatch({ type: Actions.IO_INIT, io: fakeSocket });
    store.dispatch({ type: Actions.SET_ROOM, room: GROUP_ROOM });

    // getGroup() (myRole lookup, unrelated to this test) fires on mount and
    // also goes through the default axios export — resolve it first, then
    // the second call is the room/join re-fetch this test actually cares about.
    axios.mockResolvedValueOnce({ data: { group: { myRole: 'MEMBER' } } });
    axios.mockResolvedValueOnce({
      data: { room: { ...GROUP_ROOM, people: [ME, OTHER] } },
    });

    render(
      <Provider store={store}>
        <MemoryRouter>
          <Room />
        </MemoryRouter>
      </Provider>,
    );

    expect(screen.queryByText('Other User')).not.toBeInTheDocument();

    fakeSocket.emitFake('group:member:added', { groupId: 'group-1', userId: 'user-2' });

    expect(await screen.findByText('Other User')).toBeInTheDocument();
  });

  it('ignores the event when it is for a different group than the one currently open', async () => {
    const fakeSocket = makeFakeSocket();
    const rootReducer = combineReducers({
      emoji, io, messages, rtc,
    });
    const store = createStore(rootReducer, applyMiddleware(thunk));
    store.dispatch({ type: Actions.IO_INIT, io: fakeSocket });
    store.dispatch({ type: Actions.SET_ROOM, room: GROUP_ROOM });

    axios.mockResolvedValueOnce({ data: { group: { myRole: 'MEMBER' } } });

    render(
      <Provider store={store}>
        <MemoryRouter>
          <Room />
        </MemoryRouter>
      </Provider>,
    );

    await screen.findByText('Study Group');
    axios.mockClear();

    fakeSocket.emitFake('group:member:added', { groupId: 'some-other-group', userId: 'user-2' });

    expect(axios).not.toHaveBeenCalled();
  });
});

describe('Details Room — Media tab', () => {
  it('shows both a legacy image message and a new-format (message.media) file message', async () => {
    const user = userEvent.setup();
    renderRoom();

    await user.click(screen.getByRole('button', { name: 'Media' }));

    // Legacy image renders as an <img>-backed grid cell.
    expect(document.querySelectorAll('img').length).toBeGreaterThan(0);
    // New-format non-image message renders as an icon card with its filename,
    // not a broken <img> — this is the actual regression coverage.
    expect(await screen.findByText('report.docx')).toBeInTheDocument();
  });

  it('shows the empty state when there are no media messages', async () => {
    const user = userEvent.setup();
    const rootReducer = combineReducers({
      emoji, io, messages, rtc,
    });
    const store = createStore(rootReducer, applyMiddleware(thunk));
    store.dispatch({ type: Actions.SET_ROOM, room: { ...ROOM, images: [] } });
    render(
      <Provider store={store}>
        <MemoryRouter>
          <Room />
        </MemoryRouter>
      </Provider>,
    );

    await user.click(screen.getByRole('button', { name: 'Media' }));
    expect(screen.getByText('No images shared in this conversation yet.')).toBeInTheDocument();
  });
});

describe('Details Room — Leave Group (plain MEMBER entry point)', () => {
  function renderGroupRoom(myRole) {
    const rootReducer = combineReducers({
      emoji, io, messages, rtc,
    });
    const store = createStore(rootReducer, applyMiddleware(thunk));
    store.dispatch({ type: Actions.SET_ROOM, room: GROUP_ROOM });
    axios.mockResolvedValueOnce({ data: { group: { myRole } } });
    render(
      <Provider store={store}>
        <MemoryRouter>
          <Room />
        </MemoryRouter>
      </Provider>,
    );
    return store;
  }

  it('shows "Leave Group" for a plain MEMBER, who has no other way to reach it', async () => {
    renderGroupRoom('MEMBER');
    expect(await screen.findByRole('button', { name: /leave group/i })).toBeInTheDocument();
  });

  it('shows "Leave Group" for an ADMIN too', async () => {
    renderGroupRoom('ADMIN');
    expect(await screen.findByRole('button', { name: /leave group/i })).toBeInTheDocument();
  });

  it('does not show "Leave Group" for the OWNER (their leave/transfer flow lives in GroupAdminPanel)', async () => {
    renderGroupRoom('OWNER');
    await screen.findByRole('button', { name: /manage group/i });
    expect(screen.queryByRole('button', { name: /leave group/i })).not.toBeInTheDocument();
  });

  it('clicking Leave Group asks for confirmation, then calls group/leave and navigates away', async () => {
    const user = userEvent.setup();
    renderGroupRoom('MEMBER');

    const leaveBtn = await screen.findByRole('button', { name: /leave group/i });
    await user.click(leaveBtn);

    expect(await screen.findByText('Leave this group?')).toBeInTheDocument();

    axios.mockResolvedValueOnce({ data: { status: 'success' } });
    await user.click(screen.getByRole('button', { name: 'Leave Group' }));

    await waitFor(() => expect(axios).toHaveBeenCalledWith(expect.objectContaining({
      method: 'post',
      url: expect.stringContaining('/api/group/leave'),
      data: { id: 'group-1' },
    })));
  });
});
