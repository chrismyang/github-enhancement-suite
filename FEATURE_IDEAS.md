# Feature Ideas (parked for post-v1)

Backlog for the GitHub markdown editing enhancement extension. **v1 ships Tab/Shift-Tab
indent only** — these are deferred. Each note includes findings from the live DOM probes
(2026-06-03) so we don't re-investigate later.

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

## 1. Wrap selection with surrounding characters

Selecting a text range and typing a surrounding character sequence (e.g. `~~` strikethrough,
`(` parens, `*`, `` ` ``) should **wrap** the selection rather than replace it.

- Builds directly on the same selection + `execCommand` engine as Tab indent.
- Natural companion to the indent work; good early follow-up.

## 2. Shift+Enter list continuation (Google-Docs / Word style)

Inside a list, Shift+Enter should insert a soft line break that stays **within the current
list item**, with continuation text aligned under the bullet's text rather than starting a
new bullet.

- Open question (flagged during brainstorming): GitHub already auto-continues lists on plain
  Enter, so we need to define exact markdown semantics — soft line within same item vs. just
  matching indentation. Decide before building.
- Cheap-ish: reuses the selection/`execCommand` engine.

## 3. Fixed-width (monospace) font while editing

Render the editing textarea in a monospace font.

- Trivial CSS injection, near-zero risk.
- Decision still open: always-on vs. a toggle (toggle needs an options page / popup).

## 4. Grey-out link URLs (light syntax styling)

Dim the URL portion of a markdown link (and potentially other light syntax highlighting).

- **Expensive / fragile.** Native textareas can't style sub-ranges of text. Requires a
  mirrored highlight overlay: a div behind the textarea rendering the same text with
  transparent textarea text on top, kept in sync on every input/scroll/resize and re-aligned
  against the React layout. This is the CodeMirror-lite overlay technique.
- Highest risk of breaking on GitHub UI changes. Treat as a later, opt-in phase.

## Other candidates (unprioritized)

- Configurable indent unit (2 spaces default vs. tabs vs. 4 spaces).
- Auto-continue / smart handling of numbered lists and checkboxes.
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
