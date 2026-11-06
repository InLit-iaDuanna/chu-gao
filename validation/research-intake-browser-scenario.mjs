// Called by the existing real-component/CSS browser harness. No handwritten UI.
import assert from "node:assert/strict";
import path from "node:path";
import {
  emptyIntakeView,
  intakeView,
} from "../components/research/ResearchIntake.fixture.ts";
import { task } from "../components/research/ResearchWorkspace.fixture.ts";

export async function runResearchIntakeBrowser({ browser, origin, out }) {
  const results = [];
  for (const width of [1440, 768, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      reducedMotion: "reduce",
    });
    const projectId = `offline-intake-${width}`;
    const finalTaskId = `offline-research-${width}`;
    let created = false;
    let snapshot = emptyIntakeView();
    let beforeTurn = emptyIntakeView();
    let latestSubmission;
    let finalTask;
    const submissions = [];
    const starts = [];
    const uploads = [];
    const errors = [];
    const unexpected = [];
    const plan = {
      preset: "research",
      reason: "离线 API 合同样例，未执行实际研究。",
      stages: [
        { kind: "research", engine: "gptr" },
        { kind: "verify", engine: "chugao" },
        { kind: "synthesize", engine: "chugao" },
      ],
      limits: { llm: 30, search: 20, crawl: 30, minutes: 25 },
      products: ["report", "competitors", "brief"],
    };
    await context.addInitScript(() => {
      window.__researchIntakeSources = [];
      window.EventSource = class {
        onmessage = null;
        onerror = null;
        onopen = null;
        closed = false;
        listeners = new Map();
        constructor(url) {
          this.url = url;
          window.__researchIntakeSources.push(this);
          queueMicrotask(() => this.onopen?.());
        }
        close() {
          this.closed = true;
        }
        addEventListener(name, listener) {
          this.listeners.set(name, listener);
        }
        removeEventListener(name) {
          this.listeners.delete(name);
        }
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
      const method = route.request().method();
      const json = () => route.request().postDataJSON();
      let data;
      if (url.pathname === "/api/admin/research")
        data = {
          ready: true,
          workerReady: true,
          modelReady: true,
          services: [],
        };
      else if (url.pathname === "/api/conversations/chat")
        data = {
          models: [
            {
              id: "gpt-6.1-sol",
              displayName: "离线模型配置样例",
              reasoningEfforts: ["high"],
              defaultReasoningEffort: "high",
              credits: 0.2,
              supportsVision: false,
              maxReferenceImages: 0,
            },
          ],
        };
      else if (url.pathname === "/api/research/projects" && method === "POST") {
        created = true;
        data = { id: projectId };
      } else if (url.pathname === "/api/research/projects")
        data = created
          ? [
              {
                id: projectId,
                title: "便携饮料包装研究（离线合同样例）",
                conversationId: null,
                updatedAt: "2026-10-19T00:00:00Z",
                tasks: finalTask
                  ? [
                      {
                        id: finalTaskId,
                        status: "completed",
                        preset: "research",
                        createdAt: finalTask.createdAt,
                      },
                    ]
                  : [],
              },
            ]
          : [];
      else if (url.pathname === "/api/research/uploads" && method === "POST") {
        assert.match(
          route.request().headers()["content-type"],
          /multipart\/form-data/,
        );
        uploads.push({ method, path: url.pathname, localFixtureOnly: true });
        data = { key: "offline-reference.md", filename: "reference.md" };
      } else if (url.pathname === "/api/research/intake" && method === "GET") {
        assert.equal(url.searchParams.get("projectId"), projectId);
        data = snapshot;
      } else if (url.pathname === "/api/research/intake" && method === "POST") {
        const body = json();
        assert.equal(body.projectId, projectId);
        assert.equal(body.previousTaskId, snapshot.task?.id ?? null);
        assert.deepEqual(body.brief.attachmentKeys, ["offline-reference.md"]);
        assert.ok(
          typeof body.clientRequestId === "string" &&
            body.clientRequestId.length === 36,
        );
        submissions.push(body);
        beforeTurn = snapshot;
        latestSubmission = body;
        snapshot = intakeView({
          id: `offline-turn-${width}-${submissions.length}`,
          clientRequestId: body.clientRequestId,
          projectId,
          status: "queued",
          answer: body.answer,
          previous: beforeTurn,
        });
        snapshot.task.brief = { ...body.brief };
        snapshot.result = null;
        snapshot.resultTaskId = null;
        data = { taskId: snapshot.task.id, projectId };
      } else if (url.pathname === "/api/research/plan" && method === "POST") {
        const body = json();
        data = { ...plan, products: body.products };
      } else if (url.pathname === "/api/research/tasks" && method === "POST") {
        const body = json();
        assert.equal(body.intakeTaskId, snapshot.resultTaskId);
        assert.equal(snapshot.result?.ready, true);
        assert.equal(body.brief.market, "日本");
        assert.deepEqual(body.brief.attachmentKeys, ["offline-reference.md"]);
        starts.push(body);
        finalTask = {
          ...task(),
          id: finalTaskId,
          projectId,
          brief: body.brief,
          evidence: [],
          artifacts: [],
        };
        finalTask.stages = [
          {
            ...finalTask.stages[0],
            text: "离线合同验收终点：本轮没有执行实际研究。",
          },
        ];
        data = finalTask;
      } else if (url.pathname === `/api/research/tasks/${finalTaskId}`)
        data = finalTask;
      else {
        unexpected.push(`${method} ${url.pathname}`);
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
    const checkLayout = async (phase) => {
      await page.evaluate(() => document.fonts.ready);
      const measurement = await page.evaluate(() => {
        const main = document.querySelector("main");
        const intake = document.querySelector(
          'section[aria-label="研究需求对话"]',
        );
        const box = intake?.getBoundingClientRect();
        return {
          documentWidth: document.documentElement.scrollWidth,
          mainClient: main?.clientWidth,
          mainScroll: main?.scrollWidth,
          intakeClient: intake?.clientWidth,
          intakeScroll: intake?.scrollWidth,
          left: box?.left,
          right: box?.right,
        };
      });
      assert.ok(
        measurement.documentWidth <= width + 1,
        `${phase}: document overflow ${width}`,
      );
      assert.ok(
        measurement.mainScroll <= measurement.mainClient + 1,
        `${phase}: main overflow ${width}`,
      );
      if (measurement.intakeClient) {
        assert.ok(
          measurement.intakeScroll <= measurement.intakeClient + 1,
          `${phase}: intake overflow ${width}`,
        );
        assert.ok(
          measurement.left >= -1 && measurement.right <= width + 1,
          `${phase}: intake out of viewport ${width}`,
        );
      }
      return measurement;
    };
    const complete = async ({
      reply,
      ready = false,
      summary,
      market = "",
      unknowns = [],
    }) => {
      const currentId = snapshot.task.id;
      snapshot = intakeView({
        id: currentId,
        clientRequestId: latestSubmission.clientRequestId,
        projectId,
        answer: latestSubmission.answer,
        previous: beforeTurn,
        reply,
        ready,
        summary,
        market,
        unknowns,
      });
      snapshot.result.brief.question =
        "研究便携饮料包装的单手拿取与盖紧设计机会";
      snapshot.task.brief = {
        ...latestSubmission.brief,
        ...snapshot.result.brief,
      };
      await page.evaluate((id) => {
        const source = window.__researchIntakeSources.findLast(
          (candidate) =>
            candidate.url.includes(`/tasks/${id}/events`) && !candidate.closed,
        );
        if (!source)
          throw new Error(`No actual component subscription for ${id}`);
        source.onmessage?.({
          data: JSON.stringify({ type: "task.completed" }),
        });
      }, currentId);
    };
    await page.goto(`${origin}/app/research`);
    const dialogue = page.getByRole("region", {
      name: "研究需求对话",
      exact: true,
    });
    await dialogue.getByRole("textbox").waitFor();
    assert.equal(await dialogue.getByRole("textbox").count(), 1);
    assert.equal(await dialogue.getByRole("combobox").count(), 0);
    assert.equal(await dialogue.getByRole("checkbox").count(), 0);
    const advanced = page
      .locator("details > summary")
      .filter({ hasText: "高级设置（可选）" })
      .locator("..");
    assert.equal(await advanced.getAttribute("open"), null);
    const unfocusedShadow = await dialogue
      .getByRole("textbox")
      .evaluate((element) => getComputedStyle(element.parentElement).boxShadow);
    await dialogue.getByRole("textbox").focus();
    // Global CSS transitions apply to this container: wait for the actual
    // focused ring, rather than accepting the ordinary unfocused shadow.
    await page.waitForFunction((before) => {
      const element = document.querySelector(
        'textarea[aria-label="告诉研究助手你的想法"]',
      );
      if (!element || document.activeElement !== element) return false;
      const outer = getComputedStyle(element.parentElement);
      return (
        outer.boxShadow !== before &&
        /2px/.test(outer.getPropertyValue("--tw-ring-shadow")) &&
        /0px 0px 0px 2px/.test(outer.boxShadow)
      );
    }, unfocusedShadow);
    const inputFocus = await dialogue
      .getByRole("textbox")
      .evaluate((element) => {
        const inner = getComputedStyle(element);
        const outer = getComputedStyle(element.parentElement);
        return {
          innerOutline: inner.outlineStyle,
          outerShadow: outer.boxShadow,
          outerRing: outer.getPropertyValue("--tw-ring-shadow"),
          focused: document.activeElement === element,
        };
      });
    assert.equal(inputFocus.focused, true);
    assert.notEqual(
      inputFocus.outerShadow,
      unfocusedShadow,
      "Input container must retain a visible focus treatment",
    );
    assert.match(inputFocus.outerRing, /2px/);
    assert.match(inputFocus.outerShadow, /0px 0px 0px 2px/);
    const initialLayout = await checkLayout("initial");
    await page.screenshot({
      path: path.join(out, `intake-empty-${width}.png`),
      fullPage: true,
    });

    const picker = page.waitForEvent("filechooser");
    await dialogue
      .getByRole("button", { name: "添加参考资料（可选）" })
      .click();
    await (
      await picker
    ).setFiles({
      name: "reference.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(
        "Offline UI contract reference; no factual market evidence.\n",
      ),
    });
    await page.getByText("reference.md", { exact: true }).waitFor();
    const goal = "我想给一款便携饮料做包装，想知道单手拿取和盖紧的设计机会。";
    await dialogue.getByRole("textbox").fill(goal);
    await dialogue.getByRole("button", { name: "发送回答" }).click();
    await page.getByText("需求对话排队中…", { exact: true }).waitFor();
    assert.equal(submissions.length, 1);
    assert.equal(submissions[0].answer, goal);
    const question = "我会围绕单手操作寻找设计机会。你想优先研究哪种使用情境？";
    await complete({
      reply: question,
      summary: "比较便携饮料包装的单手操作。",
    });
    await page.getByText(question, { exact: true }).waitFor();
    assert.equal(await dialogue.locator('[data-role="assistant"]').count(), 1);
    await page.screenshot({
      path: path.join(out, `intake-question-${width}.png`),
      fullPage: true,
    });
    // Reload uses persisted GET history, without another intake POST.
    await page.reload();
    await page.getByText(question, { exact: true }).waitFor();
    assert.equal(submissions.length, 1);
    assert.equal(await dialogue.getByRole("textbox").inputValue(), "");
    const answer = "主要是通勤，还不确定具体人群，先研究。";
    await dialogue.getByRole("textbox").fill(answer);
    await dialogue.getByRole("button", { name: "发送回答" }).click();
    await page.getByText("需求对话排队中…", { exact: true }).waitFor();
    assert.equal(submissions[1].answer, answer);
    const summary =
      "围绕通勤时的单手拿取与盖紧，比较便携饮料包装的结构与使用过程。";
    await complete({
      ready: true,
      reply: summary,
      summary,
      unknowns: ["具体人群还不确定，作为研究中待澄清的问题。"],
    });
    await page.getByRole("region", { name: "已理解的研究需求" }).waitFor();
    await page.getByRole("button", { name: "开始研究", exact: true }).waitFor();
    await page.waitForFunction(() =>
      [...document.querySelectorAll("button")].some(
        (button) =>
          button.textContent.trim() === "开始研究" && !button.disabled,
      ),
    );
    assert.equal(await page.getByText(summary, { exact: true }).count(), 1);
    assert.equal(
      await page.locator('details[aria-label="研究计划"]').getAttribute("open"),
      null,
    );
    const summaryLayout = await checkLayout("summary");
    await page.screenshot({
      path: path.join(out, `intake-ready-${width}.png`),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "开始研究", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(out, `intake-start-${width}.png`),
      fullPage: true,
    });

    const correction = "市场改成日本，仍然研究通勤单手操作。";
    await dialogue.getByRole("textbox").fill(correction);
    await page.waitForFunction(
      () =>
        ![...document.querySelectorAll("button")].some(
          (button) =>
            button.textContent.trim() === "开始研究" && !button.disabled,
        ),
    );
    assert.equal(starts.length, 0);
    await dialogue.getByRole("button", { name: "发送回答" }).click();
    await page.getByText("需求对话排队中…", { exact: true }).waitFor();
    const revised =
      "比较日本市场便携饮料包装在通勤时的单手拿取与盖紧过程，寻找可验证的结构设计机会。";
    await complete({
      ready: true,
      reply: revised,
      summary: revised,
      market: "日本",
      unknowns: ["具体人群和使用频次仍待研究。"],
    });
    await page.waitForFunction(() =>
      [...document.querySelectorAll("button")].some(
        (button) =>
          button.textContent.trim() === "开始研究" && !button.disabled,
      ),
    );
    assert.equal(submissions.length, 3);
    assert.equal(submissions[2].answer, correction);
    assert.equal(submissions[2].previousTaskId, `offline-turn-${width}-2`);
    const revisedLayout = await checkLayout("revised");
    await page.screenshot({
      path: path.join(out, `intake-revised-${width}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: "开始研究", exact: true }).click();
    await page
      .getByText("离线合同验收终点：本轮没有执行实际研究。", { exact: true })
      .waitFor();
    assert.equal(starts.length, 1);
    assert.equal(uploads.length, 1);
    assert.deepEqual(errors, []);
    assert.deepEqual(unexpected, []);
    results.push({
      width,
      height: 1000,
      initialLayout,
      inputFocus,
      summaryLayout,
      revisedLayout,
      naturalLanguageTurns: submissions.length,
      optionalUploads: uploads.length,
      formalStarts: starts.length,
      latestIntakeTaskId: starts[0].intakeTaskId,
      reloadUsedOnlyGet: true,
      readyRevokedBeforeCorrectionPost: true,
      originalAndRevisedSummaryShownOnce: true,
      advancedAndPlanDefaultClosed: true,
      pageErrors: errors,
      unexpectedRequests: unexpected,
    });
    await context.close();
  }
  return {
    status: "passed",
    scope:
      "Actual ResearchWorkspace/ResearchIntake and application CSS; local API fixtures only. Upload input, POST answer contract, GET reload, SSE terminal notification, natural-language uncertainty/correction, current-task approval, and formal-start payload exercised. No login, real LLM, paid request or research execution.",
    viewports: results,
  };
}
