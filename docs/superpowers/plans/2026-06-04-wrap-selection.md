# Wrap Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Typing a trigger character with a non-empty selection in a GitHub markdown textarea wraps the selection with the matching delimiter pair (keeping the inner text selected) instead of replacing it.

**Architecture:** Pure logic in `src/indent.js` (a `WRAP_PAIRS` table + a `computeWrap` function returning the project's standard edit contract); DOM glue in `src/content.js` adds a wrap branch to the existing capture-phase `keydown` listener, following the established `null`-means-native rule.

**Tech Stack:** Plain ES (no build step), `node:test` for unit tests, Manifest V3 content script, Playwright MCP for live verification.

---

### Task 1: `computeWrap` + `WRAP_PAIRS` (pure logic)

**Files:**
- Modify: `src/indent.js` (add function + table + exports)
- Test: `tests/indent.test.js` (add cases; extend the require on line 3)

- [ ] **Step 1: Write the failing tests**

In `tests/indent.test.js`, change the require on line 3 from:

```javascript
const { computeIndent } = require('../src/indent.js');
```

to:

```javascript
const { computeIndent, computeWrap } = require('../src/indent.js');
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
  // Apply r1 to the string to get the new value:
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
Expected: FAIL — `TypeError: computeWrap is not a function` (it isn't defined or exported yet).

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

Then add the function just before the export blocks (after `computeIndent`, before the
`if (typeof globalThis ...` block):

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

In `src/indent.js`, in the `globalThis.GMTI` block, add after the existing `computePasteIndent` line:

```javascript
  globalThis.GMTI.computeWrap = computeWrap;
  globalThis.GMTI.WRAP_PAIRS = WRAP_PAIRS;
```

And extend the `module.exports` object to include `computeWrap` and `WRAP_PAIRS`. The full line becomes:

```javascript
  module.exports = { computeIndent, INDENT_UNIT, listMarker, precedingListContentCols, nextMarker, owningListLine, computeSoftBreak, computeListEnter, computePasteIndent, computeWrap, WRAP_PAIRS };
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all existing tests plus the 7 new `computeWrap` tests.

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

### Task 2: Wire wrapping into the keydown listener

**Files:**
- Modify: `src/content.js` (destructure, gate, wrap branch)

No unit test — `content.js` is DOM glue and is verified live in Task 3 (per `CLAUDE.md`).

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

In `src/content.js`, the Tab branch ends with its `return;` and `}` (currently line 75),
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
Expected: PASS — unchanged from Task 1 (this task touches only DOM glue).

- [ ] **Step 6: Commit**

```bash
git add src/content.js
git commit -m "feat: wire wrap-selection into the keydown listener

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Live verification on real GitHub

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
  - Autocomplete stand-down: type `@`, and while the user-suggestion popup is open, confirm the
    trigger keys are NOT hijacked (e.g. arrow/Enter reach GitHub; a trigger char with the popup
    open types natively).

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
- Never set `textarea.value` directly. The content script mutates via
  `document.execCommand` inside `applyEdit` — this is React-safe and preserves single-step
  undo. Task 2 reuses the existing `applyEdit`; do not add a new mutation path.
- `e.key` reflects the produced character, so matching `WRAP_PAIRS[e.key]` is keyboard-layout
  correct (e.g. Shift+8 → `'*'`). Shift is intentionally NOT excluded by the handler.
