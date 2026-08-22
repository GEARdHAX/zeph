import { describe, it, expect } from 'vitest';
import parseBio, { tokenizeInline, tokensToHtml } from './parseBio';

describe('parseBio — plain text', () => {
  it('returns a single text token for plain text with no formatting', () => {
    expect(parseBio('hello world')).toEqual([{ type: 'text', text: 'hello world' }]);
  });

  it('returns an empty array for an empty/undefined string', () => {
    expect(parseBio('')).toEqual([]);
    expect(parseBio(undefined)).toEqual([]);
  });

  it('preserves internal spacing exactly', () => {
    expect(parseBio('a   b')).toEqual([{ type: 'text', text: 'a   b' }]);
  });
});

describe('parseBio — bold', () => {
  it('parses **bold** into a bold token with a text child', () => {
    expect(parseBio('**bold**')).toEqual([
      { type: 'bold', children: [{ type: 'text', text: 'bold' }] },
    ]);
  });

  it('bold is never misread as italic — the outer ** is never split into two single *', () => {
    const tokens = parseBio('**bold**');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe('bold');
  });

  it('treats unclosed ** as plain text', () => {
    expect(parseBio('**oops')).toEqual([{ type: 'text', text: '**oops' }]);
  });
});

describe('parseBio — italic', () => {
  it('parses *italic* into an italic token', () => {
    expect(parseBio('*italic*')).toEqual([
      { type: 'italic', children: [{ type: 'text', text: 'italic' }] },
    ]);
  });

  it('treats unclosed * as plain text', () => {
    expect(parseBio('*oops')).toEqual([{ type: 'text', text: '*oops' }]);
  });

  it('does not confuse a single * next to a bold span', () => {
    expect(parseBio('**bold** and *italic*')).toEqual([
      { type: 'bold', children: [{ type: 'text', text: 'bold' }] },
      { type: 'text', text: ' and ' },
      { type: 'italic', children: [{ type: 'text', text: 'italic' }] },
    ]);
  });
});

describe('parseBio — underline, strikethrough, highlight', () => {
  it('parses __underline__', () => {
    expect(parseBio('__u__')).toEqual([{ type: 'underline', children: [{ type: 'text', text: 'u' }] }]);
  });

  it('parses ~~strikethrough~~', () => {
    expect(parseBio('~~s~~')).toEqual([{ type: 'strike', children: [{ type: 'text', text: 's' }] }]);
  });

  it('parses ==highlight==', () => {
    expect(parseBio('==h==')).toEqual([{ type: 'highlight', children: [{ type: 'text', text: 'h' }] }]);
  });
});

describe('parseBio — nesting', () => {
  it('parses bold containing italic', () => {
    expect(parseBio('**bold *and italic* text**')).toEqual([
      {
        type: 'bold',
        children: [
          { type: 'text', text: 'bold ' },
          { type: 'italic', children: [{ type: 'text', text: 'and italic' }] },
          { type: 'text', text: ' text' },
        ],
      },
    ]);
  });
});

describe('parseBio — inline code', () => {
  it('parses `code` verbatim, with no nested formatting inside', () => {
    expect(parseBio('`**not bold**`')).toEqual([{ type: 'code', text: '**not bold**' }]);
  });

  it('treats an unclosed backtick as plain text', () => {
    expect(parseBio('`oops')).toEqual([{ type: 'text', text: '`oops' }]);
  });
});

describe('parseBio — links', () => {
  it('parses a valid https link', () => {
    expect(parseBio('[site](https://example.com)')).toEqual([
      { type: 'link', text: 'site', href: 'https://example.com' },
    ]);
  });

  it('parses a valid http link', () => {
    expect(parseBio('[site](http://example.com)')).toEqual([
      { type: 'link', text: 'site', href: 'http://example.com' },
    ]);
  });

  it.each([
    // eslint-disable-next-line no-script-url -- test data, not an actual sink
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'ftp://example.com',
    'file:///etc/passwd',
  ])('rejects a dangerous/non-http(s) protocol (%s) and falls back to plain text', (url) => {
    const raw = `[click me](${url})`;
    expect(parseBio(raw)).toEqual([{ type: 'text', text: raw }]);
  });

  it('treats malformed link syntax (missing url parens) as plain text', () => {
    expect(parseBio('[text without url]')).toEqual([{ type: 'text', text: '[text without url]' }]);
  });

  it('auto-links a bare https URL with no [text](url) wrapper', () => {
    expect(parseBio('check out https://example.com today')).toEqual([
      { type: 'text', text: 'check out ' },
      { type: 'link', text: 'https://example.com', href: 'https://example.com' },
      { type: 'text', text: ' today' },
    ]);
  });

  it('does not auto-link a bare non-http(s) URL-like string', () => {
    expect(parseBio('see ftp://example.com')).toEqual([{ type: 'text', text: 'see ftp://example.com' }]);
  });
});

describe('parseBio — mentions and hashtags', () => {
  it('parses @username', () => {
    expect(parseBio('hi @alice!')).toEqual([
      { type: 'text', text: 'hi ' },
      { type: 'mention', username: 'alice' },
      { type: 'text', text: '!' },
    ]);
  });

  it('parses #hashtag', () => {
    expect(parseBio('love #chitcx')).toEqual([
      { type: 'text', text: 'love ' },
      { type: 'hashtag', tag: 'chitcx' },
    ]);
  });

  it('a bare @ with no following word characters is plain text', () => {
    expect(parseBio('call me @ 5pm')).toEqual([{ type: 'text', text: 'call me @ 5pm' }]);
  });
});

describe('parseBio — newlines', () => {
  it('preserves line breaks as explicit break tokens', () => {
    expect(parseBio('line one\nline two')).toEqual([
      { type: 'text', text: 'line one' },
      { type: 'break' },
      { type: 'text', text: 'line two' },
    ]);
  });
});

describe('parseBio — HTML is never interpreted as markup', () => {
  it('treats literal HTML tags as plain, visible text (no HTML execution path exists at all)', () => {
    expect(parseBio('<b>hi</b> <script>alert(1)</script>')).toEqual([
      { type: 'text', text: '<b>hi</b> <script>alert(1)</script>' },
    ]);
  });
});

describe('parseBio — precedence edge cases', () => {
  it('code spans win over bold delimiters inside them (no nested formatting in code)', () => {
    expect(parseBio('before `x**y**z` after')).toEqual([
      { type: 'text', text: 'before ' },
      { type: 'code', text: 'x**y**z' },
      { type: 'text', text: ' after' },
    ]);
  });

  it('adjacent mention and hashtag with no separating space', () => {
    expect(parseBio('@alice#tag')).toEqual([
      { type: 'mention', username: 'alice' },
      { type: 'hashtag', tag: 'tag' },
    ]);
  });

  it('three consecutive asterisks (bold/italic ambiguity) degrades predictably with no data loss, never throws', () => {
    // "***x***" — bold's ** claims the first two and last two asterisks;
    // the single extra leading '*' becomes part of bold's own text content
    // and the single trailing '*' is left over as plain text. Not the only
    // reasonable interpretation of ambiguous input, but it must be
    // deterministic, must not throw, and must not lose the 'x'.
    const tokens = parseBio('***x***');
    expect(tokens[0].type).toBe('bold');
    const rendered = JSON.stringify(tokens);
    expect(rendered).toContain('x');
  });

  it.each([
    '*a**b*',
    '**a*b**',
    '__a~~b__',
    '***nested***',
    '[a](b)[c](d)',
    '@a@b#c#d',
    '****',
    '**',
    '*',
    '[]()',
  ])('never throws and never produces an empty result for non-empty input (%s)', (raw) => {
    expect(() => parseBio(raw)).not.toThrow();
    if (raw.length > 0) {
      expect(parseBio(raw).length).toBeGreaterThan(0);
    }
  });
});

describe('tokenizeInline', () => {
  it('is the exact function parseBio delegates to for a bare string', () => {
    expect(tokenizeInline('**x**')).toEqual(parseBio('**x**'));
  });
});

describe('tokensToHtml — clipboard text/html serialization', () => {
  it('serializes bold/italic/link tokens to real HTML tags', () => {
    expect(tokensToHtml(parseBio('**bold** and [site](https://example.com)')))
      .toBe('<strong>bold</strong> and <a href="https://example.com">site</a>');
  });

  it('HTML-escapes a literal tag in plain text so it copies as inert text, not live markup', () => {
    expect(tokensToHtml(parseBio('<script>alert(1)</script>')))
      .toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes HTML-significant characters inside a link href and text too', () => {
    expect(tokensToHtml(parseBio('[a<b>](https://example.com?x=1&y=2)')))
      .toBe('<a href="https://example.com?x=1&amp;y=2">a&lt;b&gt;</a>');
  });

  it('renders a break token as <br>', () => {
    expect(tokensToHtml(parseBio('a\nb'))).toBe('a<br>b');
  });
});
