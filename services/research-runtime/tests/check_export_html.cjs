/** Real Chromium QA for the offline HTML fixture. No remote request is made. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

(async () => {
  const root = path.resolve(process.argv[2] || 'artifacts/offline-proposal-fixture');
  const out = path.resolve(process.argv[3] || 'artifacts/qa/proposal-html');
  fs.mkdirSync(out, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'proposal-manifest.json'), 'utf8'));
  const source = path.join(root, manifest.files.find(file => file.format === 'html').path);
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const network = [];
    await page.route(/^https?:/, route => { network.push(route.request().url()); route.abort(); });
    await page.goto(pathToFileURL(source).href);
    assert.equal(await page.locator('table').count(), 2);
    assert.equal(await page.locator('#evidence-1').count(), 1);
    assert.match(await page.locator('header').innerText(), /研究草稿/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(out, 'desktop.png'), fullPage: true });
    await page.locator('a[href="#evidence-1"]').first().click();
    assert.equal(new URL(page.url()).hash, '#evidence-1');
    await page.addScriptTag({ content: 'window.__CHUGAO_SCRIPT_SHOULD_BE_BLOCKED__=true' }).catch(() => {});
    assert.equal(await page.evaluate(() => window.__CHUGAO_SCRIPT_SHOULD_BE_BLOCKED__), undefined);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(pathToFileURL(source).href);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const scrollable = await page.locator('.table-scroll').first().evaluate(el => el.scrollWidth > el.clientWidth);
    assert.equal(scrollable, true);
    await page.screenshot({ path: path.join(out, 'mobile.png'), fullPage: true });
    const selected = await page.locator('h1').evaluate(el => {
      const range = document.createRange(); range.selectNodeContents(el);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      return selection.toString();
    });
    assert.match(selected, /离线导出验收样例/);
    assert.deepEqual(network, []);
    const result = { browser: 'Chromium', checks: 9, passed: true, remoteRequests: network.length,
      desktopViewport: [1440,1000], mobileViewport: [390,844], cspScriptBlocked: true,
      note: 'Offline fixture only; checks DOM, links, local overflow, selection, CSP and zero network requests.' };
    fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
