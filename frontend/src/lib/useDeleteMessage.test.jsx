import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { createStore } from 'redux';
import { toast } from 'react-toastify';
import ioReducer from '../reducers/io';
import Actions from '../constants/Actions';
import deleteMessage from '../actions/deleteMessage';
import useDeleteMessage from './useDeleteMessage';

vi.mock('../actions/deleteMessage');
vi.mock('react-toastify', () => ({ toast: { error: vi.fn() } }));

const mine = { _id: 'm2', content: 'hello', media: { _id: 'x' }, date: '2026-01-02T00:00:00Z', author: { _id: 'u1' } };
const messages = [{ _id: 'm1', content: 'a', date: '2026-01-01T00:00:00Z' }, mine, { _id: 'm3', content: 'c', date: '2026-01-03T00:00:00Z' }];

let store;
const setup = () => {
  store = createStore(ioReducer, { messages: [...messages], rooms: [] });
  const wrapper = ({ children }) => <Provider store={store}>{children}</Provider>;
  return renderHook(() => useDeleteMessage('room1', mine), { wrapper });
};
const ids = () => store.getState().messages.map((m) => m._id);

beforeEach(() => vi.clearAllMocks());

describe('useDeleteMessage (optimistic)', () => {
  it('delete for me: the row is gone BEFORE the request resolves, and stays gone on 200', async () => {
    let resolve;
    deleteMessage.mockReturnValue(new Promise((r) => (resolve = r)));
    const { result } = setup();

    act(() => result.current.mutate({ forEveryone: false }));
    expect(ids()).toEqual(['m1', 'm3']); // already removed, request still pending

    await act(async () => resolve({ data: { status: 'success' } }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(ids()).toEqual(['m1', 'm3']);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('delete for me: a failed request puts the message back in its original position', async () => {
    deleteMessage.mockRejectedValue(new Error('network'));
    const { result } = setup();

    await act(async () => {
      result.current.mutate({ forEveryone: false });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(ids()).toEqual(['m1', 'm2', 'm3']);
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('restored'));
  });

  it('delete for everyone: tombstoned at once, then settled with the server timestamp on 200', async () => {
    deleteMessage.mockResolvedValue({ data: { deletedAt: '2026-02-02T00:00:00Z' } });
    const { result } = setup();

    await act(async () => {
      result.current.mutate({ forEveryone: true });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const m = store.getState().messages.find((x) => x._id === 'm2');
    expect(m).toMatchObject({ deletedForEveryone: true, content: null, deletedAt: '2026-02-02T00:00:00Z' });
  });

  it('delete for everyone: a failure reverts the tombstone to the original message (content and media back)', async () => {
    deleteMessage.mockRejectedValue(new Error('500'));
    const { result } = setup();

    await act(async () => {
      result.current.mutate({ forEveryone: true });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(store.getState().messages.find((x) => x._id === 'm2')).toEqual(mine);
  });

  it('an expired deletion window is explained and the message is restored', async () => {
    deleteMessage.mockRejectedValue({ response: { data: { reason: 'deletion_window_expired' } } });
    const { result } = setup();

    await act(async () => {
      result.current.mutate({ forEveryone: true });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(toast.error).toHaveBeenCalledWith('Too late to delete this for everyone.');
    expect(store.getState().messages.find((x) => x._id === 'm2').deletedForEveryone).toBeFalsy();
  });

  it('the restore action is idempotent', () => {
    const s = createStore(ioReducer, { messages: [...messages], rooms: [] });
    s.dispatch({ type: Actions.MESSAGE_RESTORE, message: mine });
    s.dispatch({ type: Actions.MESSAGE_RESTORE, message: mine });
    expect(s.getState().messages).toHaveLength(3);
  });
});
