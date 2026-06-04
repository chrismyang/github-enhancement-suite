# Feature Ideas (backlog)

Backlog for the GitHub markdown editing enhancement extension. Each note includes findings
from the live DOM probes (2026-06-03) so we don't re-investigate later.

**Already shipped:** Tab/Shift-Tab list-aware indent (v1 + v2), Shift+Enter in-item
continuation + Enter-to-new-item, monospace editor font, multi-line paste re-indent, and
selection wrapping with surrounding characters.

## Probe findings that apply to everything here

- The markdown field is a **real `<textarea>`** on every surface we tested, including the
  React "new issue" UI (Primer `prc-Textarea`, `aria-label="Markdown value"`). One engine
  covers comments and descriptions.
- Mutate text via `document.execCommand('insertText', ...)` / `'delete'` — React keeps the
  change (doesn't revert) and native **undo stays single-step**. Never set `textarea.value`
  directly (React ignores it and the undo stack is destroyed).
- **Stand-down signal** when autocomplete is open: the textarea gets `aria-expanded="true"`
  (plus `aria-activedescendant`, `aria-controls`, `aria-haspopup="listbox"`). Any feature
  that hijacks Tab/Enter/arrows MUST no-op while `aria-expanded === "true"`.

---

## Bug: Enter with caret before the list marker should insert a plain newline

When the caret is positioned before the list item's marker (i.e. in or at the start of the leading indent, left of
the -  / 1.  marker), pressing Enter currently produces a new list-item line. It should instead insert a normal
newline — the caret isn't inside the item's content, so there's no item to continue.

- Likely lives in the Enter path (computeListEnter in src/indent.js / the plain-Enter branch in src/content.js).
- Repro: click just left of the - on a   - item line and hit Enter.
- Expected: a bare newline (native behavior). Actual: a new bullet/n+1 item is started.
- Fix sketch: when the caret column is <= listMarker(line).indent (at or before the marker start),
computeListEnter should return null so GitHub's native Enter runs.

## 1. Grey-out link URLs (light syntax styling)

Dim the URL portion of a markdown link (and potentially other light syntax highlighting).

- **Expensive / fragile.** Native textareas can't style sub-ranges of text. Requires a
  mirrored highlight overlay: a div behind the textarea rendering the same text with
  transparent textarea text on top, kept in sync on every input/scroll/resize and re-aligned
  against the React layout. This is the CodeMirror-lite overlay technique.
- Highest risk of breaking on GitHub UI changes. Treat as a later, opt-in phase.

## Other candidates (unprioritized)

- Configurable indent unit (2 spaces default vs. tabs vs. 4 spaces).
- Smart ordered-list renumbering (e.g. renumber following items when one is inserted/removed).
- Markdown table column alignment helper.
- **Harden the autocomplete stand-down.** `autocompleteOpen()` in `content.js` falls back to a
  global `document.querySelector('[role="listbox"]')` visibility check. On listbox-heavy pages
  (e.g. Projects boards) a visible listbox unrelated to the comment editor could — if it is
  first in DOM order — make Tab wrongly stand down and stop indenting. Scope the fallback to the
  focused textarea's own popup (its `aria-controls`/`aria-owns` listbox) rather than any listbox
  on the page; the primary `aria-expanded === 'true'` signal already covers the real
  autocomplete.

  _Note (verified 2026-06-03):_ the Projects issue side-pane
  (`/orgs/<org>/projects/<n>/views/<v>?pane=issue`) **does** work — its comment editor is in the
  top-document light DOM and matches our `MarkdownEditor`-wrapper selector, so the wrapper fix
  (commit `cf60728`) already covers it. It is no longer an unsupported surface; the listbox
  fragility above is the only residual issue found there.
- Keyboard shorcuts for common operators
  - Toggle preview/edit mode
  - Toggle edit / view mode (not sure how it'll "select" which comment/description I'm referring to though)
