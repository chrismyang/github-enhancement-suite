# GitHub Markdown Tab Indent — v1 Design

**Date:** 2026-06-03
**Status:** Approved design, pre-implementation
**Distribution:** Personal, load-unpacked (Chrome, Manifest V3)

## Problem

On GitHub, pressing **Tab** inside a markdown editing field (issue/PR comments and
descriptions) moves keyboard focus *out* of the textarea to a toolbar button instead of
indenting. Shift-Tab is likewise unhelpful. This breaks the muscle memory of indenting a
line or a selected block, which is constant when writing nested lists or code.

## Goal (v1)

In GitHub markdown textareas, make:

- **Tab** → indent the current line, or every line touched by the selection.
- **Shift-Tab** → dedent the current line, or every touched line.

…without blurring the textarea, without breaking undo, and without interfering with
GitHub's `@`/`#`/`:` autocomplete. Nothing else changes. No options page, no popup, no
config.

## Non-goals (v1)

Everything in `FEATURE_IDEAS.md`: list-marker-aware semantic nesting, Shift+Enter list
continuation, wrap-selection, monospace font, link greying. Explicitly deferred.

## Key findings from live DOM probes (2026-06-03)

Probed against `github.com/chrismyang/hammersmith` (classic comment + React "new issue"
description) using a real authenticated session:

1. **Every surface is a real `<textarea>`** — including the React "new issue" UI
   (Primer `prc-Textarea-TextArea-snlco`, `aria-label="Markdown value"`, React-controlled).
   One engine covers both comments and descriptions.
2. **`document.execCommand('insertText', ...)` works through React** — the inserted text
   persists (React does not revert it after re-render) and **native undo stays single-step**
   (`execCommand('undo')` cleanly reverts). Setting `textarea.value` directly is forbidden:
   React ignores it and it destroys the undo stack.
3. **Native Tab blurs the box** — focus jumps to a `prc-Button` in the toolbar. Confirmed
   the exact bug.
4. **Autocomplete exposes a clean "open" signal** — while the `@`/`#` listbox is showing,
   the textarea carries `aria-expanded="true"` (plus `aria-activedescendant`,
   `aria-controls`, `aria-haspopup="listbox"`, `aria-autocomplete="list"`). This is the
   stand-down signal: when open, we must NOT hijack Tab.

## Architecture

Manifest V3 extension with a single content script injected on `https://github.com/*`.

- **One delegated `keydown` listener** on `document`, registered in the **capture phase**.
- A single document-level listener (rather than per-textarea binding) automatically:
  - survives GitHub's SPA / Turbo navigations (the listener is never torn down),
  - handles textareas added to the DOM later (checked at event time),
  - needs no `MutationObserver` and no re-attach logic.

### Control flow (per keydown)

1. If `event.key !== 'Tab'` → return (ignore).
2. If `event.target` is not a markdown textarea (selector list below) → return.
3. **Stand-down check:** if `target.getAttribute('aria-expanded') === 'true'`, or a visible
   autocomplete `[role="listbox"]` is present → return (let GitHub accept the mention).
4. Compute the edit with the pure `computeIndent` function (no DOM access).
5. If compute returns a result: `event.preventDefault()` + `event.stopPropagation()` (this
   is what cancels the blur), then apply via `execCommand`.
6. If anything throws at any step → do **not** preventDefault; let native behavior proceed.
   The box must never break.

### Target selector list (single source of truth)

```
textarea[aria-label="Markdown value"]      // React UI: issue/PR description
textarea.js-comment-field                  // classic comment box
textarea[name="issue[body]"]               // classic issue description
textarea[name="pull_request[body]"]        // classic PR description
textarea[name="comment[body]"]             // classic comment variants
```

Plus a structural match: any `<textarea>` whose `closest()` ancestor matches
`[class*="MarkdownEditor-module"], [class*="MarkdownInput-module"]`.

Integration testing (post-implementation) revealed the React **comment composer**
textarea uses `aria-labelledby="comment-composer-heading"` rather than
`aria-label="Markdown value"`, so the explicit list alone missed it. Both the
description and the comment composer render inside the Primer
`MarkdownEditor`/`MarkdownInput` module wrapper, so matching that wrapper covers
both surfaces and is resilient to the per-build hash on the textarea's own class,
while still ignoring unrelated page textareas. The explicit list is retained as a
fast path and for the classic (non-React) UI.

## The pure core: `computeIndent`

Signature:

```
computeIndent(value, selStart, selEnd, { dedent }) -> {
  rangeStart, rangeEnd,   // the span of `value` to replace (line-aligned)
  text,                   // replacement text for that span
  newSelStart, newSelEnd  // caret/selection to restore after applying
} | null                  // null = no-op (nothing to do)
```

Rules (v1 = uniform whitespace, indent unit = **2 spaces**):

- **Collapsed caret, Tab:** insert 2 spaces at the caret. (`rangeStart = rangeEnd = caret`,
  caret moves +2.)
- **Collapsed caret, Shift-Tab:** remove up to 2 leading spaces from the current line.
- **Selection touching ≥1 line, Tab:** expand the range to whole lines (from the start of the
  first touched line to the end of the last), prefix every line with 2 spaces, and return a
  selection covering the whole modified block.
- **Selection touching ≥1 line, Shift-Tab:** same line expansion, strip up to 2 leading
  spaces from each line; keep the block selected. Lines with no leading space are left
  unchanged.

"Touched by selection" = any line whose range intersects `[selStart, selEnd]`. A selection
that ends exactly at a line start does not pull in the following line.

### Applying the result (DOM glue)

1. Set `textarea.selectionStart/End` to `rangeStart/rangeEnd`.
2. `document.execCommand('insertText', false, text)` — single undo step, React-safe.
3. Set `textarea.selectionStart/End` to `newSelStart/newSelEnd`.

## Files

```
manifest.json            // MV3, content_scripts on https://github.com/*
src/indent.js            // pure computeIndent + INDENT_UNIT; exported for tests
src/content.js           // listener, selector match, stand-down check, execCommand apply
tests/indent.test.js     // unit tests for computeIndent
```

`src/indent.js` is plain JS exporting `computeIndent` so tests can import it in Node.
`src/content.js` is the only file referencing the DOM / `execCommand` and is loaded as the
content script. (Content scripts are not ES modules; the build keeps `computeIndent`
importable for tests while `content.js` includes/duplicates the function as needed — to be
resolved in the implementation plan, e.g. a tiny bundling step or a shared global.)

## Error handling

- All DOM mutation wrapped so any failure falls back to native behavior (no preventDefault).
- `computeIndent` returns `null` for no-op cases rather than throwing.
- Stand-down check is conservative: when unsure whether autocomplete is open, prefer letting
  GitHub handle the key.

## Testing

**Unit (`tests/indent.test.js`, runs in Node, no browser):**

- collapsed caret Tab inserts 2 spaces at caret
- collapsed caret Shift-Tab removes 2 / 1 / 0 leading spaces (under-2 and at-zero cases)
- single fully-selected line indents/dedents
- multi-line selection indents every line and keeps block selected
- multi-line dedent leaves already-flush lines untouched
- selection ending at a line boundary does not pull in the next line
- empty lines within a selection handled sanely

**Integration (Playwright, the same harness used for the probes):** on a real GitHub box —

- Tab indents and the textarea retains focus (does NOT blur)
- Shift-Tab dedents
- ⌘Z undoes the indent in a single step
- typing `@…` to open the mention list, then Tab, still accepts the mention (stand-down works)

## Future (see FEATURE_IDEAS.md)

Fast-follow phase 2: list-marker-aware semantic indent (nest by marker width, code-block-safe
caps) — same `computeIndent` function extended, still offset-preserving, still no AST
round-trip.
