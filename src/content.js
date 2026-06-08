(function () {
  const GMTI = globalThis.GMTI;
  if (!GMTI || !GMTI.computeIndent) return;
  const { computeIndent, computeSoftBreak, computeListEnter, computePasteIndent, computeWrap, WRAP_PAIRS } = GMTI;

  // Known markdown editing textareas. The React "new issue" description carries
  // aria-label="Markdown value", but the comment composer instead uses
  // aria-labelledby — so we also match structurally below.
  const SELECTOR = [
    'textarea[aria-label="Markdown value"]', // React UI: issue/PR description
    'textarea.js-comment-field',             // classic comment box
    'textarea[name="issue[body]"]',          // classic issue description
    'textarea[name="pull_request[body]"]',   // classic PR description
    'textarea[name="comment[body]"]',        // classic comment variants
  ].join(',');

  // The Primer React markdown editor (descriptions AND comments) wraps its
  // textarea in a MarkdownEditor/MarkdownInput module container. Matching that
  // wrapper catches both surfaces and is resilient to the per-build class hash
  // on the textarea itself, while ignoring unrelated page textareas.
  const WRAPPER_SELECTOR = '[class*="MarkdownEditor-module"], [class*="MarkdownInput-module"]';

  function isMarkdownField(el) {
    if (!(el instanceof HTMLTextAreaElement)) return false;
    return el.matches(SELECTOR) || !!el.closest(WRAPPER_SELECTOR);
  }

  // Stand down while GitHub's @/#/: autocomplete popup is open.
  function autocompleteOpen(el) {
    if (el.getAttribute('aria-expanded') === 'true') return true;
    const lb = document.querySelector('[role="listbox"]');
    return !!(lb && (lb.offsetWidth || lb.offsetHeight));
  }

  // execCommand is deprecated but intentional: on GitHub's React-controlled
  // textareas it is the only mutation that fires the input event React listens
  // for AND preserves the native single-step undo stack. (text === '' means
  // "delete the selected range"; any non-empty text replaces the range.)
  function applyEdit(ta, r) {
    ta.setSelectionRange(r.rangeStart, r.rangeEnd);
    if (r.text === '') {
      document.execCommand('delete');
    } else {
      document.execCommand('insertText', false, r.text);
    }
    ta.setSelectionRange(r.newSelStart, r.newSelEnd);
  }

  document.addEventListener(
    'keydown',
    function (e) {
      // Ctrl+; opens our issue-search overlay (a chord GitHub doesn't use). Handled
      // before the Ctrl/Alt/Meta early-return below.
      if (e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && e.key === ';') {
        const ta = e.target;
        if (!isMarkdownField(ta) || autocompleteOpen(ta) || !GMTI.openIssueSearch) return;
        e.preventDefault();
        e.stopPropagation();
        const caret = ta.selectionStart;
        try {
          GMTI.openIssueSearch(ta, caret, function (ref) {
            try {
              ta.focus();
              applyEdit(ta, {
                rangeStart: caret, rangeEnd: caret, text: ref,
                newSelStart: caret + ref.length, newSelEnd: caret + ref.length,
              });
            } catch (err) { /* never break the box */ }
          });
        } catch (err) { /* never break the box */ }
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
      const isTab = e.key === 'Tab';
      const isShiftEnter = e.key === 'Enter' && e.shiftKey;
      const isPlainEnter = e.key === 'Enter' && !e.shiftKey;
      // A wrap candidate: a single trigger char, not mid-IME-composition.
      const isWrap = !e.isComposing && Object.prototype.hasOwnProperty.call(WRAP_PAIRS, e.key);
      if (!isTab && !isShiftEnter && !isPlainEnter && !isWrap) return;

      const ta = e.target;
      if (!isMarkdownField(ta)) return;
      if (autocompleteOpen(ta)) return;

      if (isTab) {
        let r;
        try {
          r = computeIndent(ta.value, ta.selectionStart, ta.selectionEnd, { dedent: e.shiftKey });
        } catch (err) {
          return; // unexpected failure -> native behavior
        }
        // We own Tab: swallow it so focus never blurs, even on a no-op.
        e.preventDefault();
        e.stopPropagation();
        if (!r) return;
        try { applyEdit(ta, r); } catch (err) { /* never break the box */ }
        return;
      }

      if (isWrap) {
        let r;
        try {
          r = computeWrap(ta.value, ta.selectionStart, ta.selectionEnd, e.key);
        } catch (err) {
          return; // unexpected failure -> native typing
        }
        if (!r) return; // no selection / non-trigger -> let the char type normally
        e.preventDefault();
        e.stopPropagation();
        try { applyEdit(ta, r); } catch (err) { /* never break the box */ }
        return;
      }

      // Shift+Enter (soft break) or plain Enter (continuation -> new item).
      let r;
      try {
        r = isShiftEnter
          ? computeSoftBreak(ta.value, ta.selectionStart, ta.selectionEnd)
          : computeListEnter(ta.value, ta.selectionStart, ta.selectionEnd);
      } catch (err) {
        return; // native behavior
      }
      if (!r) return; // not our case -> let GitHub's native Enter/newline run
      e.preventDefault();
      e.stopPropagation();
      try { applyEdit(ta, r); } catch (err) { /* never break the box */ }
    },
    true // capture phase
  );

  document.addEventListener(
    'paste',
    function (e) {
      const ta = e.target;
      if (!isMarkdownField(ta)) return;
      const dt = e.clipboardData;
      if (!dt) return;
      if (dt.files && dt.files.length) return; // images/files -> native upload
      if ((dt.types || []).includes('text/html')) return; // rich paste -> GitHub's HTML->markdown
      const pasted = dt.getData('text/plain');
      if (!pasted) return;

      let r;
      try {
        r = computePasteIndent(ta.value, ta.selectionStart, ta.selectionEnd, pasted);
      } catch (err) {
        return; // unexpected failure -> native paste
      }
      if (!r) return; // single-line / not a list context -> native paste
      e.preventDefault();
      e.stopPropagation();
      try { applyEdit(ta, r); } catch (err) { /* never break the box */ }
    },
    true // capture phase
  );
})();
