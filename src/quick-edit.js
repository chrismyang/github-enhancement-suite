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

  function findEditItem(menu) {
    const items = menu.querySelectorAll('[role="menuitem"]');
    for (let i = 0; i < items.length; i++) {
      if ((items[i].textContent || '').trim() === 'Edit') return items[i];
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
