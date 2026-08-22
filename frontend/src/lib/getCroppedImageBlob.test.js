import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import getCroppedImageBlob from './getCroppedImageBlob';

// jsdom ships no real canvas 2D backend, so getContext()/toBlob() are stubbed
// here rather than pulling in the native `canvas` package this project
// doesn't otherwise need.
const makeCtx = ({ alpha = false } = {}) => ({
  translate: vi.fn(),
  rotate: vi.fn(),
  drawImage: vi.fn(),
  getImageData: vi.fn(() => ({
    data: alpha ? new Uint8ClampedArray([0, 0, 0, 0]) : new Uint8ClampedArray([0, 0, 0, 255]),
  })),
});

function mockCanvas({ alpha = false, toBlobResult = 'blob' } = {}) {
  const ctx = makeCtx({ alpha });
  const canvasProto = window.HTMLCanvasElement.prototype;
  vi.spyOn(canvasProto, 'getContext').mockReturnValue(ctx);
  vi.spyOn(canvasProto, 'toBlob').mockImplementation((cb, type) => {
    if (toBlobResult === null) {
      cb(null);
      return;
    }
    cb(new Blob(['x'], { type: type || 'image/png' }));
  });
  return ctx;
}

function mockImage({ width = 800, height = 600, fail = false } = {}) {
  vi.spyOn(window, 'Image').mockImplementation(function FakeImage() {
    this.width = width;
    this.height = height;
    Object.defineProperty(this, 'src', {
      set() {
        setTimeout(() => {
          if (fail) this.onerror?.();
          else this.onload?.();
        }, 0);
      },
    });
  });
}

describe('getCroppedImageBlob', () => {
  beforeEach(() => {
    mockCanvas();
    mockImage();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects when no crop region is given', async () => {
    await expect(getCroppedImageBlob('blob:x', null, 0, 'image/jpeg')).rejects.toThrow('Nothing to crop.');
  });

  it('rejects when the image fails to decode', async () => {
    mockImage({ fail: true });
    await expect(
      getCroppedImageBlob('blob:x', {
        x: 0, y: 0, width: 100, height: 100,
      }, 0, 'image/jpeg'),
    ).rejects.toThrow('Could not decode this image.');
  });

  it('produces a jpeg blob for an opaque source', async () => {
    const blob = await getCroppedImageBlob('blob:x', {
      x: 0, y: 0, width: 100, height: 100,
    }, 0, 'image/jpeg');
    expect(blob.type).toBe('image/jpeg');
  });

  it('preserves png output when the source has transparency', async () => {
    mockCanvas({ alpha: true });
    const blob = await getCroppedImageBlob('blob:x', {
      x: 0, y: 0, width: 100, height: 100,
    }, 0, 'image/png');
    expect(blob.type).toBe('image/png');
  });

  it('exports opaque png sources as jpeg, not png', async () => {
    mockCanvas({ alpha: false });
    const blob = await getCroppedImageBlob('blob:x', {
      x: 0, y: 0, width: 100, height: 100,
    }, 0, 'image/png');
    expect(blob.type).toBe('image/jpeg');
  });

  it('never upscales a crop region smaller than the output cap, and scales down one larger than it', async () => {
    const canvasProto = window.HTMLCanvasElement.prototype;
    const widths = [];
    const setWidth = Object.getOwnPropertyDescriptor(canvasProto, 'width');
    vi.spyOn(canvasProto, 'width', 'set').mockImplementation(function setW(v) {
      widths.push(v);
      setWidth.set.call(this, v);
    });

    await getCroppedImageBlob('blob:x', {
      x: 0, y: 0, width: 100, height: 50,
    }, 0, 'image/jpeg');
    // second canvas created is the output canvas — should keep the crop's
    // own size, not upscale it toward the 2048 cap
    expect(widths[widths.length - 1]).toBe(100);

    widths.length = 0;
    await getCroppedImageBlob('blob:x', {
      x: 0, y: 0, width: 4000, height: 2000,
    }, 0, 'image/jpeg');
    expect(widths[widths.length - 1]).toBeLessThanOrEqual(2048);
  });

  it('rejects when canvas.toBlob yields null', async () => {
    mockCanvas({ toBlobResult: null });
    await expect(
      getCroppedImageBlob('blob:x', {
        x: 0, y: 0, width: 100, height: 100,
      }, 0, 'image/jpeg'),
    ).rejects.toThrow('Could not process this image.');
  });
});
