# List-aware Tab Nesting (v2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the caret (or any selected line) is on a markdown list item, make Tab/Shift-Tab indent/dedent the whole line by one nesting level (marker-width aware), instead of inserting spaces at the caret.

**Architecture:** Extend the existing pure `computeIndent` in `src/indent.js` with two helpers (`listMarker`, `precedingListContentCols`) and list-aware branches. The collapsed-caret path gains a list branch (falling back to v1 for non-list lines); the selection path becomes a uniform-`delta` block shift (which reproduces v1's results for non-list selections). `src/content.js` and `manifest.json` are untouched — the keydown listener, autocomplete stand-down, and execCommand apply path all still apply; only the computed edit changes.

**Tech Stack:** Vanilla JS, Node's built-in test runner (`node --test`).

---

## File Structure

- Modify: `src/indent.js` — add `listMarker` and `precedingListContentCols` helpers (exported for tests); restructure `computeIndent`'s collapsed and selection branches to be list-aware.
- Modify: `tests/indent.test.js` — add unit tests for the helpers and the new behavior. The existing 11 tests must keep passing (they all use non-list inputs and exercise the v1 fallback paths).

Key definitions (from the spec):
- `listMarker(line)` → `{ indent, markerWidth, contentCol } | null`. Regex `/^( *)([-*+]|\d+[.)])( +)/`; `indent` = leading spaces, `markerWidth` = marker token + following spaces, `contentCol = indent + markerWidth`.
- `precedingListContentCols(value, lineStart)` → array of `contentCol` for the contiguous block of list lines immediately above `lineStart` (stops at the first non-list or blank line).
- Tab on a list line: `newIndent = min(contentCols > indent)`, or `indent + markerWidth` if none. Dedent: `newIndent = max(contentCols < indent ∪ {0})`, no-op at indent 0.
- Selection: compute one `delta` from the first affected line, apply uniformly.

---

## Task 1: `listMarker` helper

**Files:**
- Modify: `src/indent.js`
- Modify: `tests/indent.test.js`

- [ ] **Step 1: Add failing tests** — append to `tests/indent.test.js`

```js
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
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node --test`
Expected: FAIL — `listMarker` is not exported / not a function. Existing 11 tests still pass.

- [ ] **Step 3: Implement `listMarker` in `src/indent.js`**

Add this function directly below the `const INDENT_UNIT = '  ';` line (before `computeIndent`):

```js
function listMarker(line) {
  const m = /^( *)([-*+]|\d+[.)])( +)/.exec(line);
  if (!m) return null;
  const indent = m[1].length;
  const markerWidth = m[2].length + m[3].length;
  return { indent, markerWidth, contentCol: indent + markerWidth };
}
```

- [ ] **Step 4: Export `listMarker`** in both export blocks at the bottom of `src/indent.js`

Change the globalThis block to:

```js
if (typeof globalThis !== 'undefined') {
  globalThis.GMTI = globalThis.GMTI || {};
  globalThis.GMTI.computeIndent = computeIndent;
  globalThis.GMTI.INDENT_UNIT = INDENT_UNIT;
  globalThis.GMTI.listMarker = listMarker;
}
```

Change the module.exports block to:

```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { computeIndent, INDENT_UNIT, listMarker };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test`
Expected: PASS — all tests (the original 11 plus the 5 new `listMarker` tests).

- [ ] **Step 6: Commit**

```bash
git add src/indent.js tests/indent.test.js
git commit -m "feat: add listMarker helper for parsing list-item geometry"
```

---

## Task 2: `precedingListContentCols` helper

**Files:**
- Modify: `src/indent.js`
- Modify: `tests/indent.test.js`

- [ ] **Step 1: Add failing tests** — append to `tests/indent.test.js`

```js
const { precedingListContentCols } = require('../src/indent.js');

test('precedingListContentCols returns [] when nothing precedes the line', () => {
  // current line "- a" starts at index 0
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
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node --test`
Expected: FAIL — `precedingListContentCols` is not exported / not a function. All earlier tests still pass.

- [ ] **Step 3: Implement `precedingListContentCols` in `src/indent.js`**

Add this function directly below `listMarker`:

```js
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
```

- [ ] **Step 4: Export `precedingListContentCols`** in both export blocks

Add `globalThis.GMTI.precedingListContentCols = precedingListContentCols;` after the `listMarker` line in the globalThis block, and include it in module.exports:

```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { computeIndent, INDENT_UNIT, listMarker, precedingListContentCols };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test`
Expected: PASS — all tests including the 4 new `precedingListContentCols` tests.

- [ ] **Step 6: Commit**

```bash
git add src/indent.js tests/indent.test.js
git commit -m "feat: add precedingListContentCols helper for nesting-level scan"
```

---

## Task 3: List-aware collapsed-caret Tab and Shift-Tab

This restructures the collapsed-caret branch of `computeIndent`: if the caret's line is a list item, indent/dedent the whole line by one nesting level; otherwise fall back to the existing v1 behavior. The non-list fallback must produce identical results to today's Branch 1 / Branch 2 (the original collapsed-caret tests prove this).

**Files:**
- Modify: `src/indent.js`
- Modify: `tests/indent.test.js`

- [ ] **Step 1: Add failing tests** — append to `tests/indent.test.js`

```js
test('list Tab: bullet under bullet indents the line by 2', () => {
  // "- a\n- b", caret at end of line 2 (offset 7); line 2 starts at index 4
  const r = computeIndent('- a\n- b', 7, 7, { dedent: false });
  // insert 2 spaces at the start of line 2 (index 4); caret 7 -> 9
  assert.deepStrictEqual(r, { rangeStart: 4, rangeEnd: 4, text: '  ', newSelStart: 9, newSelEnd: 9 });
});

test('list Tab: numbered item indents by its marker width (3)', () => {
  // "1. a\n2. b", caret at end (index 9)
  const r = computeIndent('1. a\n2. b', 9, 9, { dedent: false });
  assert.deepStrictEqual(r, { rangeStart: 5, rangeEnd: 5, text: '   ', newSelStart: 12, newSelEnd: 12 });
});

test('list Tab: bullet under a numbered parent aligns to the parent content column (3)', () => {
  // "1. a\n- b", caret at end (index 8); parent contentCol is 3, so indent the bullet to col 3
  const r = computeIndent('1. a\n- b', 8, 8, { dedent: false });
  assert.deepStrictEqual(r, { rangeStart: 5, rangeEnd: 5, text: '   ', newSelStart: 11, newSelEnd: 11 });
});

test('list Tab: next-stop nesting does not skip levels', () => {
  // "- a\n  - b\n- c", caret at end of "- c" (offset 13); line starts at 10.
  // preceding content cols are {4,2}; smallest > 0 is 2, so indent by 2
  const r = computeIndent('- a\n  - b\n- c', 13, 13, { dedent: false });
  assert.deepStrictEqual(r, { rangeStart: 10, rangeEnd: 10, text: '  ', newSelStart: 15, newSelEnd: 15 });
});

test('list Tab: first item with no parent indents by its own marker width', () => {
  // "- a", caret at end (index 3); no preceding list line -> indent by markerWidth 2
  const r = computeIndent('- a', 3, 3, { dedent: false });
  assert.deepStrictEqual(r, { rangeStart: 0, rangeEnd: 0, text: '  ', newSelStart: 5, newSelEnd: 5 });
});

test('list Shift-Tab: dedents one level to the next shallower stop', () => {
  // "- a\n  - b\n    - c", caret at end of "    - c" (offset 17); line starts at 10.
  // line indent is 4; preceding content cols are {4,2}; stops < 4 are {2} ∪ {0}, max is 2.
  const value = '- a\n  - b\n    - c';
  assert.strictEqual(value.slice(10), '    - c');
  const r = computeIndent(value, 17, 17, { dedent: true });
  // indent 4 -> newIndent 2 -> remove 2 spaces from line start (index 10); caret 17 -> 15
  assert.deepStrictEqual(r, { rangeStart: 10, rangeEnd: 12, text: '', newSelStart: 15, newSelEnd: 15 });
});

test('list Shift-Tab: dedents a top-level-parented item to column 0', () => {
  // "- a\n  - b", caret at end of "  - b" (offset 9); line starts at 4, indent 2.
  // stops < 2 are {} ∪ {0} -> newIndent 0, remove 2; caret 9 -> 7
  const r = computeIndent('- a\n  - b', 9, 9, { dedent: true });
  assert.deepStrictEqual(r, { rangeStart: 4, rangeEnd: 6, text: '', newSelStart: 7, newSelEnd: 7 });
});

test('list Shift-Tab: no-op when the item is already at column 0', () => {
  assert.strictEqual(computeIndent('- a', 3, 3, { dedent: true }), null);
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node --test`
Expected: FAIL — the new list tests fail (today's collapsed branch inserts at the caret / strips ≤2 regardless of list context). All earlier tests still pass.

- [ ] **Step 3: Replace the collapsed-caret branches in `computeIndent`**

In `src/indent.js`, replace BOTH the Branch 1 block (`if (collapsed && !dedent) { ... }`) and the Branch 2 block (`if (collapsed && dedent) { ... }`) with this single consolidated collapsed block:

```js
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
```

Leave the selection branch (Branch 3) below this untouched for now.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test`
Expected: PASS — all tests, including the 8 new list collapsed-caret tests AND the original collapsed-caret tests (non-list inputs still hit the v1 fallback).

- [ ] **Step 5: Commit**

```bash
git add src/indent.js tests/indent.test.js
git commit -m "feat: list-aware Tab/Shift-Tab for a single caret on a list line"
```

---

## Task 4: List-aware selection (uniform-delta block shift)

This converts the selection branch to compute one `delta` from the first affected line and apply it uniformly. For a non-list first line, `delta` is 2 — which reproduces today's uniform-2-space selection behavior, so the original selection tests keep passing.

**Files:**
- Modify: `src/indent.js`
- Modify: `tests/indent.test.js`

- [ ] **Step 1: Add failing tests** — append to `tests/indent.test.js`

```js
test('list selection Tab: numbered block shifts uniformly by 3', () => {
  // "1. a\n2. b" fully selected (0..9)
  const r = computeIndent('1. a\n2. b', 0, 9, { dedent: false });
  assert.deepStrictEqual(r, {
    rangeStart: 0, rangeEnd: 9, text: '   1. a\n   2. b', newSelStart: 0, newSelEnd: 15,
  });
});

test('list selection Tab: bullet block under a parent shifts by 2 and preserves nesting', () => {
  // "- p\n- a\n  - b" with "- a\n  - b" selected (4..12); first selected line "- a" nests under "- p" (col 2)
  const value = '- p\n- a\n  - b';
  assert.strictEqual(value.slice(4), '- a\n  - b');
  const r = computeIndent(value, 4, 12, { dedent: false });
  assert.deepStrictEqual(r, {
    rangeStart: 4, rangeEnd: 12, text: '  - a\n    - b', newSelStart: 4, newSelEnd: 17,
  });
});

test('list selection Shift-Tab: dedents the block uniformly', () => {
  // "  - a\n  - b" fully selected (0..11); first line indent 2, no preceding -> dedent delta 2
  const r = computeIndent('  - a\n  - b', 0, 11, { dedent: true });
  assert.deepStrictEqual(r, {
    rangeStart: 0, rangeEnd: 11, text: '- a\n- b', newSelStart: 0, newSelEnd: 7,
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node --test`
Expected: FAIL — the new list selection tests fail (today's selection branch always shifts by 2, so the numbered block would gain 2 spaces not 3, and `text` won't match). All earlier tests still pass.

- [ ] **Step 3: Replace the selection branch in `computeIndent`**

In `src/indent.js`, replace the entire Branch 3 block (everything from `// Branch 3:` comment through the function's final `return { ... }`) with:

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test`
Expected: PASS — all tests, including the 3 new list selection tests AND the original selection tests (non-list selections still shift by 2 and produce identical results).

- [ ] **Step 5: Commit**

```bash
git add src/indent.js tests/indent.test.js
git commit -m "feat: list-aware uniform-delta indent/dedent for selections"
```

---

## Task 5: Integration verification (real GitHub via Playwright)

No code changes. Verify the updated behavior against GitHub after reloading the extension. The orchestrator drives this via the Playwright browser; the user reloads the extension on `chrome://extensions` first (the loaded build must be rebuilt from disk).

- [ ] **Step 1: Reload the extension and a comment box page**

Reload "GitHub Markdown Tab Indent" on `chrome://extensions`, then load a fresh issue page with a comment box (e.g. `https://github.com/chrismyang/hammersmith/issues/1`).

- [ ] **Step 2: Verify bullet list nesting**

In the comment box, type `- a`, press Enter (GitHub auto-continues to `- `), type `b`, press Tab.
Expected: line 2 becomes `  - b` (2 leading spaces), focus retained in the textarea.

- [ ] **Step 3: Verify numbered list nesting (3 spaces)**

Clear, type `1. a`, Enter (continues to `2. `), type `b`, press Tab.
Expected: line 2 becomes `   2. b` (3 leading spaces).

- [ ] **Step 4: Verify Shift-Tab dedent**

With the caret on the nested line from Step 3, press Shift-Tab.
Expected: the line returns to `2. b` (or the next shallower level), focus retained.

- [ ] **Step 5: Verify selection block shift**

Type a 3-item bullet list, select all three lines, press Tab.
Expected: all three lines gain 2 leading spaces (block shifted one level); Shift-Tab returns them.

- [ ] **Step 6: Verify regression — non-list Tab unchanged**

On an empty line (not a list), with a collapsed caret, press Tab.
Expected: 2 spaces inserted at the caret (v1 behavior), focus retained.

- [ ] **Step 7: Record results**

If all steps pass, the v2 acceptance criteria are met. If any fail, debug with superpowers:systematic-debugging before claiming completion. No commit (no code change).
