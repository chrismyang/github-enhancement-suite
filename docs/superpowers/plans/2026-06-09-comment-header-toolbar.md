# Comment header mini-toolbar (Edit + Copy link) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On hover, show a mini-toolbar (✎ Edit, 🔗 Copy link) in an editable comment/description's header — inline before the native kebab — with tooltips that teach the `e`/`c` shortcuts; add the `c` (Copy link) shortcut.

**Architecture:** Extend the existing `src/quick-edit.js`. Generalize its kebab→"Edit" dance into `clickMenuItem(container, label, after)` (so Edit and Copy link both reuse GitHub's own menu — permissions and the native "Copied!" toast come for free). Inject a transient toolbar into the kebab's action cluster when a comment becomes the hover target (proven safe vs React reconciliation by a live experiment; re-injected on the next hover if a re-render drops it). Add a `c` keydown branch in `content.js` mirroring `e`.

**Tech Stack:** Vanilla JS content script (MV3, no build/deps), manifest-injected CSS, Node `node:test` for the existing suite, Playwright MCP for live verification. DOM/event glue → no unit tests; live-verified (like `issue-search-ui.js`).

**Spec:** `docs/superpowers/specs/2026-06-09-comment-header-toolbar-design.md`

---

## File Structure

- **Modify `src/quick-edit.js`** — generalize the menu dance (`clickMenuItem`), add `copyLink`/`quickCopyHovered`, add the toolbar (icons, build/inject/remove, wire into `setTarget` + self-heal in `onMouseOver`).
- **Modify `src/quick-edit.css`** — styles for the toolbar, its buttons, and the custom CSS tooltip (matching GitHub's look).
- **Modify `src/content.js`** — combine the `e` keydown branch into an `e`/`c` branch.
- **Modify `CLAUDE.md` + `FEATURE_IDEAS.md`** — record the toolbar + `c` shortcut.

No manifest change (both files are already injected).

---

## Task 1: Generalize the menu dance + add Copy link

**Files:**
- Modify: `src/quick-edit.js`

- [ ] **Step 1: Generalize `findEditItem` → `findMenuItem(menu, label)`**

Replace:

```js
  function findEditItem(menu) {
    const items = menu.querySelectorAll('[role="menuitem"]');
    for (let i = 0; i < items.length; i++) {
      if ((items[i].textContent || '').trim() === 'Edit') return items[i];
    }
    return null;
  }
```

with:

```js
  function findMenuItem(menu, label) {
    const items = menu.querySelectorAll('[role="menuitem"]');
    for (let i = 0; i < items.length; i++) {
      if ((items[i].textContent || '').trim() === label) return items[i];
    }
    return null;
  }
```

- [ ] **Step 2: Replace `editComment` with `clickMenuItem` + thin `editComment`/`copyLink` wrappers**

Replace the entire existing `editComment` function (its leading comment block through its closing `}`):

```js
  // Drive GitHub's own kebab -> "Edit" flow for one comment container. The kebab
  // exposes no aria-controls, so we scope the "Edit" lookup to the menu that
  // APPEARS after the click (diffed against a pre-click snapshot) — never an
  // unrelated menu already open elsewhere. Primer unmounts menus when closed, so
  // the snapshot diff reliably isolates our menu.
  function editComment(container) {
    if (busy) return;
    let kebab;
    try { kebab = findKebab(container); } catch (err) { return; }
    if (!kebab) return;
    let before;
    try { before = new Set(document.querySelectorAll('[role="menu"]')); } catch (err) { before = new Set(); }
    busy = true;
    try { kebab.click(); } catch (err) { busy = false; return; }
    let frames = 0;
    (function poll() {
      let menu = null;
      try {
        const menus = document.querySelectorAll('[role="menu"]');
        for (let i = 0; i < menus.length; i++) {
          if (!before.has(menus[i])) { menu = menus[i]; break; }
        }
      } catch (err) {}
      // Wait until our menu has rendered its items before deciding.
      if (menu && menu.querySelector('[role="menuitem"]')) {
        let item = null;
        try { item = findEditItem(menu); } catch (err) {}
        if (item) {
          try { item.click(); } catch (err) {}
          focusEditor(container);
        } else {
          closeMenu(kebab); // menu rendered without "Edit" -> not editable
        }
        busy = false;
        return;
      }
      if (frames++ < EDIT_POLL_FRAMES) { requestAnimationFrame(poll); return; }
      closeMenu(kebab); // menu never appeared -> ensure nothing left open
      busy = false;
    })();
  }
```

with:

```js
  // Drive GitHub's own kebab -> menu -> click the item whose text === `label`,
  // then run `after(container)` if the click succeeded. The kebab exposes no
  // aria-controls, so we scope the lookup to the menu that APPEARS after our
  // click (diffed against a pre-click snapshot) — never an unrelated menu
  // already open elsewhere. Primer unmounts menus when closed, so the snapshot
  // diff reliably isolates our menu.
  function clickMenuItem(container, label, after) {
    if (busy) return;
    let kebab;
    try { kebab = findKebab(container); } catch (err) { return; }
    if (!kebab) return;
    let before;
    try { before = new Set(document.querySelectorAll('[role="menu"]')); } catch (err) { before = new Set(); }
    busy = true;
    try { kebab.click(); } catch (err) { busy = false; return; }
    let frames = 0;
    (function poll() {
      let menu = null;
      try {
        const menus = document.querySelectorAll('[role="menu"]');
        for (let i = 0; i < menus.length; i++) {
          if (!before.has(menus[i])) { menu = menus[i]; break; }
        }
      } catch (err) {}
      // Wait until our menu has rendered its items before deciding.
      if (menu && menu.querySelector('[role="menuitem"]')) {
        let item = null;
        try { item = findMenuItem(menu, label); } catch (err) {}
        if (item) {
          try { item.click(); } catch (err) {}
          if (after) { try { after(container); } catch (err) {} }
        } else {
          closeMenu(kebab); // menu rendered without the item -> not available
        }
        busy = false;
        return;
      }
      if (frames++ < EDIT_POLL_FRAMES) { requestAnimationFrame(poll); return; }
      closeMenu(kebab); // menu never appeared -> ensure nothing left open
      busy = false;
    })();
  }

  function editComment(container) { clickMenuItem(container, 'Edit', focusEditor); }
  function copyLink(container) { clickMenuItem(container, 'Copy link'); }
```

- [ ] **Step 3: Add `quickCopyHovered` and export it**

Replace:

```js
  // Called from content.js on a bare 'e' keydown. Returns whether we handled it.
  function quickEditHovered() {
    const c = current;
    if (!c || !c.isConnected) return false;
    try { editComment(c); } catch (err) { /* never break the page */ }
    return true;
  }

  document.addEventListener('mouseover', onMouseOver, true);
  GMTI.quickEditHovered = quickEditHovered;
```

with:

```js
  // Called from content.js on a bare 'e' / 'c' keydown. Each acts on the
  // currently-hovered comment and returns whether we handled the key.
  function quickEditHovered() {
    const c = current;
    if (!c || !c.isConnected) return false;
    try { editComment(c); } catch (err) { /* never break the page */ }
    return true;
  }
  function quickCopyHovered() {
    const c = current;
    if (!c || !c.isConnected) return false;
    try { copyLink(c); } catch (err) { /* never break the page */ }
    return true;
  }

  document.addEventListener('mouseover', onMouseOver, true);
  GMTI.quickEditHovered = quickEditHovered;
  GMTI.quickCopyHovered = quickCopyHovered;
```

- [ ] **Step 4: Syntax-check + confirm no stale references**

Run: `node --check src/quick-edit.js`
Expected: exit 0, no output.

Run: `grep -n "findEditItem" src/quick-edit.js`
Expected: no matches (it was fully renamed to `findMenuItem`).

- [ ] **Step 5: Commit**

```bash
git add src/quick-edit.js
git commit -m "refactor: generalize quick-edit menu dance; add copyLink + quickCopyHovered"
```

---

## Task 2: Inject the hover toolbar

**Files:**
- Modify: `src/quick-edit.js`

- [ ] **Step 1: Add the `TOOLBAR_CLASS` constant**

Replace:

```js
  const TARGET_CLASS = 'gmti-qe-target';
```

with:

```js
  const TARGET_CLASS = 'gmti-qe-target';
  const TOOLBAR_CLASS = 'gmti-qe-toolbar';
```

- [ ] **Step 2: Add icons + toolbar build/inject/remove (insert immediately before `function setTarget(el) {`)**

Insert this block directly above the existing `function setTarget(el) {` line:

```js
  // GitHub octicons (captured verbatim from the kebab menu items), colored via CSS.
  const ICON_EDIT = '<svg class="octicon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Zm.176 4.823L9.75 4.81l-6.286 6.287a.253.253 0 0 0-.064.108l-.558 1.953 1.953-.558a.253.253 0 0 0 .108-.064Zm1.238-3.763a.25.25 0 0 0-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 0 0 0-.354Z"></path></svg>';
  const ICON_LINK = '<svg class="octicon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="m7.775 3.275 1.25-1.25a3.5 3.5 0 1 1 4.95 4.95l-2.5 2.5a3.5 3.5 0 0 1-4.95 0 .751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018 1.998 1.998 0 0 0 2.83 0l2.5-2.5a2.002 2.002 0 0 0-2.83-2.83l-1.25 1.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042Zm-4.69 9.64a1.998 1.998 0 0 0 2.83 0l1.25-1.25a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042l-1.25 1.25a3.5 3.5 0 1 1-4.95-4.95l2.5-2.5a3.5 3.5 0 0 1 4.95 0 .751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018 1.998 1.998 0 0 0-2.83 0l-2.5 2.5a1.998 1.998 0 0 0 0 2.83Z"></path></svg>';

  // Build one toolbar button. `tip` is both the accessible label and the CSS
  // tooltip text (includes the shortcut, e.g. "Edit (e)"). mousedown is
  // prevented so clicking doesn't steal focus; the action runs against whatever
  // comment is current at click time.
  function makeButton(iconSvg, tip, action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'gmti-qe-btn';
    b.setAttribute('aria-label', tip);
    b.setAttribute('data-gmti-tip', tip);
    b.innerHTML = iconSvg; // static, trusted octicon markup (not remote data)
    b.addEventListener('mousedown', function (e) { e.preventDefault(); });
    b.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      if (current) { try { action(current); } catch (err) { /* never break the page */ } }
    });
    return b;
  }

  // Inject the mini-toolbar (Edit, Copy link) just before the comment's kebab,
  // in the kebab's own action cluster. Idempotent. Injection is verified safe vs
  // React reconciliation; a re-render that drops it is recovered on the next hover.
  function addToolbar(container) {
    try {
      const kebab = findKebab(container);
      if (!kebab || !kebab.parentElement) return;
      const cluster = kebab.parentElement;
      if (cluster.querySelector('.' + TOOLBAR_CLASS)) return; // already present
      const tb = document.createElement('span');
      tb.className = TOOLBAR_CLASS;
      tb.appendChild(makeButton(ICON_EDIT, 'Edit (e)', editComment));
      tb.appendChild(makeButton(ICON_LINK, 'Copy link (c)', copyLink));
      cluster.insertBefore(tb, kebab);
    } catch (err) { /* never break the page */ }
  }

  function removeToolbar() {
    try {
      const els = document.querySelectorAll('.' + TOOLBAR_CLASS);
      for (let i = 0; i < els.length; i++) els[i].remove();
    } catch (err) { /* ignore */ }
  }

```

- [ ] **Step 3: Wire the toolbar into `setTarget`**

Replace:

```js
  function setTarget(el) {
    if (el === current) return;
    if (current) current.classList.remove(TARGET_CLASS);
    current = el;
    if (current) current.classList.add(TARGET_CLASS);
  }
```

with:

```js
  function setTarget(el) {
    if (el === current) return;
    if (current) current.classList.remove(TARGET_CLASS);
    removeToolbar();
    current = el;
    if (current) { current.classList.add(TARGET_CLASS); addToolbar(current); }
  }
```

- [ ] **Step 4: Self-heal the toolbar in `onMouseOver`**

Replace:

```js
  function onMouseOver(e) {
    try {
      if (current && current.isConnected && current.contains(e.target)) return;
      setTarget(commentContainerOf(e.target));
    } catch (err) { /* never break the page */ }
  }
```

with:

```js
  function onMouseOver(e) {
    try {
      if (current && current.isConnected && current.contains(e.target)) {
        // A re-render may have dropped our toolbar while still on this comment.
        if (!current.querySelector('.' + TOOLBAR_CLASS)) addToolbar(current);
        return;
      }
      setTarget(commentContainerOf(e.target));
    } catch (err) { /* never break the page */ }
  }
```

- [ ] **Step 5: Syntax-check**

Run: `node --check src/quick-edit.js`
Expected: exit 0, no output.

- [ ] **Step 6: Commit**

```bash
git add src/quick-edit.js
git commit -m "feat: inject Edit + Copy link mini-toolbar on comment hover"
```

---

## Task 3: Toolbar + tooltip styles

**Files:**
- Modify: `src/quick-edit.css`

- [ ] **Step 1: Append the toolbar styles to `src/quick-edit.css`**

Append (after the existing `.gmti-qe-target` rule):

```css

/* Mini-toolbar injected into the comment header (Edit + Copy link). */
.gmti-qe-toolbar {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-right: 4px;
}
.gmti-qe-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--fgColor-muted, #59636e);
  cursor: pointer;
}
.gmti-qe-btn:hover {
  background: var(--bgColor-neutral-muted, rgba(175, 184, 193, 0.2));
  color: var(--fgColor-default, #1f2328);
}
.gmti-qe-btn .octicon { fill: currentColor; }

/* Custom tooltip styled to match GitHub's (dark box + caret, centered below). */
.gmti-qe-btn::after {
  content: attr(data-gmti-tip);
  position: absolute;
  top: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  white-space: nowrap;
  background: var(--bgColor-emphasis, #24292f);
  color: var(--fgColor-onEmphasis, #ffffff);
  font-size: 11px;
  line-height: 1.4;
  padding: 4px 8px;
  border-radius: 6px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.1s ease-in;
  z-index: 100;
}
.gmti-qe-btn::before {
  content: "";
  position: absolute;
  top: calc(100% + 1px);
  left: 50%;
  transform: translateX(-50%);
  border: 5px solid transparent;
  border-bottom-color: var(--bgColor-emphasis, #24292f);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.1s ease-in;
  z-index: 100;
}
.gmti-qe-btn:hover::after, .gmti-qe-btn:focus-visible::after,
.gmti-qe-btn:hover::before, .gmti-qe-btn:focus-visible::before {
  opacity: 1;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/quick-edit.css
git commit -m "feat: styles for comment header toolbar + tooltip"
```

---

## Task 4: Add the `c` (Copy link) keyboard shortcut

**Files:**
- Modify: `src/content.js`

- [ ] **Step 1: Combine the `e` keydown branch into an `e`/`c` branch**

Replace:

```js
      // Fast-edit: a bare 'e' while hovering a rendered comment/description flips
      // it into GitHub's native edit mode (target = the hovered comment). Stands
      // down while typing in any field so 'e' types normally.
      if (e.key === 'e' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && !e.isComposing) {
        const t = e.target;
        const inField = t instanceof HTMLElement &&
          (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
        if (inField || !GMTI.quickEditHovered) return;
        let acted = false;
        try { acted = GMTI.quickEditHovered(); } catch (err) { acted = false; }
        if (acted) { e.preventDefault(); e.stopPropagation(); }
        return;
      }
```

with:

```js
      // Fast actions on the hovered comment/description: bare 'e' edits, bare 'c'
      // copies its link (driving GitHub's own menu). Target = the hovered comment.
      // Stands down while typing in any field so the keys type normally.
      if ((e.key === 'e' || e.key === 'c') && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && !e.isComposing) {
        const t = e.target;
        const inField = t instanceof HTMLElement &&
          (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
        const fn = e.key === 'e' ? GMTI.quickEditHovered : GMTI.quickCopyHovered;
        if (inField || !fn) return;
        let acted = false;
        try { acted = fn(); } catch (err) { acted = false; }
        if (acted) { e.preventDefault(); e.stopPropagation(); }
        return;
      }
```

- [ ] **Step 2: Syntax-check + run the suite**

Run: `node --check src/content.js`
Expected: exit 0.

Run: `npm test`
Expected: `# fail 0`.

- [ ] **Step 3: Commit**

```bash
git add src/content.js
git commit -m "feat: bare 'c' copies the hovered comment's link"
```

---

## Task 5: Live-verify (issue surface)

Driven by the controller via the Playwright MCP browser. Reload the extension first: navigate to `chrome://extensions`, then `browser_evaluate`:

```js
() => new Promise((res) => chrome.developerPrivate.getExtensionsInfo((infos) => {
  const ext = infos.find((i) => i.name === 'GitHub Markdown Tab Indent');
  chrome.developerPrivate.reload(ext.id, { failQuietly: false }, () => res(chrome.runtime.lastError ? 'err' : 'ok'));
}))
```
Expected: `ok`. (If `chrome.developerPrivate` is unavailable, ask the user to click reload on `chrome://extensions`.)

- [ ] **Step 1: Open the issue, confirm clean injection**

Navigate to `https://github.com/chrismyang/hammersmith/issues/1`; `browser_evaluate` `() => ({ clean: typeof globalThis.GMTI === 'undefined' })` → expect `{ clean: true }`.

- [ ] **Step 2: Toolbar appears in the right place, once**

`browser_hover` a timeline comment's body, then `browser_evaluate`:

```js
() => {
  const tbs = document.querySelectorAll('.gmti-qe-toolbar');
  const tb = tbs[0];
  const kebab = tb && tb.nextElementSibling;
  return {
    count: tbs.length,
    buttons: tb ? Array.from(tb.querySelectorAll('.gmti-qe-btn')).map(b => b.getAttribute('data-gmti-tip')) : [],
    siblingIsKebab: !!(kebab && kebab.querySelector('svg.octicon-kebab-horizontal')),
  };
}
```
Expected: `count: 1`, `buttons: ["Edit (e)", "Copy link (c)"]`, `siblingIsKebab: true` (toolbar sits immediately before the kebab).

- [ ] **Step 3: Edit button opens the editor**

`browser_evaluate` `() => { document.querySelector('.gmti-qe-btn[data-gmti-tip="Edit (e)"]').click(); }`, wait ~600ms (`browser_wait_for` time 1), then `browser_evaluate` checks an editor textarea is present + focused (`document.activeElement.tagName === 'TEXTAREA'`) and `document.querySelectorAll('[role="menuitem"]').length === 0`. Cancel out (click the visible "Cancel" button) — never submit.

- [ ] **Step 4: Copy link button copies the URL**

Hover the comment again, `browser_evaluate` click `'.gmti-qe-btn[data-gmti-tip="Copy link (c)"]'`, wait ~500ms, then read the clipboard:

```js
() => navigator.clipboard.readText().then(t => ({ copied: t })).catch(e => ({ err: String(e) }))
```
Expected: `copied` is the comment's `…/issues/1#issuecomment-…` URL. (If clipboard read is blocked by permissions in the automation context, instead assert GitHub's "Copied!" feedback appeared and `[role="menuitem"].length === 0`.)

- [ ] **Step 5: Keyboard `e` and `c`, and stand-down**

Hover a comment, `browser_press_key` `e` → editor opens (cancel out). Hover again, `browser_press_key` `c` → link copied (as Step 4). Then focus the composer textarea, `browser_press_key` `c` and `e`, and assert each character is inserted into the textarea value (not swallowed). Clear the box.

- [ ] **Step 6: Description surface + tooltip + removal + re-inject**

Hover the description (`[data-testid="issue-body-viewer"]`) → toolbar appears in its header (re-run Step 2's snippet; `count: 1`). Move the mouse off all comments (hover the footer) → `document.querySelectorAll('.gmti-qe-toolbar').length === 0` (removed, no orphan). Screenshot a hovered button to confirm the tooltip renders "Edit (e)" / "Copy link (c)". Finally: edit→cancel a comment, then hover it again → toolbar re-appears (re-injection). Check the console (`browser_console_messages` onlyErrors) for React errors — expect none from us.

- [ ] **Step 7: Apply + commit any fixes surfaced**

If a step required a code change, apply it, `node --check src/quick-edit.js`, re-verify, and commit (`git commit -m "fix: quick-edit toolbar verification adjustments"`). Skip if none.

---

## Task 6: Documentation true-up

**Files:**
- Modify: `CLAUDE.md`
- Modify: `FEATURE_IDEAS.md`

- [ ] **Step 1: Update the `src/quick-edit.js` description in `CLAUDE.md`**

Replace:

```
src/quick-edit.js      DOM/event glue — hover an editable comment/description (subtle outline) and
                       press 'e' to flip it into GitHub's native edit mode. Tracks the hovered
                       comment (document mouseover) and drives GitHub's own kebab→Edit flow.
                       Exposes GMTI.quickEditHovered (called from content.js).
```

with:

```
src/quick-edit.js      DOM/event glue — hover an editable comment/description (subtle outline +
                       a mini-toolbar in the header: Edit, Copy link). Press 'e' to edit / 'c' to
                       copy link; the toolbar buttons do the same and their tooltips teach the
                       shortcuts. Tracks the hovered comment (document mouseover) and drives
                       GitHub's own kebab→menu flow (clickMenuItem). Exposes GMTI.quickEditHovered
                       + GMTI.quickCopyHovered (called from content.js).
```

- [ ] **Step 2: Note the `c` trigger in the `src/content.js` description in `CLAUDE.md`**

Replace:

```
                       keydown (Tab, Shift/plain Enter, wrap chars, Ctrl+; issue search, bare 'e'
                       fast-edit when hovering a comment) + paste; field detection; execCommand apply.
```

with:

```
                       keydown (Tab, Shift/plain Enter, wrap chars, Ctrl+; issue search, bare 'e'
                       edit / 'c' copy-link when hovering a comment) + paste; field detection;
                       execCommand apply.
```

- [ ] **Step 3: Update the "Already shipped" line in `FEATURE_IDEAS.md`**

Replace:

```
the Ctrl+; in-composer issue search, and hover+`e`
fast-edit for existing comments/descriptions.
```

with:

```
the Ctrl+; in-composer issue search, and the hover affordance for existing comments/descriptions
(outline + a header mini-toolbar with Edit/Copy-link, and `e`/`c` shortcuts).
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md FEATURE_IDEAS.md
git commit -m "docs: record comment header toolbar + 'c' shortcut"
```

---

## Task 7: Squash and push

- [ ] **Step 1: Squash the implementation commits into one**

Resolve the base (the plan-doc commit) dynamically and confirm the range before resetting:

```bash
BASE=$(git log --grep="implementation plan for comment header" --format=%H -n 1)
git log --oneline "$BASE"..HEAD   # sanity-check: only Task 1–6 commits listed
git reset --soft "$BASE"
git commit -m "$(cat <<'EOF'
feat: comment header mini-toolbar (Edit + Copy link) + 'c' shortcut

Hovering an editable comment/description now also shows a mini-toolbar in its
header (✎ Edit, 🔗 Copy link) inline before the native kebab, with tooltips
that teach the keyboard shortcuts. Adds bare 'c' to copy the hovered comment's
link; 'e' still edits. Both the buttons and the keys drive GitHub's own
kebab→menu flow (generalized clickMenuItem), so permissions and the native
"Copied!" toast come for free.

The toolbar is injected transiently on hover into the kebab's action cluster
(idempotent + self-healing) — native injection was chosen after a live
experiment proved it safe vs React reconciliation. Tooltip is a self-contained
CSS tooltip styled to match GitHub's. Extends src/quick-edit.js + .css; the 'c'
keydown rides content.js's existing listener. DOM glue, no unit tests —
live-verified on the issue surface.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

Note: `$BASE` resolves to this plan's doc commit. The sanity-check line must list **only** the Task 1–6 implementation/doc commits.

- [ ] **Step 2: Confirm + push**

Run: `git status` (clean), `npm test` (`# fail 0`), `node --check src/quick-edit.js && node --check src/content.js`.
Then: `git push origin main`.

---

## Self-review notes (addressed)

- **Spec coverage:** toolbar on hover (Task 2) + styles (Task 3); Edit/Copy-link reuse GitHub's menu via `clickMenuItem` (Task 1); `c` shortcut (Task 4); tooltips teaching shortcuts via CSS (Task 3); outline kept (untouched); idempotent + self-healing injection (Task 2); native injection safety (verified in spec); surfaces = existing `COMMENT_SEL` (unchanged); docs/backlog (Task 6); live verification incl. re-inject-after-rebuild + console check (Task 5).
- **Naming consistency:** `clickMenuItem`, `findMenuItem`, `editComment`, `copyLink`, `quickEditHovered`, `quickCopyHovered`, `addToolbar`/`removeToolbar`/`makeButton`, `TOOLBAR_CLASS = 'gmti-qe-toolbar'`, `.gmti-qe-btn`, `data-gmti-tip` — used identically across `quick-edit.js`, `quick-edit.css`, and the `content.js` call site.
- **Non-editable comments:** Edit shows on all hovered comments; clicking/pressing `e` no-ops when not editable (kept simple per the spec).
- **No placeholders:** all code is verbatim, including the captured octicon SVGs.
```
