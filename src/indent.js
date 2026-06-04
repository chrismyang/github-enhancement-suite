const INDENT_UNIT = '  ';

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

function computeSoftBreak(value, selStart, selEnd) {
  if (selStart !== selEnd) return null;
  const lineStart = value.lastIndexOf('\n', selStart - 1) + 1;
  let lineEnd = value.indexOf('\n', selStart);
  if (lineEnd === -1) lineEnd = value.length;
  const line = value.slice(lineStart, lineEnd);
  const lm = listMarker(line);
  const prefixLen = lm ? lm.contentCol : line.length - line.replace(/^ +/, '').length;
  if (prefixLen === 0) return null;
  const text = '\n' + ' '.repeat(prefixLen);
  const caret = selStart + text.length;
  return { rangeStart: selStart, rangeEnd: selStart, text, newSelStart: caret, newSelEnd: caret };
}

function computeListEnter(value, selStart, selEnd) {
  if (selStart !== selEnd) return null;
  const lineStart = value.lastIndexOf('\n', selStart - 1) + 1;
  let lineEnd = value.indexOf('\n', selStart);
  if (lineEnd === -1) lineEnd = value.length;
  const line = value.slice(lineStart, lineEnd);
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

function computeIndent(value, selStart, selEnd, opts) {
  const dedent = !!(opts && opts.dedent);
  const collapsed = selStart === selEnd;

  if (collapsed) {
    const lineStart = value.lastIndexOf('\n', selStart - 1) + 1;
    let lineEnd = value.indexOf('\n', selStart);
    if (lineEnd === -1) lineEnd = value.length;
    const line = value.slice(lineStart, lineEnd);
    const lm = listMarker(line);

    if (lm) {
      // List item: indent/dedent the whole line by one nesting level.
      let newIndent;
      if (!dedent) {
        const cols = precedingListContentCols(value, lineStart);
        const deeper = cols.filter(c => c > lm.indent);
        newIndent = deeper.length ? Math.min(...deeper) : lm.indent + lm.markerWidth;
      } else {
        if (lm.indent === 0) return null;
        const cols = precedingListContentCols(value, lineStart);
        const shallower = cols.filter(c => c < lm.indent);
        shallower.push(0);
        newIndent = Math.max(...shallower);
      }
      const delta = newIndent - lm.indent;
      if (delta === 0) return null;
      if (delta > 0) {
        const caret = selStart + delta;
        return { rangeStart: lineStart, rangeEnd: lineStart, text: ' '.repeat(delta), newSelStart: caret, newSelEnd: caret };
      }
      const remove = -delta;
      const caret = Math.max(lineStart, selStart - remove);
      return { rangeStart: lineStart, rangeEnd: lineStart + remove, text: '', newSelStart: caret, newSelEnd: caret };
    }

    // Not a list line -> v1 behavior.
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

  // Selection: shift the affected block by one uniform level (list-aware via the first line).
  const lineStart = value.lastIndexOf('\n', selStart - 1) + 1;
  let effectiveEnd = selEnd;
  if (value[selEnd - 1] === '\n') effectiveEnd = selEnd - 1; // don't pull in the next line
  let lineEnd = value.indexOf('\n', effectiveEnd);
  if (lineEnd === -1) lineEnd = value.length;

  const block = value.slice(lineStart, lineEnd);
  const nl = block.indexOf('\n');
  const firstLine = nl === -1 ? block : block.slice(0, nl);
  const flm = listMarker(firstLine);

  let delta;
  if (!dedent) {
    if (flm) {
      const cols = precedingListContentCols(value, lineStart);
      const deeper = cols.filter(c => c > flm.indent);
      const newIndent = deeper.length ? Math.min(...deeper) : flm.indent + flm.markerWidth;
      delta = newIndent - flm.indent;
    } else {
      delta = INDENT_UNIT.length;
    }
  } else {
    if (flm) {
      if (flm.indent === 0) {
        delta = 0;
      } else {
        const cols = precedingListContentCols(value, lineStart);
        const shallower = cols.filter(c => c < flm.indent);
        shallower.push(0);
        delta = flm.indent - Math.max(...shallower);
      }
    } else {
      delta = INDENT_UNIT.length;
    }
  }
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

// Expose for the content script (shared isolated-world global) and for Node tests.
if (typeof globalThis !== 'undefined') {
  globalThis.GMTI = globalThis.GMTI || {};
  globalThis.GMTI.computeIndent = computeIndent;
  globalThis.GMTI.INDENT_UNIT = INDENT_UNIT;
  globalThis.GMTI.listMarker = listMarker;
  globalThis.GMTI.precedingListContentCols = precedingListContentCols;
  globalThis.GMTI.nextMarker = nextMarker;
  globalThis.GMTI.owningListLine = owningListLine;
  globalThis.GMTI.computeSoftBreak = computeSoftBreak;
  globalThis.GMTI.computeListEnter = computeListEnter;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { computeIndent, INDENT_UNIT, listMarker, precedingListContentCols, nextMarker, owningListLine, computeSoftBreak, computeListEnter };
}
