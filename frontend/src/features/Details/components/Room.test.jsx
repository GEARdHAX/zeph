import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { render, screen } from '@testing-library/react';
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
