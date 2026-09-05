const { validateTextOutput, MAX_OUTPUT_CHARS } = require('../src/ai/outputValidation');

describe('validateTextOutput', () => {
  it('accepts a normal string', () => {
    const result = validateTextOutput('a reasonable summary');
    expect(result.ok).toBe(true);
    expect(result.text).toBe('a reasonable summary');
  });

  it('trims surrounding whitespace', () => {
    const result = validateTextOutput('  hello  ');
    expect(result.text).toBe('hello');
  });

  it('rejects non-string output', () => {
    expect(validateTextOutput(null).ok).toBe(false);
    expect(validateTextOutput(undefined).ok).toBe(false);
    expect(validateTextOutput({ text: 'x' }).ok).toBe(false);
  });

  it('rejects empty/whitespace-only output', () => {
    expect(validateTextOutput('').ok).toBe(false);
    expect(validateTextOutput('   ').ok).toBe(false);
  });

  it('rejects output longer than the max', () => {
    const tooLong = 'a'.repeat(MAX_OUTPUT_CHARS + 1);
    const result = validateTextOutput(tooLong);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('output_too_long');
  });

  it('accepts output exactly at the max', () => {
    const atMax = 'a'.repeat(MAX_OUTPUT_CHARS);
    expect(validateTextOutput(atMax).ok).toBe(true);
  });
});
