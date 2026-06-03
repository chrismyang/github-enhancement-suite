(function () {
  const computeIndent = globalThis.GMTI && globalThis.GMTI.computeIndent;
  if (!computeIndent) return;

  // Markdown editing textareas across the React UI and the classic UI.
  const SELECTOR = [
    'textarea[aria-label="Markdown value"]', // React UI: comments + descriptions
    'textarea.js-comment-field',             // classic comment box
    'textarea[name="issue[body]"]',          // classic issue description
    'textarea[name="pull_request[body]"]',   // classic PR description
    'textarea[name="comment[body]"]',        // classic comment variants
  ].join(',');

  function isMarkdownField(el) {
    return el instanceof HTMLTextAreaElement && el.matches(SELECTOR);
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
      if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey) return;
      const ta = e.target;
      if (!isMarkdownField(ta)) return;
      if (autocompleteOpen(ta)) return;

      let r;
      try {
        r = computeIndent(ta.value, ta.selectionStart, ta.selectionEnd, {
          dedent: e.shiftKey,
        });
      } catch (err) {
        return; // unexpected failure -> let native behavior happen (safety)
      }

      // We own Tab for this field now: swallow it so focus never blurs,
      // even for a computed no-op (e.g. Shift-Tab at column 0).
      e.preventDefault();
      e.stopPropagation();
      if (!r) return;

      try {
        applyEdit(ta, r);
      } catch (err) {
        /* swallow: never break the box */
      }
    },
    true // capture phase
  );
})();
