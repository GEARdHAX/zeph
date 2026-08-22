import { useLayoutEffect, useRef } from 'react';
import parseBio from '../../../lib/parseBio';

// A plain <input>/<textarea> cannot render mixed inline styles (bold
// segments, colors) inside typed text at all — that's a browser DOM
// limitation, not a React one. This is a contentEditable div styled to
// look like the old <input>, live-parsing the same **bold**/*italic*/etc.
// syntax the message bubble and Bio already use (parseBio.js) and
// re-rendering matched spans with real inline styling AS the user types,
// instead of only showing formatting after the message is sent.
//
// Controlled-component contract deliberately mirrors a plain <input>
// (`value`, `onChange(syntheticEvent)`, `onKeyDown`) so BottomBar.jsx's
// existing text state / send / emoji-insert / draft-reply logic needs
// zero changes — this is a drop-in replacement for the <input> element
// only, not a rewrite of the surrounding send flow.
//
// React explicitly does not manage children of a contentEditable element
// (it warns "Using contentEditable and React with children is not
// supported" for exactly this reason: the browser mutates that DOM subtree
// directly on every keystroke, outside React's own diffing, so React's
// virtual-DOM comparison against it is unreliable). So this component
// renders NO children through JSX at all — it manually builds and
// replaces the real DOM node's children in a layout effect instead,
// keyed only on `value`, which is the one thing both React and this
// component agree is the source of truth.

// Delimiter characters render too (as dimmed, de-emphasized text), never
// stripped — this is the whole point of this file's approach. If the
// rendered DOM only ever showed the STYLED result ("bold" instead of
// "**bold**"), root.textContent could never reconstruct the original raw
// source once a span was fully styled: the ** markers would already be
// gone from the DOM, permanently, the moment the pattern first completed.
// Editing at or near that point (backspace, typing mid-span) would then
// silently and irreversibly drop the markers from the message — exactly
// the "mix of styles with normal text... backspaces" bug this fixes.
// Keeping every character of the source always present (just visually
// muted for the syntax noise) makes root.textContent === value a real
// invariant, not something that only holds for never-yet-styled text.
const DIM = 'text-muted-foreground/50';

const wrapWithDelimiter = (tag, open, close, children, extraClass) => {
  const el = document.createElement(tag);
  if (extraClass) el.className = extraClass;
  const openSpan = document.createElement('span');
  openSpan.className = DIM;
  openSpan.textContent = open;
  el.appendChild(openSpan);
  appendTokens(el, children);
  const closeSpan = document.createElement('span');
  closeSpan.className = DIM;
  closeSpan.textContent = close;
  el.appendChild(closeSpan);
  return el;
};

const styledElementFor = (token) => {
  switch (token.type) {
    case 'bold':
      return wrapWithDelimiter('strong', '**', '**', token.children);
    case 'italic':
      return wrapWithDelimiter('em', '*', '*', token.children);
    case 'underline':
      return wrapWithDelimiter('u', '__', '__', token.children);
    case 'strike':
      return wrapWithDelimiter('s', '~~', '~~', token.children);
    case 'highlight':
      return wrapWithDelimiter('mark', '==', '==', token.children, 'rounded bg-yellow-200 px-0.5 text-inherit dark:bg-yellow-500/30');
    case 'code': {
      const el = document.createElement('span');
      const openSpan = document.createElement('span');
      openSpan.className = DIM;
      openSpan.textContent = '`';
      const codeSpan = document.createElement('code');
      codeSpan.className = 'rounded bg-black/10 px-1 font-mono text-[0.95em] dark:bg-white/10';
      codeSpan.textContent = token.text;
      const closeSpan = document.createElement('span');
      closeSpan.className = DIM;
      closeSpan.textContent = '`';
      el.append(openSpan, codeSpan, closeSpan);
      return el;
    }
    case 'link': {
      // token.href === token.text for a bare auto-linked URL (parseBio's
      // bareLink pattern) — raw source is just the URL itself, no [](
      // wrapper to reconstruct.
      if (token.href === token.text) {
        const el = document.createElement('span');
        el.className = 'text-primary underline';
        el.textContent = token.text;
        return el;
      }
      const el = document.createElement('span');
      const openBracket = document.createElement('span');
      openBracket.className = DIM;
      openBracket.textContent = '[';
      const linkText = document.createElement('span');
      linkText.className = 'text-primary underline';
      linkText.textContent = token.text;
      const middle = document.createElement('span');
      middle.className = DIM;
      middle.textContent = `](${token.href})`;
      el.append(openBracket, linkText, middle);
      return el;
    }
    case 'mention': {
      const el = document.createElement('span');
      el.className = 'font-medium text-primary';
      el.textContent = `@${token.username}`;
      return el;
    }
    case 'hashtag': {
      const el = document.createElement('span');
      el.className = 'font-medium text-primary';
      el.textContent = `#${token.tag}`;
      return el;
    }
    case 'break':
      return document.createElement('br');
    case 'text':
    default:
      return document.createTextNode(token.text);
  }
};

function appendTokens(parent, tokens) {
  tokens.forEach((token) => parent.appendChild(styledElementFor(token)));
}

// Walks the contentEditable's text nodes in document order, summing
// lengths, to convert a (node, offset) Selection range into a single
// plain-text character offset — and the reverse, to restore one after the
// DOM is rebuilt from fresh tokens (every keystroke rebuilds the styled
// nodes from scratch here, destroying the browser's own cursor position,
// which must be explicitly restored or the caret would jump to the start
// on every character typed).
const getCaretOffset = (root) => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer)) return null;

  // Building a Range from the start of `root` to the actual caret position
  // and reading its stringified length sidesteps every node-type edge case
  // a manual walk has to special-case by hand (startContainer can be a
  // text node in the common case, but is an ELEMENT node — with
  // startOffset counted in CHILD INDICES, not characters — whenever the
  // caret sits at a boundary between elements: start/end of the field,
  // right at the edge of a <strong>/<em> span, or an empty field).
  // Range.toString() already correctly handles both node types and
  // concatenates the visible text in between, which is exactly the plain-
  // text offset this needs. This replaces an earlier hand-rolled TreeWalker
  // version that mishandled the element-boundary case entirely, silently
  // collapsing every such caret position to "end of text" — the root
  // cause of the reported "cursor jumps out of the middle" bug.
  const preCaretRange = document.createRange();
  preCaretRange.selectNodeContents(root);
  preCaretRange.setEnd(range.startContainer, range.startOffset);
  return preCaretRange.toString().length;
};

const setCaretOffset = (root, targetOffset) => {
  if (targetOffset === null) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let node = walker.nextNode();
  while (node) {
    const nextOffset = offset + node.textContent.length;
    if (targetOffset <= nextOffset) {
      const range = document.createRange();
      range.setStart(node, targetOffset - offset);
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    offset = nextOffset;
    node = walker.nextNode();
  }
  // Target offset is past the end of all text (e.g. text was appended
  // externally, like the emoji picker) — place the caret at the very end.
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
};

function RichMessageInput({
  value, onChange, onKeyDown, onFocus, placeholder, className,
}) {
  const rootRef = useRef(null);
  const caretOffsetRef = useRef(null);

  // Rebuilds the real DOM directly from `value` on EVERY value change —
  // see the file-level comment for why this can't go through JSX children.
  // This includes changes caused by this element's own typing: applying
  // the live styling *is* the point, so every keystroke really does need a
  // full rebuild (there's no cheaper "just style this one new character"
  // path once bold/italic spans can grow, merge, or split at any position).
  // caretOffsetRef carries the position captured in handleInput just
  // before onChange, so typing doesn't reset the cursor to the start on
  // every character — an external value change (cleared on send, emoji
  // appended) has no captured offset and falls through to
  // setCaretOffset's own end-of-text placement instead.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const offset = caretOffsetRef.current;
    caretOffsetRef.current = null;

    root.textContent = '';
    appendTokens(root, parseBio(value));

    if (document.activeElement === root) setCaretOffset(root, offset);
  }, [value]);

  const handleInput = () => {
    const root = rootRef.current;
    if (!root) return;
    caretOffsetRef.current = getCaretOffset(root);
    onChange({ target: { value: root.textContent || '' } });
  };

  // Force plain-text paste — pasting rich content (from a webpage, a
  // formatted doc) must not inject foreign HTML/styling into the
  // composer; only the app's own **bold**/etc. syntax should ever drive
  // styling here, typed or pasted as plain characters.
  const handlePaste = (e) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  };

  return (
    <div
      ref={rootRef}
      role="textbox"
      tabIndex={0}
      aria-label={placeholder}
      aria-multiline="false"
      contentEditable
      suppressContentEditableWarning
      onInput={handleInput}
      onPaste={handlePaste}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      data-placeholder={placeholder}
      className={`${className} empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground`}
    />
  );
}

export default RichMessageInput;
