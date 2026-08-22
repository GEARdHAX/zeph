// Lightweight, dependency-free parser for the Bio field's custom formatting
// syntax. Converts a raw string into an array of typed, safe tokens (never
// HTML) — the caller renders each token as a plain React element, so there
// is no dangerouslySetInnerHTML anywhere in this pipeline. Reused for both
// the live edit-preview and the final profile display (same parser, same
// tokens, so preview never lies about what will actually render).
//
// Supported syntax (in matching-precedence order, see PATTERNS below):
//   **bold**            -> { type: 'bold', children }
//   __underline__       -> { type: 'underline', children }
//   ~~strikethrough~~    -> { type: 'strike', children }
//   ==highlight==        -> { type: 'highlight', children }
//   `inline code`        -> { type: 'code', text }            (no nested formatting inside)
//   *italic*             -> { type: 'italic', children }
//   [text](https://url)  -> { type: 'link', text, href }        (http/https only)
//   @username            -> { type: 'mention', username }
//   #hashtag             -> { type: 'hashtag', tag }
//   \n                   -> { type: 'break' }
//   anything else        -> { type: 'text', text }
//
// Design notes:
// - This is a single left-to-right scan, not a chain of sequential
//   string.replace() calls — sequential replace has no real precedence
//   (whichever regex runs first "wins" over text the next regex would also
//   have matched) and can't reliably nest. Scanning finds, at each
//   position, the EARLIEST-starting match across every pattern, and among
//   ties at the same start position, the one listed first in PATTERNS wins
//   — bold's ** is checked before italic's single *, so "**bold**" can
//   never be misread as italic-wrapping-a-lone-*.
// - Emphasis/highlight/strike/underline delimiters recurse into
//   tokenizeInline on their inner text, so "**bold *and italic***" nests
//   correctly. Code spans do NOT recurse (backtick content is verbatim,
//   matching every other inline-code convention) and must be an EXACT
//   delimiter match to avoid gobbling adjacent tokens.
// - A delimiter with no matching close (e.g. "**oops") is simply not a
//   match at all (the regex requires both delimiters) — it falls through
//   untouched and is emitted as plain text, exactly the "malformed syntax
//   degrades to normal text" behavior the spec requires. There is no
//   partial/broken output possible: either the full delimiter pair matches
//   or the raw characters pass through as-is.
// - Newlines are preserved as explicit `break` tokens rather than being
//   swallowed by the text-matching logic, so multi-line bios keep their
//   line breaks when rendered.

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Only http/https survive — this is enforced here (parse time) AND again in
// the renderer as defense in depth, never trusting a single choke point for
// something that could otherwise execute (javascript:, data:, vbscript:).
const isSafeUrl = (url) => /^https?:\/\//i.test(url.trim());

// Order matters: longer/more-specific delimiters must be listed before any
// shorter delimiter that is a prefix of them, or the shorter one would win
// ties and swallow half of the longer syntax (** would never be reachable
// if a bare * pattern were checked first at the same position).
const PATTERNS = [
  {
    type: 'code',
    // No nested-formatting recursion inside code — content is verbatim.
    regex: /`([^`\n]+)`/,
    build: (m) => ({ type: 'code', text: m[1] }),
  },
  {
    type: 'bold',
    // Inner content may contain single '*' (so nested *italic* survives)
    // but never a bare '**' run, which would otherwise let the match
    // swallow past an intended closing pair into whatever text follows.
    regex: /\*\*((?:[^*\n]|\*(?!\*))+?)\*\*/,
    build: (m) => ({ type: 'bold', children: tokenizeInline(m[1]) }),
  },
  {
    type: 'underline',
    regex: /__([^_\n]+?)__/,
    build: (m) => ({ type: 'underline', children: tokenizeInline(m[1]) }),
  },
  {
    type: 'strike',
    regex: /~~([^~\n]+?)~~/,
    build: (m) => ({ type: 'strike', children: tokenizeInline(m[1]) }),
  },
  {
    type: 'highlight',
    regex: /==([^=\n]+?)==/,
    build: (m) => ({ type: 'highlight', children: tokenizeInline(m[1]) }),
  },
  {
    type: 'link',
    // [text](url) — url may contain internal parens (e.g. a query string
    // or a deliberately-malicious "vbscript:msgbox(1)"), so this greedily
    // captures up to the LAST ')' before whitespace/newline/end rather than
    // stopping at the first — otherwise a url like "foo(1)" truncates at
    // its own internal paren and leaves a dangling ")" as separate text.
    regex: /\[([^\]\n]+)\]\((\S+)\)/,
    build: (m) => (isSafeUrl(m[2])
      ? { type: 'link', text: m[1], href: m[2].trim() }
      // Unsafe protocol (javascript:, data:, vbscript:, etc.) — degrade to
      // plain text of the whole [text](url) span rather than a dead/unsafe
      // link, matching the "malformed -> plain text" rule.
      : { type: 'text', text: m[0] }),
  },
  {
    type: 'bareLink',
    // A plain http(s):// URL with no [text](url) wrapper — same auto-link
    // behavior chat messages already had (Message.jsx's convertUrls) before
    // this parser replaced that code path, so switching to parseBio doesn't
    // regress "paste a link and it becomes clickable" for either bios or
    // messages. isSafeUrl's protocol check is redundant here (the regex
    // itself only matches http(s)://) but kept for a single source of truth
    // on what counts as a safe link across both patterns.
    regex: /\b(?:https?):\/\/[-A-Z0-9+&@#/%?=~_|!:,.;]*[-A-Z0-9+&@#/%=~_|]/i,
    build: (m) => (isSafeUrl(m[0]) ? { type: 'link', text: m[0], href: m[0] } : { type: 'text', text: m[0] }),
  },
  {
    type: 'italic',
    // Single '*' each side, NOT immediately adjacent to another '*' — the
    // negative lookaheads/behinds stop a bold pair's outer asterisks from
    // ever being reinterpreted as a nested italic pair once bold (checked
    // first, above) has already claimed them at the same starting index.
    regex: /(?<!\*)\*(?!\*)([^*\n]+?)(?<!\*)\*(?!\*)/,
    build: (m) => ({ type: 'italic', children: tokenizeInline(m[1]) }),
  },
  {
    type: 'mention',
    // 1-32 word chars, matching typical username charset (see
    // backend/src/models/User.js's username validation) — long enough to
    // never accidentally truncate a real username, short enough that a
    // stray '@' in prose (email-like text, "call me @ 5pm") mostly just
    // won't match a following run of word characters and falls to plain text.
    regex: /@(\w{1,32})/,
    build: (m) => ({ type: 'mention', username: m[1] }),
  },
  {
    type: 'hashtag',
    regex: /#(\w{1,64})/,
    build: (m) => ({ type: 'hashtag', tag: m[1] }),
  },
  {
    type: 'break',
    regex: /\n/,
    build: () => ({ type: 'break' }),
  },
];

// Finds the earliest match across every pattern starting at or after
// `fromIndex`. Ties (same start index) resolve by PATTERNS order, so a
// higher-precedence pattern (e.g. bold) wins over a lower one (italic) that
// could also match starting at the same '*'.
const findNextMatch = (text, fromIndex) => {
  let best = null;
  for (const pattern of PATTERNS) {
    const re = new RegExp(pattern.regex.source, pattern.regex.flags.includes('g') ? pattern.regex.flags : `${pattern.regex.flags}g`);
    re.lastIndex = fromIndex;
    const m = re.exec(text);
    if (m && (!best || m.index < best.match.index)) {
      best = { pattern, match: m };
    }
  }
  return best;
};

// Tokenizes a single line/segment of text (no cross-token recursion guard
// needed beyond what individual patterns already recurse into) into an
// array of typed tokens. Exported separately from parseBio so nested
// formatting (e.g. bold containing italic) can reuse the exact same logic
// for its inner text.
export const tokenizeInline = (text) => {
  const tokens = [];
  let cursor = 0;

  while (cursor < text.length) {
    const found = findNextMatch(text, cursor);

    if (!found) {
      tokens.push({ type: 'text', text: text.slice(cursor) });
      break;
    }

    const { match, pattern } = found;
    if (match.index > cursor) {
      tokens.push({ type: 'text', text: text.slice(cursor, match.index) });
    }
    tokens.push(pattern.build(match));
    cursor = match.index + match[0].length;
  }

  return tokens;
};

// Public entry point — identical to tokenizeInline today, but kept as a
// separate named export so future bio-level-only concerns (e.g. splitting
// into paragraphs) have an obvious place to live without touching the
// inline tokenizer every other formatting type recurses through.
const parseBio = (raw) => tokenizeInline(raw || '');

const HTML_ESCAPES = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};
const escapeHtml = (text) => text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

// Serializes tokens to an HTML string — used ONLY for the clipboard's
// text/html payload (Message.jsx's copy-to-clipboard), never rendered via
// dangerouslySetInnerHTML or inserted into this app's own DOM. A different
// trust boundary than BioText.jsx's React-element renderer: this HTML is
// handed to the OS clipboard as a Blob for some OTHER application to
// interpret on paste, so it still needs every text segment HTML-escaped
// (a bio/message containing a literal "<script>" must copy as the escaped
// entity, not as live markup, even though nothing in THIS app ever parses
// it back).
export const tokensToHtml = (tokens) => tokens.map((token) => {
  switch (token.type) {
    case 'bold': return `<strong>${tokensToHtml(token.children)}</strong>`;
    case 'italic': return `<em>${tokensToHtml(token.children)}</em>`;
    case 'underline': return `<u>${tokensToHtml(token.children)}</u>`;
    case 'strike': return `<s>${tokensToHtml(token.children)}</s>`;
    case 'highlight': return `<mark>${tokensToHtml(token.children)}</mark>`;
    case 'code': return `<code>${escapeHtml(token.text)}</code>`;
    case 'link': return `<a href="${escapeHtml(token.href)}">${escapeHtml(token.text)}</a>`;
    case 'mention': return `<b>@${escapeHtml(token.username)}</b>`;
    case 'hashtag': return `<b>#${escapeHtml(token.tag)}</b>`;
    case 'break': return '<br>';
    case 'text':
    default: return escapeHtml(token.text);
  }
}).join('');

export { escapeRegex, isSafeUrl };
export default parseBio;
