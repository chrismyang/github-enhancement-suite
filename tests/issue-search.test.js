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
    { number: 1283, state: 'open', state_reason: null,
      hl_title: 'Deploy pipeline <em>flakes</em> on staging',
      hl_text: '…intermittent <em>timeout</em> when the deploy step runs…',
      repo: { repository: { owner_login: 'dragonflyic', name: 'api' } },
      issue: { issue: { pull_request_id: null } } },
    { number: 1301, state: 'closed', merged: true,
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

test('stripTags removes tags and decodes named + numeric entities', () => {
  assert.strictEqual(stripTags('Deploy <em>flakes</em> here'), 'Deploy flakes here');
  assert.strictEqual(stripTags('a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;'), 'a & b <c> "d" \'e\'');
  assert.strictEqual(stripTags('doesn&#x27;t and a&#x2F;b'), "doesn't and a/b");
  assert.strictEqual(stripTags('slash &#47; dec &#38; amp'), 'slash / dec & amp');
  assert.strictEqual(stripTags(undefined), '');
});

test('parseResultsHtml maps the embedded blob to normalized results', () => {
  const r = parseResultsHtml(FIXTURE);
  assert.strictEqual(r.length, 2);
  assert.deepStrictEqual(r[0], {
    number: 1283, owner: 'dragonflyic', repo: 'api',
    title: 'Deploy pipeline flakes on staging',
    snippet: '…intermittent timeout when the deploy step runs…',
    state: 'open', isPullRequest: false, merged: false, stateReason: null,
  });
  assert.strictEqual(r[1].number, 1301);
  assert.strictEqual(r[1].repo, 'infra');
  assert.strictEqual(r[1].title, 'fix: stabilize deploy retries & backoff');
  assert.strictEqual(r[1].isPullRequest, true);
  assert.strictEqual(r[1].merged, true);
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

test('parseResultsHtml drops results missing number/owner/repo', () => {
  const html = '<script type="application/json" data-target="react-app.embeddedData">' +
    JSON.stringify({ payload: { results: [
      { number: 7, state: 'open', hl_title: 'good', hl_text: '',
        repo: { repository: { owner_login: 'o', name: 'r' } }, issue: { issue: { pull_request_id: null } } },
      { number: 8, state: 'open', hl_title: 'no repo', hl_text: '',
        repo: {}, issue: { issue: { pull_request_id: null } } },
      { state: 'open', hl_title: 'no number', hl_text: '',
        repo: { repository: { owner_login: 'o', name: 'r' } }, issue: { issue: { pull_request_id: null } } },
    ] } }) + '</script>';
  const r = parseResultsHtml(html);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].number, 7);
});

test('parseResultsHtml carries merged and stateReason', () => {
  const html = '<script type="application/json" data-target="react-app.embeddedData">' +
    JSON.stringify({ payload: { results: [
      { number: 5, state: 'closed', state_reason: 'not_planned', hl_title: 'x', hl_text: '',
        repo: { repository: { owner_login: 'o', name: 'r' } }, issue: { issue: { pull_request_id: null } } },
    ] } }) + '</script>';
  const r = parseResultsHtml(html);
  assert.strictEqual(r[0].stateReason, 'not_planned');
  assert.strictEqual(r[0].merged, false);
  assert.strictEqual(r[0].isPullRequest, false);
});
