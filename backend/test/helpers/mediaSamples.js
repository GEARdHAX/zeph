// Minimal but REAL sample files for every extension the media policy allows, so the upload tests and the live check
// exercise the true validation (content sniffing, archive inspection, thumbnails) instead of a stub.
// Usage: const samples = await buildSamples();  samples['.png'] -> Buffer
const zlib = require('zlib');
const sharp = require('sharp');
const { MEDIA_CATEGORIES } = require('../../src/mediaPolicy');

const ascii = (text) => Buffer.from(text, 'latin1');
const pad = (head, total = 64) => Buffer.concat([head, Buffer.alloc(Math.max(0, total - head.length), 0x20)]);

const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
};

// A valid ZIP with one stored entry (also what .docx/.xlsx/.pptx/.odt/.ods/.odp are underneath).
const zip = (name = 'a.txt', content = 'hello zeph') => {
  const data = ascii(content);
  const fileName = ascii(name);
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(fileName.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(fileName.length, 28);
  const localPart = Buffer.concat([local, fileName, data]);
  const centralPart = Buffer.concat([central, fileName]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralPart.length, 12);
  end.writeUInt32LE(localPart.length, 16);
  return Buffer.concat([localPart, centralPart, end]);
};

const tar = () => {
  const block = Buffer.alloc(1024);
  ascii('a.txt').copy(block, 0);
  ascii('ustar').copy(block, 257); // POSIX tar magic lives at offset 257
  return block;
};

const isoBase = (brand) => Buffer.concat([Buffer.from([0, 0, 0, 24]), ascii('ftyp'), ascii(brand), Buffer.alloc(4), ascii(brand), Buffer.alloc(4)]);

const ebml = () => pad(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01]));

const riffWave = () => {
  const header = Buffer.alloc(44);
  ascii('RIFF').copy(header, 0);
  header.writeUInt32LE(36, 4);
  ascii('WAVEfmt ').copy(header, 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8000, 24);
  header.writeUInt32LE(16000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  ascii('data').copy(header, 36);
  return header;
};

const text = (body) => ascii(body);

const buildSamples = async () => {
  const raster = { create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 60, b: 60 } } };
  const samples = {
    '.jpg': await sharp(raster).jpeg().toBuffer(),
    '.png': await sharp(raster).png().toBuffer(),
    '.webp': await sharp(raster).webp().toBuffer(),
    '.gif': Buffer.from('47494638396101000100800000000000ffffff21f90401000000002c00000000010001000002024401003b', 'hex'),
    '.mp4': isoBase('mp42'),
    '.mov': isoBase('qt  '),
    '.webm': ebml(),
    '.weba': ebml(),
    '.m4a': isoBase('M4A '),
    '.mp3': pad(Buffer.concat([ascii('ID3'), Buffer.from([4, 0, 0, 0, 0, 0, 0])])),
    '.wav': riffWave(),
    '.aac': pad(Buffer.from([0xff, 0xf1, 0x50, 0x80, 0x00, 0x1f, 0xfc])),
    '.ogg': pad(Buffer.concat([ascii('OggS'), Buffer.from([0, 2]), Buffer.alloc(20)])),
    '.opus': pad(Buffer.concat([ascii('OggS'), Buffer.from([0, 2]), Buffer.alloc(20), ascii('OpusHead')])),
    '.pdf': ascii('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n'),
    '.zip': zip(),
    '.7z': pad(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0x00, 0x04])),
    '.rar': pad(Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00])),
    '.tar': tar(),
    '.gz': zlib.gzipSync(ascii('hello zeph')),
  };
  samples['.jpeg'] = samples['.jpg'];
  // Office Open XML and OpenDocument files are zip containers.
  ['.docx', '.xlsx', '.pptx', '.odt', '.ods', '.odp'].forEach((ext) => {
    samples[ext] = zip('content.xml', '<x/>');
  });
  // Legacy Office files are OLE compound documents.
  ['.doc', '.xls', '.ppt'].forEach((ext) => {
    samples[ext] = pad(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  });
  samples['.txt'] = text('plain text\n');
  samples['.csv'] = text('a,b\n1,2\n');
  samples['.rtf'] = text('{\\rtf1\\ansi hello}');
  // Text/source files: any non-executable text.
  MEDIA_CATEGORIES.text.extensions.forEach((ext) => {
    samples[ext] = text(`sample for ${ext}\n`);
  });

  const missing = Object.values(MEDIA_CATEGORIES)
    .flatMap((def) => def.extensions)
    .filter((ext) => !samples[ext]);
  if (missing.length) throw new Error(`mediaSamples is missing a sample for: ${missing.join(', ')}`);
  return samples;
};

// A Windows executable header: never acceptable under any allowed extension.
const EXE_BYTES = Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]), Buffer.alloc(120)]);

// Extra real-world variants that the sniffer used to reject.
const VARIANTS = {
  'mp3 frame sync without ID3 (FF F3)': { ext: '.mp3', bytes: () => pad(Buffer.from([0xff, 0xf3, 0x90, 0x00])) },
  'mp3 frame sync without ID3 (FF FB)': { ext: '.mp3', bytes: () => pad(Buffer.from([0xff, 0xfb, 0x90, 0x00])) },
  'aac in ADTS (FF F9)': { ext: '.aac', bytes: () => pad(Buffer.from([0xff, 0xf9, 0x50, 0x80])) },
  'm4a with the M4A brand': { ext: '.m4a', bytes: () => isoBase('M4A ') },
  'm4a with the isom brand': { ext: '.m4a', bytes: () => isoBase('isom') },
  'tar (ustar magic at offset 257)': { ext: '.tar', bytes: tar },
  'audio-only webm (.weba)': { ext: '.weba', bytes: ebml },
};

module.exports = { buildSamples, EXE_BYTES, VARIANTS, zip, ebml, tar, isoBase };
