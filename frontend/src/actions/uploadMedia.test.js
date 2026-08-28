import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import axios from 'axios';

vi.mock('axios');
vi.mock('./getInfo', () => ({ default: vi.fn() }));

// eslint-disable-next-line import/first
import getInfo from './getInfo';

describe('uploadMedia', () => {
  beforeEach(async () => {
    axios.post.mockReset();
    axios.put.mockReset();
    getInfo.mockReset();
    // Module-scoped directUploadEnabled cache — reset between tests by
    // re-importing the module fresh each time (vi.resetModules), since the
    // cache is deliberately NOT re-fetched per call in real usage.
    vi.resetModules();
  });

  it('uses the proxy-through-Node flow when directUploadEnabled is false', async () => {
    getInfo.mockResolvedValue({ data: { directUploadEnabled: false } });
    axios.post.mockResolvedValue({ data: { status: 200, media: { _id: 'media-1', category: 'document' } } });

    const { default: uploadMedia } = await import('./uploadMedia');
    const file = new File(['content'], 'doc.pdf', { type: 'application/pdf' });
    const res = await uploadMedia(file);

    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/api/upload/media'),
      expect.any(FormData),
      expect.any(Object),
    );
    expect(axios.put).not.toHaveBeenCalled();
    expect(res.data.media._id).toBe('media-1');
  });

  it('uses the direct-to-R2 flow when directUploadEnabled is true: presign, PUT, then complete', async () => {
    getInfo.mockResolvedValue({ data: { directUploadEnabled: true } });
    axios.post.mockImplementation((url) => {
      if (url.includes('/presign')) {
        return Promise.resolve({
          data: {
            mediaId: 'media-2', uploadUrl: 'https://fake-r2/media-2', storageKey: 'user/media-2.pdf',
          },
        });
      }
      if (url.includes('/complete')) {
        return Promise.resolve({ data: { status: 200, media: { _id: 'media-2', category: 'document' } } });
      }
      throw new Error(`Unexpected POST to ${url}`);
    });
    axios.put.mockResolvedValue({ data: {} });

    const { default: uploadMedia } = await import('./uploadMedia');
    const file = new File(['content'], 'doc.pdf', { type: 'application/pdf' });
    const res = await uploadMedia(file);

    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/upload/media/presign'),
      expect.objectContaining({ filename: 'doc.pdf', size: file.size }),
    );
    expect(axios.put).toHaveBeenCalledWith('https://fake-r2/media-2', file, expect.any(Object));
    expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/upload/media/media-2/complete'), expect.any(Object));
    expect(res.data.media._id).toBe('media-2');
  });

  it('also uploads the poster frame directly when provided, in the direct-to-R2 flow', async () => {
    getInfo.mockResolvedValue({ data: { directUploadEnabled: true } });
    axios.post.mockImplementation((url) => {
      if (url.includes('/presign')) {
        return Promise.resolve({
          data: {
            mediaId: 'media-3',
            uploadUrl: 'https://fake-r2/media-3',
            storageKey: 'user/media-3.mp4',
            posterUploadUrl: 'https://fake-r2/media-3-thumb',
            posterStorageKey: 'user/media-3-thumb.jpg',
          },
        });
      }
      return Promise.resolve({ data: { status: 200, media: { _id: 'media-3', category: 'video' } } });
    });
    axios.put.mockResolvedValue({ data: {} });

    const { default: uploadMedia } = await import('./uploadMedia');
    const file = new File(['content'], 'clip.mp4', { type: 'video/mp4' });
    const poster = new Blob(['jpegbytes'], { type: 'image/jpeg' });
    await uploadMedia(file, () => {}, poster);

    expect(axios.put).toHaveBeenCalledWith('https://fake-r2/media-3-thumb', poster, expect.any(Object));
  });

  it('falls back to the proxy flow if /api/info itself fails to load', async () => {
    getInfo.mockRejectedValue(new Error('network error'));
    axios.post.mockResolvedValue({ data: { status: 200, media: { _id: 'media-4' } } });

    const { default: uploadMedia } = await import('./uploadMedia');
    const file = new File(['content'], 'doc.pdf', { type: 'application/pdf' });
    const res = await uploadMedia(file);

    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/api/upload/media'),
      expect.any(FormData),
      expect.any(Object),
    );
    expect(res.data.media._id).toBe('media-4');
  });
});
