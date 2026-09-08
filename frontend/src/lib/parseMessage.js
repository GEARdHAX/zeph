// This is a line-scanning parser — `continue` to advance to the next line is
// the clearest control flow here; rewriting each as nested if/else would only
// obscure it.
/* eslint-disable no-continue */
import { tokenizeInline } from './parseBio';

/**
 * Parses markdown-style chat messages into structured blocks:
 * - code_block: ```lang\n...```
 * - table: | Col 1 | Col 2 |\n|---|---|\n| Val 1 | Val 2 |
 * - header: #, ##, ###, ####
 * - list: unordered (*, -) or ordered (1., 2.)
 * - quote: > blockquote
 * - divider: --- or ***
 * - paragraph: general text with inline formatting tokens
 *
 * All text rendering avoids dangerouslySetInnerHTML.
 */

// Helper to determine if a line looks like a markdown table separator (e.g., |:---:|---|)
const isTableSeparator = (line) => {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return false;
  const cells = trimmed.slice(1, -1).split('|');
  return cells.length > 0 && cells.every((c) => /^[\s:-]+$/.test(c) && c.includes('-'));
};

// Helper to parse pipe-separated table row into trimmed cell strings
const parseTableRow = (line) => {
  const trimmed = line.trim();
  const inner = trimmed.startsWith('|') && trimmed.endsWith('|') ? trimmed.slice(1, -1) : trimmed;
  return inner.split('|').map((cell) => cell.trim());
};

export function parseMessage(text) {
  if (!text || typeof text !== 'string') return [];

  const blocks = [];
  const lines = text.split(/\r?\n/);
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // 1. Fenced Code Blocks (```)
    if (trimmed.startsWith('```')) {
      const lang = trimmed.slice(3).trim();
      const codeLines = [];
      i += 1;
      let closed = false;
      while (i < lines.length) {
        if (lines[i].trim().startsWith('```')) {
          closed = true;
          i += 1;
          break;
        }
        codeLines.push(lines[i]);
        i += 1;
      }
      blocks.push({
        type: 'code_block',
        lang: lang || 'text',
        code: codeLines.join('\n'),
        closed,
      });
      continue;
    }

    // 2. Horizontal Divider (--- or *** or ___ alone on line)
    if (/^(?:[-*_]\s*){3,}$/.test(trimmed)) {
      blocks.push({ type: 'divider' });
      i += 1;
      continue;
    }

    // 3. Markdown Headers (# Header)
    const headerMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      const title = headerMatch[2];
      blocks.push({
        type: 'header',
        level,
        text: title,
        tokens: tokenizeInline(title),
      });
      i += 1;
      continue;
    }

    // 4. Blockquotes (> quote)
    if (trimmed.startsWith('>')) {
      const quoteLines = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      const quoteText = quoteLines.join('\n');
      blocks.push({
        type: 'quote',
        text: quoteText,
        tokens: tokenizeInline(quoteText),
      });
      continue;
    }

    // 5. Markdown Tables (| header | ... |\n|---|---|\n| cell |)
    if (trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.includes('|')) {
      const tableLines = [line];
      let j = i + 1;
      while (j < lines.length && lines[j].trim().startsWith('|') && lines[j].trim().endsWith('|')) {
        tableLines.push(lines[j]);
        j += 1;
      }

      if (tableLines.length >= 2 && (isTableSeparator(tableLines[1]) || tableLines.some(isTableSeparator))) {
        const sepIndex = tableLines.findIndex(isTableSeparator);
        const headerRow = parseTableRow(tableLines[0]);
        const bodyRows = tableLines.filter((_, idx) => idx !== 0 && idx !== sepIndex).map(parseTableRow);

        blocks.push({
          type: 'table',
          headers: headerRow,
          rows: bodyRows,
        });
        i = j;
        continue;
      }

      // ASCII box diagram or unformatted pipe block
      if (tableLines.length >= 2) {
        blocks.push({
          type: 'code_block',
          lang: 'text',
          code: tableLines.join('\n'),
          isDiagram: true,
        });
        i = j;
        continue;
      }
    }

    // 6. Lists (*, -, 1., etc.)
    const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.+)$/);
    if (listMatch) {
      const listItems = [];
      while (i < lines.length) {
        const itemMatch = lines[i].match(/^(\s*)([-*+]|\d+\.)\s+(.+)$/);
        if (!itemMatch) break;
        listItems.push({
          marker: itemMatch[2],
          isOrdered: /^\d+\./.test(itemMatch[2]),
          tokens: tokenizeInline(itemMatch[3]),
        });
        i += 1;
      }
      blocks.push({
        type: 'list',
        items: listItems,
      });
      continue;
    }

    // 7. Empty line — separator between paragraphs
    if (!trimmed) {
      i += 1;
      continue;
    }

    // 8. Normal Paragraph (gather lines until next block element or blank line)
    const paraLines = [line];
    i += 1;
    while (i < lines.length) {
      const nextLine = lines[i];
      const nextTrimmed = nextLine.trim();
      if (!nextTrimmed) break;
      if (
        nextTrimmed.startsWith('```') ||
        /^(?:[-*_]\s*){3,}$/.test(nextTrimmed) ||
        /^(#{1,4})\s+/.test(nextTrimmed) ||
        nextTrimmed.startsWith('>') ||
        (nextTrimmed.startsWith('|') && nextTrimmed.endsWith('|')) ||
        /^(\s*)([-*+]|\d+\.)\s+/.test(nextLine)
      ) {
        break;
      }
      paraLines.push(nextLine);
      i += 1;
    }

    const paraText = paraLines.join('\n');
    blocks.push({
      type: 'paragraph',
      text: paraText,
      tokens: tokenizeInline(paraText),
    });
  }

  return blocks;
}

export default parseMessage;
