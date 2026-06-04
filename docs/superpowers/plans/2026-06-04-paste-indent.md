# Paste-indent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When pasting multi-line plain text inside a markdown list item, re-indent the pasted lines to the item's content column so the block stays in the item; defer every other paste (HTML, images, single-line, non-list) to GitHub.

**Architecture:** One pure function `computePasteIndent` in `src/indent.js` (reuses the Shift+Enter `prefixLen` rule), plus a capture-phase `paste` listener in `src/content.js` that gates on plain-text-only/multi-line/in-a-list and applies the edit via the existing `applyEdit`. No manifest change.

**Tech Stack:** Vanilla JS, Node's built-in test runner (`node --test`), Playwright for integration.

---

## File Structure

- Modify `src/indent.js` — add `computePasteIndent(value, selStart, selEnd, pasted)`; export it (globalThis + module.exports). All existing functions unchanged.
- Modify `src/content.js` — destructure `computePasteIndent` from `globalThis.GMTI`; add a capture-phase `paste` listener.
- Modify `tests/indent.test.js` — unit tests for `computePasteIndent`.

Return contract (same as the other compute fns): `{ rangeStart, rangeEnd, text, newSelStart, newSelEnd } | null` — `null` means "don't intercept; let GitHub paste natively."

---

## Task 1: `computePasteIndent` pure function

**Files:** Modify `src/indent.js`, `tests/indent.test.js`.

- [ ] **Step 1: Add failing tests** — append to `tests/indent.test.js`

```js
const { computePasteIndent } = require('../src/indent.js');

test('computePasteIndent re-indents a multi-line paste into a bullet item (2)', () => {
  const r = computePasteIndent('- foo', 5, 5, 'a\nb\nc');
  assert.deepStrictEqual(r, { rangeStart: 5, rangeEnd: 5, text: 'a\n  b\n  c', newSelStart: 14, newSelEnd: 14 });
});

test('computePasteIndent aligns to an ordered item content column (3)', () => {
  const r = computePasteIndent('1. x', 4, 4, 'a\nb');
  assert.deepStrictEqual(r, { rangeStart: 4, rangeEnd: 4, text: 'a\n   b', newSelStart: 10, newSelEnd: 10 });
});

test('computePasteIndent matches a continuation line indent (2)', () => {
  // caret at end of "  bar" (index 11) in "- foo\n  bar"
  const r = computePasteIndent('- foo\n  bar', 11, 11, 'x\ny');
  assert.deepStrictEqual(r, { rangeStart: 11, rangeEnd: 11, text: 'x\n  y', newSelStart: 16, newSelEnd: 16 });
});

test('computePasteIndent replaces a selection', () => {
  // "- foobar", select "bar" (5..8), paste "X\nY"
  const r = computePasteIndent('- foobar', 5, 8, 'X\nY');
  assert.deepStrictEqual(r, { rangeStart: 5, rangeEnd: 8, text: 'X\n  Y', newSelStart: 10, newSelEnd: 10 });
});

test('computePasteIndent normalizes CRLF to LF', () => {
  const r = computePasteIndent('- foo', 5, 5, 'a\r\nb');
  assert.deepStrictEqual(r, { rangeStart: 5, rangeEnd: 5, text: 'a\n  b', newSelStart: 10, newSelEnd: 10 });
});

test('computePasteIndent returns null for a single-line paste', () => {
  assert.strictEqual(computePasteIndent('- foo', 5, 5, 'hello'), null);
});

test('computePasteIndent returns null on a non-list, non-indented line', () => {
  assert.strictEqual(computePasteIndent('hello', 5, 5, 'a\nb'), null);
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node --test`
Expected: FAIL — `computePasteIndent` is not a function. Existing 61 tests still pass.

- [ ] **Step 3: Implement `computePasteIndent`** in `src/indent.js`, directly below `computeListEnter` (copy VERBATIM)

```js
function computePasteIndent(value, selStart, selEnd, pasted) {
  const lineStart = value.lastIndexOf('\n', selStart - 1) + 1;
  let lineEnd = value.indexOf('\n', selStart);
  if (lineEnd === -1) lineEnd = value.length;
  const line = value.slice(lineStart, lineEnd);
  const lm = listMarker(line);
  const prefixLen = lm ? lm.contentCol : line.length - line.replace(/^ +/, '').length;
  if (prefixLen === 0) return null;
  const normalized = pasted.replace(/\r\n?/g, '\n');
  if (normalized.indexOf('\n') === -1) return null;
  const text = normalized.replace(/\n/g, '\n' + ' '.repeat(prefixLen));
  const caret = selStart + text.length;
  return { rangeStart: selStart, rangeEnd: selEnd, text, newSelStart: caret, newSelEnd: caret };
}
```

- [ ] **Step 4: Export `computePasteIndent`** in BOTH export blocks

Add `globalThis.GMTI.computePasteIndent = computePasteIndent;` in the globalThis block, and add `computePasteIndent` to the `module.exports = { ... }` object.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test`
Expected: PASS — all tests including the 7 new `computePasteIndent` tests.

- [ ] **Step 6: Commit**

```bash
git add src/indent.js tests/indent.test.js
git commit -m "feat: computePasteIndent to re-indent a multi-line paste into a list item"
```

---

## Task 2: Wire the paste listener into the content script

**Files:** Modify `src/content.js`.

- [ ] **Step 1: Destructure `computePasteIndent`** — in `src/content.js`, change the line

```js
  const { computeIndent, computeSoftBreak, computeListEnter } = GMTI;
```
to:
```js
  const { computeIndent, computeSoftBreak, computeListEnter, computePasteIndent } = GMTI;
```

- [ ] **Step 2: Add the paste listener** — in `src/content.js`, directly AFTER the existing `document.addEventListener('keydown', …, true);` block, add:

```js
  document.addEventListener(
    'paste',
    function (e) {
      const ta = e.target;
      if (!isMarkdownField(ta)) return;
      const dt = e.clipboardData;
      if (!dt) return;
      if (dt.files && dt.files.length) return; // images/files -> native upload
      if ((dt.types || []).includes('text/html')) return; // rich paste -> GitHub's HTML->markdown
      const pasted = dt.getData('text/plain');
      if (!pasted) return;

      let r;
      try {
        r = computePasteIndent(ta.value, ta.selectionStart, ta.selectionEnd, pasted);
      } catch (err) {
        return; // unexpected failure -> native paste
      }
      if (!r) return; // single-line / not a list context -> native paste
      e.preventDefault();
      e.stopPropagation();
      try { applyEdit(ta, r); } catch (err) { /* never break the box */ }
    },
    true // capture phase
  );
```

- [ ] **Step 3: Verify syntax and that unit tests still pass**

Run: `node --check src/content.js && node --test 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `node --check` prints nothing (valid); all unit tests still pass (the count from Task 1).

- [ ] **Step 4: Commit**

```bash
git add src/content.js
git commit -m "feat: wire paste-indent listener into content script"
```

---

## Task 3: Integration verification (real GitHub via Playwright)

No code changes. The orchestrator drives this via Playwright after the user reloads the extension on `chrome://extensions`. **This task is also the gate for the key risk: does our capture-phase paste listener intercept before GitHub's own paste handling?**

- [ ] **Step 1: Reload the extension and load a fresh comment-box page**

Reload "GitHub Markdown Tab Indent" on `chrome://extensions`, then open `https://github.com/chrismyang/hammersmith/issues/1` fresh.

- [ ] **Step 2: Verify multi-line plain-text paste re-indents into the item**

Put a multi-line plain-text string on the clipboard (e.g. `line1\nline2\nline3`). In the comment box, type `- foo`, then paste at the end of that line.
Expected: the textarea shows `- fooline1\n  line2\n  line3` (lines 2–3 indented to column 2), staying in the item. Switch to Preview: one `<li>` containing the stacked lines.

- [ ] **Step 3: Verify single-line paste is native**

Type `- bar`, paste a single-line string (no newline) at the end.
Expected: inserted verbatim at the caret (no interception), normal behavior.

- [ ] **Step 4: Verify non-list paste is native**

On an empty (non-list) line, paste a multi-line string.
Expected: GitHub's native paste (no re-indent).

- [ ] **Step 5: Verify rich/image paste is untouched**

If feasible, paste rich text (HTML) or an image.
Expected: GitHub's native HTML→markdown conversion / image upload still works (we did not intercept).

- [ ] **Step 6: Verify single-step undo**

After a re-indented paste, press ⌘Z once.
Expected: the whole paste is undone in a single step.

- [ ] **Step 7: Record results**

If all steps pass, the acceptance criteria are met. If Step 2 shows GitHub's native paste won (no re-indent), the capture-phase listener lost the race — debug with superpowers:systematic-debugging (e.g. consider whether GitHub stops propagation, and whether a different binding is needed) before claiming completion. No commit (no code change).
```
