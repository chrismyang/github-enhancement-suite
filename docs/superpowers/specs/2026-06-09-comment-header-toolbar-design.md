# Comment header mini-toolbar (Edit + Copy link) — design

_Spec date: 2026-06-09_

## Summary

Extend the hover+`e` fast-edit feature: when an editable comment/description is hovered, also show
a small **mini-toolbar** in the comment's header — inline, just left of GitHub's native kebab — with
two icon buttons, **✎ Edit** and **🔗 Copy link** (the two actions used most). Each button carries a
tooltip that also **teaches its keyboard shortcut**: _"Edit (e)"_, _"Copy link (c)"_. So the toolbar
is the discoverable, clickable affordance *and* it advertises the keys; the shortcuts are the fast
path. `e` already exists; `c` (Copy link) is added.

The hover outline+shadow stays. Hover now produces three reinforcing signals: the outline (which
comment), the toolbar (what you can do), and the tooltips (the shortcut for each).

This is additive to the shipped `quick-edit.js`; it reuses the same comment-container detection and
the same "drive GitHub's own kebab→menu" mechanism (so permissions and GitHub's native feedback —
e.g. the "Copied!" toast — come for free).

## Motivation

The kebab menu buries the two most-frequent actions (Edit, Copy link) behind a click→menu→aim. The
fast-edit `e` already collapsed Edit to a keypress; this surfaces both actions as one-click buttons
*and* makes the shortcuts discoverable, so the feature teaches itself.

## Key technical finding — injection is safe (verified empirically)

The open question was whether injecting our own buttons into GitHub's React-managed header would be
stomped by React reconciliation or crash the page. **Tested live (2026-06-09)** by injecting a
button before the kebab and exercising re-renders:

| Scenario | Result |
| --- | --- |
| Inject button before the kebab | renders; kebab still works; no crash |
| Open/close the kebab menu | injected node **survives** |
| Trigger the username hovercard re-render | injected node **survives** |
| Injected button's own click handler | **fires** |
| Full edit→cancel rebuild | node gone (cluster is a new element) — **but no crash, kebab still works** |
| Console across all of the above | no React errors (only a pre-existing GitHub `agent_tasks` 404 + GraphQL preload warnings) |

**Conclusion:** injection is safe. The only failure mode is the heavy edit/cancel rebuild discarding
our node — harmless, because the toolbar is injected **transiently on every hover** (re-injected on
the next hover). Crucially, that rebuild **replaces the whole parent cluster** (it's a different DOM
node afterward), so React never calls `removeChild` on *our* node among its surviving siblings —
that's the path that classically crashes, and it never occurred.

## Behavior

- **Trigger:** the existing hover tracking (`commentContainerOf`) already identifies the hovered
  comment/description and applies the outline. On becoming the hovered target, also inject the
  toolbar into that comment's header; on leaving (target change/clear), remove it.
- **Placement:** insert the toolbar **into the kebab's parent cluster, immediately before the
  kebab** (`kebab.parentElement.insertBefore(toolbar, kebab)`). This is uniform across surfaces —
  for timeline comments the cluster is `ActivityHeader-module__ActionsButtonsContainer`; for the
  description it's the `IssueBodyHeader` actions section — in both, the kebab's parent is the
  right-side action cluster. No per-surface injection selector needed.
- **Buttons:** two borderless icon buttons styled to sit naturally next to the kebab:
  - **Edit** (pencil octicon) → runs the existing edit flow (kebab→"Edit" + focus/scroll).
  - **Copy link** (link octicon) → drives kebab→"Copy link" (gives GitHub's real canonical URL and
    its native "Copied!" toast for free).
- **Tooltips:** each button shows a small tooltip on hover with the action + shortcut: _"Edit (e)"_,
  _"Copy link (c)"_. Implemented as our own lightweight CSS tooltip (`:hover`-driven via a
  data-attribute; no JS), **styled to visually match GitHub's tooltip** (dark background, same
  padding/radius/font-size, pointing up from below the button). We deliberately do *not* reuse
  Primer's TooltipV2 — it's a JS-driven Popover-API component with a per-build hashed class, so
  cloning its markup wouldn't show/position without re-implementing its behavior and coupling to
  Primer internals; a self-contained CSS tooltip is more robust. Trade-off: not pixel-identical and
  could drift if GitHub restyles tooltips (acceptable).
- **Keyboard:** `c` (Copy link) is added in `content.js`, mirroring the `e` branch exactly — bare
  key, no modifiers, not composing, target not an editable field, a comment hovered; only then
  `preventDefault()`+`stopPropagation()` and act. `e` is unchanged.
- **Idempotent / self-healing:** before injecting, check our toolbar isn't already present in the
  target's header; if the target is current but our toolbar went missing (a re-render dropped it),
  re-inject on the next hover tick. Never inject into more than one header at a time.

## Architecture

Extends the existing module; no new files.

- **`src/quick-edit.js`**
  - Generalize the kebab→"Edit" dance into **`clickMenuItem(container, label)`** (open the
    kebab's menu — scoped to the menu that appears after our click, as today — find the
    `[role="menuitem"]` whose trimmed text equals `label`, click it; self-cleaning: close the menu
    if the item never appears). `editComment(container)` becomes `clickMenuItem(container, 'Edit')`
    followed by the existing `focusEditor`; **`copyLink(container)`** = `clickMenuItem(container,
    'Copy link')`.
  - **Toolbar injection** tied to the existing `setTarget(el)`: when a comment becomes current,
    build (once) and inject the toolbar before its kebab; when it stops being current, remove the
    toolbar. The toolbar's Edit/Copy-link buttons call `editComment`/`copyLink` for the *current*
    container. All DOM work wrapped in try/catch (never break the page); the re-entry `busy` guard
    already serializes the menu dances.
  - Expose **`GMTI.quickCopyHovered()`** (mirror of `quickEditHovered`: act on the current hovered
    comment, return whether it acted) for the `c` keydown.
- **`src/quick-edit.css`** — styles for `.gmti-qe-toolbar` (the injected container) and its
  buttons (borderless, native-ish hover background via Primer vars), plus the CSS tooltip. Outline
  styles unchanged.
- **`src/content.js`** — add the `c` branch next to the `e` branch (same stand-down logic), calling
  `GMTI.quickCopyHovered`.

## Surfaces

Same as the shipped fast-edit feature: the `COMMENT_SEL` containers — issue/PR timeline comments
(`[data-testid^="comment-viewer-outer-box-"]`) and the issue description (`[data-testid="issue-body"]`).
PR description, PR inline review comments, and the Projects side-pane remain the deferred follow-up
(adding their container selector to `COMMENT_SEL`); the toolbar rides on the same detection, so it
extends to those surfaces for free once their selectors are added.

## Edge cases & safety

- **Non-editable comments:** as today, editability isn't known without opening the menu, so the
  toolbar shows Edit on every hovered comment; clicking Edit (or pressing `e`) on a comment you
  can't edit is a silent no-op (no "Edit" item → menu closes). Copy link always works. _Possible
  later refinement: hide Edit when not the author — deferred (YAGNI)._
- **`c` collisions:** GitHub may bind bare `c` elsewhere; we only swallow it when a comment is
  hovered and you're not typing, and `stopPropagation` only when we act — otherwise `c` passes
  through untouched.
- **Brief menu flash:** Copy link (like Edit) opens the kebab menu momentarily before clicking the
  item. Acceptable; matches the existing Edit behavior.
- **Never break the page / box:** all injection and menu-driving is try/catch-wrapped; failure
  leaves GitHub's header untouched. Injection is idempotent and removed on un-hover, and a full
  re-render that drops our node is recovered on the next hover.
- **No layout reflow of content:** the toolbar lives in the header's existing action cluster
  (flex row), so it doesn't shift the comment body.

## Testing

DOM/event glue (no text logic) → no unit tests; `node --check` after edits and **live verification
on real GitHub** via the Playwright MCP browser:

1. Reload the extension on `chrome://extensions`, reload the page, confirm the main world is clean.
2. Hover a comment → toolbar appears before the kebab (one instance, in the right header); outline
   still shows. Hover the description → toolbar appears in its header.
3. Click **Edit** → comment enters edit mode (focused). Cancel. Click **Copy link** → GitHub's
   "Copied!" feedback appears and the clipboard holds the comment URL.
4. Press `e` → edit; press `c` → copy link. Confirm `e`/`c` type normally inside a focused field
   (stand-down). Move the mouse off the comment → toolbar removed (no orphan).
5. Edit→cancel a comment, then hover again → toolbar re-appears (re-injection works). Check the
   console for any React errors (expect none from us).

## Out of scope (YAGNI)

- More than the two actions (Quote reply, Pin, Hide, Delete stay in the kebab).
- A configurable action set or key remapping.
- Hiding Edit on non-editable comments (deferred refinement).
- Extending `COMMENT_SEL` to PR-inline / Projects surfaces (the existing deferred follow-up).
