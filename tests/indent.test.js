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
