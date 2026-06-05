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
    .replace(/&#x([0-9a-fA-F]+);/g, function (m, h) {
      const n = parseInt(h, 16);
      return n >= 0 && n <= 0x10FFFF ? String.fromCodePoint(n) : m;
    })
    .replace(/&#(\d+);/g, function (m, d) {
      const n = parseInt(d, 10);
      return n >= 0 && n <= 0x10FFFF ? String.fromCodePoint(n) : m;
    })
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
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
        merged: !!(r && r.merged),
        stateReason: r ? (r.state_reason || null) : null,
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
