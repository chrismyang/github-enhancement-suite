// Fast-edit: hover an editable comment/description (subtle outline) and press
// 'e' to flip it into GitHub's native edit mode. Pure DOM/event glue — the
// trigger keydown lives in content.js, which calls GMTI.quickEditHovered().
(function () {
  const GMTI = globalThis.GMTI;
  if (!GMTI) return;

  const TARGET_CLASS = 'gmti-qe-target';
  const TOOLBAR_CLASS = 'gmti-qe-toolbar';
  const EDIT_POLL_FRAMES = 20;  // ~320ms cap waiting for the menu's "Edit" item

  // Comment containers we recognize. closest() against these answers "is the
  // cursor inside a comment?" precisely. (An earlier "smallest ancestor holding
  // a .markdown-body + a kebab" heuristic wrongly matched <html> whenever the
  // cursor was outside every comment, since the whole page contains both.)
  const COMMENT_SEL = [
    '[data-testid^="comment-viewer-outer-box-"]', // issue/PR timeline comment (React)
    '[data-testid="issue-body"]',                 // issue/PR description (React)
  ].join(',');

  let current = null;           // the currently-outlined comment container
  let busy = false;             // an edit dance is in flight (ignore re-entry)

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

  // The comment/description under `el`, or null if `el` isn't inside one we can
  // edit (requires a recognized container that actually has an Edit kebab).
  function commentContainerOf(el) {
    let node = null;
    try { node = el && el.closest ? el.closest(COMMENT_SEL) : null; } catch (err) { return null; }
    if (node && findKebab(node)) return node;
    return null;
  }

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

  function setTarget(el) {
    if (el === current) return;
    if (current) current.classList.remove(TARGET_CLASS);
    removeToolbar();
    current = el;
    if (current) { current.classList.add(TARGET_CLASS); addToolbar(current); }
  }

  // Recompute the hovered comment. Cheap path: if still inside the current
  // container, do nothing.
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

  function findMenuItem(menu, label) {
    const items = menu.querySelectorAll('[role="menuitem"]');
    for (let i = 0; i < items.length; i++) {
      if ((items[i].textContent || '').trim() === label) return items[i];
    }
    return null;
  }

  // Close the menu we opened, if still open. The kebab toggles its own menu
  // (aria-expanded flips true->false on a second click), so this has no blast
  // radius on other page UI.
  function closeMenu(kebab) {
    try {
      if (kebab && kebab.getAttribute('aria-expanded') === 'true') kebab.click();
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
})();
