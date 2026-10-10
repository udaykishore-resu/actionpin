/* End-to-end check: loads the unpacked extension in Chromium and serves fixture pages at the real URLs
   the content script matches. Lookups from the service workers go to the real GitHub / registry endpoints. */
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const EXT = path.join(ROOT, 'extension');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra) => {
  results.push({ name, ok: !!ok });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''));
};

async function launch(ext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-e2e-'));
  const opts = {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1180, height: 900 },
    args: ['--disable-extensions-except=' + ext, '--load-extension=' + ext],
  };
  if (process.env.HTTPS_PROXY) opts.proxy = { server: process.env.HTTPS_PROXY };
  const ctx = await chromium.launchPersistentContext(dir, opts);
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  return { ctx, sw };
}

const panelText = (page, tag) =>
  page.evaluate((t) => {
    const h = document.querySelector(t);
    return h && h.shadowRoot ? h.shadowRoot.textContent : '';
  }, tag);

async function actionpin() {
  console.log('\n=== ActionPin ===');
  const { ctx, sw } = await launch(EXT);
  try {
  check('service worker registered', !!sw, sw && sw.url());
  const html = fs.readFileSync(path.join(__dirname, 'fixtures/github-workflow.html'), 'utf8');
  await ctx.route('https://github.com/acme/demo/**', (r) => r.fulfill({ contentType: 'text/html', body: html }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('https://github.com/acme/demo/blob/main/.github/workflows/ci.yml');
  await page.waitForFunction(() => document.querySelectorAll('[data-actionpin]').length >= 9, null, { timeout: 30000 }).catch(() => {});

  const get = (id) => page.evaluate((i) => {
    const e = document.getElementById(i);
    return e ? { level: e.getAttribute('data-actionpin'), label: e.getAttribute('data-actionpin-label') } : null;
  }, id);

  const tag = await get('t-tag');
  check('tag is resolved live from github.com', tag.level === 'warn' && /^⚠ tag → [0-9a-f]{7}$/.test(tag.label), tag);
  const branch = await get('t-branch');
  check('branch flagged as risky with tip SHA', branch.level === 'danger' && /^✖ branch → [0-9a-f]{7}$/.test(branch.label), branch);
  const good = await get('t-good');
  check('correct SHA + comment verifies', good.level === 'ok' && good.label === '✓ pinned = v4.2.2', good);
  const lie = await get('t-lie');
  check('SHA whose comment names the wrong tag is caught', lie.level === 'danger' && /comment says v3/.test(lie.label), lie);
  const quoted = await get('t-quoted');
  check('quoted value handled', quoted.level === 'warn' && /tag →/.test(quoted.label), quoted);
  const docker = await get('t-docker');
  check('docker tag flagged', docker.level === 'warn', docker);
  const local = await get('t-local');
  check('local action ignored', local.level === null, local);
  const missing = await get('t-missing');
  check('unreadable repo degrades to "not pinned", not a crash', missing.level === 'warn' && /not pinned/.test(missing.label), missing);
  check('`run:` line mentioning an action is ignored', (await get('t-run')).level === null);
  check('commented-out uses is ignored', (await get('t-comment')).level === null);
  const diff = await get('d-tag');
  check('diff-table line labelled', diff.level === 'warn', diff);

  const text = await panelText(page, 'actionpin-panel');
  check('panel summary present', /ActionPin/.test(text) && /risky/.test(text) && /unpinned/.test(text) && /pinned/.test(text), text);

  await page.evaluate(() => document.querySelector('actionpin-panel').shadowRoot.querySelector('.pill').click());
  const open = await page.evaluate(() => {
    const r = document.querySelector('actionpin-panel').shadowRoot;
    return { rows: [...r.querySelectorAll('.row .spec')].map((e) => e.textContent), fixes: [...r.querySelectorAll('.fix')].map((e) => e.textContent) };
  });
  check('panel lists multi-line <pre> findings', open.rows.some((s) => s.startsWith('actions/checkout@v4.2.1')) && open.rows.some((s) => s.startsWith('actions/checkout@v4.1.0')), open.rows);
  check('hidden textarea copy of the file is not double-counted', !open.rows.some((s) => /hidden-textarea-only|checkout@v2/.test(s)));
  const fix = open.fixes.find((f) => / # v4\.2\.1$/.test(f));
  check('fix line is a full 40-char SHA plus version comment', fix && /^uses: actions\/checkout@[0-9a-f]{40} # v4\.2\.1$/.test(fix), fix);
  check('fix for v4.2.1 matches the known published SHA', fix && fix.includes('eef61447b9ff4aafe5dcd4e0bbf5d482be7e7871'));
  const status = await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://github.com/*' });
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'actionpin:status' });
    return { hasUrl: !!tab.url, res, badge: await chrome.action.getBadgeText({ tabId: tab.id }) };
  });
  check('popup data: content script reports its findings', status.hasUrl && status.res.found === 10 && status.res.count.danger === 2 && status.res.count.warn === 7 && status.res.count.ok === 1, status.res.count);
  check('toolbar badge shows the number of open findings', status.badge === '9', status.badge);
  const extId = new URL(sw.url()).host;
  const pop = await ctx.newPage();
  const popErrors = [];
  pop.on('pageerror', (e) => popErrors.push(String(e)));
  await pop.goto('chrome-extension://' + extId + '/popup.html');
  await pop.waitForFunction(() => !/Checking/.test(document.getElementById('status').textContent), null, { timeout: 10000 }).catch(() => {});
  const popText = await pop.evaluate(() => document.body.innerText);
  check('popup explains itself on a non-GitHub tab instead of doing nothing', /not on github\.com/.test(popText) && popErrors.length === 0, popText.replace(/\s+/g, ' ').slice(0, 140));
  await pop.close();
  await page.bringToFront();
  check('no page errors', errors.length === 0, errors);
  await page.screenshot({ path: path.join(OUT, 'actionpin.png'), fullPage: true });

  // SPA-style navigation: content replaced without a reload.
  await page.evaluate(() => {
    document.querySelector('.react-code-lines').innerHTML =
      '<div class="react-code-text"><div class="react-file-line">      - <span class="pl-ent">uses</span>: <span class="pl-s" id="n-new">actions/checkout@v3</span></div></div>';
  });
  await page.waitForFunction(() => document.getElementById('n-new') && document.getElementById('n-new').hasAttribute('data-actionpin'), null, { timeout: 15000 }).catch(() => {});
  check('re-scans after in-page content swap', (await get('n-new')).level === 'warn');
  } finally {
    await ctx.close();
  }
}

(async () => {
  try {
    await actionpin();
  } catch (e) {
    console.error('HARNESS ERROR', e);
    process.exitCode = 2;
  }
  const failed = results.filter((r) => !r.ok);
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
  if (failed.length) process.exitCode = 1;
})();
