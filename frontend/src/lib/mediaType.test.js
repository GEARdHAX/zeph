import { describe, it, expect } from 'vitest';
import getMediaCategory from './mediaType';

describe('getMediaCategory', () => {
  it('categorizes an image message regardless of file metadata', () => {
    expect(getMediaCategory({ type: 'image' })).toBe('image');
  });

  it('categorizes a video file by mimetype', () => {
    expect(getMediaCategory({ type: 'file', file: { type: 'video/mp4', name: 'clip.mp4' } })).toBe('video');
  });

  it('categorizes an audio file by mimetype', () => {
    expect(getMediaCategory({ type: 'file', file: { type: 'audio/mpeg', name: 'song.mp3' } })).toBe('audio');
  });

  it('categorizes a PDF by mimetype', () => {
    expect(getMediaCategory({ type: 'file', file: { type: 'application/pdf', name: 'doc.pdf' } })).toBe('pdf');
  });

  it('falls back to extension when mimetype is missing (legacy records)', () => {
    expect(getMediaCategory({ type: 'file', file: { type: '', name: 'clip.webm' } })).toBe('video');
    expect(getMediaCategory({ type: 'file', file: { type: '', name: 'song.wav' } })).toBe('audio');
    expect(getMediaCategory({ type: 'file', file: { type: '', name: 'doc.pdf' } })).toBe('pdf');
  });

  it('falls back to "file" for an unrecognized type/extension', () => {
    expect(getMediaCategory({ type: 'file', file: { type: 'application/zip', name: 'archive.zip' } })).toBe('file');
  });

  it('falls back to "file" when message.file is missing entirely', () => {
    expect(getMediaCategory({ type: 'file' })).toBe('file');
  });

  it('never throws on malformed/missing metadata', () => {
    expect(() => getMediaCategory({})).not.toThrow();
    expect(() => getMediaCategory(null)).not.toThrow();
    expect(getMediaCategory(null)).toBe('file');
  });
});
