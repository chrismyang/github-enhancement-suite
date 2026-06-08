// Overlay UI + network glue for the in-composer issue search. Pure logic lives in
// src/issue-search.js. Exposes GMTI.openIssueSearch(textarea, caretStart, onChoose);
// onChoose(reference) is called with e.g. "owner/repo#123" when the user picks a result.
(function () {
  const GMTI = globalThis.GMTI;
  if (!GMTI || !GMTI.searchUrl) return;
  const { searchUrl, parseResultsHtml, buildReference, DEFAULT_QUERY } = GMTI;

  // GitHub Octicon SVGs (captured verbatim from GitHub's DOM), colored via CSS.
  const SVG = function (paths) {
    return '<svg class="octicon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">' + paths + '</svg>';
  };
  const ICON_SVG = {
    'issue-open': SVG('<path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"></path><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z"></path>'),
    'issue-closed': SVG('<path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm1.5 0a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm10.28-1.72-4.5 4.5a.75.75 0 0 1-1.06 0l-2-2a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018l1.47 1.47 3.97-3.97a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042Z"></path>'),
    'issue-skip': SVG('<path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm9.78-2.22-5.5 5.5a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734l5.5-5.5a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042Z"></path>'),
    'pr-open': SVG('<path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z"></path>'),
    'pr-merged': SVG('<path d="M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8.5-4.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5 3.25a.75.75 0 1 0 0 .005V3.25Z"></path>'),
    'pr-closed': SVG('<path d="M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.251 2.251 0 0 1 3.25 1Zm9.5 5.5a.75.75 0 0 1 .75.75v3.378a2.251 2.251 0 1 1-1.5 0V7.25a.75.75 0 0 1 .75-.75Zm-2.03-5.273a.75.75 0 0 1 1.06 0l.97.97.97-.97a.748.748 0 0 1 1.265.332.75.75 0 0 1-.205.729l-.97.97.97.97a.751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018l-.97-.97-.97.97a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734l.97-.97-.97-.97a.75.75 0 0 1 0-1.06ZM2.5 3.25a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0ZM3.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm9.5 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z"></path>'),
  };
  function iconKind(r) {
    if (r.isPullRequest) {
      if (r.merged) return 'pr-merged';
      if (r.state === 'closed') return 'pr-closed';
      return 'pr-open';
    }
    if (r.state === 'closed') return r.stateReason === 'not_planned' ? 'issue-skip' : 'issue-closed';
    return 'issue-open';
  }

  let panel = null, input = null, list = null;
  let results = [], sel = -1, lastQuery = null, onChooseCb = null, owner = null, searchToken = 0;

  function close() {
    const ta = owner;
    if (ta) ta.removeEventListener('scroll', close);
    if (panel) { panel.remove(); panel = null; }
    input = list = null; results = []; sel = -1; lastQuery = null; owner = null;
    onChooseCb = null;
    searchToken++;
    if (ta) ta.focus();
  }

  function choose() {
    if (sel < 0 || sel >= results.length) return;
    const ref = buildReference(results[sel]);
    const cb = onChooseCb;
    close();
    if (cb) cb(ref);
  }

  function render() {
    if (!list) return;
    list.innerHTML = '';
    if (!results.length) {
      const li = document.createElement('li');
      li.className = 'gmti-is-empty';
      li.textContent = lastQuery === null ? 'Type a query, then press Enter' : 'No results';
      list.appendChild(li);
      return;
    }
    results.forEach(function (r, i) {
      const li = document.createElement('li');
      li.className = 'gmti-is-row' + (i === sel ? ' gmti-is-sel' : '');
      const kind = iconKind(r);
      const icon = document.createElement('span');
      icon.className = 'gmti-is-icon gmti-is-' + kind;
      icon.innerHTML = ICON_SVG[kind]; // static SVG markup (not remote data)
      const main = document.createElement('span');
      main.className = 'gmti-is-main';
      const head = document.createElement('span');
      head.className = 'gmti-is-head';
      const title = document.createElement('span');
      title.className = 'gmti-is-title';
      title.textContent = r.title || '(untitled)';
      const ref = document.createElement('span');
      ref.className = 'gmti-is-ref';
      ref.textContent = r.owner + '/' + r.repo + '#' + r.number;
      head.appendChild(title); head.appendChild(ref);
      const snip = document.createElement('span');
      snip.className = 'gmti-is-snippet';
      snip.textContent = r.snippet || '';
      main.appendChild(head); main.appendChild(snip);
      li.appendChild(icon); li.appendChild(main);
      li.addEventListener('mousedown', function (e) { e.preventDefault(); sel = i; choose(); });
      list.appendChild(li);
    });
    const selEl = list.querySelector('.gmti-is-sel');
    if (selEl) selEl.scrollIntoView({ block: 'nearest' });
  }

  function move(delta) {
    if (!results.length) return;
    sel = (sel + delta + results.length) % results.length;
    render();
  }

  function runSearch() {
    const q = input.value;
    lastQuery = q;
    const token = ++searchToken;
    list.innerHTML = '<li class="gmti-is-empty">Searching…</li>';
    fetch(searchUrl(q), { credentials: 'same-origin' })
      .then(function (r) { return r.text(); })
      .then(function (html) {
        if (!panel || token !== searchToken) return; // stale or closed
        results = parseResultsHtml(html);
        sel = results.length ? 0 : -1;
        render();
      })
      .catch(function () {
        if (!panel || token !== searchToken) return;
        results = []; sel = -1;
        list.innerHTML = '<li class="gmti-is-empty">Couldn’t search</li>';
      });
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); move(1); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); move(-1); return; }
    if (e.key === 'Enter') {
      e.preventDefault(); e.stopPropagation();
      if (input.value !== lastQuery || !results.length) runSearch(); else choose();
    }
  }

  // Caret pixel position via the mirror-div technique.
  function caretCoords(ta) {
    const rect = ta.getBoundingClientRect();
    const style = window.getComputedStyle(ta);
    const div = document.createElement('div');
    const props = ['boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
      'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight',
      'textTransform', 'wordSpacing', 'tabSize'];
    props.forEach(function (p) { div.style[p] = style[p]; });
    div.style.position = 'absolute';
    div.style.visibility = 'hidden';
    div.style.whiteSpace = 'pre-wrap';
    div.style.wordWrap = 'break-word';
    div.style.overflow = 'hidden';
    div.style.left = (rect.left + window.scrollX) + 'px';
    div.style.top = (rect.top + window.scrollY) + 'px';
    const pos = ta.selectionStart;
    div.textContent = ta.value.slice(0, pos);
    const span = document.createElement('span');
    span.textContent = ta.value.slice(pos) || '.';
    div.appendChild(span);
    document.body.appendChild(div);
    const lineHeight = parseFloat(style.lineHeight) || (parseFloat(style.fontSize) * 1.2);
    const x = rect.left + window.scrollX + span.offsetLeft - ta.scrollLeft;
    const y = rect.top + window.scrollY + span.offsetTop - ta.scrollTop + lineHeight;
    div.remove();
    return { x: x, y: y };
  }

  function open(textarea, caretStart, onChoose) {
    if (panel) close();
    owner = textarea;
    onChooseCb = onChoose;
    void caretStart; // caret is captured by the caller; insertion happens in onChoose

    panel = document.createElement('div');
    panel.className = 'gmti-is-panel';
    input = document.createElement('input');
    input.className = 'gmti-is-input';
    input.type = 'text';
    input.setAttribute('spellcheck', 'false');
    input.value = DEFAULT_QUERY;
    list = document.createElement('ul');
    list.className = 'gmti-is-list';
    const hint = document.createElement('div');
    hint.className = 'gmti-is-hint';
    hint.textContent = '↑↓ navigate · ↵ insert · esc close';
    panel.appendChild(input); panel.appendChild(list); panel.appendChild(hint);
    document.body.appendChild(panel);

    const c = caretCoords(textarea);
    const maxLeft = window.scrollX + document.documentElement.clientWidth - panel.offsetWidth - 8;
    panel.style.left = Math.max(window.scrollX + 8, Math.min(c.x, maxLeft)) + 'px';
    panel.style.top = c.y + 'px';

    lastQuery = null; results = []; sel = -1;
    render();
    input.addEventListener('keydown', onKey);
    panel.addEventListener('focusout', function () {
      setTimeout(function () { if (panel && !panel.contains(document.activeElement)) close(); }, 0);
    });
    textarea.addEventListener('scroll', close, { once: true });
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  GMTI.openIssueSearch = open;
})();
