const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../extension/lib/core.js');

const raw = fs.readFileSync(path.join(__dirname, 'checkout.refs.txt'), 'utf8'); // real capture from actions/checkout
const refs = C.parseRefAdvertisement(raw);
const V4 = refs.tags['v4'];
const V422 = refs.tags['v4.2.2'];
const MAIN = refs.heads['main'];

test('parses real ref advertisement', () => {
  assert.match(V4, /^[0-9a-f]{40}$/);
  assert.match(V422, /^[0-9a-f]{40}$/);
  assert.match(MAIN, /^[0-9a-f]{40}$/);
  assert.equal(V422, '11bd71901bbe5b1630ceea73d27597364c9af683'); // published SHA for v4.2.2
  assert.ok(!Object.keys(refs.tags).some((t) => t.includes('^{}')));
});

test('peels annotated tags to the commit', () => {
  const adv =
    '003faaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa refs/tags/v1.0.0\n' +
    '0042bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb refs/tags/v1.0.0^{}\n';
  assert.equal(C.parseRefAdvertisement(adv).tags['v1.0.0'], 'b'.repeat(40));
});

test('parseUsesLine: shapes that must parse', () => {
  const cases = {
    '      - uses: actions/checkout@v4': ['actions', 'checkout', '', 'v4', ''],
    '        uses: "actions/setup-node@v4"  # node': ['actions', 'setup-node', '', 'v4', 'node'],
    "  - uses: 'docker/build-push-action@master'": ['docker', 'build-push-action', '', 'master', ''],
    '+      - uses: github/codeql-action/init@v3': ['github', 'codeql-action', '/init', 'v3', ''],
    '    uses: org/repo/.github/workflows/ci.yml@main': ['org', 'repo', '/.github/workflows/ci.yml', 'main', ''],
    '- uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2': ['actions', 'checkout', '', '11bd71901bbe5b1630ceea73d27597364c9af683', 'v4.2.2'],
    '- { uses: actions/cache@v4 }': null, // flow mapping with trailing brace: not supported, must not mis-parse
  };
  for (const [line, want] of Object.entries(cases)) {
    const p = C.parseUsesLine(line);
    if (want === null) {
      assert.equal(p, null, line);
      continue;
    }
    assert.ok(p, 'should parse: ' + line);
    assert.deepEqual([p.owner, p.repo, p.path, p.ref, p.comment], want, line);
  }
});

test('parseUsesLine: shapes that must be ignored', () => {
  for (const line of [
    '      - uses: ./.github/actions/local',
    '      - uses: ${{ matrix.action }}',
    '      - run: echo "uses: actions/checkout@v4 is common"',
    '# uses: actions/checkout@v4',
    'This workflow uses: several things',
    'reuses: actions/checkout@v4',
    '      - name: actions/checkout@v4',
  ]) {
    assert.equal(C.parseUsesLine(line), null, line);
  }
});

test('docker references', () => {
  assert.equal(C.assess(C.parseUsesLine('- uses: docker://alpine:3.20'), null).status, 'docker-tag');
  assert.equal(C.assess(C.parseUsesLine('- uses: docker://ghcr.io/a/b@sha256:' + 'a'.repeat(64)), null).status, 'docker-pinned');
});

test('extractCommentTag', () => {
  assert.equal(C.extractCommentTag('v4.2.2'), 'v4.2.2');
  assert.equal(C.extractCommentTag('tag=v4'), 'v4');
  assert.equal(C.extractCommentTag('pin@v3 was here'), null);
  assert.equal(C.extractCommentTag('4.1.0 (latest)'), '4.1.0');
  assert.equal(C.extractCommentTag('checkout the code'), null);
  assert.equal(C.extractCommentTag(''), null);
});

test('tag is flagged and fix carries the most specific version', () => {
  const a = C.assess(C.parseUsesLine('- uses: actions/checkout@v4'), refs);
  assert.equal(a.status, 'tag');
  assert.equal(a.level, 'warn');
  const best = C.tagsAt(refs, V4)[0];
  assert.equal(a.fix, 'actions/checkout@' + V4 + ' # ' + best);
});

test('branch is flagged as danger', () => {
  const a = C.assess(C.parseUsesLine('- uses: actions/checkout@main'), refs);
  assert.equal(a.status, 'branch');
  assert.equal(a.level, 'danger');
  assert.equal(a.fix, 'actions/checkout@' + MAIN + ' # main');
});

test('pinned SHA with a correct comment verifies', () => {
  const a = C.assess(C.parseUsesLine('- uses: actions/checkout@' + V422 + ' # v4.2.2'), refs);
  assert.equal(a.status, 'verified');
});

test('pinned SHA with a wrong comment is a mismatch', () => {
  const a = C.assess(C.parseUsesLine('- uses: actions/checkout@' + V422 + ' # v3'), refs);
  assert.equal(a.status, 'mismatch');
  assert.equal(a.level, 'danger');
  assert.equal(a.actual, 'v4.2.2');
});

test('pinned SHA without a comment is reverse-resolved', () => {
  const a = C.assess(C.parseUsesLine('- uses: actions/checkout@' + V422), refs);
  assert.equal(a.status, 'verified');
  assert.match(a.label, /v4\.2\.2/);
});

test('unknown SHA stays pinned but says it is unverifiable', () => {
  const a = C.assess(C.parseUsesLine('- uses: actions/checkout@' + 'c'.repeat(40)), refs);
  assert.equal(a.status, 'pinned');
  assert.match(a.detail, /fork/);
});

test('tag/branch name collision is ambiguous', () => {
  const r = { tags: { v1: 'a'.repeat(40) }, heads: { v1: 'b'.repeat(40) } };
  const a = C.assess(C.parseUsesLine('- uses: x/y@v1'), r);
  assert.equal(a.status, 'ambiguous');
});

test('missing ref and unreadable repo', () => {
  assert.equal(C.assess(C.parseUsesLine('- uses: actions/checkout@nope'), refs).status, 'missing');
  assert.equal(C.assess(C.parseUsesLine('- uses: actions/checkout@v4'), null, 'private or missing repo').status, 'unresolved');
  assert.equal(C.assess(C.parseUsesLine('- uses: actions/checkout@' + V422), null).status, 'pinned');
});

test('findUses over a whole workflow', () => {
  const wf = ['jobs:', '  b:', '    steps:', '      - uses: actions/checkout@v4', '      - run: make', '      - uses: actions/setup-go@v5 # go', ''].join('\n');
  const f = C.findUses(wf);
  assert.deepEqual(f.map((x) => [x.line, x.parsed.spec]), [[3, 'actions/checkout@v4'], [5, 'actions/setup-go@v5']]);
});
