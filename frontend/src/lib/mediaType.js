const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'mkv', 'avi']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac']);

const extensionOf = (name) => (name || '').split('.').pop().toLowerCase();

// Returns 'image' | 'video' | 'audio' | 'pdf' | 'document' | 'archive' |
// 'text' | 'file'. New-format messages (message.media, from the unified
// upload-media.js pipeline) carry their category directly on the Media
// document — no guessing needed. Old-format messages (message.file, or
// type:'image' with no file/media at all) fall back to the original
// mimetype/extension-sniffing logic, unchanged, so nothing existing breaks.
const getMediaCategory = (message) => {
  if (message?.media?.category) return message.media.category;
  if (message?.type === 'image') return 'image';
  if (message?.type !== 'file' || !message.file) return 'file';

  const mime = message.file.type || '';
  const ext = extensionOf(message.file.name);

  if (mime.startsWith('video/') || VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (mime.startsWith('audio/') || AUDIO_EXTENSIONS.has(ext)) return 'audio';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  return 'file';
};

export default getMediaCategory;
