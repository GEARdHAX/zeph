import { describe, it, expect } from 'vitest';
import io from './io';
import Actions from '../constants/Actions';

const baseState = { messages: [{ _id: 'm1', readBy: [], deliveredTo: [] }, { _id: 'm2', readBy: [], deliveredTo: [] }] };

describe('io reducer — delivery/read receipts', () => {
  it('MESSAGE_DELIVERED adds the reader to deliveredTo on the matching message only', () => {
    const state = io(baseState, { type: Actions.MESSAGE_DELIVERED, messageID: 'm1', readerID: 'u1' });
    expect(state.messages[0].deliveredTo).toEqual(['u1']);
    expect(state.messages[1].deliveredTo).toEqual([]);
  });

  it('MESSAGE_DELIVERED is idempotent — acking twice does not duplicate the entry', () => {
    let state = io(baseState, { type: Actions.MESSAGE_DELIVERED, messageID: 'm1', readerID: 'u1' });
    state = io(state, { type: Actions.MESSAGE_DELIVERED, messageID: 'm1', readerID: 'u1' });
    expect(state.messages[0].deliveredTo).toEqual(['u1']);
  });

  it('MESSAGE_READ adds the reader to readBy on every message in the batch', () => {
    const state = io(baseState, { type: Actions.MESSAGE_READ, messageIDs: ['m1', 'm2'], readerID: 'u1' });
    expect(state.messages[0].readBy).toEqual(['u1']);
    expect(state.messages[1].readBy).toEqual(['u1']);
  });

  it('MESSAGE_READ is idempotent — marking the same batch read twice does not duplicate entries', () => {
    let state = io(baseState, { type: Actions.MESSAGE_READ, messageIDs: ['m1'], readerID: 'u1' });
    state = io(state, { type: Actions.MESSAGE_READ, messageIDs: ['m1'], readerID: 'u1' });
    expect(state.messages[0].readBy).toEqual(['u1']);
  });
});
