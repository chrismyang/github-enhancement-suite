# In-composer issue search — design

_Spec date: 2026-06-04_

## Summary

Add a search overlay, opened with **`Ctrl+;`** from inside any GitHub markdown textarea, that
lets you find an issue with the **full `github.com/search` engine** (free text + all
qualifiers) and insert a reference (`owner/repo#123`) at the caret. **MVP is issues only**
(searching pull requests is a deferred follow-up — see Scope). It exists because GitHub's
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
  parse identically). **MVP fetches `type=issues` only** — a single request. Adding PRs later is
  just a second `type=pullrequests` fetch plus a merge (deferred — see Scope).

**Chosen backend: the same-origin scrape (no token).** It reuses the existing login with zero
setup, which is preferred for a personal, load-unpacked extension. The cost is parsing an
undocumented hydration blob that can change on a GitHub redesign — mitigated by fully defensive
parsing (below). _Verified equivalent fallback:_ `GET api.github.com/search/issues?q=…` returned
the **identical results in identical order** to the web search for the same query (same engine),
so if the embedded-blob scrape ever breaks, switching to the documented REST API — at the cost of
a read-only token + an `api.github.com` host permission — is a drop-in quality-equivalent
replacement.

## Behavior

- **Trigger:** `Ctrl+;` while focused in a markdown field opens the overlay. The native
  `@`/`#`/`:` autocompletes and all other typing are unaffected.
- **Default scope:** a hardcoded `DEFAULT_SCOPE = 'org:dragonflyic'` is prepended to the user's
  free text, *unless* the text already contains a scoping qualifier (`org:`, `repo:`, `user:`,
  or `owner:`), in which case the text is used as-is (lets the user broaden/redirect).
- **Search:** the user types a full query and presses **Enter** to run it (NOT debounced
  as-you-type). On Enter, a single same-origin fetch (`type=issues`); results parsed and listed
  with the first row auto-highlighted.
- **Result row:** state (open / closed), plain-text title, and `repo#number`.
- **Enter semantics (two stages):** while the input has focus and the query is unchanged since
  the last run, Enter inserts the highlighted result; editing the query makes Enter re-run the
  search instead. Up/Down move the highlight; click also inserts.
- **Insert:** inserts `owner/repo#123` at the caret position captured when the overlay opened,
  via the existing `execCommand` path. Always fully-qualified — GitHub renders `owner/repo#123`
  as `#123` automatically when it is the current repo.
- **Dismiss:** Escape or blur closes the overlay and restores focus to the textarea; nothing is
  inserted.

## Architecture

Preserves the repo's split: **pure logic in a testable module, DOM/network in glue.**

### `src/issue-search.js` — pure, unit-tested (no DOM, no network)

Exposed on `globalThis.GMTI` and `module.exports`, matching the project pattern.

- `const DEFAULT_SCOPE = 'org:dragonflyic';`
- `buildQuery(rawText, defaultScope)` → `string`. If `/\b(org|repo|user|owner):/i.test(rawText)`
  return `rawText.trim()`; else return `` `${defaultScope} ${rawText.trim()}` ``.
- `parseResultsHtml(htmlString)` → `Array<Result>`. Extracts the `react-app.embeddedData`
  script's JSON **by string match (NOT DOMParser, so it runs under node:test)**, `JSON.parse`s
  it, maps `payload.results` to the normalized shape below. Any failure (no blob, bad JSON,
  missing fields) returns `[]` — never throws.
- `buildReference(result)` → `` `${result.owner}/${result.repo}#${result.number}` ``.
- `stripTags(hl)` → plain text (removes `<em>`/all tags; decodes basic entities). MVP titles are
  plain text.

Normalized `Result`: `{ number, owner, repo, title, state }` (issues only in the MVP).

### `src/issue-search-ui.js` — glue (DOM + network)

- Creates/owns the overlay element (search input + results `<ul>`), positioned anchored to the
  focused textarea (below it for MVP — not caret-pixel precise).
- Enter-run search: on Enter in the input, builds the query via `buildQuery`, fetches
  `type=issues` same-origin with `credentials: 'same-origin'`, calls `parseResultsHtml`, renders
  rows, auto-highlights the first. No debounce / no as-you-type requests.
- Keyboard nav inside the overlay: Up/Down move the highlight; Enter inserts the highlighted
  result (or re-runs the search if the query changed since the last run); Escape cancels.
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
of results):

- `buildQuery`: prepends `DEFAULT_SCOPE`; leaves text untouched when it already has
  `org:`/`repo:`/`user:`/`owner:`; trims.
- `parseResultsHtml`: extracts results from the fixture with correct
  `number/owner/repo/title/state`; returns `[]` for empty HTML, malformed JSON, and a missing
  `embeddedData` blob.
- `buildReference`: `owner/repo#number`.
- `stripTags`: removes `<em>` and decodes entities.

### Live verification (Playwright, real GitHub)

Per `CLAUDE.md` (reload the extension **and reload the page** so the updated content script is
injected). Then: `Ctrl+;` opens the overlay; a query returns issue results; arrow/Enter inserts
`owner/repo#123` at the caret; Escape closes and restores focus; native `#`/`@` still work. To
protect private data, checks assert structure/counts rather than echoing `dragonflyic` titles
into logs.

## Scope

**MVP (this spec):** `Ctrl+;` trigger → type query → **Enter-run** single `type=issues` search →
list with plain-text titles → arrow + Enter inserts `owner/repo#123`. Overlay anchored under the
textarea.

**Deferred polish (not now):** **searching pull requests too** (a second `type=pullrequests`
fetch + merge, with an issue-vs-PR icon and merged-state); safe `<em>` highlight rendering; exact
caret-pixel positioning; collapsing same-repo references to bare `#123`; recency-vs-relevance sort
tuning; a `;;` text trigger in addition to the chord; a runtime-configurable scope (options page).
