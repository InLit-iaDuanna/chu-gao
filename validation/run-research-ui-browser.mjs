// Real React workspace + the application's Tailwind CSS, with explicit offline
// API fixtures. Run: RESEARCH_QA_CHROME=/path/to/chrome node --import tsx
// validation/run-research-ui-browser.mjs [--prepare-only]
// Screenshots and temporary bundles stay outside the deliverable source tree.
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { runResearchIntakeBrowser } from "./research-intake-browser-scenario.mjs";
import {
  task,
  decisionTask,
} from "../components/research/ResearchWorkspace.fixture.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const resolveWith = (name, hints = []) =>
  require.resolve(name, { paths: [root, ...hints] });
const tailwindEntry = resolveWith("@tailwindcss/postcss");
const postcss = require(resolveWith("postcss", [path.dirname(tailwindEntry)]));
const tailwind = require(tailwindEntry);
const { build } = require(
  resolveWith("esbuild", [path.dirname(resolveWith("tsx"))]),
);
const { chromium } = require(
  resolveWith(
    "playwright",
    [process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES].filter(Boolean),
  ),
);
const out =
  process.env.RESEARCH_QA_OUTPUT ??
  path.resolve(root, "../../review-v3-audit/ui-browser-qa");
const cjkFont =
  process.env.RESEARCH_QA_CJK_FONT ??
  path.resolve(root, "../validation/fonts/NotoSansCJKsc-Regular.otf");
await fs.mkdir(out, { recursive: true });
const baseline = await fs.readFile(
  path.join(root, "validation/baseline-ResearchWorkspace.tsx.txt"),
  "utf8",
);
const workspacePath = path.join(
  root,
  "components/research/ResearchWorkspace.tsx",
);
const shell = (name) =>
  `<!doctype html><html lang="zh-CN" class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Research workspace offline QA</title><link rel="stylesheet" href="/app.css"><style>@font-face{font-family:GeistQA;src:url('/geist.woff2') format('woff2');font-weight:100 900;font-display:swap}@font-face{font-family:NotoCJKQA;src:url('/cjk.otf') format('opentype');font-display:swap}:root{--font-geist-sans:GeistQA,NotoCJKQA;--font-geist-mono:ui-monospace,NotoCJKQA}html,body,#qa-root{height:100%;margin:0}</style></head><body><div id="qa-root"></div><script type="module" src="/${name}.js"></script></body></html>`;
for (const name of ["current", "before"]) {
  await build({
    stdin: {
      contents: `import { createRoot } from "react-dom/client"; import { ResearchWorkspace } from ${JSON.stringify(name === "before" ? "qa-baseline-workspace" : workspacePath)}; createRoot(document.getElementById("qa-root")).render(<ResearchWorkspace />);`,
      resolveDir: root,
      sourcefile: "qa-entry.tsx",
      loader: "tsx",
    },
    outfile: path.join(out, `${name}.js`),
    bundle: true,
    platform: "browser",
    format: "esm",
    jsx: "automatic",
    tsconfig: path.join(root, "tsconfig.json"),
    minify: true,
    define: { "process.env.NODE_ENV": '"production"' },
    banner: {
      js: 'globalThis.process ??= { env: { NODE_ENV: "production" } };',
    },
    plugins: [
      {
        name: "recorded-baseline",
        setup(builder) {
          builder.onResolve({ filter: /^qa-baseline-workspace$/ }, () => ({
            path: "baseline",
            namespace: "recorded",
          }));
          builder.onLoad({ filter: /.*/, namespace: "recorded" }, () => ({
            contents: baseline,
            loader: "tsx",
            resolveDir: path.dirname(workspacePath),
          }));
        },
      },
    ],
    logLevel: "silent",
  });
  await fs.writeFile(path.join(out, `${name}.html`), shell(name));
}
const css = await postcss([tailwind({ base: root, optimize: true })]).process(
  await fs.readFile(path.join(root, "app/globals.css"), "utf8"),
  { from: path.join(root, "app/globals.css"), to: path.join(out, "app.css") },
);
await fs.writeFile(path.join(out, "app.css"), css.css);
await fs.copyFile(
  path.join(
    root,
    "node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2",
  ),
  path.join(out, "geist.woff2"),
);
await fs.copyFile(cjkFont, path.join(out, "cjk.otf"));
const result = {
  status: "prepared",
  scope:
    "Actual ResearchWorkspace component with actual application CSS and shared offline component-test fixtures. Browser HTTP API responses and EventSource are mocked; no account, database, model, search or external website is used.",
  baseline: "82afe417",
  baselineComponentSha256: createHash("sha256").update(baseline).digest("hex"),
  componentSha256: createHash("sha256")
    .update(await fs.readFile(workspacePath))
    .digest("hex"),
  intakeComponentSha256: createHash("sha256")
    .update(
      await fs.readFile(
        path.join(root, "components/research/ResearchIntake.tsx"),
      ),
    )
    .digest("hex"),
  intakeFixtureSha256: createHash("sha256")
    .update(
      await fs.readFile(
        path.join(root, "components/research/ResearchIntake.fixture.ts"),
      ),
    )
    .digest("hex"),
  fixtureSha256: createHash("sha256")
    .update(
      await fs.readFile(
        path.join(root, "components/research/ResearchWorkspace.fixture.ts"),
      ),
    )
    .digest("hex"),
  cjkFont:
    "Local Noto Sans CJK SC fallback supplied by the QA harness; no web font network request.",
  outputDirectory: out,
  viewports: [],
  limitations: [
    "Workspace component mounting is not a full Next.js authenticated app or SSR acceptance.",
    "Offline cards are explicit fixture examples, not live model research results.",
    "Baseline bundle uses the recorded component and current unchanged shared primitives/CSS; this is a controlled component comparison.",
    "Screenshots are local QA records and are not part of the user deliverable.",
  ],
};
const resultPath = path.join(
  root,
  "validation/research-ui-browser-result.json",
);
if (process.argv.includes("--prepare-only")) {
  await fs.writeFile(resultPath, JSON.stringify(result, null, 2) + "\n");
  process.stdout.write(
    `Prepared real-component assets at ${out}; no browser assertions executed.\n`,
  );
  process.exit(0);
}
const chrome = process.env.RESEARCH_QA_CHROME;
assert.ok(
  chrome,
  "Set RESEARCH_QA_CHROME to the available local browser binary; preparation is not browser acceptance.",
);
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const known = {
      "/current.js": ["current.js", "text/javascript"],
      "/before.js": ["before.js", "text/javascript"],
      "/app.css": ["app.css", "text/css"],
      "/geist.woff2": ["geist.woff2", "font/woff2"],
      "/cjk.otf": ["cjk.otf", "font/otf"],
    };
    const entry = known[url.pathname];
    if (entry) {
      res.writeHead(200, { "Content-Type": entry[1] });
      res.end(await fs.readFile(path.join(out, entry[0])));
      return;
    }
    if (url.pathname === "/app/research") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        shell(
          url.searchParams.get("renderer") === "before" ? "before" : "current",
        ),
      );
      return;
    }
    res.writeHead(404);
    res.end("No fixture route");
  } catch {
    res.writeHead(500);
    res.end("Local QA fixture error");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
const origin = `http://127.0.0.1:${address.port}`;
let browser;
try {
  browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  result.browserVersion = browser.version();
  for (const width of [1440, 768, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      reducedMotion: "reduce",
    });
    const errors = [];
    const unexpected = [];
    let snapshot = decisionTask();
    await context.addInitScript(() => {
      // This layout/navigation QA is not an SSE transport test.
      window.EventSource = class {
        onmessage = null;
        onerror = null;
        onopen = null;
        constructor() {
          queueMicrotask(() => this.onopen?.());
        }
        close() {}
        addEventListener() {}
        removeEventListener() {}
      };
    });
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) {
        unexpected.push(url.origin);
        await route.abort();
        return;
      }
      if (!url.pathname.startsWith("/api/")) {
        await route.continue();
        return;
      }
      let data;
      if (url.pathname === "/api/research/projects") data = [];
      else if (url.pathname === "/api/admin/research")
        data = {
          ready: true,
          workerReady: true,
          modelReady: true,
          services: [],
        };
      else if (url.pathname === "/api/conversations/chat")
        data = { models: [] };
      else if (url.pathname === "/api/research/tasks/task-1") data = snapshot;
      else {
        unexpected.push(url.pathname);
        await route.abort();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data }),
      });
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}/app/research?task=task-1`);
    await page.getByRole("region", { name: "设计决策", exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    const measure = async () =>
      page.evaluate(() => {
        const main = document.querySelector("main");
        const regions = [
          ...document.querySelectorAll(
            'section[aria-label="设计决策"], section[aria-label="待解关键问题"], article',
          ),
        ].map((element) => {
          const box = element.getBoundingClientRect();
          return {
            label: element.getAttribute("aria-label") ?? element.tagName,
            left: box.left,
            right: box.right,
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
          };
        });
        return {
          windowWidth: innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          mainClientWidth: main?.clientWidth,
          mainScrollWidth: main?.scrollWidth,
          regions,
        };
      });
    const initial = await measure();
    assert.ok(
      initial.documentWidth <= width + 1,
      `Document overflow at ${width}`,
    );
    assert.ok(
      initial.mainScrollWidth <= initial.mainClientWidth + 1,
      `Main overflow at ${width}`,
    );
    assert.ok(
      initial.regions.every(
        (box) =>
          box.right <= width + 1 &&
          box.left >= -1 &&
          box.scrollWidth <= box.clientWidth + 1,
      ),
      `Decision region overflow at ${width}`,
    );
    assert.equal(
      await page
        .locator('details[aria-label="运行与版本信息"]')
        .getAttribute("open"),
      null,
    );
    assert.ok(
      (
        await page.getByRole("region", { name: "待解关键问题" }).textContent()
      ).includes("证据不足 · 已读材料"),
    );
    await page.screenshot({
      path: path.join(out, `current-${width}.png`),
      fullPage: true,
    });
    await page
      .getByRole("region", { name: "设计决策", exact: true })
      .getByRole("button", { name: "来源 1 · 单个受邀众测样例" })
      .click();
    const source = page.getByRole("article", {
      name: "来源 1：单个受邀众测样例",
      exact: true,
    });
    await source.waitFor();
    await page.waitForFunction(
      () => document.activeElement?.id === "evidence-source-1",
    );
    assert.equal(
      await source
        .getByRole("link", { name: "查看留档原文" })
        .getAttribute("href"),
      "/api/research/evidence/source-1/file",
    );
    assert.equal(
      await source.getByRole("link", { name: "原始来源" }).getAttribute("href"),
      "https://example.com/product",
    );
    const evidenceLayout = await measure();
    assert.ok(
      evidenceLayout.mainScrollWidth <= evidenceLayout.mainClientWidth + 1,
      `Evidence overflow at ${width}`,
    );
    await page.screenshot({
      path: path.join(out, `source-${width}.png`),
      fullPage: true,
    });
    await page.getByRole("tab", { name: "报告", exact: true }).click();
    await page
      .getByRole("region", { name: "研究报告全文" })
      .getByRole("link", { name: "来源 1", exact: true })
      .click();
    await page.waitForFunction(
      () => document.activeElement?.id === "evidence-source-1",
    );
    // Render the original component against the identical new fixture for a
    // controlled visual reference. It correctly has no decision-card feature.
    await page.goto(`${origin}/app/research?task=task-1&renderer=before`);
    await page.getByRole("heading", { name: "原始报告全文" }).waitFor();
    assert.equal(
      await page.getByRole("region", { name: "设计决策", exact: true }).count(),
      0,
    );
    await page.screenshot({
      path: path.join(out, `before-${width}.png`),
      fullPage: true,
    });
    // Legacy packet on the new component must still show its original report.
    snapshot = task();
    await page.goto(`${origin}/app/research?task=task-1`);
    await page.getByText("待补证的研究草稿。", { exact: true }).waitFor();
    assert.equal(
      await page.getByRole("region", { name: "设计决策", exact: true }).count(),
      0,
    );
    assert.equal(
      await page.getByRole("tab", { name: "文件 1", exact: true }).count(),
      1,
    );
    assert.deepEqual(errors, [], `Browser page errors at ${width}`);
    assert.deepEqual(unexpected, [], `Unexpected network at ${width}`);
    result.viewports.push({
      width,
      height: 1000,
      initial,
      evidenceLayout,
      cardSourceNavigation: "passed",
      reportSourceNavigation: "passed",
      legacyFallback: "passed",
      baselineRendered: true,
      pageErrors: errors,
      externalRequests: unexpected,
    });
    await context.close();
  }
  result.intake = await runResearchIntakeBrowser({ browser, origin, out });
  result.status = "passed";
} catch (error) {
  result.status = "failed";
  result.error = String(error?.stack ?? error);
  throw error;
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  await fs.writeFile(resultPath, JSON.stringify(result, null, 2) + "\n");
}
process.stdout.write(
  JSON.stringify(
    {
      status: result.status,
      browser: result.browserVersion,
      viewports: result.viewports.map((row) => row.width),
      intakeViewports: result.intake?.viewports.map((row) => row.width),
      resultPath,
    },
    null,
    2,
  ) + "\n",
);
