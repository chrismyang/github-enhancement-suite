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
