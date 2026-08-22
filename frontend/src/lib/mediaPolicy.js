// Frontend mirror of backend/src/mediaPolicy.js — UX-only pre-check so an
// invalid/oversized file is rejected instantly instead of round-tripping to
// the server first. The backend remains the real authority; if these two
// files ever disagree, the backend's limits win. Keep both in sync.
const MB = 1024 * 1024;

export const MEDIA_CATEGORIES = {
  image: {
    extensions: ['.jpg', '.jpeg', '.png', '.webp', '.gif'],
    mimes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    maxSize: 10 * MB,
  },
  video: {
    extensions: ['.mp4', '.webm', '.mov'],
    mimes: ['video/mp4', 'video/webm', 'video/quicktime'],
    maxSize: 50 * MB,
  },
  audio: {
    extensions: ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.opus', '.weba'],
    mimes: [
      'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/aac',
      'audio/ogg', 'audio/opus', 'audio/webm',
    ],
    maxSize: 25 * MB,
  },
  pdf: {
    extensions: ['.pdf'],
    mimes: ['application/pdf'],
    maxSize: 25 * MB,
  },
  document: {
    extensions: [
      '.doc', '.docx', '.xls', '.xlsx', '.csv', '.ppt', '.pptx',
      '.txt', '.rtf', '.odt', '.ods', '.odp',
    ],
    mimes: [],
    maxSize: 25 * MB,
  },
  archive: {
    extensions: ['.zip', '.7z', '.rar', '.tar', '.gz'],
    mimes: [],
    maxSize: 25 * MB,
  },
  text: {
    extensions: [
      '.json', '.xml', '.yaml', '.yml', '.md', '.log', '.sql', '.css',
      '.html', '.htm', '.js', '.ts', '.tsx', '.jsx', '.py', '.java',
      '.cpp', '.c', '.h',
    ],
    mimes: [],
    maxSize: 10 * MB,
  },
};

const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.dll', '.bat', '.cmd', '.ps1', '.sh', '.msi', '.com', '.scr',
  '.jar', '.vbs', '.app', '.deb', '.rpm', '.apk', '.msix', '.gadget',
]);

const extensionToCategory = new Map();
Object.entries(MEDIA_CATEGORIES).forEach(([category, def]) => {
  def.extensions.forEach((ext) => extensionToCategory.set(ext, category));
});

const extensionOf = (filename) => {
  const match = /\.[^./\\]+$/.exec(filename || '');
  return match ? match[0].toLowerCase() : '';
};

// Returns the category key or null if blocked/unrecognized.
export const categorizeFile = (file) => {
  const ext = extensionOf(file?.name);
  if (BLOCKED_EXTENSIONS.has(ext)) return null;
  return extensionToCategory.get(ext) || null;
};

export const getMaxSize = (category) => MEDIA_CATEGORIES[category]?.maxSize ?? 0;

// Validates a File against the policy, returning { valid, category, error }.
// `error` is a short, user-facing reason when valid is false.
export const validateFile = (file) => {
  const category = categorizeFile(file);
  if (!category) {
    return { valid: false, category: null, error: `${file.name}: unsupported file type.` };
  }
  const maxSize = getMaxSize(category);
  if (file.size > maxSize) {
    return {
      valid: false,
      category,
      error: `${file.name}: file is too large (max ${Math.round(maxSize / MB)}MB).`,
    };
  }
  return { valid: true, category, error: null };
};
