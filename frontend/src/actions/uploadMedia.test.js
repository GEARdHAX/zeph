import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';

vi.mock('axios');
vi.mock('./getInfo', () => ({ default: vi.fn() }));

// eslint-disable-next-line import/first
import getInfo from './getInfo';

// A scriptable XMLHttpRequest: records what a browser would send to R2.
class FakeXHR {
  static sent = [];

  static respond = () => ({ status: 200, body: '' });

  constructor() {
    this.headers = {};
    this.upload = {};
  }

  open(method, url) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name, value) {
    this.headers[name] = value;
  }

  send(body) {
    FakeXHR.sent.push({ method: this.method, url: this.url, headers: this.headers, body });
    const { status, body: text } = FakeXHR.respond(this);
    this.status = status;
    this.responseText = text;
    if (this.upload.onprogress) this.upload.onprogress({ loaded: 5, total: 10 });
    setTimeout(() => (status === 0 ? this.onerror() : this.onload()), 0);
  }
}

describe('uploadMedia', () => {
  beforeEach(async () => {
    FakeXHR.sent = [];
    FakeXHR.respond = () => ({ status: 200, body: '' });
    vi.stubGlobal('XMLHttpRequest', FakeXHR);
    axios.post.mockReset();
    axios.put.mockReset();
    getInfo.mockReset();
    // Module-scoped directUploadEnabled cache — reset between tests by
    // re-importing the module fresh each time (vi.resetModules), since the
    // cache is deliberately NOT re-fetched per call in real usage.
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete axios.defaults.headers.common.Authorization;
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
            mediaId: 'media-2',
            uploadUrl: 'https://fake-r2/media-2',
            storageKey: 'user/media-2.pdf',
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
    expect(axios.put).not.toHaveBeenCalled(); // the R2 PUT is not an axios request (see putToStorage)
    expect(FakeXHR.sent).toHaveLength(1);
    expect(FakeXHR.sent[0]).toMatchObject({ method: 'PUT', url: 'https://fake-r2/media-2', body: file });
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/upload/media/media-2/complete'),
      expect.any(Object),
    );
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

    expect(FakeXHR.sent.map((r) => r.url)).toEqual(['https://fake-r2/media-3', 'https://fake-r2/media-3-thumb']);
    expect(FakeXHR.sent[1].body).toBe(poster);
  });

  describe('the PUT to R2', () => {
    const presign = (extra = {}) => ({
      mediaId: 'm',
      uploadUrl: 'https://fake-r2/m',
      uploadHeaders: { 'Content-Type': 'video/webm', 'Cache-Control': 'private, no-store' },
      storageKey: 'k',
      ...extra,
    });
    const setup = (presignData) => {
      getInfo.mockResolvedValue({ data: { directUploadEnabled: true } });
      axios.post.mockImplementation((url) =>
        Promise.resolve({ data: url.includes('/presign') ? presignData : { status: 200, media: { _id: 'm' } } }),
      );
    };

    it('never carries the login token, even when axios is configured to send it everywhere (the 400 bug)', async () => {
      axios.defaults.headers.common.Authorization = 'Bearer secret-login-token';
      setup(presign());
      const { default: uploadMedia } = await import('./uploadMedia');
      await uploadMedia(new File(['x'], 'clip.webm', { type: 'video/webm' }));

      const headers = FakeXHR.sent[0].headers;
      expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain('authorization');
      expect(JSON.stringify(headers)).not.toContain('secret-login-token');
    });

    it('sends exactly the headers the server signed, not the browser file type', async () => {
      setup(presign());
      const { default: uploadMedia } = await import('./uploadMedia');
      // a recorded file often reports an empty or parameterised type
      await uploadMedia(new File(['x'], 'clip.webm', { type: 'video/webm;codecs=vp8,opus' }));
      expect(FakeXHR.sent[0].headers).toEqual({ 'Content-Type': 'video/webm', 'Cache-Control': 'private, no-store' });

      FakeXHR.sent = [];
      vi.resetModules();
      const { default: again } = await import('./uploadMedia');
      await again(new File(['x'], 'clip.webm', { type: '' }));
      expect(FakeXHR.sent[0].headers['Content-Type']).toBe('video/webm');
    });

    it('falls back to the file type only if an older server sends no signed headers', async () => {
      setup(presign({ uploadHeaders: undefined }));
      const { default: uploadMedia } = await import('./uploadMedia');
      await uploadMedia(new File(['x'], 'clip.webm', { type: 'video/webm' }));
      expect(FakeXHR.sent[0].headers).toEqual({ 'Content-Type': 'video/webm' });
    });

    it('forwards upload progress to the caller', async () => {
      setup(presign());
      const onProgress = vi.fn();
      const { default: uploadMedia } = await import('./uploadMedia');
      await uploadMedia(new File(['x'], 'clip.webm', { type: 'video/webm' }), onProgress);
      expect(onProgress).toHaveBeenCalledWith({ loaded: 5, total: 10 });
    });

    it('rejects with R2\'s status and message when the storage refuses the upload, and never calls complete', async () => {
      setup(presign());
      FakeXHR.respond = () => ({ status: 400, body: '<Error><Code>InvalidRequest</Code></Error>' });
      const { default: uploadMedia } = await import('./uploadMedia');
      await expect(uploadMedia(new File(['x'], 'clip.webm', { type: 'video/webm' }))).rejects.toMatchObject({
        response: { status: 400, data: { error: 'STORAGE_UPLOAD_FAILED', detail: expect.stringContaining('InvalidRequest') } },
      });
      expect(axios.post.mock.calls.some(([url]) => url.includes('/complete'))).toBe(false);
    });

    it('reports a network or CORS failure distinctly', async () => {
      setup(presign());
      FakeXHR.respond = () => ({ status: 0, body: '' });
      const { default: uploadMedia } = await import('./uploadMedia');
      await expect(uploadMedia(new File(['x'], 'clip.webm', { type: 'video/webm' }))).rejects.toMatchObject({
        response: { status: 0 },
      });
    });
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
