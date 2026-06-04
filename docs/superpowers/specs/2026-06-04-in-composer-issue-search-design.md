# In-composer issue/PR search — design

_Spec date: 2026-06-04_

## Summary

Add a search overlay, opened with **`Ctrl+;`** from inside any GitHub markdown textarea, that
lets you find an issue or PR with the **full `github.com/search` engine** (free text + all
qualifiers) and insert a reference (`owner/repo#123`) at the caret. It exists because GitHub's
native `#` autocomplete has weak recall/ranking and no qualifier support, so finding the right
issue while composing a comment is painful relative to `github.com/search`.

The native `#` popup is left **completely untouched** — this is a separate, parallel affordance,
which sidesteps the fragility of fighting GitHub's React `#` popup.

## Motivation

Backlog: the felt pain is that `#` can't find issues the author knows exist. `github.com/search`
can, but copy-pasting references from a separate tab is friction. This brings that search power
into the composer.

## Key technical finding (de-risks the whole feature)

Verified live on real GitHub (2026-06-04):

- The content script runs on `github.com`, so a **same-origin** `fetch('/search?q=…&type=issues')`
  rides the user's existing **session cookies** — authenticated as the user, private repos
  included. **No token, no options page, no host permission** required.
- The `/search` response is server-rendered HTML containing a hydration blob:
  ```html
  <script type="application/json" data-target="react-app.embeddedData">
    { "payload": { "results": [ … ], "result_count": N } }
  </script>
  ```
  `payload.results[]` is the **full search result set** — identical engine and qualifier
  semantics to `github.com/search`.
- Each result carries: `number`, `state` / `state_reason` / `merged`, `hl_title` (title with
  `<em>` match highlights), `hl_text` (body snippet), `repo.repository.owner_login` +
  `repo.repository.name`, `labels`, `num_comments`, `author_name`, `created`, and
  `issue.issue.pull_request_id` (null ⇒ issue).
- `type=issues` returns **issues only**; `type=pullrequests` returns **PRs only** (both 200, both
  parse identically). To include both, fire **two fetches and merge**.

## Behavior

- **Trigger:** `Ctrl+;` while focused in a markdown field opens the overlay. The native
  `@`/`#`/`:` autocompletes and all other typing are unaffected.
- **Default scope:** a hardcoded `DEFAULT_SCOPE = 'org:dragonflyic'` is prepended to the user's
  free text, *unless* the text already contains a scoping qualifier (`org:`, `repo:`, `user:`,
  or `owner:`), in which case the text is used as-is (lets the user broaden/redirect).
- **Search:** debounced (~200 ms) as the user types; two parallel same-origin fetches
  (`type=issues`, `type=pullrequests`); results parsed, merged, and listed.
- **Result row:** issue-vs-PR icon, state (open / closed / merged), plain-text title, and
  `repo#number`.
- **Insert:** Enter (or click) inserts `owner/repo#123` at the caret position captured when the
  overlay opened, via the existing `execCommand` path. Always fully-qualified — GitHub renders
  `owner/repo#123` as `#123` automatically when it is the current repo.
- **Dismiss:** Escape or blur closes the overlay and restores focus to the textarea; nothing is
  inserted.

## Architecture

Preserves the repo's split: **pure logic in a testable module, DOM/network in glue.**

### `src/issue-search.js` — pure, unit-tested (no DOM, no network)

Exposed on `globalThis.GMTI` and `module.exports`, matching the project pattern.

- `const DEFAULT_SCOPE = 'org:dragonflyic';`
- `buildQuery(rawText, defaultScope)` → `string`. If `/\b(org|repo|user|owner):/i.test(rawText)`
  return `rawText.trim()`; else return `` `${defaultScope} ${rawText.trim()}` ``.
- `parseResultsHtml(htmlString, kind)` → `Array<Result>`. Extracts the
  `react-app.embeddedData` script's JSON **by string match (NOT DOMParser, so it runs under
  node:test)**, `JSON.parse`s it, maps `payload.results` to the normalized shape below. Any
  failure (no blob, bad JSON, missing fields) returns `[]` — never throws.
- `mergeResults(issues, prs)` → interleaved `Array<Result>` (relevance-ranked within each kind;
  interleave by rank position).
- `buildReference(result)` → `` `${result.owner}/${result.repo}#${result.number}` ``.
- `stripTags(hl)` → plain text (removes `<em>`/all tags; decodes basic entities). MVP titles are
  plain text.

Normalized `Result`: `{ kind: 'issue' | 'pr', number, owner, repo, title, state, merged }`
(`kind` comes from the originating fetch, not from re-deriving it).

### `src/issue-search-ui.js` — glue (DOM + network)

- Creates/owns the overlay element (search input + results `<ul>`), positioned anchored to the
  focused textarea (below it for MVP — not caret-pixel precise).
- Debounced search: builds the query via `buildQuery`, fetches both types same-origin with
  `credentials: 'same-origin'`, calls `parseResultsHtml`, `mergeResults`, renders rows.
- Keyboard nav inside the overlay: Up/Down to move selection, Enter to choose, Escape to cancel.
- On choose: invokes a callback with `buildReference(result)`; on cancel/blur: closes and
  refocuses the textarea.
- Fetch failure → a non-fatal "couldn't search" state in the overlay (no exception escapes).

### `src/content.js` — glue (trigger + insertion)

- The capture-phase `keydown` listener currently early-returns on `e.ctrlKey`. Carve out the one
  chord: if `e.ctrlKey && !e.altKey && !e.metaKey && e.key === ';'` on a markdown field and the
  autocomplete is not open, `preventDefault()` + open the overlay (remembering
  `ta.selectionStart`). All wrapped in the existing "never break the box" try/catch.
- The overlay's choose-callback inserts the reference with the existing `applyEdit`
  (`execCommand`) helper at the remembered caret — **no new mutation path, single-step undo
  preserved.**

### `manifest.json`

- Add `src/issue-search.js` (before `content.js`, so `content.js` can read it off `GMTI`) and
  `src/issue-search-ui.js` to the content-scripts `js` array; add `src/issue-search.css` to the
  `css` array. **No new permissions** (same-origin fetch needs none).

## Error handling

- `parseResultsHtml` is fully defensive (→ `[]`), so a GitHub markup change degrades to "no
  results," never a thrown error.
- The `Ctrl+;` keydown branch and the insertion are wrapped like every other mutation path —
  any failure falls back to native behavior rather than corrupting the textarea.
- Network errors surface only inside the overlay; Escape/blur always restores the textarea.
- `hl_title`/`hl_text` are server HTML; MVP strips tags to plain text (no `innerHTML` of
  untrusted content).

## Testing

### Unit (`tests/`, node:test) — the pure module

Against a saved **HTML fixture** (a real `/search?...&type=issues` response trimmed to a couple
of results) plus a `type=pullrequests` fixture:

- `buildQuery`: prepends `DEFAULT_SCOPE`; leaves text untouched when it already has
  `org:`/`repo:`/`user:`/`owner:`; trims.
- `parseResultsHtml`: extracts results from the fixture with correct
  `number/owner/repo/title/state/kind`; returns `[]` for empty HTML, malformed JSON, and a
  missing `embeddedData` blob.
- `mergeResults`: interleaves issues and PRs as specified.
- `buildReference`: `owner/repo#number`.
- `stripTags`: removes `<em>` and decodes entities.

### Live verification (Playwright, real GitHub)

Per `CLAUDE.md` (reload the extension **and reload the page** so the updated content script is
injected). Then: `Ctrl+;` opens the overlay; a query returns merged issue+PR results; arrow/Enter
inserts `owner/repo#123` at the caret; Escape closes and restores focus; native `#`/`@` still
work. To protect private data, checks assert structure/counts rather than echoing `dragonflyic`
titles into logs.

## Scope

**MVP (this spec):** `Ctrl+;` trigger → debounced dual-fetch search → merged list with plain-text
titles → insert `owner/repo#123`. Overlay anchored under the textarea.

**Deferred polish (not now):** safe `<em>` highlight rendering; exact caret-pixel positioning;
collapsing same-repo references to bare `#123`; recency-vs-relevance sort tuning; a `;;` text
trigger in addition to the chord; a runtime-configurable scope (options page).
