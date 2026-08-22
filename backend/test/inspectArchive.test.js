const fs = require('fs');
const os = require('os');
const path = require('path');
const { inspectArchive } = require('../src/utils/inspectArchive');

// Hand-builds a minimal, valid (uncompressed/"stored") ZIP with a single
// entry, so the archive-bomb heuristic can be tested against a real ZIP
// structure without pulling in a zip-authoring dependency.
const buildZip = ({ entries }) => {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  entries.forEach(({ name, uncompressedSize, compressedSize }) => {
    const nameBuf = Buffer.from(name);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // local file header signature
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0, 6); // flags
    localHeader.writeUInt16LE(0, 8); // compression method (0 = stored)
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0, 12); // mod date
    localHeader.writeUInt32LE(0, 14); // crc32 (unchecked by our inspector)
    localHeader.writeUInt32LE(compressedSize, 18);
    localHeader.writeUInt32LE(uncompressedSize, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra field length

    const data = Buffer.alloc(compressedSize, 0x41); // filler bytes, content irrelevant
    const localEntry = Buffer.concat([localHeader, nameBuf, data]);
    localParts.push(localEntry);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0); // central directory signature
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0, 8); // flags
    centralHeader.writeUInt16LE(0, 10); // compression method
    centralHeader.writeUInt16LE(0, 12); // mod time
    centralHeader.writeUInt16LE(0, 14); // mod date
    centralHeader.writeUInt32LE(0, 16); // crc32
    centralHeader.writeUInt32LE(compressedSize, 20);
    centralHeader.writeUInt32LE(uncompressedSize, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra field length
    centralHeader.writeUInt16LE(0, 32); // comment length
    centralHeader.writeUInt16LE(0, 34); // disk number
    centralHeader.writeUInt16LE(0, 36); // internal attrs
    centralHeader.writeUInt32LE(0, 38); // external attrs
    centralHeader.writeUInt32LE(offset, 42); // relative offset of local header

    centralParts.push(Buffer.concat([centralHeader, nameBuf]));
    offset += localEntry.length;
  });

  const localSection = Buffer.concat(localParts);
  const centralSection = Buffer.concat(centralParts);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSection.length, 12);
  eocd.writeUInt32LE(localSection.length, 16); // central dir offset = end of local section
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([localSection, centralSection, eocd]);
};

const tmpZip = (buffer) => {
  const filePath = path.join(os.tmpdir(), `archive-test-${Date.now()}-${Math.random().toString(36).slice(2)}.zip`);
  fs.writeFileSync(filePath, buffer);
  return filePath;
};

describe('inspectArchive', () => {
  it('accepts a normal small zip with a reasonable compression ratio', () => {
    const zip = buildZip({ entries: [{ name: 'hello.txt', uncompressedSize: 100, compressedSize: 100 }] });
    const filePath = tmpZip(zip);
    const result = inspectArchive(filePath, '.zip');
    expect(result.safe).toBe(true);
    expect(result.checked).toBe(true);
    expect(result.totalEntries).toBe(1);
    fs.unlinkSync(filePath);
  });

  it('rejects a zip with an absurd compression ratio (decompression-bomb heuristic)', () => {
    // 1MB claimed uncompressed from ~1KB "compressed" — ratio far past the threshold.
    const zip = buildZip({ entries: [{ name: 'bomb.bin', uncompressedSize: 100 * 1024 * 1024, compressedSize: 100 }] });
    const filePath = tmpZip(zip);
    const result = inspectArchive(filePath, '.zip');
    expect(result.safe).toBe(false);
    expect(result.reason).toBe('compression_ratio_exceeded');
    fs.unlinkSync(filePath);
  });

  it('rejects a zip with an excessive entry count', () => {
    const entries = Array.from({ length: 2500 }, (_, i) => ({
      name: `f${i}.txt`, uncompressedSize: 1, compressedSize: 1,
    }));
    const zip = buildZip({ entries });
    const filePath = tmpZip(zip);
    const result = inspectArchive(filePath, '.zip');
    expect(result.safe).toBe(false);
    expect(result.reason).toBe('too_many_entries');
    fs.unlinkSync(filePath);
  });

  it('skips structural inspection for non-zip archive formats (.rar/.7z/.tar/.gz)', () => {
    const filePath = path.join(os.tmpdir(), `not-a-real-rar-${Date.now()}.rar`);
    fs.writeFileSync(filePath, Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]));
    const result = inspectArchive(filePath, '.rar');
    expect(result.safe).toBe(true);
    expect(result.checked).toBe(false);
    fs.unlinkSync(filePath);
  });

  it('rejects a corrupt/malformed zip (no valid EOCD)', () => {
    const filePath = tmpZip(Buffer.from([1, 2, 3, 4, 5]));
    const result = inspectArchive(filePath, '.zip');
    expect(result.safe).toBe(false);
    fs.unlinkSync(filePath);
  });

  it('treats a docx/xlsx/pptx (zip-container document) with the same structural check', () => {
    const zip = buildZip({ entries: [{ name: 'word/document.xml', uncompressedSize: 500, compressedSize: 300 }] });
    const filePath = tmpZip(zip);
    // Renamed to .docx to exercise the document-category zip-like path.
    const docxPath = filePath.replace('.zip', '.docx');
    fs.renameSync(filePath, docxPath);
    const result = inspectArchive(docxPath, '.docx');
    expect(result.safe).toBe(true);
    expect(result.checked).toBe(true);
    fs.unlinkSync(docxPath);
  });
});
