const { test } = require('node:test');
const assert = require('node:assert');
const { computeIndent } = require('../src/indent.js');

test('collapsed caret + Tab inserts 2 spaces at the caret', () => {
  const r = computeIndent('ab', 1, 1, { dedent: false });
  assert.deepStrictEqual(r, {
    rangeStart: 1,
    rangeEnd: 1,
    text: '  ',
    newSelStart: 3,
    newSelEnd: 3,
  });
});

test('collapsed caret + Shift-Tab strips 2 leading spaces, caret stays collapsed', () => {
  const r = computeIndent('  x', 3, 3, { dedent: true });
  assert.deepStrictEqual(r, {
    rangeStart: 0,
    rangeEnd: 2,
    text: '',
    newSelStart: 1,
    newSelEnd: 1,
  });
});

test('collapsed caret + Shift-Tab strips only the 1 available leading space', () => {
  const r = computeIndent(' x', 2, 2, { dedent: true });
  assert.deepStrictEqual(r, {
    rangeStart: 0,
    rangeEnd: 1,
    text: '',
    newSelStart: 1,
    newSelEnd: 1,
  });
});

test('collapsed caret + Shift-Tab with no leading space is a no-op (null)', () => {
  assert.strictEqual(computeIndent('x', 1, 1, { dedent: true }), null);
});

test('Shift-Tab dedents the correct line in a multi-line value', () => {
  // value: "a\n  b", caret inside "  b" (index 5, after both spaces)
  const r = computeIndent('a\n  b', 5, 5, { dedent: true });
  assert.deepStrictEqual(r, {
    rangeStart: 2,
    rangeEnd: 4,
    text: '',
    newSelStart: 3,
    newSelEnd: 3,
  });
});

test('single fully-selected line indents', () => {
  const r = computeIndent('abc', 0, 3, { dedent: false });
  assert.deepStrictEqual(r, {
    rangeStart: 0,
    rangeEnd: 3,
    text: '  abc',
    newSelStart: 0,
    newSelEnd: 5,
  });
});

test('multi-line selection indents every line and selects the block', () => {
  // "a\nb\nc", select "a\nb" (0..3)
  const r = computeIndent('a\nb\nc', 0, 3, { dedent: false });
  assert.deepStrictEqual(r, {
    rangeStart: 0,
    rangeEnd: 3,
    text: '  a\n  b',
    newSelStart: 0,
    newSelEnd: 7,
  });
});

test('selection ending exactly at a line start does not pull in the next line', () => {
  // "a\nb\nc", select "a\n" (0..2) -> only line "a" is touched
  const r = computeIndent('a\nb\nc', 0, 2, { dedent: false });
  assert.deepStrictEqual(r, {
    rangeStart: 0,
    rangeEnd: 1,
    text: '  a',
    newSelStart: 0,
    newSelEnd: 3,
  });
});

test('blank lines within a selection are not indented', () => {
  // "a\n\nb", select all (0..4)
  const r = computeIndent('a\n\nb', 0, 4, { dedent: false });
  assert.deepStrictEqual(r, {
    rangeStart: 0,
    rangeEnd: 4,
    text: '  a\n\n  b',
    newSelStart: 0,
    newSelEnd: 8,
  });
});

test('multi-line dedent strips each line, leaving already-flush lines untouched', () => {
  // "  a\nb", select all (0..5)
  const r = computeIndent('  a\nb', 0, 5, { dedent: true });
  assert.deepStrictEqual(r, {
    rangeStart: 0,
    rangeEnd: 5,
    text: 'a\nb',
    newSelStart: 0,
    newSelEnd: 3,
  });
});

test('selection dedent with no removable leading space is a no-op (null)', () => {
  assert.strictEqual(computeIndent('a\nb', 0, 3, { dedent: true }), null);
});

const { listMarker } = require('../src/indent.js');

test('listMarker parses a bullet item', () => {
  assert.deepStrictEqual(listMarker('- a'), { indent: 0, markerWidth: 2, contentCol: 2 });
});

test('listMarker parses *, +, and ordered markers with correct widths', () => {
  assert.deepStrictEqual(listMarker('* a'), { indent: 0, markerWidth: 2, contentCol: 2 });
  assert.deepStrictEqual(listMarker('+ a'), { indent: 0, markerWidth: 2, contentCol: 2 });
  assert.deepStrictEqual(listMarker('1. a'), { indent: 0, markerWidth: 3, contentCol: 3 });
  assert.deepStrictEqual(listMarker('1) a'), { indent: 0, markerWidth: 3, contentCol: 3 });
  assert.deepStrictEqual(listMarker('10. a'), { indent: 0, markerWidth: 4, contentCol: 4 });
});

test('listMarker accounts for leading indent', () => {
  assert.deepStrictEqual(listMarker('  - a'), { indent: 2, markerWidth: 2, contentCol: 4 });
  assert.deepStrictEqual(listMarker('   1. a'), { indent: 3, markerWidth: 3, contentCol: 6 });
});

test('listMarker treats a task item as a bullet (the brackets are content)', () => {
  assert.deepStrictEqual(listMarker('- [ ] a'), { indent: 0, markerWidth: 2, contentCol: 2 });
});

test('listMarker returns null for non-list lines', () => {
  assert.strictEqual(listMarker('hello'), null);
  assert.strictEqual(listMarker('  hello'), null);
  assert.strictEqual(listMarker('-no space after marker'), null);
  assert.strictEqual(listMarker(''), null);
});

const { precedingListContentCols } = require('../src/indent.js');

test('precedingListContentCols returns [] when nothing precedes the line', () => {
  assert.deepStrictEqual(precedingListContentCols('- a', 0), []);
});

test('precedingListContentCols collects the contiguous list block above, nearest first', () => {
  // value: "- a\n  - b\n- c"; current line "- c" starts at index 10
  const value = '- a\n  - b\n- c';
  assert.strictEqual(value.slice(10), '- c');
  assert.deepStrictEqual(precedingListContentCols(value, 10), [4, 2]);
});

test('precedingListContentCols stops at a blank line', () => {
  // value: "- a\n\n- b"; current line "- b" starts at index 5
  const value = '- a\n\n- b';
  assert.strictEqual(value.slice(5), '- b');
  assert.deepStrictEqual(precedingListContentCols(value, 5), []);
});

test('precedingListContentCols stops at a non-list line', () => {
  // value: "text\n- b"; current line "- b" starts at index 5
  const value = 'text\n- b';
  assert.strictEqual(value.slice(5), '- b');
  assert.deepStrictEqual(precedingListContentCols(value, 5), []);
});

test('list Tab: bullet under bullet indents the line by 2', () => {
  // "- a\n- b", caret at end of line 2 (offset 7); line 2 starts at index 4
  const r = computeIndent('- a\n- b', 7, 7, { dedent: false });
  assert.deepStrictEqual(r, { rangeStart: 4, rangeEnd: 4, text: '  ', newSelStart: 9, newSelEnd: 9 });
});

test('list Tab: numbered item indents by its marker width (3)', () => {
  const r = computeIndent('1. a\n2. b', 9, 9, { dedent: false });
  assert.deepStrictEqual(r, { rangeStart: 5, rangeEnd: 5, text: '   ', newSelStart: 12, newSelEnd: 12 });
});

test('list Tab: bullet under a numbered parent aligns to the parent content column (3)', () => {
  const r = computeIndent('1. a\n- b', 8, 8, { dedent: false });
  assert.deepStrictEqual(r, { rangeStart: 5, rangeEnd: 5, text: '   ', newSelStart: 11, newSelEnd: 11 });
});

test('list Tab: next-stop nesting does not skip levels', () => {
  // "- a\n  - b\n- c", caret at end of "- c" (offset 13); line starts at 10; stops {4,2}, min>0 is 2
  const r = computeIndent('- a\n  - b\n- c', 13, 13, { dedent: false });
  assert.deepStrictEqual(r, { rangeStart: 10, rangeEnd: 10, text: '  ', newSelStart: 15, newSelEnd: 15 });
});

test('list Tab: first item with no parent indents by its own marker width', () => {
  const r = computeIndent('- a', 3, 3, { dedent: false });
  assert.deepStrictEqual(r, { rangeStart: 0, rangeEnd: 0, text: '  ', newSelStart: 5, newSelEnd: 5 });
});

test('list Shift-Tab: dedents one level to the next shallower stop', () => {
  // "- a\n  - b\n    - c", caret at end of "    - c" (offset 17); line starts at 10, indent 4; stops<4 are {2}∪{0}, max 2
  const value = '- a\n  - b\n    - c';
  assert.strictEqual(value.slice(10), '    - c');
  const r = computeIndent(value, 17, 17, { dedent: true });
  assert.deepStrictEqual(r, { rangeStart: 10, rangeEnd: 12, text: '', newSelStart: 15, newSelEnd: 15 });
});

test('list Shift-Tab: dedents a top-level-parented item to column 0', () => {
  const r = computeIndent('- a\n  - b', 9, 9, { dedent: true });
  assert.deepStrictEqual(r, { rangeStart: 4, rangeEnd: 6, text: '', newSelStart: 7, newSelEnd: 7 });
});

test('list Shift-Tab: no-op when the item is already at column 0', () => {
  assert.strictEqual(computeIndent('- a', 3, 3, { dedent: true }), null);
});

test('list selection Tab: numbered block shifts uniformly by 3', () => {
  const r = computeIndent('1. a\n2. b', 0, 9, { dedent: false });
  assert.deepStrictEqual(r, {
    rangeStart: 0, rangeEnd: 9, text: '   1. a\n   2. b', newSelStart: 0, newSelEnd: 15,
  });
});

test('list selection Tab: bullet block under a parent shifts by 2 and preserves nesting', () => {
  // "- p\n- a\n  - b" with "- a\n  - b" selected; first selected line "- a" nests under "- p" (col 2)
  const value = '- p\n- a\n  - b';
  assert.strictEqual(value.slice(4), '- a\n  - b');
  const r = computeIndent(value, 4, 12, { dedent: false });
  assert.deepStrictEqual(r, {
    rangeStart: 4, rangeEnd: 13, text: '  - a\n    - b', newSelStart: 4, newSelEnd: 17,
  });
});

test('list selection Shift-Tab: dedents the block uniformly', () => {
  const r = computeIndent('  - a\n  - b', 0, 11, { dedent: true });
  assert.deepStrictEqual(r, {
    rangeStart: 0, rangeEnd: 11, text: '- a\n- b', newSelStart: 0, newSelEnd: 7,
  });
});

test('list selection Shift-Tab: no-op when the block is already at the margin', () => {
  // first line "- a" is at column 0 -> delta 0 -> null
  assert.strictEqual(computeIndent('- a\n- b', 0, 7, { dedent: true }), null);
});

test('list selection Tab: mixed list + non-list block shifts uniformly by the first line', () => {
  // first line "- item" dictates delta 2; the non-list second line is shifted too
  const value = '- item\nsome text';
  const r = computeIndent(value, 0, value.length, { dedent: false });
  assert.deepStrictEqual(r, {
    rangeStart: 0, rangeEnd: 16, text: '  - item\n  some text', newSelStart: 0, newSelEnd: 20,
  });
});

test('list Tab: a two-digit ordered item indents by its marker width (4)', () => {
  // "10. a", caret at end (offset 5); first item -> indent by markerWidth 4
  const r = computeIndent('10. a', 5, 5, { dedent: false });
  assert.deepStrictEqual(r, { rangeStart: 0, rangeEnd: 0, text: '    ', newSelStart: 9, newSelEnd: 9 });
});

test('list Tab: caret mid-line still indents the whole line and tracks the caret', () => {
  // "- abc", caret after "b" (offset 4); insert 2 at line start, caret 4 -> 6
  const r = computeIndent('- abc', 4, 4, { dedent: false });
  assert.deepStrictEqual(r, { rangeStart: 0, rangeEnd: 0, text: '  ', newSelStart: 6, newSelEnd: 6 });
});
