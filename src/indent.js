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

  return null;
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
