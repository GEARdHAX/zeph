import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import axios from 'axios';
import useAuthorizedMediaUrl from './useAuthorizedMediaUrl';

vi.mock('axios');

beforeEach(() => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-object-url');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  axios.get.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useAuthorizedMediaUrl', () => {
  it('passes a legacy (unauthorized) URL straight through with no fetch', async () => {
    const { result } = renderHook(() => useAuthorizedMediaUrl('/api/images/abc/2048', { authorized: false }));

    expect(result.current.url).toBe('/api/images/abc/2048');
    expect(result.current.loading).toBe(false);
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('fetches an authorized URL via axios (which attaches the auth header) and resolves a blob: URL', async () => {
    const blob = new Blob(['fake audio bytes'], { type: 'audio/mpeg' });
    axios.get.mockResolvedValue({ data: blob });

    const { result } = renderHook(() => useAuthorizedMediaUrl('/api/media/abc', { authorized: true }));

    expect(result.current.loading).toBe(true);
    expect(result.current.url).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(axios.get).toHaveBeenCalledWith('/api/media/abc', { responseType: 'blob' });
    expect(result.current.url).toBe('blob:mock-object-url');
    expect(result.current.error).toBe(false);
  });

  it('sets error when the authorized fetch fails (e.g. 401/404)', async () => {
    axios.get.mockRejectedValue(new Error('Request failed with status code 401'));

    const { result } = renderHook(() => useAuthorizedMediaUrl('/api/media/abc', { authorized: true }));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe(true);
    expect(result.current.url).toBeNull();
  });

  it('returns null/not-loading when url is null', () => {
    const { result } = renderHook(() => useAuthorizedMediaUrl(null, { authorized: true }));

    expect(result.current.url).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('revokes the object URL on unmount', async () => {
    const blob = new Blob(['x'], { type: 'audio/mpeg' });
    axios.get.mockResolvedValue({ data: blob });

    const { result, unmount } = renderHook(() => useAuthorizedMediaUrl('/api/media/abc', { authorized: true }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    unmount();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-object-url');
  });
});
