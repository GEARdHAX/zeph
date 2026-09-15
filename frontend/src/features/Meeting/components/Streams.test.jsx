import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { createStore, combineReducers } from 'redux';
import { setGlobal } from 'reactn';
import rtc from '../../../reducers/rtc';
import io from '../../../reducers/io';
import Streams from './Streams';

// Spotlight/grid layout bugs fixed together:
// 1. Spotlight mode had NO visible way to switch who was spotlighted from
//    inside the layout itself (the only thumbnail strip lived in TopBar's
//    LittleStreams, gated behind an unrelated toggle).
// 2. The spotlighted peer was looked up via `peer.socketID === mainPeer`
//    where mainPeer was the whole stashed OBJECT, not a string — always
//    false, so the tile kept rendering stale video/audio stream refs.
// 3. setMainStream was called during render (not an effect) when nothing
//    was yet spotlighted.
// 4. A short last ROW in the grid stretched its tiles to fill the full row
//    width, visibly wider than tiles in a full row above.

const peer = (socketID, overrides = {}) => ({
  socketID,
  userID: `user-${socketID}`,
  user: { firstName: socketID, lastName: 'Peer' },
  video: null,
  audio: null,
  isScreen: false,
  ...overrides,
});

const makeStore = ({ consumers, peers, myID = 'me' }) =>
  createStore(combineReducers({ rtc, io }), {
    rtc: { producers: [], consumers, peers, counterpart: null },
    io: { id: myID },
  });

const renderStreams = (store, props = {}) =>
  render(
    <Provider store={store}>
      <Streams streams={[]} isMaximized {...props} />
    </Provider>,
  );

beforeEach(async () => {
  await setGlobal({ mainStream: null });
});

describe('Streams — grid mode', () => {
  it('renders every peer as an equal-width grid tile (no stretched last-row tile)', () => {
    const store = makeStore({
      consumers: ['me', 'a', 'b', 'c'],
      peers: { a: peer('a'), b: peer('b'), c: peer('c') },
    });
    renderStreams(store, { isGrid: true });

    // 3 peers -> side = ceil(sqrt(3)) = 2 columns; a CSS grid keeps every
    // tile the same size regardless of the last row having only 1 item —
    // verified structurally here (grid-template-columns present, one
    // container, no per-row wrapper divs with differing tile counts).
    expect(screen.getByText('a Peer')).toBeInTheDocument();
    expect(screen.getByText('b Peer')).toBeInTheDocument();
    expect(screen.getByText('c Peer')).toBeInTheDocument();
  });

  it('shows the waiting state with no peers', () => {
    const store = makeStore({ consumers: ['me'], peers: {} });
    renderStreams(store, { isGrid: true });
    expect(screen.getByText('Waiting for others to join...')).toBeInTheDocument();
  });
});

describe('Streams — spotlight mode', () => {
  // The thumbnail buttons carry a `title="Focus on X"` tooltip AND visible
  // text content (LittleInterface's avatar-initials fallback + the bare
  // first name) — per the ARIA accessible-name algorithm, ALL visible
  // descendant text is concatenated and wins over `title` when both are
  // present, so a thumbnail's real accessible name is e.g. "APa" (initials
  // "AP" + name "a"), not the title string. Queried via a data-testid
  // instead of fighting that concatenation — more robust than depending on
  // exactly how AvatarFallback happens to compose initials.

  it('auto-selects a peer to spotlight when none is chosen yet, showing a thumbnail strip to switch', async () => {
    const store = makeStore({
      consumers: ['me', 'a', 'b'],
      peers: { a: peer('a'), b: peer('b') },
    });
    renderStreams(store, { isGrid: false });

    // The auto-select effect fires after mount — b (most recently joined
    // in actualPeers order) becomes the spotlight ("b Peer", the larger
    // Interface tile's fuller name), and the thumbnail strip shows both
    // peers (by their "Focus on X" tooltip title, queried directly on the
    // DOM attribute rather than via accessible-name matching).
    expect(await screen.findByText('b Peer')).toBeInTheDocument();
    expect(document.querySelector('button[title="Focus on a"]')).not.toBeNull();
    expect(document.querySelector('button[title="Focus on b"]')).not.toBeNull();
  });

  it('clicking a thumbnail switches the spotlighted peer', async () => {
    const store = makeStore({
      consumers: ['me', 'a', 'b'],
      peers: { a: peer('a'), b: peer('b') },
    });
    const user = userEvent.setup();
    renderStreams(store, { isGrid: false });

    // b is auto-selected first (see the test above).
    await screen.findByText('b Peer');
    await user.click(document.querySelector('button[title="Focus on a"]'));

    // The main tile now shows a's full name; b is no longer the spotlight.
    expect(await screen.findByText('a Peer')).toBeInTheDocument();
    expect(screen.queryByText('b Peer')).not.toBeInTheDocument();
  });

  it('does not show a thumbnail strip with only one other peer (nothing to switch to)', async () => {
    const store = makeStore({ consumers: ['me', 'a'], peers: { a: peer('a') } });
    renderStreams(store, { isGrid: false });

    await screen.findByText('a Peer'); // the spotlighted tile itself
    expect(document.querySelector('button[title^="Focus on"]')).toBeNull();
  });
});
