/** Local Chromium checks of the actual proposal replays. No upstream calls. */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

(async () => {
  const root = path.resolve(process.argv[2]);
  const output = path.resolve(process.argv[3]);
  fs.mkdirSync(output, { recursive: true });
  const fixtures = path.resolve(__dirname, '../services/research-runtime/tests/fixtures');
  const inputs = JSON.parse(fs.readFileSync(path.join(fixtures, 'office_lunch_actual_tool_inputs.json'), 'utf8'));
  const proposals = Object.fromEntries(inputs.map((item, index) => [`original-input-${index + 1}`, item.arguments.proposal]));
  proposals['reviewer-curated'] = JSON.parse(fs.readFileSync(path.join(fixtures, 'office_lunch_curated_proposal.json'), 'utf8'));
  const cases = JSON.parse(fs.readFileSync(path.join(root, 'replay-results.json'), 'utf8'));
  const executablePath = process.env.CHUGAO_QA_CHROMIUM;
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });
  const results = [];
  try {
    for (const item of cases) {
      const expected = proposals[item.case];
      const manifest = JSON.parse(fs.readFileSync(path.join(root, item.manifest), 'utf8'));
      const file = manifest.files.find(entry => entry.format === 'html');
      const source = path.resolve(root, item.case, file.path);
      assert.equal(crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex'), file.sha256);
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const remoteRequests = [];
      await page.route(/^https?:/, route => { remoteRequests.push(route.request().url()); route.abort(); });
      const checks = [];
      await page.goto(pathToFileURL(source).href);
      assert.equal(await page.locator('h1').innerText(), expected.title);
      assert.equal(await page.locator('table').count(), expected.slides.filter(section => section.table).length);
      assert.match(await page.locator('header').innerText(), /研究草稿/);
      checks.push('title, draft state and semantic table count');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      checks.push('desktop has no document-level horizontal overflow');
      const broken = await page.locator('a[href^="#"]').evaluateAll(links => links.filter(link => !document.getElementById(link.getAttribute('href').slice(1))).map(link => link.getAttribute('href')));
      assert.deepEqual(broken, []);
      await page.locator('a[href="#evidence-1"]').first().click();
      assert.equal(new URL(page.url()).hash, '#evidence-1');
      checks.push('source, shared-basis and section anchors resolve');
      await page.addScriptTag({ content: 'window.__CHUGAO_SCRIPT_SHOULD_BE_BLOCKED__=true' }).catch(() => {});
      assert.equal(await page.evaluate(() => window.__CHUGAO_SCRIPT_SHOULD_BE_BLOCKED__), undefined);
      checks.push('CSP blocks injected inline script');
      await page.goto(pathToFileURL(source).href);
      await page.screenshot({ path: path.join(output, item.case + '-desktop.png'), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await page.locator('.table-scroll').first().evaluate(element => element.scrollWidth > element.clientWidth), true);
      checks.push('mobile confines wide tables to their own scroller');
      const selected = await page.locator('h1').evaluate(element => {
        const range = document.createRange(); range.selectNodeContents(element);
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
        return selection.toString();
      });
      assert.equal(selected, expected.title);
      checks.push('actual title can be selected intact');
      await page.screenshot({ path: path.join(output, item.case + '-mobile.png'), fullPage: true });
      assert.deepEqual(remoteRequests, []);
      checks.push('zero outbound HTTP requests with interception enabled');
      results.push({ case: item.case, passed: true, htmlSha256: file.sha256, checks, remoteRequests: remoteRequests.length });
      await page.close();
    }
    const report = { browser: await browser.version(), scope: 'Local exported HTML only; not the signed-in product UI or a live model run', cases: results };
    fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
