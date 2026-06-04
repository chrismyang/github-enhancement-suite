# Shift+Enter list continuation + Monospace font — Design

**Date:** 2026-06-03
**Status:** Approved design, pre-implementation
**Builds on:** v1 (Tab indent) and v2 (list-aware nesting). Same extension, same pure-function
module (`src/indent.js`) consumed by `src/content.js`. Ships #2 (Shift+Enter) and #3 (font)
in one push. Paste handling is explicitly deferred (see Out of scope).

## Problem

Inside a markdown list, GitHub auto-continues the list on **Enter** (`- foo` → `- foo\n- `).
But there's no good way to add a line *within* the same item (Google-Docs Shift+Enter), and the
editor is proportional-width. Two enhancements:

1. **Shift+Enter** should insert a line break that stays in the current list item, aligned under
   the item's text — and keep working line after line (e.g. building a multi-line block).
2. After such a soft break, a **plain Enter** should start a new list item — GitHub does NOT do
   this from a markerless continuation line (verified: it inserts a bare newline at column 0).
3. The editing textarea should render in a **monospace** font.

### Verified behavior (live, 2026-06-03)
- `- foo` + Enter → `- foo\n- ` (GitHub auto-continues from a **marker** line). Leave alone.
- `- foo` + Shift+Enter → `- foo\n` (plain newline, column 0, no alignment). Enhance.
- `- foo\n  bar` + Enter (caret on `  bar`) → `- foo\n  bar\n` (bare newline; **no** new item).
- `- foo\n  bar\n- second` **renders** as `<ul><li>foo<br>bar</li><li>second item</li></ul>` —
  i.e. `bar` is a stacked line *inside* the first item, not a new bullet or sub-list. This
  confirms the soft-break representation (newline + content-column alignment) is correct.

## Goal (this push)

When the caret is in a markdown editing textarea:
- **Shift+Enter** on a list item or indented continuation line → insert `\n` + spaces to align
  the next line under the item's content (repeatable across many lines).
- **Plain Enter** on a *non-empty, markerless, indented continuation line* of a list item →
  insert a new sibling list item at the owning item's level (bullet, or ordered `n+1`).
- Markdown editing textareas render in a monospace font (always on).

Non-list lines, marker lines, ⌘/Ctrl+Enter (submit), and the autocomplete-open state are all
left to GitHub's native behavior.

## Definitions (reused / added in `src/indent.js`)

- `listMarker(line)` → `{ indent, markerWidth, contentCol } | null` — **unchanged** (v2).
  `indent` = leading spaces; `markerWidth` = marker token + following spaces; `contentCol` =
  `indent + markerWidth`.
- `nextMarker(line)` → string | null — **new.** Parses the line's list marker and returns the
  marker text for a new *sibling* item (normalized to one trailing space): a bullet returns the
  same bullet char + space (`- `, `* `, `+ `); an ordered marker returns `(n+1)` + delimiter +
  space (`1. ` → `2. `, `10) ` → `11) `). Returns `null` if the line is not a list item.
- `owningListLine(value, lineStart, indent)` → string | null — **new.** Scans upward from the
  line at `lineStart` to find the list item that "owns" a continuation line whose leading indent
  is `indent`. Skips intervening markerless continuation lines (leading indent ≥ `indent`,
  non-blank). Returns the owning list line **only if** its `contentCol === indent`; returns
  `null` on a blank line, a shallower markerless line, a misaligned list item, or start-of-text.

## `computeSoftBreak(value, selStart, selEnd)` — Shift+Enter (#2a)

Returns the standard `{ rangeStart, rangeEnd, text, newSelStart, newSelEnd } | null` contract.

1. If `selStart !== selEnd` (a selection) → `null` (let native handle).
2. Find the caret's line `[lineStart, lineEnd]`; `line = value.slice(lineStart, lineEnd)`.
3. `prefixLen`:
   - if `listMarker(line)` → `contentCol` (e.g. `- ` →2, `1. ` →3, `  - ` →4).
   - else → the line's leading-space count (so a Shift+Enter from a continuation line repeats
     that indent — this is what makes multi-line "stay in the item" work).
4. If `prefixLen === 0` (plain, non-indented line) → `null` (native bare newline; we don't hijack).
5. Otherwise insert at the caret: `text = '\n' + ' '.repeat(prefixLen)`; caret →
   `selStart + 1 + prefixLen`. (`rangeStart = rangeEnd = selStart`.)

Works at any caret position (splits the line, continuation aligned). Repeated presses keep the
caret at the same indent, so you can build a multi-line block staying in the item.

## `computeListEnter(value, selStart, selEnd)` — plain Enter (#2b)

Fires **only** on a non-empty, markerless, indented continuation line of a list item. Same return
contract.

1. If `selStart !== selEnd` → `null`.
2. Find the caret's line; if `listMarker(line)` is non-null → `null` (it's a marker line —
   GitHub's native Enter already auto-continues correctly; we don't touch it).
3. `indent` = the line's leading-space count. If `indent === 0` → `null` (not an indented
   continuation). If the line is whitespace-only → `null` (empty continuation; native bare
   newline acts as a clean "exit the soft-break" gesture).
4. `ownerLine = owningListLine(value, lineStart, indent)`. If `null` → `null` (not a clean
   continuation of a list item).
5. Build the new item: `text = '\n' + ' '.repeat(listMarker(ownerLine).indent) + nextMarker(ownerLine)`.
   Caret → `selStart + text.length`. (`rangeStart = rangeEnd = selStart`.)

Examples: `- foo` → soft-break → `  bar` → Enter ⇒ new `- ` at column 0.  `1. a` → soft-break →
`   b` → Enter ⇒ `2. `.  Nested `  - foo` → `    baz` → Enter ⇒ `  - `.

**Known edge (intentional, per scoping):** a fenced code block's lines look identical to
continuation lines, so a *plain Enter* inside a list-nested code block will start a new bullet.
Use **Shift+Enter** to add lines inside a code block (it keeps you in). No code-block detection
in this push.

## `src/content.js` wiring

Extend the single capture-phase `keydown` listener:

1. Bail if `e.ctrlKey || e.altKey || e.metaKey` (leaves ⌘/Ctrl+Enter submit alone).
2. Compute `isTab`, `isShiftEnter` (`Enter` + shift), `isPlainEnter` (`Enter`, no shift). Bail if none.
3. Bail unless `isMarkdownField(e.target)`. Bail if `autocompleteOpen(e.target)`.
4. **Tab:** unchanged — compute `computeIndent`; `preventDefault` + `stopPropagation` even on a
   `null` result (so Tab never blurs); apply if non-null.
5. **Shift+Enter / plain Enter:** compute `computeSoftBreak` / `computeListEnter` respectively.
   If the result is `null` → **return without preventDefault** (GitHub's native Enter / newline
   runs — this is what preserves auto-continue on marker lines and bare newline elsewhere). If
   non-null → `preventDefault` + `stopPropagation` + `applyEdit`.

All edits go through the existing `applyEdit` (execCommand insertText — React-safe, single undo).
Any thrown error in compute → return without preventDefault (never break the box).

## `src/editor.css` (#3) + manifest

New static stylesheet, injected via the manifest's content-scripts `css`:

```css
textarea[aria-label="Markdown value"],
textarea.js-comment-field,
textarea[name="issue[body]"], textarea[name="pull_request[body]"], textarea[name="comment[body]"],
[class*="MarkdownEditor-module"] textarea,
[class*="MarkdownInput-module"] textarea {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace !important;
}
```

Mirrors the JS field selector (explicit list + wrapper-descendant), so it covers descriptions,
the comment composer, and the Projects pane. Editing view only; rendered output unaffected.
`manifest.json` content-scripts entry gains `"css": ["src/editor.css"]`.

## Files

- Modify `src/indent.js`: add `computeSoftBreak`, `computeListEnter`, `nextMarker`,
  `owningListLine`; export them (and the helpers, for unit tests). `listMarker`/`computeIndent`
  unchanged.
- Modify `src/content.js`: wire Shift+Enter and plain Enter alongside Tab.
- Add `src/editor.css`.
- Modify `manifest.json`: add the css entry.
- Modify `tests/indent.test.js`: unit tests for the new functions.

## Testing

**Unit (`node --test`):**
- `nextMarker`: `- `→`- `, `* `→`* `, `+ `→`+ `, `1. `→`2. `, `9) `→`10) `, `10. `→`11. `, indented
  variants, `null` for non-list.
- `owningListLine`: direct parent, parent across multiple continuation lines, returns `null` for
  blank-line break / shallower line / misaligned indent / no list above.
- `computeSoftBreak`: bullet (2), ordered (3), nested (4), continuation-line indent match,
  **repeated** soft break (caret on the produced continuation line yields the same indent again),
  mid-line caret split, non-list → null, selection → null, task item.
- `computeListEnter`: continuation under bullet → `- `, under ordered → `n+1`, nested sibling,
  across multiple continuation lines, marker line → null, indent-0 line → null, whitespace-only
  continuation → null, no owner → null, selection → null.

**Integration (Playwright, real GitHub):** Shift+Enter in a bullet list aligns and stays in the
item (Preview shows one `<li>` with `<br>`); repeated Shift+Enter builds a multi-line block in the
item; plain Enter on the continuation line then starts a new bullet; ordered list yields the next
number; plain Enter on a marker line still uses GitHub's native auto-continue; ⌘Enter still
submits; monospace font visibly applied; Tab/indent regression intact.

## Out of scope (this push)

- **Paste multi-line as implicit soft-breaks** — deferred to a follow-up (high interaction risk
  with GitHub's native paste: HTML→markdown conversion, image upload, link-on-paste). Recorded in
  `FEATURE_IDEAS.md`.
- **Code-block detection** — no special handling; use Shift+Enter inside code blocks.
- No options page (font is always on). No renumbering of existing ordered items. No change to
  Tab, plain Enter on marker lines, or ⌘/Ctrl+Enter.
