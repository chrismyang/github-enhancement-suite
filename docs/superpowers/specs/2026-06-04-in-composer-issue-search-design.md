# In-composer issue search — design

_Spec date: 2026-06-04_

## Summary

Add a search overlay, opened with **`Ctrl+;`** from inside any GitHub markdown textarea, that
lets you find an issue with the **full `github.com/search` engine** (free text + all
qualifiers) and insert a reference (`owner/repo#123`) at the caret. The query box defaults to
issues; PRs are reachable by editing it (see Scope). It exists because GitHub's
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
- **Query syntax (confirmed live):** the fetch URL **must** include a `type` param — with none,
  `/search` defaults to *repository* search (0 issue results). With `&type=issues` set (which
  engages GitHub's issue/PR search index), the **`is:` qualifier in `q` drives the result kind**:
  `is:issue` → issues, `is:pr` → PRs (verified: `type=issues` + `is:pr` returned PRs). So one
  fixed `&type=issues` URL switch plus the user's query text covers both kinds — single request,
  no merge.

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
- **Pre-filled, editable query (self-describing):** the overlay input opens **pre-filled** with
  `DEFAULT_QUERY = 'org:dragonflyic is:issue '` (caret at end). The user appends their terms and
  can edit the prefix for a one-off — different `org:`/`repo:`, or `is:pr` to find a PR instead.
  The box content **is** the query; there's no hidden prepend or qualifier-guessing.
- **Search:** the user presses **Enter** to run the box's current text (NOT debounced
  as-you-type). On Enter, a single same-origin fetch to `/search?q=<box>&type=issues` — the fixed
  `type=issues` switch engages the issue/PR index and the box's `is:` qualifier selects the kind.
  Results parsed and listed with the first row auto-highlighted.
- **Results:** rendered in the overlay panel — see *Overlay UI & placement* below.
- **Enter semantics (two stages):** while the input has focus and the query is unchanged since
  the last run, Enter inserts the highlighted result; editing the query makes Enter re-run the
  search instead. Up/Down move the highlight; click also inserts.
- **Insert:** inserts `owner/repo#123` at the caret position captured when the overlay opened,
  via the existing `execCommand` path. Always fully-qualified — GitHub renders `owner/repo#123`
  as `#123` automatically when it is the current repo.
- **Dismiss:** Escape or blur closes the overlay and restores focus to the textarea; nothing is
  inserted.

## Overlay UI & placement

The overlay is a small floating **panel** (our own DOM, isolated styling) — NOT GitHub's inline
`#` popup. It differs from native `#` in one way by necessity: it has its **own search input**,
because the query (`org:dragonflyic is:issue …`) must stay separate from the comment text. Its
*result rows*, though, deliberately echo the native `#` popup, plus a search-style snippet.

**Layout:**
- **Query input** (top): a single-line `<input>` pre-filled with `DEFAULT_QUERY`, caret at end.
- **Results list** (below): one row per result, styled after the native `#` popup —
  - leading **icon**: issue vs PR + open/closed (from `state` + `isPullRequest`),
  - **title**: plain text, truncated with ellipsis, one line,
  - trailing **`owner/repo#number`**: muted, right-aligned,
  - a secondary **snippet line**: muted/smaller, the body text around the match (`hl_text`,
    tag-stripped, ~1 line) — the "preview of where it hit," like `github.com/search`.
- The first result is auto-highlighted; **↑/↓** move the highlight, **Enter** inserts the
  highlighted row, **click** inserts, **Esc** closes. An optional footer hint (`↑↓ ↵ esc`).
- Empty/zero-results and fetch-error states render a single muted line in the panel.

**Placement:** anchored at the **caret's line**, like the native `#` popup — the panel floats
just below the caret. Caret pixel coordinates come from the standard **mirror-div technique**: a
hidden div mirrors the textarea's font / padding / border / width and its text up to the caret
with a marker span; the span's offset, plus the textarea's `getBoundingClientRect()` and scroll
offsets, gives the caret x/y. The panel is positioned there and clamped within the viewport. MVP
positions once on open and closes on textarea scroll/blur; continuous reposition-on-scroll is a
later refinement.

**Styling:** rounded panel with border + subtle shadow echoing GitHub's popup affordance; lives
in `src/issue-search.css`. The panel is one container element, appended on open and removed on
close.

## Architecture

Preserves the repo's split: **pure logic in a testable module, DOM/network in glue.**

### `src/issue-search.js` — pure, unit-tested (no DOM, no network)

Exposed on `globalThis.GMTI` and `module.exports`, matching the project pattern.

- `const DEFAULT_QUERY = 'org:dragonflyic is:issue ';` — the initial (editable) box content.
- `searchUrl(queryText)` → `` `/search?q=${encodeURIComponent(queryText.trim())}&type=issues` ``.
  (`type=issues` is the fixed switch that engages the issue/PR index; the query text — incl. any
  `is:issue`/`is:pr` — does the filtering.)
- `parseResultsHtml(htmlString)` → `Array<Result>`. Extracts the `react-app.embeddedData`
  script's JSON **by string match (NOT DOMParser, so it runs under node:test)**, `JSON.parse`s
  it, maps `payload.results` to the normalized shape below. Field mapping: `number`,
  `repo.repository.owner_login` → `owner`, `repo.repository.name` → `repo`,
  `stripTags(hl_title)` → `title`, `stripTags(hl_text)` → `snippet`, `state`,
  `issue.issue.pull_request_id != null` → `isPullRequest`. Any failure (no blob, bad JSON,
  missing fields) returns `[]` — never throws.
- `buildReference(result)` → `` `${result.owner}/${result.repo}#${result.number}` ``.
- `stripTags(hl)` → plain text (removes `<em>`/all tags; decodes basic entities). Used for both
  `title` and `snippet` (MVP renders them as plain text).

Normalized `Result`: `{ number, owner, repo, title, snippet, state, isPullRequest }`.

### `src/issue-search-ui.js` — glue (DOM + network)

- Creates/owns the overlay element (search input + results `<ul>`) and positions it at the
  caret via a `caretCoords(textarea)` glue helper (mirror-div measurement; see *Overlay UI &
  placement*). The input opens **pre-filled with `DEFAULT_QUERY`**, caret at end, so the
  scope/qualifiers are visible and editable.
- Enter-run search: on Enter in the input, fetches `searchUrl(input.value)` same-origin with
  `credentials: 'same-origin'`, calls `parseResultsHtml`, renders rows, auto-highlights the
  first. No debounce / no as-you-type requests.
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

- `searchUrl`: trims and URL-encodes the query text and appends `&type=issues`.
- `parseResultsHtml`: extracts results from the fixture with correct
  `number/owner/repo/title/snippet/state/isPullRequest`; returns `[]` for empty HTML, malformed
  JSON, and a missing `embeddedData` blob.
- `buildReference`: `owner/repo#number`.
- `stripTags`: removes `<em>` and decodes entities.

### Live verification (Playwright, real GitHub)

Per `CLAUDE.md` (reload the extension **and reload the page** so the updated content script is
injected). Then: `Ctrl+;` opens the overlay; a query returns issue results; arrow/Enter inserts
`owner/repo#123` at the caret; Escape closes and restores focus; native `#`/`@` still work. To
protect private data, checks assert structure/counts rather than echoing `dragonflyic` titles
into logs.

## Scope

**MVP (this spec):** `Ctrl+;` trigger → overlay opens with the **pre-filled, editable** query
`org:dragonflyic is:issue ` → **Enter-run** search (`/search?q=<box>&type=issues`) → list with
plain-text titles → arrow + Enter inserts `owner/repo#123`. Defaults to issues; editing the box to
`is:pr` finds PRs via the same single fetch. Overlay anchored at the caret line (mirror-div).

**Deferred polish (not now):** **issues + PRs merged into one list** (the box already *reaches*
either kind via `is:issue`/`is:pr`; showing both at once would need a second fetch + merge);
richer state icons (e.g. merged-PR purple, beyond MVP's open/closed + issue/PR); safe `<em>`
highlight rendering in titles/snippets; continuous reposition-on-scroll (MVP closes on scroll);
collapsing same-repo references to bare `#123`; recency-vs-relevance sort tuning; a `;;` text
trigger in addition to the chord; a runtime-configurable scope (options page).
