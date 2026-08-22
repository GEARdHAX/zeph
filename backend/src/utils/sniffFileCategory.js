const fs = require('fs');

// Reads only the first 32 bytes of the uploaded temp file and checks known
// magic-number signatures — this is the "never trust client MIME" defense:
// a renamed .exe claiming to be image/png is still caught here because its
// actual header bytes don't match PNG's signature. Returns the sniffed
// category, or null if the header doesn't match anything recognized (the
// caller decides whether to reject on a mismatch with the claimed category).
const SIGNATURES = [
  { category: 'image', bytes: [0xff, 0xd8, 0xff] }, // JPEG
  { category: 'image', bytes: [0x89, 0x50, 0x4e, 0x47] }, // PNG
  { category: 'image', bytes: [0x47, 0x49, 0x46, 0x38] }, // GIF87a/89a
  { category: 'image', bytes: [0x52, 0x49, 0x46, 0x46], offset: 0, riffType: 'WEBP' }, // RIFF....WEBP
  { category: 'video', bytes: [0x1a, 0x45, 0xdf, 0xa3] }, // WebM/Matroska (EBML)
  { category: 'video', ftyp: true }, // MP4/MOV — ISO base media, detected via 'ftyp' at offset 4
  { category: 'audio', bytes: [0x49, 0x44, 0x33] }, // MP3 (ID3)
  { category: 'audio', bytes: [0xff, 0xfb] }, // MP3 (no ID3 tag)
  { category: 'audio', bytes: [0x52, 0x49, 0x46, 0x46], offset: 0, riffType: 'WAVE' }, // RIFF....WAVE
  { category: 'audio', bytes: [0x4f, 0x67, 0x67, 0x53] }, // OGG
  { category: 'pdf', bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { category: 'archive', bytes: [0x50, 0x4b, 0x03, 0x04] }, // ZIP (also .docx/.xlsx/.pptx/.odt — OOXML/ODF are zip containers)
  { category: 'archive', bytes: [0x50, 0x4b, 0x05, 0x06] }, // ZIP (empty archive)
  { category: 'archive', bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c] }, // 7z
  { category: 'archive', bytes: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07] }, // RAR
  { category: 'archive', bytes: [0x1f, 0x8b] }, // GZIP
];

const matches = (header, bytes) => bytes.every((byte, i) => header[i] === byte);

const sniffCategory = (filePath) => {
  const fd = fs.openSync(filePath, 'r');
  const header = Buffer.alloc(32);
  fs.readSync(fd, header, 0, 32, 0);
  fs.closeSync(fd);

  const ftyp = header.slice(4, 8).toString('ascii');
  if (ftyp === 'ftyp') return 'video';

  const riffType = header.slice(8, 12).toString('ascii');
  for (const sig of SIGNATURES) {
    if (sig.riffType) {
      if (matches(header, sig.bytes) && riffType === sig.riffType) return sig.category;
      continue;
    }
    if (sig.bytes && matches(header, sig.bytes)) return sig.category;
  }
  return null;
};

// Rejects a file whose header matches a KNOWN BINARY signature that doesn't
// belong to the category it claims to be — e.g. a renamed .exe (MZ header)
// claiming to be a .txt. Plain-text categories ('text', and 'document'
// formats like .doc/.txt/.csv/.rtf that have no single universal magic
// number) have nothing reliable to sniff FOR, so they're only checked
// NEGATIVELY: the header must not match any other category's binary
// signature, nor a known executable header (MZ/ELF/Mach-O).
const EXECUTABLE_SIGNATURES = [
  [0x4d, 0x5a], // MZ (Windows PE/EXE/DLL)
  [0x7f, 0x45, 0x4c, 0x46], // ELF (Linux binaries)
  [0xca, 0xfe, 0xba, 0xbe], // Mach-O (macOS, also Java class files' fat binary form)
  [0xfe, 0xed, 0xfa, 0xce], // Mach-O 32-bit
  [0xfe, 0xed, 0xfa, 0xcf], // Mach-O 64-bit
];

const looksExecutable = (filePath) => {
  const fd = fs.openSync(filePath, 'r');
  const header = Buffer.alloc(8);
  fs.readSync(fd, header, 0, 8, 0);
  fs.closeSync(fd);
  return EXECUTABLE_SIGNATURES.some((sig) => matches(header, sig));
};

// OOXML documents (.docx/.xlsx/.pptx) and ODF documents (.odt/.ods/.odp) are
// themselves zip containers — sniffCategory correctly reports them as
// 'archive' at the byte level. Document-vs-archive disambiguation for those
// extensions is intentionally left to the claimed extension/category (both
// are DOWNLOAD_ONLY in mediaPolicy anyway, so nothing SAFE_PREVIEW-trusts a
// misidentified zip either way) — a zip-signature match is accepted as
// consistent with a claimed 'document' OR 'archive' category.
//
// 'document' and 'text' categories include formats with no reliable magic
// number (plain .txt/.csv/.rtf/.json/etc) — for those, consistency means
// "not a disguised executable and not some OTHER category's binary format",
// not "matched a positive signature for its own category".
const isConsistentWithCategory = (filePath, claimedCategory) => {
  if (looksExecutable(filePath)) return false;

  const sniffed = sniffCategory(filePath);
  if (!sniffed) {
    // No recognized binary signature at all — acceptable for text/document
    // categories (plain text has none), but SAFE_PREVIEW categories
    // (image/video/audio/pdf) must always match a real signature.
    return claimedCategory === 'document' || claimedCategory === 'text';
  }
  if (sniffed === claimedCategory) return true;
  if (sniffed === 'archive' && claimedCategory === 'document') return true;
  return false;
};

module.exports = { sniffCategory, isConsistentWithCategory };
