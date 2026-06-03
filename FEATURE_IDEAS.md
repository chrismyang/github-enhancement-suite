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

## 5. List-aware semantic indent (fast-follow to v1)

v1 indents by a uniform 2 spaces. Phase 2: detect list markers on the affected lines and
indent/dedent by one *real* level (= the parent marker's width), with plain text capped so a
double-indent can't accidentally create a 4-space code block. Same pure `computeIndent`
function, extended; still offset-preserving text manipulation (NOT a full markdown AST
round-trip — see brainstorming notes / spec for why an AST reformats the whole document and
loses the cursor).

### The concrete indent rule (per official GitHub docs + empirically verified)

GitHub's [Basic writing and formatting syntax](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax)
("Nested Lists") does NOT mandate a fixed 2 or 4 spaces. It is an **alignment / character-count
rule**: indent a nested item until its marker sits directly below the first character of the
parent item's text — i.e. by the **width of the parent's marker**:

| Parent marker | Chars before content | Spaces to nest one level |
| ------------- | -------------------- | ------------------------ |
| `- ` / `* `   | 2                    | **2**                    |
| `1. `         | 3                    | **3**                    |
| `100. `       | 5                    | **5** (docs' own example) |

Verified live against GitHub's CommonMark renderer (Preview tab, 2026-06-03):
- Bullet sublists nest correctly at 2 spaces/level (tested 3 levels deep).
- A 3-space child nests under `1. `.
- A **2-space child under `1. ` does NOT nest** — it breaks out into a separate top-level
  list. This is the bug uniform-2-spaces will hit under numbered lists, and the reason this
  feature is worth doing.

So phase 2's indent amount must be derived from the enclosing list item's marker width, not a
constant. **Blockquotes are out of scope for this rule** — they nest via stacked `>` markers
(`>` then `> >`), not leading spaces, so Tab indentation does not apply to them.

## Known unsupported surfaces

- **Projects issue side-pane.** The extension does not trigger when editing a comment from
  the Projects "issue pane" view, e.g.
  `https://github.com/orgs/<org>/projects/<n>/views/<v>?pane=issue&itemId=…&issue=…`.
  The content script matches `https://github.com/*` so it does inject on that page, but the
  comment editor in the pane isn't being caught/handled — needs investigation (different
  editor markup, an iframe/shadow boundary, or the pane's keydown handling intercepting Tab
  before our capture-phase listener). Worth probing this surface's DOM the way we probed the
  comment composer, then extending the selector / handling to cover it.

## Other candidates (unprioritized)

- Configurable indent unit (2 spaces default vs. tabs vs. 4 spaces).
- Auto-continue / smart handling of numbered lists and checkboxes.
- Markdown table column alignment helper.
