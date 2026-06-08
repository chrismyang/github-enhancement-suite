# Fast-edit comment ("hover + `e`") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hover an editable GitHub comment/description (subtle outline) and press `e` to flip it into GitHub's native edit mode.

**Architecture:** A new DOM-glue module (`src/quick-edit.js`) tracks the comment under the pointer via a document `mouseover` listener and outlines it; it exposes `GMTI.quickEditHovered()`, which drives GitHub's own kebab→"Edit" flow on that comment. The `e` keydown is routed through `content.js`'s existing capture-phase listener (the `Ctrl+;` branch is the precedent). Detection is **surface-agnostic**: a comment container is the smallest ancestor of the cursor that holds both a `.markdown-body` and a kebab button (`button[aria-haspopup="true"]` containing `svg.octicon-kebab-horizontal`) — so issue/PR descriptions, timeline comments, PR inline review comments, and the Projects side-pane are all handled by one engine. Reusing GitHub's Edit flow gives permissions for free (no "Edit" item ⇒ silent no-op).

**Tech Stack:** Vanilla JS content script (MV3, no build/deps), manifest-injected CSS, Node `node:test` for the existing suite, Playwright MCP for live verification. This feature is pure DOM/event glue, so — consistent with `src/issue-search-ui.js` — it has **no unit tests**; it is live-verified on real GitHub.

**Spec:** `docs/superpowers/specs/2026-06-08-fast-edit-comment-design.md`

---

## File Structure

- **Create `src/quick-edit.js`** — hover tracking + outline + the kebab→Edit activation dance. Exposes `GMTI.quickEditHovered()`. DOM glue (like `issue-search-ui.js`); no pure logic, no unit tests.
- **Create `src/quick-edit.css`** — the `.gmti-qe-target` hover outline (no layout reflow, theme-aware).
- **Modify `src/content.js`** — add a `key === 'e'` branch to the existing capture-phase `keydown` listener that delegates to `GMTI.quickEditHovered()`.
- **Modify `manifest.json`** — register `src/quick-edit.js` (before `content.js`) and `src/quick-edit.css`.
- **Modify `CLAUDE.md`** — add the two new files to the Layout section + the `content_scripts` arrays line.
- **Modify `FEATURE_IDEAS.md`** — remove the now-shipped "Toggle edit / view mode" idea; update the "Already shipped" line.

---

## Task 1: Create the quick-edit DOM-glue module

**Files:**
- Create: `src/quick-edit.js`

- [ ] **Step 1: Write `src/quick-edit.js`**

```js
// Fast-edit: hover an editable comment/description (subtle outline) and press
// 'e' to flip it into GitHub's native edit mode. Pure DOM/event glue — the
// trigger keydown lives in content.js, which calls GMTI.quickEditHovered().
(function () {
  const GMTI = globalThis.GMTI;
  if (!GMTI) return;

  const TARGET_CLASS = 'gmti-qe-target';
  const MAX_ASCENT = 25;        // ancestors to climb when resolving a comment
  const EDIT_POLL_FRAMES = 20;  // ~320ms cap waiting for the menu's "Edit" item

  let current = null;           // the currently-outlined comment container

  // The kebab/actions button GitHub renders for a comment OR an issue/PR body.
  // Both use an octicon-kebab-horizontal glyph and aria-haspopup="true". The
  // reaction (smiley) button also has aria-haspopup, so the icon filter matters.
  function findKebab(root) {
    const btns = root.querySelectorAll('button[aria-haspopup="true"]');
    for (let i = 0; i < btns.length; i++) {
      if (btns[i].querySelector('svg.octicon-kebab-horizontal')) return btns[i];
    }
    return null;
  }

  // A comment container = the smallest ancestor of `el` that holds both a
  // rendered markdown body and its own kebab. Identifies one comment (or the
  // issue/PR description) without depending on per-surface testids.
  function commentContainerOf(el) {
    let node = el;
    for (let i = 0; i < MAX_ASCENT && node && node.nodeType === 1; i++) {
      if (node.querySelector('.markdown-body') && findKebab(node)) return node;
      node = node.parentElement;
    }
    return null;
  }

  function setTarget(el) {
    if (el === current) return;
    if (current) current.classList.remove(TARGET_CLASS);
    current = el;
    if (current) current.classList.add(TARGET_CLASS);
  }

  // Recompute the hovered comment. Cheap path: if still inside the current
  // container, do nothing.
  function onMouseOver(e) {
    try {
      if (current && current.isConnected && current.contains(e.target)) return;
      setTarget(commentContainerOf(e.target));
    } catch (err) { /* never break the page */ }
  }

  function findEditItem() {
    const items = document.querySelectorAll('[role="menuitem"]');
    for (let i = 0; i < items.length; i++) {
      if ((items[i].textContent || '').trim() === 'Edit') return items[i];
    }
    return null;
  }

  function closeMenu() {
    // Primer ActionMenu closes on Escape.
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    } catch (err) { /* ignore */ }
  }

  // Best-effort: focus the edit textarea once it mounts and scroll it into view.
  // GitHub usually focuses it itself; this is insurance + scroll.
  function focusEditor(container) {
    let frames = 0;
    (function poll() {
      let ta = null;
      try { ta = container.isConnected ? container.querySelector('textarea') : null; } catch (err) {}
      if (ta) {
        try {
          if (document.activeElement !== ta) {
            ta.focus();
            ta.setSelectionRange(ta.value.length, ta.value.length);
          }
          ta.scrollIntoView({ block: 'nearest' });
        } catch (err) {}
        return;
      }
      if (frames++ < EDIT_POLL_FRAMES) requestAnimationFrame(poll);
    })();
  }

  // Drive GitHub's own kebab -> "Edit" flow for one comment container.
  function editComment(container) {
    let kebab;
    try { kebab = findKebab(container); } catch (err) { return; }
    if (!kebab) return;
    try { kebab.click(); } catch (err) { return; }
    let frames = 0;
    (function poll() {
      let item = null;
      try { item = findEditItem(); } catch (err) {}
      if (item) {
        try { item.click(); } catch (err) {}
        focusEditor(container);
        return;
      }
      if (frames++ < EDIT_POLL_FRAMES) { requestAnimationFrame(poll); return; }
      closeMenu(); // no "Edit" (not editable / changed DOM) -> don't leave a menu open
    })();
  }

  // Called from content.js on a bare 'e' keydown. Returns whether we handled it.
  function quickEditHovered() {
    const c = current;
    if (!c || !c.isConnected) return false;
    try { editComment(c); } catch (err) { /* never break the page */ }
    return true;
  }

  document.addEventListener('mouseover', onMouseOver, true);
  GMTI.quickEditHovered = quickEditHovered;
})();
```

- [ ] **Step 2: Syntax-check**

Run: `node --check src/quick-edit.js`
Expected: no output (exit 0).

- [ ] **Step 3: Commit**

```bash
git add src/quick-edit.js
git commit -m "feat: quick-edit module — hover tracking + kebab→Edit dance"
```

---

## Task 2: Add the hover-outline styles

**Files:**
- Create: `src/quick-edit.css`

- [ ] **Step 1: Write `src/quick-edit.css`**

```css
/* Subtle ring on the comment/description the fast-edit 'e' will target.
   Inset box-shadow (not border/outline) so it never reflows layout or bleeds
   onto adjacent comments. Theme-aware via Primer's accent color. */
.gmti-qe-target {
  box-shadow: inset 0 0 0 2px var(--borderColor-accent-emphasis, #0969da);
  border-radius: 6px;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/quick-edit.css
git commit -m "feat: quick-edit hover outline styles"
```

---

## Task 3: Route the `e` trigger through content.js

**Files:**
- Modify: `src/content.js` (insert a branch in the capture-phase keydown listener, immediately after the `Ctrl+;` block that ends at the `return;`/`}` on line 72, and **before** `if (e.ctrlKey || e.altKey || e.metaKey) return;`)

- [ ] **Step 1: Insert the fast-edit branch**

Find this existing boundary in the keydown listener:

```js
        return;
      }
      if (e.ctrlKey || e.altKey || e.metaKey) return; // leave Ctrl/⌘+Enter (submit) etc. alone
```

Replace it with (adds the new branch between the two):

```js
        return;
      }
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
      if (e.ctrlKey || e.altKey || e.metaKey) return; // leave Ctrl/⌘+Enter (submit) etc. alone
```

- [ ] **Step 2: Syntax-check**

Run: `node --check src/content.js`
Expected: no output (exit 0).

- [ ] **Step 3: Run the existing test suite (nothing should regress)**

Run: `npm test`
Expected: `# fail 0` (content.js is not unit-tested; this just confirms no collateral breakage).

- [ ] **Step 4: Commit**

```bash
git add src/content.js
git commit -m "feat: route bare 'e' to quick-edit when hovering a comment"
```

---

## Task 4: Register the new files in the manifest

**Files:**
- Modify: `manifest.json:9-10`

- [ ] **Step 1: Add `quick-edit.js` (before `content.js`) and `quick-edit.css`**

Replace:

```json
      "js": ["src/indent.js", "src/issue-search.js", "src/issue-search-ui.js", "src/content.js"],
      "css": ["src/editor.css", "src/issue-search.css"],
```

with:

```json
      "js": ["src/indent.js", "src/issue-search.js", "src/issue-search-ui.js", "src/quick-edit.js", "src/content.js"],
      "css": ["src/editor.css", "src/issue-search.css", "src/quick-edit.css"],
```

- [ ] **Step 2: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add manifest.json
git commit -m "feat: inject quick-edit.js + quick-edit.css"
```

---

## Task 5: Live-verify — issue description + timeline comments

This and the next two tasks use the Playwright MCP browser driving the real loaded extension. Reload the extension first: navigate to `chrome://extensions`, then run (in `browser_evaluate`):

```js
() => new Promise((res) => chrome.developerPrivate.getExtensionsInfo((infos) => {
  const ext = infos.find((i) => i.name === 'GitHub Markdown Tab Indent');
  chrome.developerPrivate.reload(ext.id, { failQuietly: false }, () => res(chrome.runtime.lastError ? 'err' : 'ok'));
}))
```
Expected: `ok`. (If `chrome.developerPrivate` is unavailable, ask the user to click reload on `chrome://extensions`.)

- [ ] **Step 1: Open a fresh issue you authored and confirm clean injection**

Navigate to `https://github.com/chrismyang/hammersmith/issues/1`, then `browser_evaluate`:

```js
() => ({ mainWorldClean: typeof globalThis.GMTI === 'undefined' })
```
Expected: `{ mainWorldClean: true }` (the extension runs in the isolated world).

- [ ] **Step 2: Hover a comment → assert the outline lands on the right container**

`browser_hover` the rendered text of the first timeline comment, then `browser_evaluate`:

```js
() => {
  const t = document.querySelector('.gmti-qe-target');
  return {
    count: document.querySelectorAll('.gmti-qe-target').length,
    testid: t && t.getAttribute('data-testid'),
    hasBody: !!(t && t.querySelector('.markdown-body')),
  };
}
```
Expected: `count: 1`, `testid` begins with `comment-viewer-outer-box-`, `hasBody: true`.

- [ ] **Step 3: Press `e` → assert the comment enters edit mode**

With the comment hovered, `browser_press_key` `e`, then `browser_evaluate` (poll a beat first via `browser_wait_for` ~500ms):

```js
() => {
  const ta = document.querySelector('textarea[class*="prc-Textarea"], [class*="MarkdownInput-module"] textarea');
  return { editorOpen: !!ta, focused: !!ta && document.activeElement === ta };
}
```
Expected: `editorOpen: true`. Record whether `focused` is true (GitHub usually auto-focuses; `focusEditor` is the fallback). Cancel the editor (Escape / click Cancel) — **never submit**.

- [ ] **Step 4: Hover the issue description → press `e` → assert it enters edit mode**

`browser_hover` the description (`[data-testid="issue-body-viewer"]`), confirm `.gmti-qe-target` is now the `[data-testid="issue-body"]` container (re-run Step 2's snippet; `testid` should be `issue-body`), then press `e` and re-run Step 3's snippet. Expected: `editorOpen: true`. Cancel out.

- [ ] **Step 5: Stand-down checks**

`browser_evaluate` to focus the comment composer textarea, type `e`, and assert it was inserted (not swallowed):

```js
() => {
  const ta = document.querySelector('[class*="MarkdownInput-module"] textarea, textarea[aria-label="Markdown value"]');
  ta.focus(); return { focused: document.activeElement === ta };
}
```
Then `browser_press_key` `e` and `browser_evaluate` that `ta.value` now contains the typed `e`. Expected: the `e` typed normally. Clear the box afterward.

- [ ] **Step 6: No-stray-menu check (non-editable path)**

This is best-checked on a comment with no "Edit" item; if none is available in this repo, simulate by hovering a comment and pressing `e`, then immediately Escape, and assert no orphaned `[role="menuitem"]` menu remains after ~500ms:

```js
() => ({ openMenus: document.querySelectorAll('[role="menuitem"]').length })
```
Expected: `0` when no menu should be open.

- [ ] **Step 7: Commit any selector fixes**

If Steps 2–6 surfaced a needed adjustment to `src/quick-edit.js`, apply it, `node --check`, re-verify, and:

```bash
git add src/quick-edit.js
git commit -m "fix: quick-edit issue-surface verification adjustments"
```
(If no changes were needed, skip the commit.)

---

## Task 6: Live-verify — pull request (description, timeline comments, inline review comments)

- [ ] **Step 1: Reload the extension and open a PR you authored**

Reload (as in Task 5). Navigate to a PR you authored that has at least one timeline comment and at least one inline review comment (in `chrismyang/*` or `dragonflyic/*`). If no suitable PR exists, note this in the verification log and skip the inline-review sub-check.

- [ ] **Step 2: Verify the PR description + a timeline comment**

Repeat Task 5 Steps 2–3 on the PR description and a PR timeline comment. Expected: outline lands on the right container; `e` opens the editor. Cancel out, never submit.

- [ ] **Step 3: Verify a PR inline review comment (Files changed → a diff thread)**

Open the **Files changed** tab, hover an existing inline review comment you authored, and run Task 5 Step 2's snippet. Expected: `count: 1`, `hasBody: true` (the `testid` will differ from issues — record it). Press `e`; expected the inline comment enters edit mode. Cancel out.

- [ ] **Step 4: If a surface didn't resolve, capture its DOM and extend the engine**

If hover produced `count: 0` on any PR surface, `browser_evaluate` from the comment's markdown body upward to find why (no `.markdown-body`, or kebab uses a different icon/attr):

```js
() => {
  const md = document.querySelectorAll('.markdown-body');
  const last = md[md.length - 1];
  let n = last, hops = 0, info = [];
  while (n && hops < 12) {
    const k = Array.from(n.querySelectorAll('button[aria-haspopup="true"]'))
      .map(b => (b.querySelector('svg') || {}).getAttribute && b.querySelector('svg').getAttribute('class'));
    info.push({ hops, testid: n.getAttribute && n.getAttribute('data-testid'), kebabIcons: k });
    n = n.parentElement; hops++;
  }
  return info;
}
```
Use the result to adjust `findKebab` (e.g. broaden the icon match) or `commentContainerOf` minimally, `node --check`, re-verify. Commit:

```bash
git add src/quick-edit.js
git commit -m "fix: quick-edit support for PR inline review comments"
```
(Skip the commit if no change was needed.)

---

## Task 7: Live-verify — Projects issue side-pane

- [ ] **Step 1: Reload and open a Projects board issue side-pane**

Reload (as in Task 5). Open a Project you can access (`/orgs/dragonflyic/projects/<n>` or a user project), click an issue row to open the issue side-pane (`?pane=issue`). If no Project is accessible, note this in the verification log and skip this task.

- [ ] **Step 2: Verify hover + `e` in the side-pane**

Hover a rendered comment/description in the pane, run Task 5 Step 2's snippet (expect `count: 1`, `hasBody: true`; record the `testid`), press `e`, and confirm the editor opens (Task 5 Step 3 snippet). Cancel out, never submit.

- [ ] **Step 3: Adjust + commit if needed**

If a pane surface didn't resolve, use Task 6 Step 4's probe to capture its DOM, make the minimal engine adjustment, `node --check`, re-verify, and:

```bash
git add src/quick-edit.js
git commit -m "fix: quick-edit support for Projects side-pane"
```
(Skip if no change was needed.)

---

## Task 8: Documentation true-up

**Files:**
- Modify: `CLAUDE.md`
- Modify: `FEATURE_IDEAS.md`

- [ ] **Step 1: Update the `CLAUDE.md` Layout block**

In the `manifest.json` line of the Layout code block, update the arrays to include the new files. Replace:

```
manifest.json          MV3; one content_scripts entry on https://github.com/* :
                       js = [src/indent.js, src/issue-search.js, src/issue-search-ui.js,
                       src/content.js], css = [src/editor.css, src/issue-search.css]
```

with:

```
manifest.json          MV3; one content_scripts entry on https://github.com/* :
                       js = [src/indent.js, src/issue-search.js, src/issue-search-ui.js,
                       src/quick-edit.js, src/content.js], css = [src/editor.css,
                       src/issue-search.css, src/quick-edit.css]
```

- [ ] **Step 2: Add the `quick-edit.js` / `quick-edit.css` entries to the Layout list**

Immediately after the `src/issue-search-ui.js` description line in the Layout block, add:

```
src/quick-edit.js      DOM/event glue — hover an editable comment/description (subtle outline)
                       and press 'e' to flip it into GitHub's native edit mode. Tracks the
                       hovered comment (document mouseover) and drives GitHub's own kebab→Edit
                       flow. Exposes GMTI.quickEditHovered (called from content.js).
```

And immediately after the `src/issue-search.css` line, add:

```
src/quick-edit.css     Styling for the fast-edit hover outline (manifest-injected).
```

- [ ] **Step 3: Note the new keydown branch in `CLAUDE.md`**

In the `src/content.js` Layout line, update the capture-phase summary to mention the `e` trigger. Replace:

```
src/content.js         DOM glue — the ONLY file with the keydown/paste listeners. Capture-phase
                       keydown (Tab, Shift/plain Enter, wrap chars, Ctrl+; issue search) + paste;
                       field detection; execCommand apply.
```

with:

```
src/content.js         DOM glue — the ONLY file with the keydown/paste listeners. Capture-phase
                       keydown (Tab, Shift/plain Enter, wrap chars, Ctrl+; issue search, bare 'e'
                       fast-edit when hovering a comment) + paste; field detection; execCommand apply.
```

- [ ] **Step 4: True up `FEATURE_IDEAS.md`**

Update the "Already shipped" sentence to append the new feature. Replace:

```
and the Ctrl+; in-composer issue search.
```

with:

```
the Ctrl+; in-composer issue search, and hover+`e` fast-edit for existing comments/descriptions.
```

Then remove the now-shipped backlog sub-bullet (the `Toggle edit / view mode …` line under "Keyboard shorcuts for common operators"). Delete exactly this line:

```
  - Toggle edit / view mode (not sure how it'll "select" which comment/description I'm referring to though)
```

(Leave the `Toggle preview/edit mode` sub-bullet — that's a different, unshipped idea.)

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md FEATURE_IDEAS.md
git commit -m "docs: record quick-edit feature; true up backlog"
```

---

## Task 9: Squash and push

- [ ] **Step 1: Squash the feature's commits into one**

This feature was built directly on `main`. Soft-reset to the plan-doc commit (the last commit before Task 1) and recommit as a single commit. This keeps the spec + plan doc commits intact and folds only the Task 1–8 implementation commits. Resolve the base hash dynamically so it can't go stale:

```bash
BASE=$(git log --grep="implementation plan for fast-edit comment" --format=%H -n 1)
git log --oneline "$BASE"..HEAD   # sanity-check: only Task 1–8 commits listed
git reset --soft "$BASE"
git commit -m "$(cat <<'EOF'
feat: hover+e fast-edit for existing comments & descriptions

Hover an editable comment or issue/PR description (subtle outline) and press
'e' to flip it into GitHub's native edit mode — the hovered comment is the
target, solving the "no selected comment" problem. Drives GitHub's own
kebab→Edit flow, so permissions/editor/autocomplete come for free.

Surface-agnostic detection: a comment container is the smallest ancestor of
the cursor holding both a .markdown-body and a kebab button
(button[aria-haspopup=true] with an octicon-kebab-horizontal icon) — covers
issue/PR descriptions + timeline comments, PR inline review comments, and the
Projects side-pane. New DOM glue in src/quick-edit.js + src/quick-edit.css;
the 'e' keydown routes through content.js's existing listener. DOM glue, no
unit tests — live-verified on real GitHub.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

Note: `$BASE` resolves to the plan-doc commit. The sanity-check line must list **only** the Task 1–8 implementation commits — if it shows the spec or plan doc commit, stop and pick the correct base manually.

- [ ] **Step 2: Confirm the tree is intact and tests pass**

Run: `git status` (clean) and `npm test` (`# fail 0`). Run `node --check src/quick-edit.js && node --check src/content.js`.

- [ ] **Step 3: Push**

```bash
git push origin main
```

---

## Self-review notes (addressed)

- **Spec coverage:** hover outline (Task 1–2), `e` trigger + stand-down while typing (Task 3), kebab→Edit dance + permissions-free no-op + no stray menu + focus/scroll (Task 1), all three surfaces (Tasks 5–7), never-break-the-page try/catch (Task 1, Task 3), no-reflow outline (Task 2), SPA-resilient document listener (Task 1), docs/backlog true-up (Task 8).
- **Trigger key:** `e`, bare, per the brainstorm decision.
- **Detection:** surface-agnostic (no per-surface testid hardcoded); Tasks 6–7 include a concrete DOM-probe + minimal-adjustment fallback if a surface's kebab/body signal differs, rather than a placeholder selector.
- **Naming consistency:** `GMTI.quickEditHovered`, `commentContainerOf`, `findKebab`, `findEditItem`, `editComment`, `focusEditor`, `.gmti-qe-target` are used identically across `quick-edit.js` and the `content.js` call site.
