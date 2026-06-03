const INDENT_UNIT = '  ';

function computeIndent(value, selStart, selEnd, opts) {
  const dedent = !!(opts && opts.dedent);
  const collapsed = selStart === selEnd;

  // Branch 1: collapsed caret + Tab -> insert indent unit at caret
  if (collapsed && !dedent) {
    const caret = selStart + INDENT_UNIT.length;
    return {
      rangeStart: selStart,
      rangeEnd: selStart,
      text: INDENT_UNIT,
      newSelStart: caret,
      newSelEnd: caret,
    };
  }

  // Branch 2: collapsed caret + Shift-Tab -> strip up to INDENT_UNIT leading spaces
  if (collapsed && dedent) {
    const lineStart = value.lastIndexOf('\n', selStart - 1) + 1;
    let i = 0;
    while (i < INDENT_UNIT.length && value[lineStart + i] === ' ') i++;
    if (i === 0) return null;
    const caret = Math.max(lineStart, selStart - i);
    return {
      rangeStart: lineStart,
      rangeEnd: lineStart + i,
      text: '',
      newSelStart: caret,
      newSelEnd: caret,
    };
  }

  // Branch 3: non-collapsed selection -> line-mode indent/dedent of all touched lines
  const lineStart = value.lastIndexOf('\n', selStart - 1) + 1;
  let effectiveEnd = selEnd;
  if (selEnd > 0 && value[selEnd - 1] === '\n') effectiveEnd = selEnd - 1; // don't pull in the next line
  let lineEnd = value.indexOf('\n', effectiveEnd);
  if (lineEnd === -1) lineEnd = value.length;

  const block = value.slice(lineStart, lineEnd);
  const newBlock = block
    .split('\n')
    .map(function (line) {
      if (dedent) {
        let i = 0;
        while (i < INDENT_UNIT.length && line[i] === ' ') i++;
        return line.slice(i);
      }
      if (line.length === 0) return line; // never indent a blank line
      return INDENT_UNIT + line;
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
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { computeIndent, INDENT_UNIT };
}
