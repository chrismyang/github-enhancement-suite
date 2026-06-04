const INDENT_UNIT = '  ';

const WRAP_PAIRS = {
  '*': { open: '*', close: '*' },
  '_': { open: '_', close: '_' },
  '`': { open: '`', close: '`' },
  '~': { open: '~', close: '~' },
  '"': { open: '"', close: '"' },
  "'": { open: "'", close: "'" },
  '(': { open: '(', close: ')' },
  '[': { open: '[', close: ']' },
  '<': { open: '<', close: '>' },
};

function listMarker(line) {
  const m = /^( *)([-*+]|\d+[.)])( +)/.exec(line);
  if (!m) return null;
  const indent = m[1].length;
  const markerWidth = m[2].length + m[3].length;
  return { indent, markerWidth, contentCol: indent + markerWidth };
}

function precedingListContentCols(value, lineStart) {
  const cols = [];
  let end = lineStart - 1; // index of the '\n' ending the previous line, or -1 if none
  while (end >= 0) {
    const prevLineStart = value.lastIndexOf('\n', end - 1) + 1;
    const prevLine = value.slice(prevLineStart, end);
    const lm = listMarker(prevLine);
    if (!lm) break; // non-list or blank line ends the contiguous block
    cols.push(lm.contentCol);
    end = prevLineStart - 1;
  }
  return cols;
}

function nextMarker(line) {
  const m = /^ *([-*+]|(\d+)([.)]))( +)/.exec(line);
  if (!m) return null;
  if (m[2]) return (parseInt(m[2], 10) + 1) + m[3] + ' ';
  return m[1] + ' ';
}

function owningListLine(value, lineStart, indent) {
  let end = lineStart - 1; // index of the '\n' ending the previous line, or -1
  while (end >= 0) {
    const prevStart = value.lastIndexOf('\n', end - 1) + 1;
    const prevLine = value.slice(prevStart, end);
    const lm = listMarker(prevLine);
    if (lm) return lm.contentCol === indent ? prevLine : null;
    // markerless line: a deeper/equal non-blank line is a continuation -> keep scanning
    const lead = prevLine.length - prevLine.replace(/^ +/, '').length;
    if (prevLine.trim() !== '' && lead >= indent) { end = prevStart - 1; continue; }
    return null; // blank line or a shallower line ends the item's continuation block
  }
  return null;
}

// The bounds + text of the line containing `pos`. Shared by every line-aware compute.
function lineBounds(value, pos) {
  const lineStart = value.lastIndexOf('\n', pos - 1) + 1;
  let lineEnd = value.indexOf('\n', pos);
  if (lineEnd === -1) lineEnd = value.length;
  return { lineStart, lineEnd, line: value.slice(lineStart, lineEnd) };
}

// Signed indent change (in columns) to nest/un-nest a list line one level, using the
// contiguous preceding list items as the column ladder. Positive = indent, negative =
// dedent, 0 = no move (e.g. dedent already at column 0).
function listIndentDelta(value, lineStart, lm, dedent) {
  const cols = precedingListContentCols(value, lineStart);
  if (!dedent) {
    const deeper = cols.filter(c => c > lm.indent);
    const newIndent = deeper.length ? Math.min(...deeper) : lm.indent + lm.markerWidth;
    return newIndent - lm.indent;
  }
  if (lm.indent === 0) return 0;
  const shallower = cols.filter(c => c < lm.indent);
  shallower.push(0);
  return Math.max(...shallower) - lm.indent;
}

function computeSoftBreak(value, selStart, selEnd) {
  if (selStart !== selEnd) return null;
  const { line } = lineBounds(value, selStart);
  const lm = listMarker(line);
  const prefixLen = lm ? lm.contentCol : line.length - line.replace(/^ +/, '').length;
  if (prefixLen === 0) return null;
  const text = '\n' + ' '.repeat(prefixLen);
  const caret = selStart + text.length;
  return { rangeStart: selStart, rangeEnd: selStart, text, newSelStart: caret, newSelEnd: caret };
}

function computeListEnter(value, selStart, selEnd) {
  if (selStart !== selEnd) return null;
  const { lineStart, line } = lineBounds(value, selStart);
  if (listMarker(line)) return null; // marker line: GitHub's native Enter auto-continues
  const indent = line.length - line.replace(/^ +/, '').length;
  if (indent === 0) return null; // not an indented continuation
  if (line.trim() === '') return null; // empty continuation: native bare newline (exit)
  const ownerLine = owningListLine(value, lineStart, indent);
  if (!ownerLine) return null;
  const text = '\n' + ' '.repeat(listMarker(ownerLine).indent) + nextMarker(ownerLine);
  const caret = selStart + text.length;
  return { rangeStart: selStart, rangeEnd: selStart, text, newSelStart: caret, newSelEnd: caret };
}

function computePasteIndent(value, selStart, selEnd, pasted) {
  const { line } = lineBounds(value, selStart);
  const lm = listMarker(line);
  const prefixLen = lm ? lm.contentCol : line.length - line.replace(/^ +/, '').length;
  if (prefixLen === 0) return null;
  const normalized = pasted.replace(/\r\n?/g, '\n');
  if (normalized.indexOf('\n') === -1) return null;
  const text = normalized.replace(/\n/g, '\n' + ' '.repeat(prefixLen));
  const caret = selStart + text.length;
  return { rangeStart: selStart, rangeEnd: selEnd, text, newSelStart: caret, newSelEnd: caret };
}

// Tab/Shift-Tab with a collapsed caret: indent/dedent the current line.
function caretIndentEdit(value, selStart, dedent) {
  const { lineStart, line } = lineBounds(value, selStart);
  const lm = listMarker(line);

  if (lm) {
    // List item: indent/dedent the whole line by one nesting level.
    const delta = listIndentDelta(value, lineStart, lm, dedent);
    if (delta === 0) return null;
    if (delta > 0) {
      const caret = selStart + delta;
      return { rangeStart: lineStart, rangeEnd: lineStart, text: ' '.repeat(delta), newSelStart: caret, newSelEnd: caret };
    }
    const remove = -delta;
    const caret = Math.max(lineStart, selStart - remove);
    return { rangeStart: lineStart, rangeEnd: lineStart + remove, text: '', newSelStart: caret, newSelEnd: caret };
  }

  // Not a list line -> plain 2-space insert/strip at the caret (v1 behavior).
  if (!dedent) {
    const caret = selStart + INDENT_UNIT.length;
    return { rangeStart: selStart, rangeEnd: selStart, text: INDENT_UNIT, newSelStart: caret, newSelEnd: caret };
  }
  let i = 0;
  while (i < INDENT_UNIT.length && value[lineStart + i] === ' ') i++;
  if (i === 0) return null;
  const caret = Math.max(lineStart, selStart - i);
  return { rangeStart: lineStart, rangeEnd: lineStart + i, text: '', newSelStart: caret, newSelEnd: caret };
}

// Tab/Shift-Tab with a range selection: shift the affected block by one uniform level
// (list-aware via the first line).
function selectionIndentEdit(value, selStart, selEnd, dedent) {
  const { lineStart } = lineBounds(value, selStart);
  let effectiveEnd = selEnd;
  if (value[selEnd - 1] === '\n') effectiveEnd = selEnd - 1; // don't pull in the next line
  let lineEnd = value.indexOf('\n', effectiveEnd);
  if (lineEnd === -1) lineEnd = value.length;

  const block = value.slice(lineStart, lineEnd);
  const nl = block.indexOf('\n');
  const firstLine = nl === -1 ? block : block.slice(0, nl);
  const flm = listMarker(firstLine);

  // Shift magnitude: list-aware from the first line, else a plain indent unit.
  // listIndentDelta is signed (negative when dedenting); here we only need the
  // magnitude because direction is already carried by `dedent` below.
  const delta = flm ? Math.abs(listIndentDelta(value, lineStart, flm, dedent)) : INDENT_UNIT.length;
  if (delta === 0) return null;

  const newBlock = block
    .split('\n')
    .map(function (lineText) {
      if (!dedent) {
        if (lineText.length === 0) return lineText; // never indent a blank line
        return ' '.repeat(delta) + lineText;
      }
      let i = 0;
      while (i < delta && lineText[i] === ' ') i++;
      return lineText.slice(i);
    })
    .join('\n');

  if (newBlock === block) return null;
  return {
    rangeStart: lineStart,
    rangeEnd: lineEnd,
    text: newBlock,
    newSelStart: lineStart,
    newSelEnd: lineStart + newBlock.length,
  };
}

function computeIndent(value, selStart, selEnd, opts) {
  const dedent = !!(opts && opts.dedent);
  return selStart === selEnd
    ? caretIndentEdit(value, selStart, dedent)
    : selectionIndentEdit(value, selStart, selEnd, dedent);
}

function computeWrap(value, selStart, selEnd, ch) {
  if (selStart === selEnd) return null; // no selection -> type natively
  if (!Object.prototype.hasOwnProperty.call(WRAP_PAIRS, ch)) return null; // not a trigger char
  const pair = WRAP_PAIRS[ch];
  const selected = value.slice(selStart, selEnd);
  const text = pair.open + selected + pair.close;
  const newSelStart = selStart + pair.open.length;
  const newSelEnd = newSelStart + selected.length;
  return { rangeStart: selStart, rangeEnd: selEnd, text, newSelStart, newSelEnd };
}

// Expose for the content script (shared isolated-world global) and for Node tests.
if (typeof globalThis !== 'undefined') {
  globalThis.GMTI = globalThis.GMTI || {};
  globalThis.GMTI.computeIndent = computeIndent;
  globalThis.GMTI.INDENT_UNIT = INDENT_UNIT;
  globalThis.GMTI.listMarker = listMarker;
  globalThis.GMTI.precedingListContentCols = precedingListContentCols;
  globalThis.GMTI.nextMarker = nextMarker;
  globalThis.GMTI.owningListLine = owningListLine;
  globalThis.GMTI.lineBounds = lineBounds;
  globalThis.GMTI.listIndentDelta = listIndentDelta;
  globalThis.GMTI.computeSoftBreak = computeSoftBreak;
  globalThis.GMTI.computeListEnter = computeListEnter;
  globalThis.GMTI.computePasteIndent = computePasteIndent;
  globalThis.GMTI.computeWrap = computeWrap;
  globalThis.GMTI.WRAP_PAIRS = WRAP_PAIRS;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { computeIndent, INDENT_UNIT, listMarker, precedingListContentCols, nextMarker, owningListLine, lineBounds, listIndentDelta, computeSoftBreak, computeListEnter, computePasteIndent, computeWrap, WRAP_PAIRS };
}
