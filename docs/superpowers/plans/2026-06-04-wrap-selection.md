# Wrap Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Typing a trigger character with a non-empty selection in a GitHub markdown textarea wraps the selection with the matching delimiter pair (keeping the inner text selected) instead of replacing it.

**Architecture:** Pure logic in `src/indent.js` (a `WRAP_PAIRS` table + a `computeWrap` function returning the project's standard edit contract); DOM glue in `src/content.js` adds a wrap branch to the existing capture-phase `keydown` listener, following the established `null`-means-native rule. Task 1 first decomposes the grown `computeIndent` into focused helpers (`lineBounds`, `listIndentDelta`, `caretIndentEdit`, `selectionIndentEdit`) so the new code lands in a tidy module.

**Tech Stack:** Plain ES (no build step), `node:test` for unit tests, Manifest V3 content script, Playwright MCP for live verification.

---

### Task 1: Refactor `computeIndent` into focused helpers (behavior-identical)

**Files:**
- Modify: `src/indent.js` (extract helpers, slim `computeIndent`, adopt `lineBounds` in the
  three sibling functions, update exports)
- Test: `tests/indent.test.js` (existing suite is the regression guard; add focused helper tests)

This is a **pure refactor** — no behavior change. The existing `computeIndent` tests are the
safety net: they must stay green before and after. Replace the logic section of `src/indent.js`
(everything from the `INDENT_UNIT` line through the end of `computeIndent`, i.e. lines 1-200)
with the content shown in Step 2; the export blocks below it are updated in Step 3.

- [ ] **Step 1: Confirm a green baseline**

Run: `npm test`
Expected: PASS — record that all existing tests pass before touching anything.

- [ ] **Step 2: Replace the logic section with the decomposed version**

In `src/indent.js`, replace lines 1-200 (the `INDENT_UNIT` declaration through the end of the
`computeIndent` function, stopping just before the `// Expose for the content script ...`
comment) with exactly this:

```javascript
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
```

- [ ] **Step 3: Update the export blocks to expose the two reusable helpers**

In `src/indent.js`, in the `globalThis.GMTI` block, add these two lines (anywhere among the
existing assignments, e.g. right after the `globalThis.GMTI.owningListLine = owningListLine;`
line):

```javascript
  globalThis.GMTI.lineBounds = lineBounds;
  globalThis.GMTI.listIndentDelta = listIndentDelta;
```

And add `lineBounds, listIndentDelta` to the `module.exports` object. The full line becomes:

```javascript
  module.exports = { computeIndent, INDENT_UNIT, listMarker, precedingListContentCols, nextMarker, owningListLine, lineBounds, listIndentDelta, computeSoftBreak, computeListEnter, computePasteIndent };
```

- [ ] **Step 4: Run the full suite to prove the refactor changed no behavior**

Run: `npm test`
Expected: PASS — identical pass count to Step 1. Any change here means the refactor altered
behavior; stop and reconcile against the Step-2 code.

- [ ] **Step 5: Syntax-check the module**

Run: `node --check src/indent.js`
Expected: no output (exit 0).

- [ ] **Step 6: Add focused tests for the new pure helpers**

In `tests/indent.test.js`, change the require on line 3 from:

```javascript
const { computeIndent } = require('../src/indent.js');
```

to:

```javascript
const { computeIndent, lineBounds, listIndentDelta, listMarker } = require('../src/indent.js');
```

Then append:

```javascript
test('lineBounds returns the bounds and text of the line containing pos', () => {
  assert.deepStrictEqual(lineBounds('ab\ncd\nef', 4), { lineStart: 3, lineEnd: 5, line: 'cd' });
});

test('lineBounds handles the first line (pos 0)', () => {
  assert.deepStrictEqual(lineBounds('ab\ncd', 0), { lineStart: 0, lineEnd: 2, line: 'ab' });
});

test('lineBounds handles the last line with no trailing newline', () => {
  assert.deepStrictEqual(lineBounds('ab\ncd', 5), { lineStart: 3, lineEnd: 5, line: 'cd' });
});

test('listIndentDelta nests a lone top-level item by its marker width', () => {
  const value = '- a';
  assert.strictEqual(listIndentDelta(value, 0, listMarker('- a'), false), 2);
});

test('listIndentDelta dedent at column 0 is a no-op (0)', () => {
  const value = '- a';
  assert.strictEqual(listIndentDelta(value, 0, listMarker('- a'), true), 0);
});
```

- [ ] **Step 7: Run the suite again**

Run: `npm test`
Expected: PASS — existing tests plus the 5 new helper tests.

- [ ] **Step 8: Commit**

```bash
git add src/indent.js tests/indent.test.js
git commit -m "refactor: decompose computeIndent into lineBounds/listIndentDelta helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `computeWrap` + `WRAP_PAIRS` (pure logic)

**Files:**
- Modify: `src/indent.js` (add table + function + exports)
- Test: `tests/indent.test.js` (add cases; extend the require on line 3)

- [ ] **Step 1: Write the failing tests**

In `tests/indent.test.js`, add `computeWrap` to the destructured require on line 3 (it currently
reads `const { computeIndent, lineBounds, listIndentDelta, listMarker } = require('../src/indent.js');`
after Task 1) so it becomes:

```javascript
const { computeIndent, lineBounds, listIndentDelta, listMarker, computeWrap } = require('../src/indent.js');
```

Then append these tests to the end of the file:

```javascript
test('computeWrap wraps a selection symmetrically and keeps inner text selected', () => {
  // value: "foo", select "foo" (0..3), press '*'
  const r = computeWrap('foo', 0, 3, '*');
  assert.deepStrictEqual(r, {
    rangeStart: 0,
    rangeEnd: 3,
    text: '*foo*',
    newSelStart: 1,
    newSelEnd: 4,
  });
});

test('computeWrap each symmetric char wraps open === close === key', () => {
  for (const ch of ['*', '_', '`', '~', '"', "'"]) {
    const r = computeWrap('xfoox', 1, 4, ch); // select "foo"
    assert.strictEqual(r.text, ch + 'foo' + ch, 'char ' + ch);
    assert.strictEqual(r.newSelStart, 2);
    assert.strictEqual(r.newSelEnd, 5);
  }
});

test('computeWrap brackets use the matching close', () => {
  assert.strictEqual(computeWrap('foo', 0, 3, '(').text, '(foo)');
  assert.strictEqual(computeWrap('foo', 0, 3, '[').text, '[foo]');
  assert.strictEqual(computeWrap('foo', 0, 3, '<').text, '<foo>');
});

test('computeWrap returns null with no selection (collapsed caret)', () => {
  assert.strictEqual(computeWrap('foo', 1, 1, '*'), null);
});

test('computeWrap returns null for a non-trigger char', () => {
  for (const ch of ['a', ')', ']', '>', '$', '{', '}', '^', '=']) {
    assert.strictEqual(computeWrap('foo', 0, 3, ch), null, 'char ' + ch);
  }
});

test('computeWrap wraps a multi-line selection as one range, newline preserved', () => {
  const r = computeWrap('a\nb', 0, 3, '`');
  assert.strictEqual(r.text, '`a\nb`');
  assert.strictEqual(r.newSelStart, 1);
  assert.strictEqual(r.newSelEnd, 4);
});

test('computeWrap applied twice builds **bold** with inner text still selected', () => {
  // First wrap: select "foo" in "foo" -> "*foo*", inner selection 1..4
  const r1 = computeWrap('foo', 0, 3, '*');
  const v2 = 'foo'.slice(0, r1.rangeStart) + r1.text + 'foo'.slice(r1.rangeEnd);
  assert.strictEqual(v2, '*foo*');
  // Second wrap: the inner text is still selected (1..4), press '*' again
  const r2 = computeWrap(v2, r1.newSelStart, r1.newSelEnd, '*');
  const v3 = v2.slice(0, r2.rangeStart) + r2.text + v2.slice(r2.rangeEnd);
  assert.strictEqual(v3, '**foo**');
  assert.strictEqual(r2.newSelStart, 2);
  assert.strictEqual(r2.newSelEnd, 5);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `TypeError: computeWrap is not a function` (not defined or exported yet).

- [ ] **Step 3: Implement `WRAP_PAIRS` + `computeWrap`**

In `src/indent.js`, immediately after the `INDENT_UNIT` declaration on line 1, add the table:

```javascript
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
```

Then add the function just before the `// Expose for the content script ...` comment (after
`computeIndent`):

```javascript
function computeWrap(value, selStart, selEnd, ch) {
  if (selStart === selEnd) return null; // no selection -> type natively
  const pair = WRAP_PAIRS[ch];
  if (!pair) return null; // not a trigger char
  const selected = value.slice(selStart, selEnd);
  const text = pair.open + selected + pair.close;
  const newSelStart = selStart + pair.open.length;
  const newSelEnd = newSelStart + selected.length;
  return { rangeStart: selStart, rangeEnd: selEnd, text, newSelStart, newSelEnd };
}
```

- [ ] **Step 4: Add the exports**

In `src/indent.js`, in the `globalThis.GMTI` block, add after the existing `computePasteIndent`
assignment:

```javascript
  globalThis.GMTI.computeWrap = computeWrap;
  globalThis.GMTI.WRAP_PAIRS = WRAP_PAIRS;
```

And add `computeWrap, WRAP_PAIRS` to the end of the `module.exports` object. The full line
becomes:

```javascript
  module.exports = { computeIndent, INDENT_UNIT, listMarker, precedingListContentCols, nextMarker, owningListLine, lineBounds, listIndentDelta, computeSoftBreak, computeListEnter, computePasteIndent, computeWrap, WRAP_PAIRS };
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all prior tests plus the 7 new `computeWrap` tests.

- [ ] **Step 6: Syntax-check the module**

Run: `node --check src/indent.js`
Expected: no output (exit 0).

- [ ] **Step 7: Commit**

```bash
git add src/indent.js tests/indent.test.js
git commit -m "feat: computeWrap + WRAP_PAIRS pure logic for wrap-selection

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Wire wrapping into the keydown listener

**Files:**
- Modify: `src/content.js` (destructure, gate, wrap branch)

No unit test — `content.js` is DOM glue and is verified live in Task 4 (per `CLAUDE.md`).

- [ ] **Step 1: Pull `computeWrap` + `WRAP_PAIRS` out of `GMTI`**

In `src/content.js`, change line 4 from:

```javascript
  const { computeIndent, computeSoftBreak, computeListEnter, computePasteIndent } = GMTI;
```

to:

```javascript
  const { computeIndent, computeSoftBreak, computeListEnter, computePasteIndent, computeWrap, WRAP_PAIRS } = GMTI;
```

- [ ] **Step 2: Detect a wrap candidate in the early-return gate**

In `src/content.js`, find this block (currently lines 53-56):

```javascript
      const isTab = e.key === 'Tab';
      const isShiftEnter = e.key === 'Enter' && e.shiftKey;
      const isPlainEnter = e.key === 'Enter' && !e.shiftKey;
      if (!isTab && !isShiftEnter && !isPlainEnter) return;
```

Replace it with (adds `isWrap` and includes it in the gate):

```javascript
      const isTab = e.key === 'Tab';
      const isShiftEnter = e.key === 'Enter' && e.shiftKey;
      const isPlainEnter = e.key === 'Enter' && !e.shiftKey;
      // A wrap candidate: a single trigger char, not mid-IME-composition.
      const isWrap = !e.isComposing && Object.prototype.hasOwnProperty.call(WRAP_PAIRS, e.key);
      if (!isTab && !isShiftEnter && !isPlainEnter && !isWrap) return;
```

- [ ] **Step 3: Add the wrap branch after the Tab branch**

In `src/content.js`, the Tab branch ends with its `return;` then `}` (currently line 75),
immediately before the comment `// Shift+Enter (soft break) or plain Enter ...`. Insert this
new branch between the Tab block's closing `}` and that comment:

```javascript

      if (isWrap) {
        let r;
        try {
          r = computeWrap(ta.value, ta.selectionStart, ta.selectionEnd, e.key);
        } catch (err) {
          return; // unexpected failure -> native typing
        }
        if (!r) return; // no selection / non-trigger -> let the char type normally
        e.preventDefault();
        e.stopPropagation();
        try { applyEdit(ta, r); } catch (err) { /* never break the box */ }
        return;
      }
```

This placement matters: the Enter fall-through below assumes the key is Enter. Returning here
keeps a wrap keystroke out of `computeListEnter`/`computeSoftBreak`.

- [ ] **Step 4: Syntax-check the content script**

Run: `node --check src/content.js`
Expected: no output (exit 0).

- [ ] **Step 5: Confirm the full unit suite still passes (no regressions)**

Run: `npm test`
Expected: PASS — unchanged from Task 2 (this task touches only DOM glue).

- [ ] **Step 6: Commit**

```bash
git add src/content.js
git commit -m "feat: wire wrap-selection into the keydown listener

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Live verification on real GitHub

**Files:** none (manual/Playwright-MCP integration check, per `CLAUDE.md`).

This task has no code. It verifies the loaded extension behaves correctly against a real
GitHub textarea. Drive it with the Playwright MCP browser.

- [ ] **Step 1: Reload the unpacked extension**

Ask the user to open `chrome://extensions` and click reload on "GitHub Markdown Tab Indent"
(load-unpacked does not hot-reload — the loaded build is a snapshot of disk).

- [ ] **Step 2: Open a fresh comment box**

Navigate to `https://github.com/chrismyang/hammersmith/issues/1` and focus the comment
textarea.

- [ ] **Step 3: Confirm the page main world is clean**

Evaluate `typeof globalThis.GMTI` in the page — expect `'undefined'` (the extension runs in the
isolated world). This confirms we're testing the real extension, not injected helpers.

- [ ] **Step 4: Verify each behavior, reading back `textarea.value` and selection after each**

  - Type `foo`, select all of it, press `` ` `` → value `` `foo` ``, selection covers `foo`
    (positions 1..4). Press `` ` `` again → ``` ``foo`` ```, selection still on `foo`.
  - Clear. Type `link`, select it, press `[` → `[link]`, selection on `link`.
  - Clear. Type `bold`, select it, press `*` twice → `**bold**`, selection on `bold`.
  - Clear. With an empty caret (no selection), press `(` → a literal `(` is inserted (native),
    no wrap.
  - Regression: with a list line present, Tab/Shift-Tab still indent/dedent (confirms the Task 1
    refactor didn't change live behavior).
  - Autocomplete stand-down: type `@`, and while the user-suggestion popup is open, confirm the
    trigger keys are NOT hijacked (arrow/Enter reach GitHub; a trigger char with the popup open
    types natively).

- [ ] **Step 5: Clean up**

Clear the comment box. Never submit.

- [ ] **Step 6: Report results**

Summarize what passed/failed with the observed `textarea.value` for each check. If anything
misbehaves, stop and debug (do not mark the feature complete).

---

## Notes for the implementer

- The edit contract is uniform across the codebase: every compute returns
  `{ rangeStart, rangeEnd, text, newSelStart, newSelEnd } | null`, where `null` means
  "no-op / let GitHub handle it natively." `computeWrap` follows it exactly.
- Task 1 is a **pure refactor**: the existing test suite is the only behavior guarantee, so it
  must stay green across Steps 1, 4, and 7. `selectionIndentEdit` takes `Math.abs` of the signed
  `listIndentDelta` because the block-shift logic uses a positive magnitude for both indent and
  dedent (it adds `delta` spaces, or strips up to `delta` leading spaces).
- Never set `textarea.value` directly. The content script mutates via
  `document.execCommand` inside `applyEdit` — this is React-safe and preserves single-step
  undo. Task 3 reuses the existing `applyEdit`; do not add a new mutation path.
- `e.key` reflects the produced character, so matching `WRAP_PAIRS[e.key]` is keyboard-layout
  correct (e.g. Shift+8 → `'*'`). Shift is intentionally NOT excluded by the handler.
