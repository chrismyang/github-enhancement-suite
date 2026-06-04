# Wrap selection with surrounding characters — design

_Spec date: 2026-06-04_

## Summary

When a markdown field has a **non-empty selection** and the user types a *trigger
character*, wrap the selection with the matching delimiter pair instead of replacing it,
and leave the original text selected (now sitting between the inserted markers). This
builds directly on the same selection + `execCommand` engine as the Tab indent feature.

With no selection, the character types natively — wrapping never fires on a bare caret.

## Motivation

Backlog idea #1 (`FEATURE_IDEAS.md`), flagged as the natural early follow-up to the indent
work. Selecting a word and pressing `` ` `` to wrap it in code, or `[` to start a link, is a
common editing move that a native textarea otherwise turns into a destructive replace.

## Behavior

### Trigger characters

| Key(s) | Open | Close | Construct |
|---|---|---|---|
| `*` `_` `` ` `` `~` `"` `'` | same as key | same as key (symmetric) | emphasis / code / strikethrough / quotes |
| `(` | `(` | `)` | parens / link URL half |
| `[` | `[` | `]` | link / reference / task text |
| `<` | `<` | `>` | autolink / raw HTML |

Only the listed keys trigger. Closing brackets (`)` `]` `>`) and every other character type
natively. The set was chosen for GitHub-Flavored-Markdown relevance plus the two most common
plain-text wraps (quotes):

- **Included and GFM-meaningful:** `*` `_` `` ` `` `~` `(` `[` `<`.
- **Included as plain-text convenience (not markdown syntax):** `"` `'`.
- **Deliberately excluded:**
  - `$` (inline/block math) — a real GitHub construct, but `$` is common in code/currency, so
    wrap-on-selection would surprise too often. Trivial to add later.
  - `{ }` — not GFM syntax; dropped to keep the set to constructs with real markdown/text meaning.
  - `^…^` superscript, `==…==` highlight — **not** GitHub-flavored (GitHub uses `<sup>` /
    `<mark>` HTML tags), so triggering them would imply fake syntax. (`~` stays, for
    *strikethrough* — `~~` — not subscript.)

### Wrapping rules

- Fires only when the selection is **non-empty** (`selStart !== selEnd`).
- `text = open + selected + close`. The selection range is replaced by this text.
- **The original text stays selected**, now between the markers:
  `newSelStart = selStart + open.length`, `newSelEnd = newSelStart + selected.length`.
- **No toggle / unwrap (v1).** Pressing `*` on an already-`*foo*` selection yields `**foo**`.
  Because the inner text stays selected, repeated presses build up multi-char markers
  naturally: `*` → `**` → `***`; `` ` `` → double/triple backticks; `~` → `~~` (GFM
  strikethrough). This composability is *why* we preserve the selection.
- **Multi-line selections wrap the whole range** — open marker before the first character,
  close after the last, newlines untouched in between. No special block handling in v1.

### Interaction with existing behavior

- **No-selection caret types natively.** `computeWrap` returns `null`, and per the existing
  `null`-means-native rule the content script does **not** `preventDefault`, so the keystroke
  falls through to GitHub.
- **Autocomplete stand-down** (`aria-expanded === "true"` etc.) is already checked before the
  wrap branch — `@`/`#`/`:` popups keep working.
- **IME / composition:** the wrap branch bails when `e.isComposing` is true, so dead keys and
  composed input are never hijacked.
- Ctrl/Alt/Meta combos are already ignored by the handler (so ⌘B/⌘I/⌘K and ⌘Enter submit are
  untouched). Shift is *not* ignored — it is required to produce `*` `(` `<` `_` `~` `"` on a
  US layout, and `e.key` already reflects the produced character, so matching is layout-correct.

## Architecture

Stay consistent with the codebase: **pure logic in `src/indent.js`, DOM glue only in
`src/content.js`.**

### `src/indent.js`

**Preliminary refactor (code-quality, behavior-identical).** `computeIndent` has grown to ~107
lines covering four branches (caret/selection × list/non-list × indent/dedent), and two idioms
are duplicated across the module. Before adding the wrap logic, decompose it — guarded by the
existing unit suite (a pure refactor must keep every current test green):

- `lineBounds(value, pos)` → `{ lineStart, lineEnd, line }` — the "current line" idiom repeated
  in `computeSoftBreak`, `computeListEnter`, `computePasteIndent`, and `computeIndent`. Adopt it
  in all four.
- `listIndentDelta(value, lineStart, lm, dedent)` → signed indent delta — the
  preceding-content-column math currently duplicated between the caret-list and selection-list
  branches (selection mode takes its magnitude via `Math.abs`).
- `caretIndentEdit(...)` and `selectionIndentEdit(...)` — the two halves of the function, leaving
  `computeIndent` a small dispatcher on `selStart === selEnd`.
- Export the two reusable pure helpers (`lineBounds`, `listIndentDelta`) on `GMTI` +
  `module.exports`, matching the existing helper exports; the two edit-builders stay internal.

Then add the wrap logic:

- Add a `WRAP_PAIRS` table mapping each trigger key to `{ open, close }`.
- Add a pure `computeWrap(value, selStart, selEnd, ch)` returning the standard edit contract
  `{ rangeStart, rangeEnd, text, newSelStart, newSelEnd } | null`:
  - `null` when `selStart === selEnd` (no selection) **or** `ch` is not a key in `WRAP_PAIRS`.
  - On a hit: `rangeStart = selStart`, `rangeEnd = selEnd`,
    `text = open + value.slice(selStart, selEnd) + close`,
    `newSelStart = selStart + open.length`,
    `newSelEnd = newSelStart + (selEnd - selStart)`.
- Export `computeWrap` and `WRAP_PAIRS` on both `globalThis.GMTI` and `module.exports`, matching
  the existing export blocks.

### `src/content.js`

- In the existing capture-phase `keydown` listener, add a wrap branch:
  - A keystroke is a *wrap candidate* when (Ctrl/Alt/Meta already excluded), `!e.isComposing`,
    and `e.key` is a key in `GMTI.WRAP_PAIRS`. Add this to the early-return gate alongside
    `isTab` / `isShiftEnter` / `isPlainEnter`.
  - Field detection (`isMarkdownField`) and `autocompleteOpen` stand-down run first, exactly as
    today.
  - Follow the **`null`-means-native** pattern (like Enter/paste): call `computeWrap`; only when
    it returns a non-null result do we `preventDefault()` + `stopPropagation()` + `applyEdit`.
    A `null` (no selection / non-trigger) lets the character type normally.
  - Wrapped in the existing try/catch "never break the box" guard — any failure falls back to
    native typing.

### Rejected alternatives

- **Pair table in `content.js`** instead of `indent.js`: splits config from the pure logic.
- **A second dedicated keydown listener** for wrapping: duplicates field-detection and the
  autocomplete stand-down, and risks ordering issues against the existing listener.

The single-listener + pure-module split is the established pattern; both rejected options work
against it.

## Testing

### Unit tests (`tests/indent.test.js`, `node:test`)

Cover `computeWrap`:

- Each symmetric char (`*` `_` `` ` `` `~` `"` `'`) wraps `open === close === key`.
- Each bracket (`(` `[` `<`) wraps with the matching close.
- No selection (`selStart === selEnd`) → `null`.
- Non-trigger char (e.g. `a`, `)`, `]`, `$`, `{`) → `null`.
- Exact returned coordinates (`rangeStart/rangeEnd/text/newSelStart/newSelEnd`) for a known
  input, asserting the inner span is the original selection.
- Multi-line selection wraps the whole range (newline preserved inside).
- Double-apply build-up: applying `*` twice to the same logical selection yields `**text**`
  with the inner text still selected.

### Live verification (real GitHub, Playwright MCP)

Per `CLAUDE.md`: reload the unpacked extension, open a fresh comment box, confirm the main
world is clean, then drive real key events and read back `textarea.value` + selection:

- Select a word, press `` ` `` → `` `word` `` with the word still selected; press `` ` `` again
  → ``` ``word`` ```.
- Select text, press `[` → `[text]`, caret/selection inside.
- Press `*` twice → `**text**` (bold build-up).
- No selection: press `(` → a literal `(` is inserted (native), no wrap.
- Autocomplete stand-down: with the `@`/`#` popup open, the trigger keys reach GitHub.
- Clear the box afterward; never submit.
