import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import axios from 'axios';
import useAuthorizedMediaUrl, { resetCdnState } from './useAuthorizedMediaUrl';

vi.mock('axios');

beforeEach(() => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-object-url');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  axios.get.mockReset();
  resetCdnState();
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

  describe('CDN signed URLs', () => {
    const notEnabled = () => Object.assign(new Error('404'), { response: { status: 404, data: { error: 'CDN_NOT_ENABLED' } } });

    it('uses the signed edge URL directly (no blob download) when the backend issues one', async () => {
      axios.get.mockResolvedValue({ data: { url: 'https://cdn.example/o/private/x?sig=1', expiresAt: 1 } });

      const { result } = renderHook(() => useAuthorizedMediaUrl('/api/media/abc', { authorized: true }));
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(axios.get).toHaveBeenCalledTimes(1);
      expect(axios.get).toHaveBeenCalledWith('/api/media/abc/url');
      expect(result.current.url).toBe('https://cdn.example/o/private/x?sig=1');
      expect(URL.createObjectURL).not.toHaveBeenCalled();
    });

    it('requests the thumbnail signed URL the same way', async () => {
      axios.get.mockResolvedValue({ data: { url: 'https://cdn.example/o/private/t?sig=1' } });
      renderHook(() => useAuthorizedMediaUrl('/api/media/abc/thumbnail', { authorized: true }));
      await waitFor(() => expect(axios.get).toHaveBeenCalledWith('/api/media/abc/thumbnail/url'));
    });

    it('falls back to the authenticated blob path when the CDN is off, and stops asking', async () => {
      axios.get.mockImplementation((u) => (u.endsWith('/url') ? Promise.reject(notEnabled()) : Promise.resolve({ data: new Blob(['x']) })));

      const first = renderHook(() => useAuthorizedMediaUrl('/api/media/one', { authorized: true }));
      await waitFor(() => expect(first.result.current.loading).toBe(false));
      expect(first.result.current.url).toBe('blob:mock-object-url');

      axios.get.mockClear();
      const second = renderHook(() => useAuthorizedMediaUrl('/api/media/two', { authorized: true }));
      await waitFor(() => expect(second.result.current.loading).toBe(false));
      expect(axios.get).toHaveBeenCalledTimes(1); // straight to the blob path, no more /url probes
      expect(axios.get).toHaveBeenCalledWith('/api/media/two', { responseType: 'blob' });
    });

    it('falls back for a single older object without disabling the CDN for others', async () => {
      const notAvailable = Object.assign(new Error('404'), { response: { status: 404, data: { error: 'CDN_NOT_AVAILABLE' } } });
      axios.get.mockImplementation((u) => (u.endsWith('/url') ? Promise.reject(notAvailable) : Promise.resolve({ data: new Blob(['x']) })));

      const { result } = renderHook(() => useAuthorizedMediaUrl('/api/media/old', { authorized: true }));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.url).toBe('blob:mock-object-url');

      axios.get.mockClear();
      axios.get.mockResolvedValue({ data: { url: 'https://cdn.example/o/private/new?sig=1' } });
      const next = renderHook(() => useAuthorizedMediaUrl('/api/media/new', { authorized: true }));
      await waitFor(() => expect(next.result.current.loading).toBe(false));
      expect(next.result.current.url).toBe('https://cdn.example/o/private/new?sig=1');
    });
  });
});
