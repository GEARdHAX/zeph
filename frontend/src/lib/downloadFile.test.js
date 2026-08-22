import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import downloadFile from './downloadFile';

describe('downloadFile', () => {
  afterEach(() => {
    delete window.showSaveFilePicker;
    vi.restoreAllMocks();
  });

  describe('when showSaveFilePicker is available (Chromium)', () => {
    let writable;
    let handle;

    beforeEach(() => {
      writable = { write: vi.fn().mockResolvedValue(), close: vi.fn().mockResolvedValue() };
      handle = { createWritable: vi.fn().mockResolvedValue(writable) };
      window.showSaveFilePicker = vi.fn().mockResolvedValue(handle);
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        blob: vi.fn().mockResolvedValue(new Blob(['x'])),
      });
    });

    it('opens the picker with the suggested filename, then fetches and writes the blob', async () => {
      await downloadFile('/api/files/abc', 'report.pdf');

      expect(window.showSaveFilePicker).toHaveBeenCalledWith({ suggestedName: 'report.pdf' });
      expect(global.fetch).toHaveBeenCalledWith('/api/files/abc');
      expect(writable.write).toHaveBeenCalled();
      expect(writable.close).toHaveBeenCalled();
    });

    it('does nothing further when the user cancels the picker (AbortError)', async () => {
      const abortError = new Error('cancelled');
      abortError.name = 'AbortError';
      window.showSaveFilePicker = vi.fn().mockRejectedValue(abortError);

      await downloadFile('/api/files/abc', 'report.pdf');

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('falls back to a plain download if fetch fails after the picker succeeds', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false });
      const clickSpy = vi.fn();
      const originalCreateElement = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tag) => {
        const el = originalCreateElement(tag);
        if (tag === 'a') el.click = clickSpy;
        return el;
      });

      await downloadFile('/api/files/abc', 'report.pdf');

      expect(clickSpy).toHaveBeenCalled();
    });
  });

  describe('when showSaveFilePicker is unavailable (Firefox/Safari)', () => {
    beforeEach(() => {
      delete window.showSaveFilePicker;
    });

    it('falls back to a plain <a download> click', async () => {
      const clickSpy = vi.fn();
      const originalCreateElement = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tag) => {
        const el = originalCreateElement(tag);
        if (tag === 'a') el.click = clickSpy;
        return el;
      });

      await downloadFile('/api/files/abc', 'report.pdf');

      expect(clickSpy).toHaveBeenCalled();
    });
  });
});
