import { useState } from 'react';
import {
  describe, it, expect, vi,
} from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RichMessageInput from './RichMessageInput';

function Controlled({ initial = '', onChangeSpy }) {
  return function Wrapper() {
    const [value, setValue] = useState(initial);
    return (
      <RichMessageInput
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          onChangeSpy?.(e.target.value);
        }}
        placeholder="Type something to send..."
      />
    );
  };
}

describe('RichMessageInput', () => {
  it('renders a contentEditable textbox with the placeholder as its accessible name', () => {
    render(<RichMessageInput value="" onChange={() => {}} placeholder="Type something to send..." />);
    const box = screen.getByRole('textbox', { name: 'Type something to send...' });
    expect(box).toHaveAttribute('contenteditable', 'true');
  });

  it('live-styles **bold** as a real <strong> element while typing — the ** markers still render too (dimmed), never stripped from the DOM', async () => {
    const user = userEvent.setup();
    const Wrapper = Controlled({});
    render(<Wrapper />);
    const box = screen.getByRole('textbox', { name: 'Type something to send...' });

    await user.type(box, '**hi**');

    // Full raw source (markers included) is preserved as real DOM text —
    // this is the actual invariant that matters: root.textContent must
    // always equal the plain-text value exactly, or editing near/inside a
    // styled span permanently drops characters (the reported bug).
    expect(box.textContent).toBe('**hi**');
    expect(box.querySelector('strong')?.textContent).toBe('**hi**');
  });

  it('live-styles *italic* as a real <em> element while typing — the * markers still render too (dimmed)', async () => {
    const user = userEvent.setup();
    const Wrapper = Controlled({});
    render(<Wrapper />);
    const box = screen.getByRole('textbox', { name: 'Type something to send...' });

    await user.type(box, '*hi*');

    expect(box.textContent).toBe('*hi*');
    expect(box.querySelector('em')?.textContent).toBe('*hi*');
  });

  it('calls onChange with the plain-text content (markers included), not styled HTML', async () => {
    const onChangeSpy = vi.fn();
    const user = userEvent.setup();
    const Wrapper = Controlled({ onChangeSpy });
    render(<Wrapper />);
    const box = screen.getByRole('textbox', { name: 'Type something to send...' });

    await user.type(box, '**x**');

    expect(onChangeSpy).toHaveBeenLastCalledWith('**x**');
  });

  it('clears the rendered DOM when the controlling value is externally reset to empty (e.g. after send)', () => {
    const { rerender } = render(
      <RichMessageInput value="**hi**" onChange={() => {}} placeholder="Type something to send..." />,
    );
    const box = screen.getByRole('textbox', { name: 'Type something to send...' });
    expect(box.textContent).toBe('**hi**');

    rerender(<RichMessageInput value="" onChange={() => {}} placeholder="Type something to send..." />);
    expect(box.textContent).toBe('');
  });

  it('leaves unclosed/malformed syntax as plain visible text, not broken output', () => {
    render(<RichMessageInput value="**oops" onChange={() => {}} placeholder="Type something to send..." />);
    const box = screen.getByRole('textbox', { name: 'Type something to send...' });
    expect(box.textContent).toBe('**oops');
    expect(box.querySelector('strong')).not.toBeInTheDocument();
  });

  // Places the caret at a plain-text character offset by walking the
  // element's text nodes, mirroring exactly what the component's own
  // setCaretOffset does — this is the standard way to position a caret at
  // an arbitrary point for a test, since real character offsets are
  // structure-independent (unlike raw (node, childIndex) coordinates,
  // which is exactly what the fixed bug was about getting wrong).
  const placeCaretAt = (root, targetOffset) => {
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
  };

  it('inserts a typed character at the boundary right after a styled span, not at the end of the whole string (regression: caret math was wrong at style-span boundaries, corrupting mid-text edits)', async () => {
    const onChangeSpy = vi.fn();
    const Wrapper = Controlled({ initial: '**bold** normal', onChangeSpy });
    render(<Wrapper />);
    const box = screen.getByRole('textbox', { name: 'Type something to send...' });

    box.focus();
    // "**bold**" is 8 characters — caret right after the closing ** and
    // before the space, exactly at the boundary between the styled span
    // and the following plain text.
    placeCaretAt(box, 8);

    const user = userEvent.setup();
    await user.keyboard('X');

    expect(onChangeSpy).toHaveBeenLastCalledWith('**bold**X normal');
  });

  it('inserts a typed character in the middle of plain text between two styled spans without corrupting either span or its markers', async () => {
    const onChangeSpy = vi.fn();
    const Wrapper = Controlled({ initial: '**a** middle **b**', onChangeSpy });
    render(<Wrapper />);
    const box = screen.getByRole('textbox', { name: 'Type something to send...' });

    box.focus();
    // "**a** mid|dle **b**" — caret after "mid", inside the plain-text
    // run between the two styled spans.
    placeCaretAt(box, '**a** mid'.length);

    const user = userEvent.setup();
    await user.keyboard('X');

    expect(onChangeSpy).toHaveBeenLastCalledWith('**a** midXdle **b**');
  });

  it('forces plain-text paste, ignoring any HTML on the clipboard', async () => {
    const onChangeSpy = vi.fn();
    const Wrapper = Controlled({ onChangeSpy });
    render(<Wrapper />);
    const box = screen.getByRole('textbox', { name: 'Type something to send...' });
    box.focus();

    document.execCommand = vi.fn((command, showUi, value) => {
      if (command === 'insertText') box.textContent += value;
      return true;
    });

    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true });
    pasteEvent.clipboardData = {
      getData: (type) => (type === 'text/plain' ? 'pasted text' : '<b>pasted text</b>'),
    };
    box.dispatchEvent(pasteEvent);

    expect(document.execCommand).toHaveBeenCalledWith('insertText', false, 'pasted text');
  });
});
