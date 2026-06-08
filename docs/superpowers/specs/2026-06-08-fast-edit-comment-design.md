# Fast-edit comment ("hover + `e`") — design

_Spec date: 2026-06-08_

## Summary

Add a fast way to edit an existing comment or issue/PR description without going through the
ellipsis (kebab) menu. Hovering an editable comment gives it a **subtle outline** (the "this is
the target" affordance); pressing **`e`** (no modifiers) while a comment is outlined flips *that*
comment into GitHub's native edit mode.

The crux — GitHub has no notion of a "selected comment" — is answered by the **hovered comment is
the target**. The mouse is already near what you're reading; the keypress just commits. No new
navigation model, no persistent selection state.

Critically, this does **not** reimplement editing. It drives GitHub's *own* edit flow
(kebab → "Edit"), so the rendered editor, autocomplete, preview, ⌘Enter submit, and — importantly
— **permissions** all come for free: a comment you can't edit has no "Edit" menu item, so the
keypress is a silent no-op.

## Motivation

Editing an existing comment/description is one of the most frequent actions, and today it's a
multi-step hunt: find the kebab → open menu → click "Edit". This collapses that to a single
keypress on the comment you're already looking at.

Backlog item ("Toggle edit / view mode … not sure how it'll 'select' which comment/description")
— the open question there was exactly the target-selection problem, now resolved via hover.

## Key technical findings

Verified live on real GitHub (2026-06-08), new React issue UI
(`github.com/chrismyang/hammersmith/issues/1`):

- The issue **description** and each **timeline comment** are distinct containers, each holding a
  rendered `.markdown-body` (`[data-testid="markdown-body"]`) and an actions kebab button
  `[data-testid="comment-header-hamburger"]` (aria-label like _"Actions for chrismyang's comment,
  3:03 PM on June 3"_). The description body sits in `[data-testid="issue-body-viewer"]`.
- The kebab's menu items render **lazily** — only after the kebab is clicked. The menu then
  contains: Copy link, Copy Markdown, Quote reply, Reference in a new issue, **Edit**, Pin, Hide,
  Delete.
- The **"Edit" item** is an `li[role="menuitem"]` whose trimmed `textContent` is exactly `"Edit"`
  (class `prc-ActionList-ActionListItem-*`, **no `data-testid`**). Selecting it by role + exact
  text is the reliable, surface-agnostic handle. ("Edit Assignees/Labels/…" buttons elsewhere on
  the page are `<button>`s outside the open menu, so a role=menuitem + exact-text match excludes
  them.)
- Programmatic "edit this comment" path (verified mechanics): locate the comment's kebab → click
  → wait for the menu's "Edit" `menuitem` to appear → click it. The comment then flips to its
  in-place editor.

The other two surfaces (PR inline/code-review comments, Projects issue side-pane) follow the
same shape — a rendered body + an actions kebab whose menu carries an "Edit" item — but their
container/kebab selectors differ and are **verified live during implementation** (see Surfaces).

## Behavior

- **Hover affordance:** while the pointer is over an editable comment container, that container
  gets a subtle outline (`.gmti-qe-target`). Moving to another comment moves the outline; leaving
  all comments removes it. The outline is the visual contract: whatever is outlined is what `e`
  will edit.
- **Trigger:** `e` with **no** Ctrl/Alt/Meta/Shift, not mid-IME-composition, fires the fast-edit
  **only** when (a) the focused/event-target element is **not** an editable field
  (`input` / `textarea` / `select` / `[contenteditable]`) and (b) a comment is currently hovered.
  When both hold, we `preventDefault()` + `stopPropagation()` and drive the edit. Otherwise we do
  nothing and let `e` behave natively (so GitHub's own single-key shortcuts are unaffected when no
  comment is hovered, and typing `e` in any field is untouched).
- **Activation:** find the hovered comment's kebab → click → poll briefly (a few animation
  frames, ~250 ms cap) for the menu's "Edit" `menuitem` → click it. Then ensure the resulting
  editor textarea is focused and scrolled into view. If no "Edit" item appears within the cap
  (not editable / permission), close the opened menu (so we never leave a stray menu open) and
  no-op.
- **No toggle-off.** `e` only *enters* edit mode. Exiting is GitHub-native (Escape / Cancel) —
  and once focus is in the editor textarea, the `e` trigger stands down anyway, so there's nothing
  to special-case.

## Architecture

Follows the repo's existing split (DOM glue separate from `content.js`'s listener; the `Ctrl+;`
issue-search branch is the precedent).

- **`src/quick-edit.js`** — DOM/event glue (analogous to `src/issue-search-ui.js`; no pure text
  logic, so no unit tests):
  - A document `mouseover`/`mouseout` listener resolves the pointer to the nearest editable-comment
    container (`event.target.closest(<container selectors>)`), tracks it as the current target, and
    applies/removes `.gmti-qe-target`. Recomputed cheaply on each `mouseover`; the class only
    changes when the resolved container changes.
  - `GMTI.quickEditHovered()` → if a current hovered target exists, calls `editComment` on it;
    returns whether it acted (so `content.js` knows whether to swallow the key).
  - `GMTI.editComment(container)` → the kebab → "Edit" dance, self-cleaning on failure. Every DOM
    read/mutation wrapped so a GitHub DOM change can never throw into the page or leave a menu open.
  - Single document-level listeners (survive GitHub's SPA navigation; never torn down) — consistent
    with the repo convention.
- **`src/quick-edit.css`** — the `.gmti-qe-target` outline. Uses `outline` / `box-shadow` (no
  layout reflow), subtle, and theme-aware via Primer CSS variables
  (e.g. `var(--borderColor-accent-emphasis, …)`), matching `issue-search.css`'s approach.
- **`src/content.js`** — a new branch at the top of the existing capture-phase `keydown` listener
  (mirroring the `Ctrl+;` branch), placed **before** the markdown-field gate: if the event is the
  fast-edit trigger (`e`, no modifiers, not composing) and the target/active element is not an
  editable field and `GMTI.quickEditHovered` exists, call it; if it acted, `preventDefault()` +
  `stopPropagation()`. The trigger gating is small and DOM-coupled, so it lives inline like the
  other trigger checks (untested, consistent with the existing branches).
- **`manifest.json`** — add `src/quick-edit.js` to `js` and `src/quick-edit.css` to `css`.

## Surfaces

Spec covers all three; built and live-verified together (per the rollout choice). Detection is a
small per-surface set of (container selector, kebab selector); the "Edit" `menuitem` finder is
universal (role=menuitem + exact text "Edit").

1. **Issue/PR description + timeline comments** (new React UI) — _verified above._ Container:
   `[data-testid="issue-body-viewer"]` (description) and the timeline comment container; kebab:
   `[data-testid="comment-header-hamburger"]`.
2. **PR inline / code-review comments** (Files-changed diff threads) — different container DOM;
   verify selectors + that the menu carries "Edit" live.
3. **Projects issue side-pane** — the comment editor there already matches the repo's
   `MarkdownEditor` wrapper (per FEATURE_IDEAS probe, 2026-06-03); verify the rendered-comment
   container + kebab in the pane live.

Each surface's exact selectors are captured during implementation via a live DOM probe (the repo's
established practice) and recorded in the plan.

## Edge cases & safety

- **Stand-down while typing:** the editable-field check means `e` types normally in any input,
  textarea, or contenteditable (search box, the comment editor itself, etc.).
- **Not-editable comments:** outline still appears (we don't open menus on hover to check
  permission), but `e` is a silent no-op when no "Edit" item exists. _Possible later refinement:
  restrict the outline to comments authored by the current user — deferred (YAGNI for now)._
- **No stray menus:** if activation fails to find "Edit", the opened kebab menu is closed.
- **Never break the page:** all DOM work in `quick-edit.js` and the `content.js` branch is wrapped
  in try/catch; any failure falls back to native behavior (the page is untouched).
- **No layout shift:** the outline must not reflow the comment (use `outline`/`box-shadow`, not a
  `border`).
- **SPA resilience:** document-level listeners are installed once and never removed, so they keep
  working across GitHub's client-side navigation and for dynamically-added comments.

## Testing

This feature is entirely DOM/event glue (no text computation), so — consistent with how
`src/issue-search-ui.js` is handled — there are **no unit tests**. `node --check` after edits, and
**live verification on real GitHub via the Playwright MCP browser** per surface:

1. Reload the extension on `chrome://extensions`, then reload the GitHub page.
2. Confirm the main world is clean (`typeof globalThis.GMTI === 'undefined'`).
3. Hover a comment → assert `.gmti-qe-target` outlines the right container; press `e` → assert the
   comment enters edit mode (its editor textarea appears and is focused). Hover a non-editable
   comment → `e` is a no-op and no menu is left open. Verify `e` types normally inside a field.
   Repeat per surface (issue/PR body + comments, PR inline review, Projects pane).
   Cancel/Escape out of every editor; never submit.

## Out of scope (YAGNI)

- Keyboard-only comment navigation (j/k focus ring) — the hover model makes it unnecessary.
- A toggle-off / mouse double-click gesture — native Escape/Cancel covers exiting.
- Configurable trigger key — `e` is fixed; revisit only if a real collision surfaces.
- Restricting the outline to author-owned comments — deferred refinement.
