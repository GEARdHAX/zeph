const fs = require('fs');
const os = require('os');
const path = require('path');
const { sniffCategory, isConsistentWithCategory } = require('../src/utils/sniffFileCategory');

const tmpFile = (bytes) => {
  const filePath = path.join(os.tmpdir(), `sniff-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.writeFileSync(filePath, Buffer.from(bytes));
  return filePath;
};

describe('sniffCategory', () => {
  it('recognizes a JPEG header', () => {
    const filePath = tmpFile([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
    expect(sniffCategory(filePath)).toBe('image');
    fs.unlinkSync(filePath);
  });

  it('recognizes a PNG header', () => {
    const filePath = tmpFile([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(sniffCategory(filePath)).toBe('image');
    fs.unlinkSync(filePath);
  });

  it('recognizes a PDF header', () => {
    const filePath = tmpFile(Buffer.from('%PDF-1.4\n'));
    expect(sniffCategory(filePath)).toBe('pdf');
    fs.unlinkSync(filePath);
  });

  it('recognizes a ZIP header', () => {
    const filePath = tmpFile([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
    expect(sniffCategory(filePath)).toBe('archive');
    fs.unlinkSync(filePath);
  });

  it('returns null for an unrecognized header', () => {
    const filePath = tmpFile([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(sniffCategory(filePath)).toBeNull();
    fs.unlinkSync(filePath);
  });
});

describe('isConsistentWithCategory — renamed-executable / MIME-mismatch defense', () => {
  it('rejects an .exe (MZ header) renamed to claim any category', () => {
    const filePath = tmpFile([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]);
    expect(isConsistentWithCategory(filePath, 'image')).toBe(false);
    expect(isConsistentWithCategory(filePath, 'document')).toBe(false);
    expect(isConsistentWithCategory(filePath, 'text')).toBe(false);
    fs.unlinkSync(filePath);
  });

  it('rejects a PNG-signatured file claiming to be a video', () => {
    const filePath = tmpFile([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(isConsistentWithCategory(filePath, 'video')).toBe(false);
    fs.unlinkSync(filePath);
  });

  it('accepts a real JPEG claiming to be an image', () => {
    const filePath = tmpFile([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
    expect(isConsistentWithCategory(filePath, 'image')).toBe(true);
    fs.unlinkSync(filePath);
  });

  it('accepts plain text with no magic number for the text category', () => {
    const filePath = tmpFile(Buffer.from('{"hello":"world"}'));
    expect(isConsistentWithCategory(filePath, 'text')).toBe(true);
    fs.unlinkSync(filePath);
  });

  it('accepts plain text with no magic number for the document category', () => {
    const filePath = tmpFile(Buffer.from('just a plain text file'));
    expect(isConsistentWithCategory(filePath, 'document')).toBe(true);
    fs.unlinkSync(filePath);
  });

  it('rejects unrecognized-header content for a SAFE_PREVIEW category (image/video/audio/pdf)', () => {
    const filePath = tmpFile(Buffer.from('just a plain text file'));
    expect(isConsistentWithCategory(filePath, 'image')).toBe(false);
    fs.unlinkSync(filePath);
  });

  it('accepts a docx (zip-signatured) claiming to be a document', () => {
    const filePath = tmpFile([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
    expect(isConsistentWithCategory(filePath, 'document')).toBe(true);
    fs.unlinkSync(filePath);
  });
});
