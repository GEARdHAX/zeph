import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { createStore, combineReducers } from 'redux';
import rtc from '../../../reducers/rtc';
import io from '../../../reducers/io';
import Streams, { gridShape } from './Streams';

// Meet-style layout: every tile carries its owner's name, a person who shares their screen gets a
// separate "<name>'s screen" tile that takes the stage, and the tiled grid adapts to head-count
// and screen size.

const peer = (socketID, overrides = {}) => ({
  socketID,
  userID: `user-${socketID}`,
  user: { firstName: socketID, lastName: 'Peer' },
  ...overrides,
});

const makeStore = ({ consumers, peers, producers = [], myID = 'me', counterpart = null }) =>
  createStore(combineReducers({ rtc, io }), {
    rtc: { producers, consumers, peers, counterpart },
    io: { id: myID },
  });

// jsdom has no MediaStream; the tile only needs `.isVideo` and ids for classification.
const videoStream = (socketID, producerID) => ({ isVideo: true, socketID, producerID });

const renderStreams = (store, props = {}) =>
  render(
    <Provider store={store}>
      <Streams streams={[]} isMaximized {...props} />
    </Provider>,
  );

describe('gridShape', () => {
  it('tiles like Meet: 1 full, 2 side by side, 3-4 two columns, then wider', () => {
    expect(gridShape(1, true)).toEqual({ cols: 1, rows: 1 });
    expect(gridShape(2, true)).toEqual({ cols: 2, rows: 1 });
    expect(gridShape(3, true)).toEqual({ cols: 2, rows: 2 });
    expect(gridShape(4, true)).toEqual({ cols: 2, rows: 2 });
    expect(gridShape(6, true)).toEqual({ cols: 3, rows: 2 });
    expect(gridShape(10, true)).toEqual({ cols: 4, rows: 3 });
  });

  it('stacks two tiles on a phone and uses two columns after that', () => {
    expect(gridShape(1, false)).toEqual({ cols: 1, rows: 1 });
    expect(gridShape(2, false)).toEqual({ cols: 1, rows: 2 });
    expect(gridShape(3, false)).toEqual({ cols: 2, rows: 2 });
    expect(gridShape(5, false)).toEqual({ cols: 2, rows: 3 });
  });
});

describe('Streams — tiled mode', () => {
  it('shows every participant with their name', () => {
    const store = makeStore({
      consumers: ['me', 'a', 'b', 'c'],
      peers: { a: peer('a'), b: peer('b'), c: peer('c') },
    });
    renderStreams(store, { isGrid: true });
    ['a Peer', 'b Peer', 'c Peer'].forEach((name) => expect(screen.getByText(name)).toBeInTheDocument());
    expect(screen.queryByTestId('stage')).toBeNull(); // nobody presenting: even grid, no stage
  });

  it('shows the waiting state with no peers', () => {
    renderStreams(makeStore({ consumers: ['me'], peers: {} }), { isGrid: true });
    expect(screen.getByText('Waiting for others to join...')).toBeInTheDocument();
  });

  it('falls back to the 1:1 counterpart when the consumer list has not arrived', () => {
    const store = makeStore({ consumers: ['me'], peers: {}, counterpart: { firstName: 'Dana', lastName: 'Lee' } });
    renderStreams(store, { isGrid: true });
    expect(screen.getByText('Dana Lee')).toBeInTheDocument();
  });
});

describe('Streams — screen share', () => {
  const sharing = () => ({
    store: makeStore({
      consumers: ['me', 'a', 'b'],
      peers: { a: peer('a'), b: peer('b') },
      producers: [
        { producerID: 'sess/video-1', isScreen: false },
        { producerID: 'sess/screen-1', isScreen: true },
      ],
    }),
    streams: [videoStream('a', 'sess/video-1'), videoStream('a', 'sess/screen-1')],
  });

  it("puts the presenter's screen on the stage, labelled with their name, and keeps everyone else in the strip", () => {
    const { store, streams } = sharing();
    renderStreams(store, { isGrid: true, streams });

    const stage = screen.getByTestId('stage');
    expect(within(stage).getByText("a Peer's screen")).toBeInTheDocument();
    // the presenter's own camera tile and the other participant stay visible, named, in the strip
    expect(screen.getByTestId('tile-a')).toBeInTheDocument();
    expect(screen.getByTestId('tile-b')).toBeInTheDocument();
    expect(within(screen.getByTestId('tile-a')).getByText('a Peer')).toBeInTheDocument();
    expect(within(screen.getByTestId('tile-b')).getByText('b Peer')).toBeInTheDocument();
  });

  it('lets you pin another tile onto the stage and unpin it again', async () => {
    const { store, streams } = sharing();
    const user = userEvent.setup();
    renderStreams(store, { isGrid: true, streams });

    await user.click(document.querySelector('button[title="Focus on b Peer"]'));
    expect(within(screen.getByTestId('stage')).getByText('b Peer')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Unpin' }));
    expect(within(screen.getByTestId('stage')).getByText("a Peer's screen")).toBeInTheDocument();
  });

  it('shows two presenters as two separately named screens', () => {
    const streams = [videoStream('a', 'sa/screen-1'), videoStream('b', 'sb/screen-1')];
    const store = makeStore({
      consumers: ['me', 'a', 'b'],
      peers: { a: peer('a'), b: peer('b') },
      producers: [
        { producerID: 'sa/screen-1', isScreen: true },
        { producerID: 'sb/screen-1', isScreen: true },
      ],
    });
    renderStreams(store, { isGrid: true, streams });
    expect(screen.getByText("a Peer's screen")).toBeInTheDocument();
    expect(screen.getByText("b Peer's screen")).toBeInTheDocument();
  });
});

describe('Streams — spotlight mode', () => {
  it('spotlights the most recent person and lets you switch via the strip', async () => {
    const store = makeStore({ consumers: ['me', 'a', 'b'], peers: { a: peer('a'), b: peer('b') } });
    const user = userEvent.setup();
    renderStreams(store, { isGrid: false });

    expect(within(screen.getByTestId('stage')).getByText('b Peer')).toBeInTheDocument();
    await user.click(document.querySelector('button[title="Focus on a Peer"]'));
    expect(within(screen.getByTestId('stage')).getByText('a Peer')).toBeInTheDocument();
  });

  it('has no strip with only one other person', () => {
    renderStreams(makeStore({ consumers: ['me', 'a'], peers: { a: peer('a') } }), { isGrid: false });
    expect(within(screen.getByTestId('stage')).getByText('a Peer')).toBeInTheDocument();
    expect(document.querySelector('button[title^="Focus on"]')).toBeNull();
  });
});
