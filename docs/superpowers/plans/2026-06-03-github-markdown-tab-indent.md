# GitHub Markdown Tab Indent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Manifest V3 Chrome extension that makes Tab/Shift-Tab indent/dedent the current line or selected lines inside GitHub markdown textareas, instead of blurring the field.

**Architecture:** One content script loaded on `https://github.com/*`. A pure, DOM-free `computeIndent` function (in `src/indent.js`) computes the text edit and new selection; the DOM glue (in `src/content.js`) listens for Tab on a single capture-phase `document` listener, stands down when GitHub autocomplete is open, and applies the edit via `document.execCommand` (React-safe, single-step undo). No bundler: `indent.js` exposes `computeIndent` on `globalThis` for the content script and via `module.exports` for Node tests.

**Tech Stack:** Vanilla JS, Chrome MV3 content scripts, Node's built-in test runner (`node --test`), Playwright (via the session's browser harness) for integration verification.

---

## File Structure

```
manifest.json            # MV3 manifest; loads indent.js then content.js on github.com
package.json             # "test": "node --test"; no runtime deps
src/indent.js            # pure computeIndent + INDENT_UNIT; dual export (globalThis + module.exports)
src/content.js           # keydown listener, selector match, stand-down check, execCommand apply
tests/indent.test.js     # unit tests for computeIndent (Node, no browser)
```

`computeIndent` contract:

```
computeIndent(value, selStart, selEnd, { dedent }) -> {
  rangeStart, rangeEnd,    // span of `value` to replace
  text,                    // replacement text ('' means: delete the range)
  newSelStart, newSelEnd   // selection to restore after applying
} | null                   // null = no-op (swallow the key, change nothing)
```

Indent unit is **2 spaces**. Three behaviors:
- Collapsed caret + Tab → insert 2 spaces at caret.
- Collapsed caret + Shift-Tab → strip up to 2 leading spaces from the current line (caret stays collapsed).
- Any non-collapsed selection (single or multi-line) → indent/dedent every touched line; selection covers the modified block. A selection ending exactly at a line start does NOT pull in the next line. Blank lines are not indented.

---

## Task 1: Scaffold + collapsed-caret Tab (insert)

**Files:**
- Create: `package.json`
- Create: `src/indent.js`
- Create: `tests/indent.test.js`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "github-markdown-tab-indent",
  "version": "1.0.0",
  "private": true,
  "description": "Tab / Shift-Tab indent and dedent in GitHub markdown textareas.",
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 2: Write the failing test** — `tests/indent.test.js`

```js
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test`
Expected: FAIL — `Cannot find module '../src/indent.js'`.

- [ ] **Step 4: Create `src/indent.js` with the minimal implementation**

```js
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test`
Expected: PASS — 1 test passing.

- [ ] **Step 6: Commit**

```bash
git add package.json src/indent.js tests/indent.test.js
git commit -m "feat: computeIndent inserts 2 spaces on collapsed Tab"
```

---

## Task 2: Collapsed-caret Shift-Tab (dedent current line)

**Files:**
- Modify: `src/indent.js`
- Modify: `tests/indent.test.js`

- [ ] **Step 1: Add failing tests** — append to `tests/indent.test.js`

```js
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
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `node --test`
Expected: FAIL — the 4 new tests fail (computeIndent returns `null` for dedent).

- [ ] **Step 3: Add Branch 2 to `src/indent.js`**

Insert this block in `computeIndent`, immediately after the Branch 1 `if (collapsed && !dedent)` block and before `return null;`:

```js
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test`
Expected: PASS — all 5 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/indent.js tests/indent.test.js
git commit -m "feat: computeIndent dedents current line on collapsed Shift-Tab"
```

---

## Task 3: Selection (line-mode) indent/dedent

**Files:**
- Modify: `src/indent.js`
- Modify: `tests/indent.test.js`

- [ ] **Step 1: Add failing tests** — append to `tests/indent.test.js`

```js
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
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `node --test`
Expected: FAIL — the 6 new tests fail (computeIndent returns `null` for non-collapsed selections).

- [ ] **Step 3: Add Branch 3 to `src/indent.js`**

Replace the final `return null;` in `computeIndent` with this block:

```js
  // Branch 3: non-collapsed selection -> line-mode indent/dedent of all touched lines
  const lineStart = value.lastIndexOf('\n', selStart - 1) + 1;
  let effectiveEnd = selEnd;
  if (value[selEnd - 1] === '\n') effectiveEnd = selEnd - 1; // don't pull in the next line
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test`
Expected: PASS — all 11 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/indent.js tests/indent.test.js
git commit -m "feat: computeIndent handles line-mode selection indent/dedent"
```

---

## Task 4: Manifest + content script (DOM wiring)

**Files:**
- Create: `manifest.json`
- Create: `src/content.js`

- [ ] **Step 1: Create `manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "GitHub Markdown Tab Indent",
  "version": "1.0.0",
  "description": "Tab / Shift-Tab indent and dedent in GitHub markdown textareas.",
  "content_scripts": [
    {
      "matches": ["https://github.com/*"],
      "js": ["src/indent.js", "src/content.js"],
      "run_at": "document_idle"
    }
  ]
}
```

- [ ] **Step 2: Create `src/content.js`**

```js
(function () {
  const computeIndent = globalThis.GMTI && globalThis.GMTI.computeIndent;
  if (!computeIndent) return;

  // Markdown editing textareas across the React UI and the classic UI.
  const SELECTOR = [
    'textarea[aria-label="Markdown value"]', // React UI: comments + descriptions
    'textarea.js-comment-field',             // classic comment box
    'textarea[name="issue[body]"]',          // classic issue description
    'textarea[name="pull_request[body]"]',   // classic PR description
    'textarea[name="comment[body]"]',        // classic comment variants
  ].join(',');

  function isMarkdownField(el) {
    return el instanceof HTMLTextAreaElement && el.matches(SELECTOR);
  }

  // Stand down while GitHub's @/#/: autocomplete popup is open.
  function autocompleteOpen(el) {
    if (el.getAttribute('aria-expanded') === 'true') return true;
    const lb = document.querySelector('[role="listbox"]');
    return !!(lb && (lb.offsetWidth || lb.offsetHeight));
  }

  function applyEdit(ta, r) {
    ta.setSelectionRange(r.rangeStart, r.rangeEnd);
    if (r.text === '') {
      document.execCommand('delete');
    } else {
      document.execCommand('insertText', false, r.text);
    }
    ta.setSelectionRange(r.newSelStart, r.newSelEnd);
  }

  document.addEventListener(
    'keydown',
    function (e) {
      if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey) return;
      const ta = e.target;
      if (!isMarkdownField(ta)) return;
      if (autocompleteOpen(ta)) return;

      let r;
      try {
        r = computeIndent(ta.value, ta.selectionStart, ta.selectionEnd, {
          dedent: e.shiftKey,
        });
      } catch (err) {
        return; // unexpected failure -> let native behavior happen (safety)
      }

      // We own Tab for this field now: swallow it so focus never blurs,
      // even for a computed no-op (e.g. Shift-Tab at column 0).
      e.preventDefault();
      e.stopPropagation();
      if (!r) return;

      try {
        applyEdit(ta, r);
      } catch (err) {
        /* swallow: never break the box */
      }
    },
    true // capture phase
  );
})();
```

- [ ] **Step 3: Commit**

```bash
git add manifest.json src/content.js
git commit -m "feat: content script wires Tab/Shift-Tab to computeIndent on github.com"
```

---

## Task 5: Load-unpacked + Playwright integration verification

No code changes — this task loads the extension and verifies real behavior on GitHub using the session's Playwright browser. Use `chrismyang/hammersmith` (the repo used during the probes).

- [ ] **Step 1: Load the extension unpacked (manual, one-time)**

In Chrome: `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the project root (`github-enhancement-suite/`). Confirm "GitHub Markdown Tab Indent" appears with no errors. (Note: the session's Playwright browser is a separate Chromium and will not have the unpacked extension; Steps 2–5 instead inject `src/indent.js` + the listener via `browser_evaluate` to verify the same logic against the live React textarea. The manual Chrome load is the real acceptance check.)

- [ ] **Step 2: Verify Tab indents and does NOT blur (manual, in the Chrome with the extension)**

Open `https://github.com/chrismyang/hammersmith/issues/new`, click into the description, type `hello`, press **Tab**.
Expected: two spaces appear before `hello` (`  hello`), and the cursor stays in the textarea (focus does NOT jump to the toolbar).

- [ ] **Step 3: Verify multi-line indent/dedent (manual)**

Type three lines (`a`, `b`, `c` on separate lines), select all three, press **Tab**.
Expected: all three lines gain 2 leading spaces. Press **Shift-Tab**: all three lose 2 leading spaces.

- [ ] **Step 4: Verify single-step undo (manual)**

After an indent, press **⌘Z** once.
Expected: the indent is undone in a single step (not character-by-character).

- [ ] **Step 5: Verify autocomplete stand-down (manual)**

Type `hi @c`, wait for the user-mention popup to appear, press **Tab**.
Expected: Tab accepts the highlighted mention (popup behavior), and does NOT insert spaces — the stand-down check fired.

- [ ] **Step 6: Record results**

If all steps pass, the v1 acceptance criteria from the spec are met. If any fail, debug with superpowers:systematic-debugging before claiming completion. No commit (no code change), but note the verification outcome in the task tracker / PR description.
```
