// Downloads a media/file URL, letting the user pick the save location where
// the browser supports it. The File System Access API (showSaveFilePicker)
// is Chromium-only — Firefox/Safari fall back to a plain <a download> click,
// which saves via whatever the browser's own download settings already do
// (identical to this app's previous behavior). Never changes what's
// fetched/trusted: same authorized media URL either way.
const downloadFile = async (url, filename) => {
  if (typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName: filename || 'download' });
      const response = await fetch(url);
      if (!response.ok) throw new Error('Download failed');
      const blob = await response.blob();
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err) {
      // AbortError = user cancelled the picker — not a failure, just stop.
      if (err.name === 'AbortError') return;
      // Any other failure (permission denied, fetch error, etc.) falls
      // through to the plain-link approach below rather than leaving the
      // user with no way to download at all.
    }
  }

  const link = document.createElement('a');
  link.href = url;
  if (filename) link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
};

export default downloadFile;
