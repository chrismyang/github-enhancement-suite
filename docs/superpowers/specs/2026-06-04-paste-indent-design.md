# Paste-indent (keep a pasted block inside the list item) — Design

**Date:** 2026-06-04
**Status:** Approved design, pre-implementation
**Builds on:** the Shift+Enter / list-editing work. Same pure module (`src/indent.js`) and
content-script wiring (`src/content.js`). This was the deferred follow-up recorded in
`FEATURE_IDEAS.md`.

## Problem

When you paste multi-line text while editing inside a list item, GitHub inserts it verbatim —
the second and later lines land at column 0, breaking out of the list item:

```
- foo|        ← paste "a\nb\nc"
- fooa
b
c
```

Google Docs keeps a pasted block inside the current item. We want the same: re-indent the
pasted lines to the item's content column so the block stays in the item. But paste is
GitHub's most feature-rich event (HTML→markdown via `js-paste-markdown`, image upload,
link-on-paste), so we intercept only a narrow, safe case and leave everything else native.

## Goal

On paste into a markdown editing textarea, when the caret is in a list/indented context **and**
the clipboard is a multi-line **plain-text** payload (no HTML, no files), insert the text with
each line after the first aligned to the item's content column. Every other paste falls through
to GitHub unchanged.

## Definitions / reuse

- `listMarker(line)` → `{ indent, markerWidth, contentCol } | null` — unchanged.
- **`prefixLen`** (same rule as `computeSoftBreak`): for the line containing `selStart`, the
  content column if it is a list item (`contentCol`), else the line's leading-space count. A
  `prefixLen` of `0` means "not a list/indented context" → do not intercept.

## `computePasteIndent(value, selStart, selEnd, pasted)`

Pure function. Returns the standard `{ rangeStart, rangeEnd, text, newSelStart, newSelEnd }`
contract, or `null` (meaning: don't intercept — let GitHub paste natively).

1. Find the line containing `selStart`; compute `prefixLen` (above). If `prefixLen === 0` →
   `null`.
2. Normalize newlines: `normalized = pasted.replace(/\r\n?/g, '\n')`. If `normalized` contains
   no `\n` → `null` (single-line paste; nothing to re-indent).
3. `text = normalized.replace(/\n/g, '\n' + ' '.repeat(prefixLen))`.
4. Replace the (possibly empty) selection: `rangeStart = selStart`, `rangeEnd = selEnd`, caret →
   `selStart + text.length` (`newSelStart = newSelEnd = caret`).

Uniformly prefixing every line after the first preserves the pasted block's internal structure
and keeps it under the item. Works whether or not there's a selection (it replaces the
selection, exactly as a native paste would).

Examples (caret `|`):
- `- foo|` + paste `a\nb\nc` → `- fooa\n  b\n  c`.
- `1. x|` + paste `a\nb` → `1. xa\n   b` (3-space align).
- caret on a `  bar` continuation line + paste `x\ny` → continuation indent (2) preserved.
- `- foo|` + paste `hello` (single line) → `null` (native paste).
- plain non-list line + paste `a\nb` → `null` (native paste).

## `src/content.js` wiring

Add a capture-phase `paste` listener on `document`:

1. `ta = e.target`; bail unless `isMarkdownField(ta)`.
2. `const dt = e.clipboardData`; bail if `!dt`.
3. Bail if `dt.files && dt.files.length` (images/files → native upload).
4. Bail if `(dt.types || []).includes('text/html')` (rich paste → GitHub's HTML→markdown).
5. `const pasted = dt.getData('text/plain')`; bail if falsy.
6. `r = computePasteIndent(ta.value, ta.selectionStart, ta.selectionEnd, pasted)` in a
   try/catch (on throw → return, native paste).
7. If `r` is `null` → return (native paste). Else `e.preventDefault()` + `e.stopPropagation()`
   + `applyEdit(ta, r)` in a try/catch.

`applyEdit` already does `setSelectionRange(rangeStart, rangeEnd)` then
`execCommand('insertText', …)` — React-safe and a single undo step; it correctly replaces the
selection with the transformed text.

No autocomplete stand-down here (paste is unrelated to the `@`/`#` popup). No manifest change.

## Files

- Modify `src/indent.js`: add `computePasteIndent`; export it (globalThis + module.exports).
- Modify `src/content.js`: grab `computePasteIndent` from `globalThis.GMTI`; add the paste listener.
- Modify `tests/indent.test.js`: unit tests for `computePasteIndent`.

## Testing

**Unit (`node --test`):**
- bullet item: `('- foo', 5, 5, 'a\nb\nc')` → `text: 'a\n  b\n  c'`, caret 14.
- ordered item: `('1. x', 4, 4, 'a\nb')` → `text: 'a\n   b'` (3 spaces).
- continuation line: `('- foo\n  bar', 11, 11, 'x\ny')` → `text: 'x\n  y'` (indent 2).
- replaces a selection: `('- foobar', 5, 8, 'X\nY')` → `rangeStart 5, rangeEnd 8, text: 'X\n  Y'`.
- `\r\n` normalization: `('- foo', 5, 5, 'a\r\nb')` → `text: 'a\n  b'`.
- single-line paste → `null`.
- non-list / non-indented line → `null`.

**Integration (Playwright, real GitHub):** with a real multi-line plain-text clipboard, paste
into a list item and confirm the block is re-indented and stays in the item (Preview shows one
`<li>`); confirm a single-line paste, a paste on a non-list line, and an image paste all behave
natively; confirm undo reverts the paste in one step. **Key risk to confirm:** our capture-phase
paste listener actually intercepts before GitHub's own paste handling.

## Out of scope

- Rich/HTML paste (deferred to GitHub's converter), image/file paste, single-line paste.
- Any renumbering or structural rewriting of the pasted content beyond uniform indentation.
- Code-block awareness (consistent with the rest of the extension).
