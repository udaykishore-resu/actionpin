/* Regenerates the 1280x800 store screenshots: the real extension running in Chromium on store/demo-page.html.
   Lookups are live, so the SHAs / verdicts in the pictures are whatever is true on the day you run it. */
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const EXT = path.resolve(__dirname, '..', 'extension');
const OUT = __dirname;

async function launch(ext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shots-'));
  const opts = { channel: 'chromium', headless: true, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1,
    args: ['--disable-extensions-except=' + ext, '--load-extension=' + ext] };
  if (process.env.HTTPS_PROXY) opts.proxy = { server: process.env.HTTPS_PROXY };
  const ctx = await chromium.launchPersistentContext(dir, opts);
  if (!ctx.serviceWorkers().length) await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  return ctx;
}
const clickIn = (page, tag, sel, re) => page.evaluate(([t, s, r]) => {
  const root = document.querySelector(t).shadowRoot;
  const el = [...root.querySelectorAll(s)].find((e) => !r || new RegExp(r).test(e.textContent));
  if (el) el.click();
  return !!el;
}, [tag, sel, re || '']);

(async () => {
  // ActionPin
  const ctx = await launch(EXT);
  const html = fs.readFileSync(path.join(__dirname, 'demo-page.html'), 'utf8');
  await ctx.route('https://github.com/acme/**', (r) => r.fulfill({ contentType: 'text/html', body: html }));
  const page = await ctx.newPage();
  await page.goto('https://github.com/acme/shop-api/blob/main/.github/workflows/ci.yml');
  await page.waitForFunction(() => document.querySelectorAll('[data-actionpin]').length >= 7, null, { timeout: 60000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, 'actionpin-screenshot-1.png') });
  console.log('actionpin labels:', await page.evaluate(() => [...document.querySelectorAll('[data-actionpin]')].map((e) => e.textContent + ' => ' + e.getAttribute('data-actionpin-label'))));
  await clickIn(page, 'actionpin-panel', '.pill');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, 'actionpin-screenshot-2.png') });
  await ctx.close();
})().catch((e) => { console.error(e); process.exit(1); });
