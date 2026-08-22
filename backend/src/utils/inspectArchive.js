const fs = require('fs');

// Cheap decompression-bomb / archive-bomb heuristic for ZIP-format archives
// (also covers OOXML/.docx/.xlsx/.pptx and ODF, which are zip containers) —
// reads the End Of Central Directory record and per-entry local headers to
// count entries and sum claimed uncompressed sizes, WITHOUT ever inflating
// any entry's actual bytes. Per the task's explicit instruction, archives
// are never extracted server-side even to inspect them; this only reads
// structural header fields that are present regardless of compression.
//
// Non-ZIP archive formats (.7z/.rar/.tar/.gz) have no equivalently simple
// structural header to scan without a dedicated parser library — for those,
// this function returns { safe: true, checked: false } (accepted based on
// size-limit + extension/signature checks alone, same posture as the
// original file-type-only gate) rather than pulling in a 7z/rar-parsing
// dependency for a "nice to have" deeper check.
const MAX_ENTRIES = 2000;
const MAX_COMPRESSION_RATIO = 100; // uncompressed size vs. entry's own compressed size

const EOCD_SIGNATURE = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const CENTRAL_DIR_SIGNATURE = Buffer.from([0x50, 0x4b, 0x01, 0x02]);

const findEOCD = (buffer) => {
  // EOCD is always in the last 64KB + comment; scanning from the end is
  // the standard approach since the comment length is variable.
  const searchStart = Math.max(0, buffer.length - 65557);
  for (let i = buffer.length - 22; i >= searchStart; i -= 1) {
    if (buffer.slice(i, i + 4).equals(EOCD_SIGNATURE)) return i;
  }
  return -1;
};

const inspectZipArchive = (filePath, archiveSize) => {
  const fd = fs.openSync(filePath, 'r');
  try {
    const tailSize = Math.min(archiveSize, 65557);
    const tail = Buffer.alloc(tailSize);
    fs.readSync(fd, tail, 0, tailSize, archiveSize - tailSize);

    const eocdOffset = findEOCD(tail);
    if (eocdOffset === -1) return { safe: false, checked: true, reason: 'no_eocd_found' };

    const totalEntries = tail.readUInt16LE(eocdOffset + 10);
    const centralDirOffset = tail.readUInt32LE(eocdOffset + 16);

    if (totalEntries > MAX_ENTRIES) {
      return {
        safe: false, checked: true, reason: 'too_many_entries', totalEntries,
      };
    }

    // Read the central directory (from its offset to the EOCD) to sum each
    // entry's claimed uncompressed size vs. compressed size.
    const centralDirSize = archiveSize - centralDirOffset - (archiveSize - tailSize >= 0 ? tailSize - eocdOffset : 0);
    const readSize = Math.max(0, Math.min(centralDirSize, archiveSize - centralDirOffset));
    const centralDir = Buffer.alloc(readSize);
    fs.readSync(fd, centralDir, 0, readSize, centralDirOffset);

    let offset = 0;
    let totalUncompressed = 0;
    let totalCompressed = 0;
    let entriesRead = 0;

    while (offset + 46 <= centralDir.length && entriesRead < totalEntries) {
      if (!centralDir.slice(offset, offset + 4).equals(CENTRAL_DIR_SIGNATURE)) break;
      const compressedSize = centralDir.readUInt32LE(offset + 20);
      const uncompressedSize = centralDir.readUInt32LE(offset + 24);
      const nameLen = centralDir.readUInt16LE(offset + 28);
      const extraLen = centralDir.readUInt16LE(offset + 30);
      const commentLen = centralDir.readUInt16LE(offset + 32);

      totalCompressed += compressedSize;
      totalUncompressed += uncompressedSize;
      entriesRead += 1;
      offset += 46 + nameLen + extraLen + commentLen;
    }

    if (totalCompressed > 0 && totalUncompressed / totalCompressed > MAX_COMPRESSION_RATIO) {
      return {
        safe: false, checked: true, reason: 'compression_ratio_exceeded', totalUncompressed, totalCompressed,
      };
    }

    return {
      safe: true, checked: true, totalEntries, totalUncompressed, totalCompressed,
    };
  } finally {
    fs.closeSync(fd);
  }
};

const inspectArchive = (filePath, extension) => {
  const archiveSize = fs.statSync(filePath).size;
  const zipLikeExtensions = new Set(['.zip', '.docx', '.xlsx', '.pptx', '.odt', '.ods', '.odp']);
  if (zipLikeExtensions.has(extension)) {
    try {
      return inspectZipArchive(filePath, archiveSize);
    } catch (err) {
      return { safe: false, checked: true, reason: 'parse_error' };
    }
  }
  return { safe: true, checked: false };
};

module.exports = { inspectArchive };
