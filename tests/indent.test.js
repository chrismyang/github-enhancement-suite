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
