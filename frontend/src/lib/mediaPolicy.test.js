import { describe, it, expect } from 'vitest';
import { categorizeFile, getMaxSize, validateFile } from './mediaPolicy';

const makeFile = (name, size = 100) => new File([new Uint8Array(size)], name);

describe('categorizeFile', () => {
  it.each([
    ['photo.jpg', 'image'], ['photo.png', 'image'], ['photo.webp', 'image'], ['photo.gif', 'image'],
    ['clip.mp4', 'video'], ['clip.webm', 'video'], ['clip.mov', 'video'],
    ['song.mp3', 'audio'], ['song.wav', 'audio'], ['song.m4a', 'audio'], ['song.ogg', 'audio'],
    ['doc.pdf', 'pdf'],
    ['report.docx', 'document'], ['sheet.xlsx', 'document'], ['data.csv', 'document'],
    ['slides.pptx', 'document'], ['notes.txt', 'document'],
    ['archive.zip', 'archive'], ['archive.7z', 'archive'], ['archive.rar', 'archive'],
    ['data.json', 'text'], ['page.html', 'text'], ['script.js', 'text'],
  ])('categorizes %s as %s', (name, expected) => {
    expect(categorizeFile(makeFile(name))).toBe(expected);
  });

  it.each(['.exe', '.dll', '.bat', '.ps1', '.sh', '.msi'])('blocks %s', (ext) => {
    expect(categorizeFile(makeFile(`file${ext}`))).toBeNull();
  });

  it('returns null for an unrecognized extension', () => {
    expect(categorizeFile(makeFile('file.xyz123'))).toBeNull();
  });
});

describe('getMaxSize', () => {
  it('matches the documented per-category limits', () => {
    expect(getMaxSize('image')).toBe(10 * 1024 * 1024);
    expect(getMaxSize('video')).toBe(50 * 1024 * 1024);
    expect(getMaxSize('audio')).toBe(25 * 1024 * 1024);
    expect(getMaxSize('pdf')).toBe(25 * 1024 * 1024);
    expect(getMaxSize('document')).toBe(25 * 1024 * 1024);
    expect(getMaxSize('archive')).toBe(25 * 1024 * 1024);
    expect(getMaxSize('text')).toBe(10 * 1024 * 1024);
  });
});

describe('validateFile', () => {
  it('accepts a valid small image', () => {
    const result = validateFile(makeFile('photo.png', 1024));
    expect(result.valid).toBe(true);
    expect(result.category).toBe('image');
  });

  it('rejects an oversized video (over 50MB)', () => {
    const bigFile = makeFile('movie.mp4', 51 * 1024 * 1024);
    const result = validateFile(bigFile);
    expect(result.valid).toBe(false);
    expect(result.category).toBe('video');
    expect(result.error).toMatch(/too large/);
  });

  it('rejects a blocked file type', () => {
    const result = validateFile(makeFile('virus.exe'));
    expect(result.valid).toBe(false);
    expect(result.category).toBeNull();
    expect(result.error).toMatch(/unsupported/);
  });
});
