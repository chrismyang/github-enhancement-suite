# In-composer Issue Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `Ctrl+;` overlay inside GitHub markdown textareas that searches issues with the full `github.com/search` engine (via the user's existing session, no token) and inserts an `owner/repo#123` reference at the caret.

**Architecture:** Pure, unit-tested logic (`src/issue-search.js`: query/url building, HTML-blob parsing, reference building) is split from DOM/network glue (`src/issue-search-ui.js`: the floating overlay, caret positioning, fetch, render, keyboard nav) and the trigger/insertion wiring in `src/content.js`. Results come from a same-origin `fetch('/search?q=…&type=issues')` whose server-rendered HTML embeds a `react-app.embeddedData` JSON blob we parse.

**Tech Stack:** Plain ES (no build step), `node:test` for unit tests, MV3 content scripts, `execCommand` for React-safe insertion, Playwright MCP for live verification.

---

### Task 1: Pure logic module `src/issue-search.js`

**Files:**
- Create: `src/issue-search.js`
- Test: `tests/issue-search.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/issue-search.test.js` with exactly:

```javascript
const { test } = require('node:test');
const assert = require('node:assert');
const { DEFAULT_QUERY, searchUrl, stripTags, parseResultsHtml, buildReference } = require('../src/issue-search.js');

// A trimmed real-shape /search?type=issues response: a decoy blob, then the
// react-app.embeddedData blob with one issue and one PR.
const FIXTURE = [
  '<!doctype html><html><head></head><body>',
  '<script type="application/json" data-target="react-partial.embeddedData">{"props":{}}</script>',
  '<script type="application/json" data-target="react-app.embeddedData">',
  JSON.stringify({ payload: { result_count: 2, results: [
    { number: 1283, state: 'open',
      hl_title: 'Deploy pipeline <em>flakes</em> on staging',
      hl_text: '…intermittent <em>timeout</em> when the deploy step runs…',
      repo: { repository: { owner_login: 'dragonflyic', name: 'api' } },
      issue: { issue: { pull_request_id: null } } },
    { number: 1301, state: 'open',
      hl_title: 'fix: stabilize deploy retries &amp; backoff',
      hl_text: 'addresses the flaky deploy',
      repo: { repository: { owner_login: 'dragonflyic', name: 'infra' } },
      issue: { issue: { pull_request_id: 99887 } } },
  ] } }),
  '</script></body></html>',
].join('');

test('DEFAULT_QUERY is the dragonflyic issue scope with a trailing space', () => {
  assert.strictEqual(DEFAULT_QUERY, 'org:dragonflyic is:issue ');
});

test('searchUrl trims, URL-encodes the query, and appends type=issues', () => {
  assert.strictEqual(
    searchUrl('  org:dragonflyic is:issue flaky  '),
    '/search?q=org%3Adragonflyic%20is%3Aissue%20flaky&type=issues'
  );
});

test('stripTags removes tags and decodes basic entities', () => {
  assert.strictEqual(stripTags('Deploy <em>flakes</em> here'), 'Deploy flakes here');
  assert.strictEqual(stripTags('a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;'), 'a & b <c> "d" \'e\'');
  assert.strictEqual(stripTags(undefined), '');
});

test('parseResultsHtml maps the embedded blob to normalized results', () => {
  const r = parseResultsHtml(FIXTURE);
  assert.strictEqual(r.length, 2);
  assert.deepStrictEqual(r[0], {
    number: 1283, owner: 'dragonflyic', repo: 'api',
    title: 'Deploy pipeline flakes on staging',
    snippet: '…intermittent timeout when the deploy step runs…',
    state: 'open', isPullRequest: false,
  });
  assert.strictEqual(r[1].number, 1301);
  assert.strictEqual(r[1].repo, 'infra');
  assert.strictEqual(r[1].title, 'fix: stabilize deploy retries & backoff');
  assert.strictEqual(r[1].isPullRequest, true);
});

test('parseResultsHtml returns [] for empty, malformed, or blob-less HTML', () => {
  assert.deepStrictEqual(parseResultsHtml(''), []);
  assert.deepStrictEqual(parseResultsHtml('<html><body>no blob here</body></html>'), []);
  assert.deepStrictEqual(parseResultsHtml(
    '<script type="application/json" data-target="react-app.embeddedData">{bad json</script>'), []);
  assert.deepStrictEqual(parseResultsHtml(undefined), []);
});

test('buildReference is always fully qualified', () => {
  assert.strictEqual(buildReference({ owner: 'dragonflyic', repo: 'api', number: 1283 }), 'dragonflyic/api#1283');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/issue-search.js'`.

- [ ] **Step 3: Implement `src/issue-search.js`**

Create `src/issue-search.js` with exactly:

```javascript
// Pure logic for the in-composer issue search. No DOM, no network — see
// src/issue-search-ui.js for the overlay/fetch glue. Mirrors src/indent.js's
// pattern: exported on globalThis.GMTI (content scripts) AND module.exports (tests).

const DEFAULT_QUERY = 'org:dragonflyic is:issue ';

// type=issues is the fixed switch that engages GitHub's issue/PR search index;
// the query text (incl. any is:issue / is:pr qualifier) does the actual filtering.
function searchUrl(queryText) {
  return '/search?q=' + encodeURIComponent(String(queryText).trim()) + '&type=issues';
}

// Strip HTML tags and decode the handful of entities GitHub emits in hl_* fields.
// Decode &amp; last so "&amp;lt;" doesn't collapse into "<".
function stripTags(hl) {
  if (typeof hl !== 'string') return '';
  return hl
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

// Extract the react-app.embeddedData JSON blob (by string match, NOT DOMParser, so
// this stays node-testable) and map payload.results to a normalized shape. Any
// failure returns [] — never throws.
function parseResultsHtml(htmlString) {
  try {
    if (typeof htmlString !== 'string') return [];
    const m = htmlString.match(/data-target="react-app\.embeddedData">([\s\S]*?)<\/script>/);
    if (!m) return [];
    const data = JSON.parse(m[1]);
    const results = data && data.payload && data.payload.results;
    if (!Array.isArray(results)) return [];
    return results.map(function (r) {
      const repo = (r && r.repo && r.repo.repository) || {};
      const prId = r && r.issue && r.issue.issue ? r.issue.issue.pull_request_id : null;
      return {
        number: r ? r.number : undefined,
        owner: repo.owner_login,
        repo: repo.name,
        title: stripTags(r && r.hl_title),
        snippet: stripTags(r && r.hl_text),
        state: r ? r.state : undefined,
        isPullRequest: prId != null,
      };
    }).filter(function (r) { return r.number != null && r.owner && r.repo; });
  } catch (e) {
    return [];
  }
}

function buildReference(result) {
  return result.owner + '/' + result.repo + '#' + result.number;
}

if (typeof globalThis !== 'undefined') {
  globalThis.GMTI = globalThis.GMTI || {};
  globalThis.GMTI.DEFAULT_QUERY = DEFAULT_QUERY;
  globalThis.GMTI.searchUrl = searchUrl;
  globalThis.GMTI.stripTags = stripTags;
  globalThis.GMTI.parseResultsHtml = parseResultsHtml;
  globalThis.GMTI.buildReference = buildReference;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DEFAULT_QUERY, searchUrl, stripTags, parseResultsHtml, buildReference };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — the existing `tests/indent.test.js` suite plus the 6 new `issue-search` tests.

- [ ] **Step 5: Syntax-check the module**

Run: `node --check src/issue-search.js`
Expected: no output (exit 0).

- [ ] **Step 6: Commit**

```bash
git add src/issue-search.js tests/issue-search.test.js
git commit -m "feat: issue-search pure logic (query/url, blob parse, reference)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Overlay stylesheet `src/issue-search.css`

**Files:**
- Create: `src/issue-search.css`

No test — CSS is verified live in Task 5.

- [ ] **Step 1: Create `src/issue-search.css`**

Create `src/issue-search.css` with exactly:

```css
.gmti-is-panel {
  position: absolute;
  z-index: 2147483646;
  width: 440px;
  max-width: 90vw;
  background: var(--bgColor-default, #ffffff);
  border: 1px solid var(--borderColor-default, #d0d7de);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(140, 149, 159, 0.2);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  font-size: 13px;
  color: var(--fgColor-default, #1f2328);
  overflow: hidden;
}
.gmti-is-input {
  width: 100%;
  box-sizing: border-box;
  border: 0;
  border-bottom: 1px solid var(--borderColor-muted, #d8dee4);
  padding: 8px 10px;
  font: inherit;
  outline: none;
  background: transparent;
  color: inherit;
}
.gmti-is-list { list-style: none; margin: 0; padding: 4px 0; max-height: 300px; overflow-y: auto; }
.gmti-is-row { display: flex; gap: 8px; padding: 6px 10px; cursor: pointer; align-items: flex-start; }
.gmti-is-sel, .gmti-is-row:hover { background: var(--bgColor-muted, #f6f8fa); }
.gmti-is-icon { flex: 0 0 16px; text-align: center; line-height: 18px; color: #57606a; }
.gmti-is-icon.open { color: #1a7f37; }
.gmti-is-icon.issue.closed { color: #8250df; }
.gmti-is-icon.pr.closed { color: #cf222e; }
.gmti-is-main { display: flex; flex-direction: column; min-width: 0; flex: 1 1 auto; }
.gmti-is-head { display: flex; gap: 8px; align-items: baseline; min-width: 0; }
.gmti-is-title { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1 1 auto; }
.gmti-is-ref { color: #57606a; font-size: 12px; flex: 0 0 auto; }
.gmti-is-snippet { color: #57606a; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gmti-is-empty { padding: 10px; color: #57606a; list-style: none; }
.gmti-is-hint { padding: 6px 10px; border-top: 1px solid var(--borderColor-muted, #d8dee4); color: #8c959f; font-size: 11px; }
```

- [ ] **Step 2: Commit**

```bash
git add src/issue-search.css
git commit -m "feat: issue-search overlay stylesheet

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Overlay UI glue `src/issue-search-ui.js`

**Files:**
- Create: `src/issue-search-ui.js`

No unit test — DOM/network glue, verified live in Task 5. It exposes `GMTI.openIssueSearch(textarea, caretStart, onChoose)`.

- [ ] **Step 1: Create `src/issue-search-ui.js`**

Create `src/issue-search-ui.js` with exactly:

```javascript
// Overlay UI + network glue for the in-composer issue search. Pure logic lives in
// src/issue-search.js. Exposes GMTI.openIssueSearch(textarea, caretStart, onChoose);
// onChoose(reference) is called with e.g. "owner/repo#123" when the user picks a result.
(function () {
  const GMTI = globalThis.GMTI;
  if (!GMTI || !GMTI.searchUrl) return;
  const { searchUrl, parseResultsHtml, buildReference, DEFAULT_QUERY } = GMTI;

  let panel = null, input = null, list = null;
  let results = [], sel = -1, lastQuery = null, onChooseCb = null, owner = null;

  function close() {
    const ta = owner;
    if (panel) { panel.remove(); panel = null; }
    input = list = null; results = []; sel = -1; lastQuery = null; owner = null;
    const cb = onChooseCb; onChooseCb = null; // cb consumed by choose() before close()
    void cb;
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
      const icon = document.createElement('span');
      icon.className = 'gmti-is-icon ' + (r.isPullRequest ? 'pr' : 'issue') + ' ' + (r.state || '');
      icon.textContent = r.isPullRequest ? '⇄' : (r.state === 'closed' ? '✓' : '◉');
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
  }

  function move(delta) {
    if (!results.length) return;
    sel = (sel + delta + results.length) % results.length;
    render();
  }

  function runSearch() {
    const q = input.value;
    lastQuery = q;
    list.innerHTML = '<li class="gmti-is-empty">Searching…</li>';
    fetch(searchUrl(q), { credentials: 'same-origin' })
      .then(function (r) { return r.text(); })
      .then(function (html) {
        if (!panel) return; // closed while in flight
        results = parseResultsHtml(html);
        sel = results.length ? 0 : -1;
        render();
      })
      .catch(function () {
        if (!panel) return;
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
```

- [ ] **Step 2: Syntax-check the module**

Run: `node --check src/issue-search-ui.js`
Expected: no output (exit 0).

- [ ] **Step 3: Commit**

```bash
git add src/issue-search-ui.js
git commit -m "feat: issue-search overlay UI (caret-anchored panel, fetch, nav)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Wire the `Ctrl+;` trigger + insertion, register files

**Files:**
- Modify: `src/content.js`
- Modify: `manifest.json`

No unit test — DOM glue, verified live in Task 5.

- [ ] **Step 1: Add the `Ctrl+;` branch at the top of the keydown handler**

In `src/content.js`, find this line (currently line 52, the first statement inside the `keydown` listener):

```javascript
      if (e.ctrlKey || e.altKey || e.metaKey) return; // leave Ctrl/⌘+Enter (submit) etc. alone
```

Insert this block IMMEDIATELY BEFORE that line (so the chord is handled before the Ctrl/Alt/Meta early-return swallows it):

```javascript
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
```

- [ ] **Step 2: Register the new files in the manifest**

In `manifest.json`, replace the `"js"` and `"css"` arrays of the content-scripts entry:

```json
      "js": ["src/indent.js", "src/content.js"],
      "css": ["src/editor.css"],
```

with (issue-search.js + issue-search-ui.js load before content.js so `GMTI.openIssueSearch` etc. exist; issue-search-ui.js depends on issue-search.js, so it comes after it):

```json
      "js": ["src/indent.js", "src/issue-search.js", "src/issue-search-ui.js", "src/content.js"],
      "css": ["src/editor.css", "src/issue-search.css"],
```

- [ ] **Step 3: Syntax-check and validate**

Run: `node --check src/content.js && node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest ok')"`
Expected: `manifest ok` (and no syntax error).

- [ ] **Step 4: Confirm the unit suite still passes (no regressions)**

Run: `npm test`
Expected: PASS — unchanged from Task 1 (this task touches only glue + manifest).

- [ ] **Step 5: Commit**

```bash
git add src/content.js manifest.json
git commit -m "feat: wire Ctrl+; issue-search trigger; register scripts in manifest

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Live verification on real GitHub

**Files:** none (manual / Playwright-MCP integration check, per `CLAUDE.md`).

Drive with the Playwright MCP browser. **Protect private data:** assert structure/counts; do not echo `dragonflyic` issue titles into logs.

- [ ] **Step 1: Reload the extension AND the page**

Ask the user to reload the unpacked extension at `chrome://extensions`, **then reload the GitHub tab** (an extension reload does not re-inject the content script into an already-open tab).

- [ ] **Step 2: Open a fresh comment box and confirm isolation**

Navigate to `https://github.com/chrismyang/hammersmith/issues/1`, focus the comment textarea, and confirm `typeof globalThis.GMTI === 'undefined'` in the page main world (extension runs isolated).

- [ ] **Step 3: Open the overlay**

Focus the textarea (place the caret), press `Ctrl+;`. Verify: a `.gmti-is-panel` exists, its `.gmti-is-input` value is `org:dragonflyic is:issue ` and is focused, and the panel sits near the caret line (top/left within the viewport).

- [ ] **Step 4: Run a search and insert**

Type a term after the prefill (e.g. append a word likely to match), press Enter. Verify `.gmti-is-row` items render (count > 0; check structure: icon + title + `owner/repo#n` + snippet — assert the ref text matches `/^[\w.-]+\/[\w.-]+#\d+$/`, do not log titles). Press ArrowDown then Enter. Verify the textarea value now contains a reference matching `/[\w.-]+\/[\w.-]+#\d+/` at the original caret, the overlay is gone, and focus is back on the textarea.

- [ ] **Step 5: Dismiss + scope-edit checks**

Re-open with `Ctrl+;`, press Escape → panel removed, focus restored, textarea unchanged. Re-open, clear the input and type `repo:cli/cli auth` (public, avoids private data), Enter → results render. Optionally change `is:issue`→`is:pr` and confirm PR rows (PR icon) come back via the same flow.

- [ ] **Step 6: Regression sweep**

Confirm unrelated behavior still works: Tab/Shift-Tab indent a list line; typing a normal `;` (no Ctrl) inserts a literal `;`; `@`-autocomplete still opens (native). Clear the comment box; never submit.

- [ ] **Step 7: Report results**

Summarize pass/fail per step with observed structure (ref strings, counts, panel presence) — not private titles. If anything misbehaves, stop and debug; do not mark complete.

---

## Notes for the implementer

- **`null`/empty means safe:** `parseResultsHtml` never throws (returns `[]`); the `Ctrl+;` branch and insertion are wrapped in try/catch ("never break the box"); a fetch failure shows a muted line, not an exception.
- **Insertion is `execCommand`-based** via the existing `applyEdit` in `content.js` — React-safe, single-step undo. The caret captured at open time is still valid at insert time because the user typed into the overlay's own input, not the textarea.
- **Script load order matters:** `indent.js` → `issue-search.js` → `issue-search-ui.js` → `content.js`. `issue-search-ui.js` early-returns unless `GMTI.searchUrl` exists; `content.js` calls `GMTI.openIssueSearch` only at event time.
- **Same-origin only:** the fetch hits `github.com/search` from a `github.com` page, so no host permission and no token — cookies ride along automatically.
- Do not touch `FEATURE_IDEAS.md` or unrelated files.
```
