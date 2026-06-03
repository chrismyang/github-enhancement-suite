# List-aware Tab Nesting (v2) — Design

**Date:** 2026-06-03
**Status:** Approved design, pre-implementation
**Builds on:** `2026-06-03-github-markdown-tab-indent-design.md` (v1). Same extension, same
`computeIndent` pure function, same content-script wiring. This adds list awareness to the
indent/dedent logic.

## Problem

GitHub auto-continues lists on Enter (typing `- a` then Enter yields a fresh `- ` item with
the caret right after the marker). At that caret, v1's collapsed-caret rule inserts 2 spaces
*at the caret* — turning `- |` into `- ␣␣|` (spaces after the marker) instead of nesting the
item to `␣␣- |`. We want the Google-Docs feel: pressing Tab on a list item **indents
(nests) the whole line one level**; Shift-Tab dedents it.

## Goal (v2)

When the caret's line — or any line within a selection — **is a list item**, Tab/Shift-Tab
indent/dedent the whole line by one nesting level (marker-width aware, so numbered lists nest
correctly). Non-list lines keep v1 behavior unchanged.

## Non-goals

Enter handling (GitHub already auto-continues lists). Renumbering ordered lists. Blockquotes
(they nest via stacked `>` markers, not leading spaces). No new browser surface, options page,
or config.

## Definitions

A **list item line** matches:

```
/^( *)([-*+]|\d+[.)])( +)/
```

- `indent` = length of leading spaces (group 1). v1 and v2 use spaces only (not tabs).
- `markerWidth` = `group2.length + group3.length` (the marker token plus the spaces after it).
  E.g. `- ` → 2, `1. ` → 3, `10. ` → 4, `1) ` → 3.
- `contentCol` = `indent + markerWidth` (the column where the item's text begins).

Task items (`- [ ] x`) match too: `- ` is the marker; `[ ] x` is content.

## Algorithm — single caret (collapsed selection)

Let the current line be the line containing the caret. If it is **not** a list item, fall back
to v1 exactly (Tab inserts 2 spaces at the caret; Shift-Tab strips up to 2 leading spaces from
the line). If it **is** a list item:

### Tab (indent one level)

Compute the target indent by aligning to the list structure above the current line:

1. Scan upward over the **contiguous preceding list block**: consecutive non-blank lines
   immediately above that are themselves list items. Stop at the first non-list-item line or
   blank line. Collect their `contentCol` values.
2. `candidates` = those collected `contentCol`s that are **strictly greater than** the current
   line's `indent`.
3. If `candidates` is non-empty: `newIndent = min(candidates)` — the next nesting level down,
   which never skips levels (matches Google-Docs one-level-per-Tab).
4. If `candidates` is empty (first item, or already as deep as any item above): `newIndent =
   indent + markerWidth` — "indent anyway" by this line's own marker width.

Apply: replace the line's leading whitespace so its `indent` becomes `newIndent` (i.e. insert
`newIndent - indent` spaces at the line start). The caret moves right by the same amount,
staying on the same character.

Worked examples (caret `|`; spaces shown as `·`):

```
- a              - a
- b|     →Tab→    ··- b|              (bullet under bullet: +2)

1. a             1. a
2. b|    →Tab→    ···2. b|            (numbered: marker width 3 → +3)

1. a             1. a
- b|     →Tab→    ···- b|             (mixed: aligns to parent content col 3, not +2)

- a              - a
··- b            ··- b
- c|     →Tab→    ··- c|              (next stop is col 2 = sibling of b; 2nd Tab → col 4)
```

### Shift-Tab (dedent one level)

1. Scan the contiguous preceding list block (as above), collect their `contentCol`s.
2. `stops` = those `contentCol`s that are **strictly less than** the current line's `indent`,
   plus `0`.
3. `newIndent = max(stops)` — the next shallower nesting level (or 0).
4. If the current `indent` is already 0: no-op (return `null`).

Apply: remove `indent - newIndent` leading spaces from the line. The caret moves left by the
same amount (clamped at the line start).

## Algorithm — selection (multi-line)

Google-Docs behavior: indenting a selection shifts the whole block one level, preserving its
internal nesting.

1. Determine the affected lines: every line touched by the selection (same line-expansion rule
   as v1 — a selection ending exactly at a line start does not pull in the next line).
2. Compute a single `delta` from the **first affected line**:
   - **Tab:** if the first affected line is a list item, `delta = newIndent - indent` using the
     single-caret Tab rule above; otherwise `delta = 2` (v1 uniform fallback).
   - **Shift-Tab:** if the first affected line is a list item, `delta = indent - newIndent`
     using the single-caret Shift-Tab rule; otherwise `delta = 2`.
3. Apply uniformly to every affected line:
   - **Tab:** prepend `delta` spaces to each non-blank line (blank lines untouched, as in v1).
   - **Shift-Tab:** remove up to `delta` leading spaces from each line.
4. The selection is restored to cover the modified block (as in v1).

A uniform `delta` preserves the block's relative nesting and never skips levels (the first
line's `delta` is already clamped by the stop rule). If `delta` computes to 0 (e.g. Shift-Tab
on a block already at the margin), return `null` (no-op).

## `computeIndent` contract (unchanged shape)

```
computeIndent(value, selStart, selEnd, { dedent }) -> {
  rangeStart, rangeEnd,    // span of `value` to replace
  text,                    // replacement text ('' means: delete the range)
  newSelStart, newSelEnd   // selection to restore
} | null                   // null = no-op
```

The function already receives the full `value`, so it can scan preceding lines for the stop
computation. The branch order becomes:

1. **Collapsed caret, current line is a list item** → list-indent / list-dedent (new).
2. **Collapsed caret, not a list item** → v1 Branch 1 (Tab insert at caret) / Branch 2
   (Shift-Tab strip ≤2 leading spaces).
3. **Selection** → list-aware uniform-`delta` block indent/dedent (extends v1 Branch 3).

A new pure helper:

```
listMarker(line) -> { indent, markerWidth, contentCol } | null
```

returns the parsed leading-marker geometry, or `null` if `line` is not a list item.

## Files

- Modify: `src/indent.js` — add `listMarker` helper; add list-aware paths to `computeIndent`.
- Modify: `tests/indent.test.js` — add unit tests for the new behavior.
- `src/content.js`, `manifest.json` — unchanged. The capture-phase listener, autocomplete
  stand-down, and execCommand apply path all continue to work; only the computed edit changes.

## Error handling

Same as v1: `computeIndent` is pure and returns `null` for no-ops rather than throwing; the
content script only `preventDefault`s after a successful (non-throwing) compute; any DOM-apply
failure is swallowed so the textarea is never broken.

## Testing

Unit tests (`node --test`, no browser) for `listMarker` and the new `computeIndent` paths:

- `listMarker`: `- `, `* `, `+ `, `1. `, `1) `, `10. `, `- [ ] `, indented variants; returns
  `null` for non-list lines and for a bare `-` with no following space.
- Single-caret Tab: bullet under bullet (+2); numbered (+3 for `1. `, +4 for `10. `); mixed
  bullet-under-numbered (aligns to parent contentCol); next-stop selection (`- c` after a
  nested `- b` → col 2, then col 4); first item with no parent (indent by own marker width);
  caret offset moves with the text.
- Single-caret Shift-Tab: dedent one level to the next shallower stop; dedent to 0; no-op at
  column 0.
- Selection: uniform `delta` for a bullet block (2) and a numbered block (3); relative nesting
  preserved; mixed list/non-list block; Shift-Tab block dedent; no-op when already at margin.
- Regression: non-list collapsed caret still behaves as v1 (insert 2 at caret / strip ≤2).

Integration (Playwright, real GitHub, after loading the updated extension): in a comment box,
type `- a`, Enter (GitHub continues to `- `), type `b`, press Tab → line becomes `  - b`,
focus retained; numbered list nests by 3; Shift-Tab dedents; selecting a 3-item list and Tab
shifts the block one level.
