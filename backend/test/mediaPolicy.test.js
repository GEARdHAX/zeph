const mediaPolicy = require('../src/mediaPolicy');

describe('mediaPolicy.categorizeFile', () => {
  it.each([
    ['.jpg', 'image'], ['.jpeg', 'image'], ['.png', 'image'], ['.webp', 'image'], ['.gif', 'image'],
    ['.mp4', 'video'], ['.webm', 'video'], ['.mov', 'video'],
    ['.mp3', 'audio'], ['.wav', 'audio'], ['.m4a', 'audio'], ['.ogg', 'audio'],
    ['.pdf', 'pdf'],
    ['.doc', 'document'], ['.docx', 'document'], ['.xls', 'document'], ['.xlsx', 'document'],
    ['.csv', 'document'], ['.ppt', 'document'], ['.pptx', 'document'], ['.txt', 'document'],
    ['.rtf', 'document'], ['.odt', 'document'], ['.ods', 'document'], ['.odp', 'document'],
    ['.zip', 'archive'], ['.7z', 'archive'], ['.rar', 'archive'], ['.tar', 'archive'], ['.gz', 'archive'],
    ['.json', 'text'], ['.html', 'text'], ['.js', 'text'], ['.py', 'text'], ['.md', 'text'],
  ])('categorizes %s as %s', (ext, expected) => {
    expect(mediaPolicy.categorizeFile(ext)).toBe(expected);
  });

  it.each([
    '.exe', '.dll', '.bat', '.cmd', '.ps1', '.sh', '.msi', '.com', '.scr', '.jar', '.vbs', '.app',
  ])('blocks %s regardless of case', (ext) => {
    expect(mediaPolicy.categorizeFile(ext)).toBeNull();
    expect(mediaPolicy.categorizeFile(ext.toUpperCase())).toBeNull();
  });

  it('returns null for an unrecognized extension', () => {
    expect(mediaPolicy.categorizeFile('.xyz123')).toBeNull();
  });

  it('is case-insensitive for recognized extensions', () => {
    expect(mediaPolicy.categorizeFile('.PNG')).toBe('image');
    expect(mediaPolicy.categorizeFile('.MP4')).toBe('video');
  });
});

describe('mediaPolicy.getMaxSize', () => {
  it('returns the documented limit per category', () => {
    expect(mediaPolicy.getMaxSize('image')).toBe(10 * 1024 * 1024);
    expect(mediaPolicy.getMaxSize('video')).toBe(50 * 1024 * 1024);
    expect(mediaPolicy.getMaxSize('audio')).toBe(25 * 1024 * 1024);
    expect(mediaPolicy.getMaxSize('pdf')).toBe(25 * 1024 * 1024);
    expect(mediaPolicy.getMaxSize('document')).toBe(25 * 1024 * 1024);
    expect(mediaPolicy.getMaxSize('archive')).toBe(25 * 1024 * 1024);
    expect(mediaPolicy.getMaxSize('text')).toBe(10 * 1024 * 1024);
  });

  it('returns 0 for an unknown category', () => {
    expect(mediaPolicy.getMaxSize('not-a-category')).toBe(0);
  });
});

describe('mediaPolicy.getSecurityLevel', () => {
  it('marks image/video/audio/pdf as SAFE_PREVIEW', () => {
    expect(mediaPolicy.getSecurityLevel('image')).toBe('SAFE_PREVIEW');
    expect(mediaPolicy.getSecurityLevel('video')).toBe('SAFE_PREVIEW');
    expect(mediaPolicy.getSecurityLevel('audio')).toBe('SAFE_PREVIEW');
    expect(mediaPolicy.getSecurityLevel('pdf')).toBe('SAFE_PREVIEW');
  });

  it('marks document/archive/text as DOWNLOAD_ONLY', () => {
    expect(mediaPolicy.getSecurityLevel('document')).toBe('DOWNLOAD_ONLY');
    expect(mediaPolicy.getSecurityLevel('archive')).toBe('DOWNLOAD_ONLY');
    expect(mediaPolicy.getSecurityLevel('text')).toBe('DOWNLOAD_ONLY');
  });

  it('defaults to BLOCKED for an unknown category', () => {
    expect(mediaPolicy.getSecurityLevel('not-a-category')).toBe('BLOCKED');
  });
});
