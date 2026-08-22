// Centralized media-sharing policy — the single place that defines which
// file types are accepted, how big they may be, and how much trust the
// viewer gives them. Every upload/serving route imports this instead of
// hardcoding its own limits/allowlist, so a future limit change (per the
// task's own "not permanent architectural limits" instruction) is a one-file
// edit, not a hunt across routes.
//
// security levels:
//   SAFE_PREVIEW   — safe to render inline (img/video/audio/iframe)
//   DOWNLOAD_ONLY  — never rendered inline; served with Content-Disposition:
//                    attachment so the browser can't be tricked into
//                    executing/rendering it at the app's own origin
const SecurityLevel = {
  SAFE_PREVIEW: 'SAFE_PREVIEW',
  DOWNLOAD_ONLY: 'DOWNLOAD_ONLY',
  BLOCKED: 'BLOCKED',
};

const MB = 1024 * 1024;

const MEDIA_CATEGORIES = {
  image: {
    extensions: ['.jpg', '.jpeg', '.png', '.webp', '.gif'],
    mimes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    maxSize: 10 * MB,
    security: SecurityLevel.SAFE_PREVIEW,
  },
  video: {
    extensions: ['.mp4', '.webm', '.mov'],
    mimes: ['video/mp4', 'video/webm', 'video/quicktime'],
    maxSize: 50 * MB,
    security: SecurityLevel.SAFE_PREVIEW,
  },
  audio: {
    extensions: ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.opus', '.weba'],
    mimes: [
      'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/aac',
      'audio/ogg', 'audio/opus', 'audio/webm',
    ],
    maxSize: 25 * MB,
    security: SecurityLevel.SAFE_PREVIEW,
  },
  pdf: {
    extensions: ['.pdf'],
    mimes: ['application/pdf'],
    maxSize: 25 * MB,
    security: SecurityLevel.SAFE_PREVIEW,
  },
  document: {
    extensions: [
      '.doc', '.docx', '.xls', '.xlsx', '.csv', '.ppt', '.pptx',
      '.txt', '.rtf', '.odt', '.ods', '.odp',
    ],
    mimes: [
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain',
      'application/rtf',
      'application/vnd.oasis.opendocument.text',
      'application/vnd.oasis.opendocument.spreadsheet',
      'application/vnd.oasis.opendocument.presentation',
    ],
    maxSize: 25 * MB,
    security: SecurityLevel.DOWNLOAD_ONLY,
  },
  archive: {
    extensions: ['.zip', '.7z', '.rar', '.tar', '.gz'],
    mimes: [
      'application/zip', 'application/x-7z-compressed', 'application/vnd.rar',
      'application/x-rar-compressed', 'application/x-tar', 'application/gzip',
      'application/x-gzip',
    ],
    maxSize: 25 * MB,
    security: SecurityLevel.DOWNLOAD_ONLY,
  },
  // Plain-text/source files — never executed, always shown as escaped text
  // or downloaded, even HTML/JS which are otherwise "active" formats.
  text: {
    extensions: [
      '.json', '.xml', '.yaml', '.yml', '.md', '.log', '.sql', '.css',
      '.html', '.htm', '.js', '.ts', '.tsx', '.jsx', '.py', '.java',
      '.cpp', '.c', '.h',
    ],
    mimes: [
      'application/json', 'application/xml', 'text/xml', 'text/yaml',
      'text/markdown', 'text/plain', 'text/x-log', 'application/sql',
      'text/css', 'text/html', 'application/javascript', 'text/javascript',
      'application/x-typescript', 'text/x-python', 'text/x-java-source',
      'text/x-c', 'text/x-c++',
    ],
    maxSize: 10 * MB,
    security: SecurityLevel.DOWNLOAD_ONLY,
  },
};

// Never accepted, regardless of MIME claims — executables/scripts capable
// of running on the host OS or inside a shell.
const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.dll', '.bat', '.cmd', '.ps1', '.sh', '.msi', '.com', '.scr',
  '.jar', '.vbs', '.app', '.deb', '.rpm', '.apk', '.msix', '.gadget',
]);

const extensionToCategory = new Map();
Object.entries(MEDIA_CATEGORIES).forEach(([category, def]) => {
  def.extensions.forEach((ext) => extensionToCategory.set(ext, category));
});

// Returns the category key ('image'|'video'|...) or null if the extension is
// blocked or unrecognized. `mimetype` is accepted for future use (e.g.
// disambiguating an extension shared across categories) but the extension
// map is authoritative today — every extension in MEDIA_CATEGORIES maps to
// exactly one category.
const categorizeFile = (extension) => {
  const ext = (extension || '').toLowerCase();
  if (BLOCKED_EXTENSIONS.has(ext)) return null;
  return extensionToCategory.get(ext) || null;
};

const getMaxSize = (category) => MEDIA_CATEGORIES[category]?.maxSize ?? 0;

const getSecurityLevel = (category) => MEDIA_CATEGORIES[category]?.security ?? SecurityLevel.BLOCKED;

const isAllowedMime = (category, mimetype) => {
  const def = MEDIA_CATEGORIES[category];
  return !!def && def.mimes.includes(mimetype);
};

module.exports = {
  MEDIA_CATEGORIES,
  BLOCKED_EXTENSIONS,
  SecurityLevel,
  categorizeFile,
  getMaxSize,
  getSecurityLevel,
  isAllowedMime,
};
