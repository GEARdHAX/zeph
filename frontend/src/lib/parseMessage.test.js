import { describe, it, expect } from 'vitest';
import { parseMessage } from './parseMessage';

describe('parseMessage', () => {
  it('returns empty array for empty or non-string input', () => {
    expect(parseMessage('')).toEqual([]);
    expect(parseMessage(null)).toEqual([]);
    expect(parseMessage(undefined)).toEqual([]);
  });

  it('parses plain text as a paragraph block', () => {
    const blocks = parseMessage('Hello world');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('paragraph');
    expect(blocks[0].text).toBe('Hello world');
  });

  it('parses fenced code blocks with language and code content', () => {
    const input = '```javascript\nconst a = 1;\nconsole.log(a);\n```';
    const blocks = parseMessage(input);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('code_block');
    expect(blocks[0].lang).toBe('javascript');
    expect(blocks[0].code).toBe('const a = 1;\nconsole.log(a);');
    expect(blocks[0].closed).toBe(true);
  });

  it('handles unclosed fenced code blocks gracefully', () => {
    const input = '```python\nprint("unclosed")';
    const blocks = parseMessage(input);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('code_block');
    expect(blocks[0].lang).toBe('python');
    expect(blocks[0].code).toBe('print("unclosed")');
    expect(blocks[0].closed).toBe(false);
  });

  it('parses markdown headers with levels', () => {
    const input = '## Final Choice\nSome text\n### Sub-heading';
    const blocks = parseMessage(input);
    expect(blocks).toHaveLength(3);
    expect(blocks[0].type).toBe('header');
    expect(blocks[0].level).toBe(2);
    expect(blocks[0].text).toBe('Final Choice');
    expect(blocks[1].type).toBe('paragraph');
    expect(blocks[2].type).toBe('header');
    expect(blocks[2].level).toBe(3);
  });

  it('parses blockquotes', () => {
    const input = '> This is a quote\n> Second line';
    const blocks = parseMessage(input);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('quote');
    expect(blocks[0].text).toBe('This is a quote\nSecond line');
  });

  it('parses markdown tables correctly', () => {
    const input = [
      '| Feature | Status | Priority |',
      '|---|---|---|',
      '| Summarize | Active | High |',
      '| Translate | Active | Normal |',
    ].join('\n');
    const blocks = parseMessage(input);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('table');
    expect(blocks[0].headers).toEqual(['Feature', 'Status', 'Priority']);
    expect(blocks[0].rows).toEqual([
      ['Summarize', 'Active', 'High'],
      ['Translate', 'Active', 'Normal'],
    ]);
  });

  it('parses bulleted and numbered lists', () => {
    const input = '- Item 1\n- Item 2\n1. Numbered 1\n2. Numbered 2';
    const blocks = parseMessage(input);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('list');
    expect(blocks[0].items).toHaveLength(4);
    expect(blocks[0].items[0].isOrdered).toBe(false);
    expect(blocks[0].items[2].isOrdered).toBe(true);
  });

  it('parses dividers', () => {
    const input = 'Before\n---\nAfter';
    const blocks = parseMessage(input);
    expect(blocks).toHaveLength(3);
    expect(blocks[0].type).toBe('paragraph');
    expect(blocks[1].type).toBe('divider');
    expect(blocks[2].type).toBe('paragraph');
  });
});
