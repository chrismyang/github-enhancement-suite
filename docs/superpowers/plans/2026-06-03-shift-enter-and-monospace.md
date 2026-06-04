# Shift+Enter Continuation + Monospace Font Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google-Docs-style Shift+Enter soft breaks inside list items (aligned, repeatable), make a plain Enter on a continuation line start a new list item, and render markdown editing textareas in a monospace font.

**Architecture:** Two new pure functions (`computeSoftBreak`, `computeListEnter`) plus two helpers (`nextMarker`, `owningListLine`) in `src/indent.js`, consumed by the existing capture-phase keydown listener in `src/content.js` (which gains Shift+Enter and plain-Enter handling alongside Tab). Monospace is a static CSS file injected by the manifest. `listMarker`/`computeIndent` are unchanged.

**Tech Stack:** Vanilla JS, Node's built-in test runner (`node --test`), MV3 content-script CSS.

---

## File Structure

- Modify `src/indent.js` — add `nextMarker`, `owningListLine`, `computeSoftBreak`, `computeListEnter`; export all four (globalThis + module.exports). `listMarker`, `precedingListContentCols`, `computeIndent`, `INDENT_UNIT` unchanged.
- Modify `src/content.js` — grab the two new compute fns from `globalThis.GMTI`; extend the keydown listener to dispatch Shift+Enter and plain Enter.
- Create `src/editor.css` — monospace on the markdown textareas.
- Modify `manifest.json` — add `"css": ["src/editor.css"]` to the content-scripts entry.
- Modify `tests/indent.test.js` — unit tests for the four new functions.

Return contract for both new compute fns (same as `computeIndent`):
`{ rangeStart, rangeEnd, text, newSelStart, newSelEnd } | null` — `null` means "no-op, let GitHub's native behavior run."

---

## Task 1: `nextMarker` helper

**Files:** Modify `src/indent.js`, `tests/indent.test.js`.

- [ ] **Step 1: Add failing tests** — append to `tests/indent.test.js`

```js
const { nextMarker } = require('../src/indent.js');

test('nextMarker returns the same bullet for unordered markers', () => {
  assert.strictEqual(nextMarker('- a'), '- ');
  assert.strictEqual(nextMarker('* a'), '* ');
  assert.strictEqual(nextMarker('+ a'), '+ ');
});

test('nextMarker increments ordered markers and keeps the delimiter', () => {
  assert.strictEqual(nextMarker('1. a'), '2. ');
  assert.strictEqual(nextMarker('9) a'), '10) ');
  assert.strictEqual(nextMarker('10. a'), '11. ');
});

test('nextMarker ignores leading indent and returns only the marker', () => {
  assert.strictEqual(nextMarker('  - a'), '- ');
  assert.strictEqual(nextMarker('   1. a'), '2. ');
});

test('nextMarker returns null for non-list lines', () => {
  assert.strictEqual(nextMarker('hello'), null);
  assert.strictEqual(nextMarker(''), null);
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node --test`
Expected: FAIL — `nextMarker` is not a function. Existing tests still pass.

- [ ] **Step 3: Implement `nextMarker`** in `src/indent.js`, directly below `precedingListContentCols`

```js
function nextMarker(line) {
  const m = /^ *([-*+]|(\d+)([.)]))( +)/.exec(line);
  if (!m) return null;
  if (m[2]) return (parseInt(m[2], 10) + 1) + m[3] + ' ';
  return m[1] + ' ';
}
```

- [ ] **Step 4: Export `nextMarker`** in both export blocks

Add `globalThis.GMTI.nextMarker = nextMarker;` in the globalThis block, and add `nextMarker` to the `module.exports = { ... }` list.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test`
Expected: PASS — all tests including the 4 new `nextMarker` tests.

- [ ] **Step 6: Commit**

```bash
git add src/indent.js tests/indent.test.js
git commit -m "feat: add nextMarker helper for sibling list markers"
```

---

## Task 2: `owningListLine` helper

**Files:** Modify `src/indent.js`, `tests/indent.test.js`.

- [ ] **Step 1: Add failing tests** — append to `tests/indent.test.js`

```js
const { owningListLine } = require('../src/indent.js');

test('owningListLine finds the direct parent of a continuation line', () => {
  // "- foo\n  bar"; continuation "  bar" starts at index 6, indent 2
  assert.strictEqual(owningListLine('- foo\n  bar', 6, 2), '- foo');
});

test('owningListLine scans past intervening continuation lines', () => {
  // "- foo\n  bar\n  baz"; "  baz" starts at index 12, indent 2
  const value = '- foo\n  bar\n  baz';
  assert.strictEqual(value.slice(12), '  baz');
  assert.strictEqual(owningListLine(value, 12, 2), '- foo');
});

test('owningListLine returns null across a blank line', () => {
  // "- foo\n\n  bar"; "  bar" starts at index 7
  assert.strictEqual(owningListLine('- foo\n\n  bar', 7, 2), null);
});

test('owningListLine returns null when the line above is not a list', () => {
  assert.strictEqual(owningListLine('text\n  bar', 5, 2), null);
});

test('owningListLine returns null when indent does not match the parent content column', () => {
  // "- foo" content column is 2, but the continuation is indented 3
  assert.strictEqual(owningListLine('- foo\n   bar', 6, 3), null);
});

test('owningListLine returns null when nothing precedes the line', () => {
  assert.strictEqual(owningListLine('  bar', 0, 2), null);
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node --test`
Expected: FAIL — `owningListLine` is not a function. Earlier tests still pass.

- [ ] **Step 3: Implement `owningListLine`** in `src/indent.js`, directly below `nextMarker`

```js
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
```

- [ ] **Step 4: Export `owningListLine`** in both export blocks

Add `globalThis.GMTI.owningListLine = owningListLine;` in the globalThis block, and add `owningListLine` to `module.exports`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test`
Expected: PASS — all tests including the 6 new `owningListLine` tests.

- [ ] **Step 6: Commit**

```bash
git add src/indent.js tests/indent.test.js
git commit -m "feat: add owningListLine helper to resolve a continuation line's list item"
```

---

## Task 3: `computeSoftBreak` (Shift+Enter)

**Files:** Modify `src/indent.js`, `tests/indent.test.js`.

- [ ] **Step 1: Add failing tests** — append to `tests/indent.test.js`

```js
const { computeSoftBreak } = require('../src/indent.js');

test('computeSoftBreak aligns a bullet item continuation to the content column (2)', () => {
  const r = computeSoftBreak('- foo', 5, 5);
  assert.deepStrictEqual(r, { rangeStart: 5, rangeEnd: 5, text: '\n  ', newSelStart: 8, newSelEnd: 8 });
});

test('computeSoftBreak aligns an ordered item continuation (3)', () => {
  const r = computeSoftBreak('1. foo', 6, 6);
  assert.deepStrictEqual(r, { rangeStart: 6, rangeEnd: 6, text: '\n   ', newSelStart: 10, newSelEnd: 10 });
});

test('computeSoftBreak aligns a nested item continuation (4)', () => {
  const r = computeSoftBreak('  - foo', 7, 7);
  assert.deepStrictEqual(r, { rangeStart: 7, rangeEnd: 7, text: '\n    ', newSelStart: 12, newSelEnd: 12 });
});

test('computeSoftBreak repeats on a continuation line (matches its indent)', () => {
  // caret on the produced continuation line "  " (value "- foo\n  ", caret 8)
  const r = computeSoftBreak('- foo\n  ', 8, 8);
  assert.deepStrictEqual(r, { rangeStart: 8, rangeEnd: 8, text: '\n  ', newSelStart: 11, newSelEnd: 11 });
});

test('computeSoftBreak splits at a mid-line caret', () => {
  // "- foobar", caret 5 (between "- foo" and "bar")
  const r = computeSoftBreak('- foobar', 5, 5);
  assert.deepStrictEqual(r, { rangeStart: 5, rangeEnd: 5, text: '\n  ', newSelStart: 8, newSelEnd: 8 });
});

test('computeSoftBreak treats a task item like a bullet (content column 2)', () => {
  const r = computeSoftBreak('- [ ] x', 7, 7);
  assert.deepStrictEqual(r, { rangeStart: 7, rangeEnd: 7, text: '\n  ', newSelStart: 10, newSelEnd: 10 });
});

test('computeSoftBreak returns null on a plain non-indented line', () => {
  assert.strictEqual(computeSoftBreak('hello', 5, 5), null);
});

test('computeSoftBreak returns null for a selection', () => {
  assert.strictEqual(computeSoftBreak('- foo', 0, 5), null);
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node --test`
Expected: FAIL — `computeSoftBreak` is not a function. Earlier tests still pass.

- [ ] **Step 3: Implement `computeSoftBreak`** in `src/indent.js`, directly below `computeIndent`

```js
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
```

- [ ] **Step 4: Export `computeSoftBreak`** in both export blocks

Add `globalThis.GMTI.computeSoftBreak = computeSoftBreak;` and add `computeSoftBreak` to `module.exports`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test`
Expected: PASS — all tests including the 8 new `computeSoftBreak` tests.

- [ ] **Step 6: Commit**

```bash
git add src/indent.js tests/indent.test.js
git commit -m "feat: computeSoftBreak for aligned Shift+Enter list continuation"
```

---

## Task 4: `computeListEnter` (plain Enter on a continuation line)

**Files:** Modify `src/indent.js`, `tests/indent.test.js`.

- [ ] **Step 1: Add failing tests** — append to `tests/indent.test.js`

```js
const { computeListEnter } = require('../src/indent.js');

test('computeListEnter starts a new bullet from a continuation line', () => {
  // "- foo\n  bar", caret at end (11)
  const r = computeListEnter('- foo\n  bar', 11, 11);
  assert.deepStrictEqual(r, { rangeStart: 11, rangeEnd: 11, text: '\n- ', newSelStart: 14, newSelEnd: 14 });
});

test('computeListEnter increments an ordered marker from a continuation line', () => {
  // "1. a\n   b", caret at end (9)
  const r = computeListEnter('1. a\n   b', 9, 9);
  assert.deepStrictEqual(r, { rangeStart: 9, rangeEnd: 9, text: '\n2. ', newSelStart: 13, newSelEnd: 13 });
});

test('computeListEnter starts a nested sibling at the owner indent', () => {
  // "  - foo\n    baz", caret at end (15)
  const value = '  - foo\n    baz';
  assert.strictEqual(value.slice(8), '    baz');
  const r = computeListEnter(value, 15, 15);
  assert.deepStrictEqual(r, { rangeStart: 15, rangeEnd: 15, text: '\n  - ', newSelStart: 20, newSelEnd: 20 });
});

test('computeListEnter returns null on a marker line (native auto-continue)', () => {
  assert.strictEqual(computeListEnter('- foo', 5, 5), null);
});

test('computeListEnter returns null on a non-indented line', () => {
  assert.strictEqual(computeListEnter('foo', 3, 3), null);
});

test('computeListEnter returns null on a whitespace-only continuation line', () => {
  // "- foo\n  ", caret 8
  assert.strictEqual(computeListEnter('- foo\n  ', 8, 8), null);
});

test('computeListEnter returns null when there is no owning list item', () => {
  assert.strictEqual(computeListEnter('text\n  bar', 10, 10), null);
});

test('computeListEnter returns null for a selection', () => {
  assert.strictEqual(computeListEnter('- foo\n  bar', 0, 11), null);
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node --test`
Expected: FAIL — `computeListEnter` is not a function. Earlier tests still pass.

- [ ] **Step 3: Implement `computeListEnter`** in `src/indent.js`, directly below `computeSoftBreak`

```js
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
```

- [ ] **Step 4: Export `computeListEnter`** in both export blocks

Add `globalThis.GMTI.computeListEnter = computeListEnter;` and add `computeListEnter` to `module.exports`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test`
Expected: PASS — all tests including the 8 new `computeListEnter` tests.

- [ ] **Step 6: Commit**

```bash
git add src/indent.js tests/indent.test.js
git commit -m "feat: computeListEnter to start a new item from a continuation line"
```

---

## Task 5: Wire Shift+Enter and plain Enter into the content script

**Files:** Modify `src/content.js`.

- [ ] **Step 1: Grab the new functions** — in `src/content.js`, replace the top line

Replace:
```js
  const computeIndent = globalThis.GMTI && globalThis.GMTI.computeIndent;
  if (!computeIndent) return;
```
with:
```js
  const GMTI = globalThis.GMTI;
  if (!GMTI || !GMTI.computeIndent) return;
  const { computeIndent, computeSoftBreak, computeListEnter } = GMTI;
```

- [ ] **Step 2: Replace the keydown listener** — replace the entire existing `document.addEventListener('keydown', …, true);` block with:

```js
  document.addEventListener(
    'keydown',
    function (e) {
      if (e.ctrlKey || e.altKey || e.metaKey) return; // leave Ctrl/⌘+Enter (submit) etc. alone
      const isTab = e.key === 'Tab';
      const isShiftEnter = e.key === 'Enter' && e.shiftKey;
      const isPlainEnter = e.key === 'Enter' && !e.shiftKey;
      if (!isTab && !isShiftEnter && !isPlainEnter) return;

      const ta = e.target;
      if (!isMarkdownField(ta)) return;
      if (autocompleteOpen(ta)) return;

      if (isTab) {
        let r;
        try {
          r = computeIndent(ta.value, ta.selectionStart, ta.selectionEnd, { dedent: e.shiftKey });
        } catch (err) {
          return; // unexpected failure -> native behavior
        }
        // We own Tab: swallow it so focus never blurs, even on a no-op.
        e.preventDefault();
        e.stopPropagation();
        if (!r) return;
        try { applyEdit(ta, r); } catch (err) { /* never break the box */ }
        return;
      }

      // Shift+Enter (soft break) or plain Enter (continuation -> new item).
      let r;
      try {
        r = isShiftEnter
          ? computeSoftBreak(ta.value, ta.selectionStart, ta.selectionEnd)
          : computeListEnter(ta.value, ta.selectionStart, ta.selectionEnd);
      } catch (err) {
        return; // native behavior
      }
      if (!r) return; // not our case -> let GitHub's native Enter/newline run
      e.preventDefault();
      e.stopPropagation();
      try { applyEdit(ta, r); } catch (err) { /* never break the box */ }
    },
    true // capture phase
  );
```

- [ ] **Step 3: Verify syntax and that unit tests still pass**

Run: `node --check src/content.js && node --test 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `node --check` prints nothing (valid); all unit tests still pass (the `src/indent.js` count from Task 4).

- [ ] **Step 4: Commit**

```bash
git add src/content.js
git commit -m "feat: wire Shift+Enter and plain Enter list handling into content script"
```

---

## Task 6: Monospace font (CSS + manifest)

**Files:** Create `src/editor.css`, modify `manifest.json`.

- [ ] **Step 1: Create `src/editor.css`**

```css
/* Render GitHub markdown editing textareas in a monospace font (editing view only). */
textarea[aria-label="Markdown value"],
textarea.js-comment-field,
textarea[name="issue[body]"],
textarea[name="pull_request[body]"],
textarea[name="comment[body]"],
[class*="MarkdownEditor-module"] textarea,
[class*="MarkdownInput-module"] textarea {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace !important;
}
```

- [ ] **Step 2: Add the CSS to the manifest** — in `manifest.json`, change the content-scripts entry so it includes a `css` array. The entry becomes:

```json
    {
      "matches": ["https://github.com/*"],
      "js": ["src/indent.js", "src/content.js"],
      "css": ["src/editor.css"],
      "run_at": "document_idle"
    }
```

- [ ] **Step 3: Verify the manifest is valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest OK')"`
Expected: prints `manifest OK`.

- [ ] **Step 4: Commit**

```bash
git add src/editor.css manifest.json
git commit -m "feat: monospace font for markdown editing textareas"
```

---

## Task 7: Integration verification (real GitHub via Playwright)

No code changes. The orchestrator drives this via Playwright after the user reloads the extension on `chrome://extensions` (the loaded build must be rebuilt from disk). Use a comment box, e.g. `https://github.com/chrismyang/hammersmith/issues/1`.

- [ ] **Step 1: Reload the extension and load a fresh comment-box page**

Reload "GitHub Markdown Tab Indent" on `chrome://extensions`, then open the issue page fresh.

- [ ] **Step 2: Verify Shift+Enter soft break + render**

Type `- foo`, press Shift+Enter, type `bar`.
Expected: the textarea shows `- foo\n  bar` (continuation aligned at column 2), focus retained. Switch to Preview: it renders as a single `<li>` containing `foo<br>bar` (one bullet, stacked lines).

- [ ] **Step 3: Verify repeated Shift+Enter (multi-line stays in item)**

From the previous state, press Shift+Enter again, type `baz`.
Expected: `- foo\n  bar\n  baz` — each line aligned at column 2 (stays in the item).

- [ ] **Step 4: Verify plain Enter on a continuation line starts a new item**

With the caret at the end of a `  bar` continuation line, press Enter.
Expected: a new `- ` bullet appears at column 0 (`…\n- `), caret after it.

- [ ] **Step 5: Verify ordered list + marker-line Enter**

Type `1. a`, Shift+Enter, type `b` (→ `1. a\n   b`), press Enter → expect `\n2. `. Separately, on a plain `- foo` marker line press Enter → expect GitHub's native `- foo\n- ` (we did not intercept).

- [ ] **Step 6: Verify monospace font + regressions**

Confirm the comment textarea renders in a monospace font. Confirm ⌘Enter still submits is NOT triggered accidentally (don't actually submit — just confirm Tab indent and Shift+Tab dedent still work as in v1/v2).

- [ ] **Step 7: Record results**

If all steps pass, the acceptance criteria are met. If any fail, debug with superpowers:systematic-debugging before claiming completion. No commit (no code change).
