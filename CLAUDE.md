# CLAUDE.md

Guidance for working in this repo.

## What this is

A personal, **Manifest V3 Chrome extension** ("GitHub Markdown Tab Indent") that improves
editing in GitHub's markdown textareas (issue/PR comments and descriptions, the Projects
issue side-pane, classic + the React/Primer editor). It enhances GitHub's *native* textarea
in place — it does **not** replace the editor — so GitHub's own `@`/`#`/`:` autocomplete,
image upload, preview, and ⌘Enter submit keep working.

Private repo: `chrismyang/github-enhancement-suite`. Distribution is **load-unpacked** (no
build step, no bundler, no dependencies).

### Shipped behaviors
Each shipped feature has a dated design doc in `docs/superpowers/specs/` (and an implementation
plan in `docs/superpowers/plans/`); read those for the authoritative spec of current behavior
rather than duplicating it here. Backlog and probe findings live in `FEATURE_IDEAS.md`.

## Layout

```
manifest.json          MV3; one content_scripts entry on https://github.com/* :
                       js = [src/indent.js, src/issue-search.js, src/issue-search-ui.js,
                       src/content.js], css = [src/editor.css, src/issue-search.css]
src/indent.js          PURE logic — no DOM. All text-edit computations + helpers. Exported on
                       globalThis.GMTI.* (for the content script) AND module.exports (for tests).
src/issue-search.js    PURE logic — no DOM/network. Issue-search query/URL building, parsing the
                       /search embedded-JSON blob, reference building. On GMTI.* + module.exports.
src/issue-search-ui.js DOM/network glue — the caret-anchored search overlay (mirror-div position,
                       same-origin fetch, render, keyboard nav). Exposes GMTI.openIssueSearch.
src/content.js         DOM glue — the ONLY file with the keydown/paste listeners. Capture-phase
                       keydown (Tab, Shift/plain Enter, wrap chars, Ctrl+; issue search) + paste;
                       field detection; execCommand apply.
src/editor.css         Monospace font on the markdown textareas (manifest-injected).
src/issue-search.css   Styling for the issue-search overlay panel (manifest-injected).
tests/indent.test.js   Unit tests for src/indent.js (node:test).
tests/issue-search.test.js  Unit tests for src/issue-search.js (node:test).
docs/superpowers/specs/ Design docs (one per feature, dated).
docs/superpowers/plans/ Implementation plans (one per feature, dated).
```

`src/indent.js` is the heart. Pure functions, each returning the same edit contract:
`{ rangeStart, rangeEnd, text, newSelStart, newSelEnd } | null` (where `null` = no-op / let
GitHub handle it). Key functions: `listMarker`, `precedingListContentCols`, `nextMarker`,
`owningListLine`, `computeIndent`, `computeSoftBreak`, `computeListEnter`, `computePasteIndent`.

## Testing

```bash
npm test          # or: node --test   — runs the tests/ suite (Node >= 18, zero deps)
```

All editing *logic* is unit-tested as pure functions. `src/content.js` is DOM glue and is
**not** unit-tested — verify it live (see below). After editing JS, `node --check src/<file>.js`.

### Live verification (integration)
The real behavior (and anything in `content.js`) is verified against real GitHub via the
Playwright MCP browser, driving the actual loaded extension. Pattern used throughout:
1. Ask the user to **reload** the extension on `chrome://extensions` (load-unpacked doesn't
   hot-reload — the loaded build is a snapshot of disk) **and then reload the GitHub page** —
   reloading the extension alone does NOT re-inject the content script into an already-open tab.
2. Open a fresh GitHub comment box (e.g. `https://github.com/chrismyang/hammersmith/issues/1`).
3. Confirm the page's main world is clean (`typeof globalThis.GMTI === 'undefined'` — the
   extension runs in the isolated world), then drive real key/paste events and read back
   `textarea.value`. Clear the box after; never submit.

## Conventions / gotchas (important)

- **Never set `textarea.value` directly.** GitHub's editor is React-controlled; assigning
  `.value` is ignored on submit and destroys the undo stack. Mutate via
  `document.execCommand('insertText'|'delete', ...)` — it's React-safe (fires the `input`
  event React listens for) and preserves **single-step native undo**. This is why
  `applyEdit` in `content.js` uses execCommand. (`execCommand` is deprecated but works
  reliably in Chrome for this and is intentional.)
- **Field detection** (`isMarkdownField` in `content.js`): a `<textarea>` matching an explicit
  selector list OR inside a `[class*="MarkdownEditor-module"] / [class*="MarkdownInput-module"]`
  wrapper. The wrapper match is what catches the comment composer and the Projects side-pane
  (they use `aria-labelledby`, not `aria-label="Markdown value"`), and survives the per-build
  hash on the textarea's own class. `src/editor.css`'s selectors mirror this exactly — keep
  them in sync.
- **Autocomplete stand-down**: when GitHub's `@`/`#` popup is open the textarea has
  `aria-expanded="true"`; the listeners no-op then so Tab/Enter reach GitHub. (Known latent
  bug: the fallback global `[role="listbox"]` check can mis-fire on listbox-heavy pages — see
  FEATURE_IDEAS "harden the autocomplete stand-down".)
- **Single capture-phase listener per event** on `document` (not per-textarea). It survives
  GitHub's SPA navigation (the listener is never torn down) and handles dynamically-added
  textareas. The paste listener relies on capture phase to win the race vs GitHub's own paste
  handling (verified live).
- **`null` means native.** For Enter/paste, only `preventDefault()` when a compute returns a
  result; a `null` lets GitHub's native behavior run. (Tab is the exception — it always
  `preventDefault`s on a markdown field so focus never blurs, even on a no-op.)
- **Never break the box.** Every DOM mutation path is wrapped so any failure falls back to
  native behavior rather than corrupting the textarea.

## Workflow (how features get built here)

This repo is built with the **superpowers** skills, one feature at a time:
brainstorm → write spec (`docs/superpowers/specs/`) → write plan (`docs/superpowers/plans/`) →
implement plan task-by-task with TDD and per-task spec+quality review → live-verify on real
GitHub → **squash the feature's commits into one** and push to keep `origin/main` tidy. When
wrapping up, **true up `FEATURE_IDEAS.md`**: remove the now-shipped idea from the backlog.

Plans contain exact, verbatim code per task — implement it as written (don't "improve" regexes
etc.; deviations have caused bugs). Commit messages end with the project's Co-Authored-By line.
