import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { db } from "../lib/db";
import {
  createResearchProject,
  createResearchTask,
  retryResearchStage,
  researchTaskView,
} from "../lib/research/service";
import { claimResearchTask, executeResearchTask } from "../lib/research/worker";
import {
  researchPlanInputSchema,
  type ResearchPlan,
} from "../lib/research/types";
import { researchJson } from "../lib/research/errors";
import { getResearchConfig } from "../lib/research/config";
import { storeResearchAttachment } from "../lib/research/attachments";
import { readResearchFile } from "../lib/research/storage";
import { validateResearchArtifact } from "../lib/research/artifacts";

const arg = (name: string) => process.argv[process.argv.indexOf(name) + 1];
const mode = arg("--mode");
const auditOnly = process.argv.includes("--audit-only");
const mediumGrant = process.argv.includes("--authorized-100-medium");
const originalGrant = process.argv.includes("--authorized-v2-original-30");
const v2Grant = originalGrant || process.argv.includes("--authorized-v2-20");
const statePath = originalGrant
  ? ".data/research/acceptance-v2-original.json"
  : v2Grant
    ? ".data/research/acceptance-v2.json"
    : mediumGrant
      ? ".data/research/acceptance-medium.json"
      : ".data/research/acceptance.json";
type State = {
  authorized: number;
  tasks: Record<string, string>;
  checks: Record<string, unknown>;
  baselineCalls?: number;
};

async function main() {
  if (
    (!process.argv.includes("--authorized-20") && !mediumGrant && !v2Grant) ||
    !["explore", "full", "native"].includes(mode)
  )
    throw Error(
      "Use --authorized-100-medium --mode explore|full|native --user-id <local-admin>.",
    );
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(
      new URL(process.env.DATABASE_URL!).hostname,
    )
  )
    throw Error("Local synthetic acceptance only.");
  const userId = arg("--user-id");
  if (!(await db.user.findFirst({ where: { id: userId, role: "ADMIN" } })))
    throw Error("Choose an existing local administrator.");
  let state: State = {
    authorized: originalGrant ? 30 : mediumGrant ? 100 : 20,
    tasks: {},
    checks: {},
  };
  try {
    state = JSON.parse(await readFile(statePath, "utf8"));
  } catch {
    /* First run. */
    if (mediumGrant) {
      const previous: State = JSON.parse(
        await readFile(".data/research/acceptance.json", "utf8"),
      );
      state.tasks = { ...previous.tasks };
      const intake = await db.researchTask.findFirst({
        where: { userId, preset: "intake" },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      if (intake) state.tasks.intake = intake.id;
      state.baselineCalls =
        (
          await db.researchTask.aggregate({
            where: { id: { in: Object.values(state.tasks) } },
            _sum: { llmCalls: true },
          })
        )._sum.llmCalls ?? 0;
      state.checks.effort = "medium";
    }
  }
  const persist = async () => {
    await mkdir(".data/research", { recursive: true });
    await writeFile(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
  };
  const countCalls = async () =>
    (
      await db.researchTask.aggregate({
        where: {
          project: {
            tasks: { some: { id: { in: Object.values(state.tasks) } } },
          },
        },
        _sum: { llmCalls: true },
      })
    )._sum.llmCalls ?? 0;
  if (mode === "full")
    state.checks.productionUrl ??= (await getResearchConfig()).deerflowUrl;
  const beforeCredits = (
    await db.user.findUniqueOrThrow({ where: { id: userId } })
  ).credits;
  let taskId = state.tasks[mode];
  if (!taskId) {
    if (auditOnly) throw Error("No stored acceptance task to audit.");
    const used = await countCalls();
    const remaining = state.authorized - used + (state.baselineCalls ?? 0);
    if (remaining < 3)
      throw Error(`Only ${remaining} authorized calls remain.`);
    const source =
      mode === "native"
        ? await researchTaskView(userId, state.tasks.full)
        : null;
    const project = source
      ? { id: source.projectId }
      : await createResearchProject(
          userId,
          `内测样例：${mode === "explore" ? "资料探索" : "研究与提案"}`,
        );
    let input = researchPlanInputSchema.parse({
      preset: mode === "explore" ? "explore" : "research",
      scope: "standard",
      modelId: "gpt-6.1-sol",
      reasoningEffort: mediumGrant || v2Grant ? "medium" : "low",
      collectVisuals: true,
      verify: mode === "full",
      products:
        mode === "full"
          ? ["report", "competitors", "board", "brief", "pptx", "docx", "html"]
          : ["report", "competitors", "board", "brief"],
      brief: {
        question:
          "为设计师制作‘示例域名与网页原型’的微型资料研究。比较 example.com、example.org 的公开用途和页面信息。研究报告不超过600字，不推断市场份额或实际用户行为。若需要制作文件，只做2页可编辑PPTX、1页DOCX和一个自包含HTML原型。",
        market: "合成内测样例，非商业市场研究",
        audience: "网页原型设计师",
        constraints:
          "保留证据ID。只使用公开样例网页，不包含任何用户历史、账户或私人文件。不编造价格和调研数据。报告简短；文件内文字必须可编辑。",
        competitors: ["example.com", "example.org"],
        links: ["https://example.com", "https://example.org"],
      },
    });
    if (originalGrant && mode === "full") {
      const original = await db.researchTask.findFirstOrThrow({
        where: { id: "cmvdzgia800c93yyzsuyfbr75", userId },
        include: { brief: true },
      });
      input.brief = researchPlanInputSchema.parse({
        brief: original.brief.content,
      }).brief;
      state.checks.originalTaskId = original.id;
      state.checks.originalBriefId = original.briefId;
    } else if (v2Grant && mode === "full") {
      input.brief = researchPlanInputSchema.parse({
        brief: {
          question:
            "为设计工作台比较 Crawl4AI 与 Playwright 的网页采集、截图和本地资料留档能力。基于官方公开文档给出两条可选路径、取舍及待验证项，报告不超过800字，不推断市场数据。提案仅做3至5页简短可编辑PPT、文档与静态网页。",
          market: "自建网页资料采集工具选型，不是市场规模研究",
          audience: "设计研究工作台开发者",
          competitors: ["Crawl4AI", "Playwright"],
          constraints:
            "只使用已实际取得的官方资料和提供的合成需求。原文未取得就说明不足。不要编造性能数据、价格、视觉理解或真实用户研究。未经视觉读取的参考图必须保留未分析状态。",
          links: [
            "https://github.com/unclecode/crawl4ai",
            "https://playwright.dev/python/docs/screenshots",
          ],
        },
      }).brief;
      const document = await storeResearchAttachment(userId, project.id, {
        filename: "synthetic-design-requirements.txt",
        mimeType: "text/plain",
        buffer: Buffer.from(
          "合成验收资料：设计工作台需要保存网页正文、截图和来源时间，并支持失败后继续处理。仅用于测试文件提取与资料身份，不是实际访谈或市场事实。",
        ),
      });
      const image = await storeResearchAttachment(userId, project.id, {
        filename: "synthetic-reference.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=",
          "base64",
        ),
      });
      input.brief.attachmentKeys = [
        `attachment:${document.id}`,
        `attachment:${image.id}`,
      ];
    }
    if (source)
      input = researchPlanInputSchema.parse({
        brief: source.brief,
        sourceTaskId: source.id,
        preset: "proposal",
        scope: "standard",
        modelId: "gpt-6.1-sol",
        reasoningEffort: "medium",
        products: ["pptx", "docx", "html"],
      });
    const task = await createResearchTask(userId, {
      ...input,
      projectId: project.id,
      clientRequestId: randomUUID(),
    });
    taskId = task.id;
    const stored = await db.researchTask.findUniqueOrThrow({
      where: { id: taskId },
    });
    const plan = stored.plan as unknown as ResearchPlan;
    plan.limits.llm = Math.min(
      mode === "native" ? 6 : mode === "explore" ? 12 : remaining,
      remaining,
    );
    plan.limits.search = mode === "full" ? 12 : 6;
    plan.limits.crawl =
      mode === "full" ? 15 : mediumGrant ? stored.crawlCalls + 6 : 5;
    if (v2Grant) {
      plan.limits.search = originalGrant ? 12 : 6;
      plan.limits.crawl = originalGrant ? 15 : 8;
      plan.limits.minutes = originalGrant ? 25 : 15;
    }
    if (mediumGrant && mode === "explore")
      plan.limits.search = stored.searchCalls + 6;
    if (mode === "full") {
      const snapshot = stored.configSnapshot as Record<string, unknown>;
      state.checks.productionUrl = snapshot.deerflowUrl;
      snapshot.deerflowUrl = "http://127.0.0.1:19999";
      await db.researchTask.update({
        where: { id: taskId },
        data: {
          plan: researchJson(plan),
          configSnapshot: researchJson(snapshot),
        },
      });
    } else
      await db.researchTask.update({
        where: { id: taskId },
        data: { plan: researchJson(plan) },
      });
    state.tasks[mode] = taskId;
    await persist();
  }
  console.log(
    JSON.stringify({
      mode,
      taskId,
      url: `http://127.0.0.1:3000/app/research?task=${taskId}`,
    }),
  );
  const run = async () => {
    const claim = await claimResearchTask();
    if (!claim || claim.id !== taskId)
      throw Error(
        "Stop the detached research worker before this bounded acceptance run.",
      );
    const ticker = setInterval(() => {
      void db.researchTask
        .findUnique({
          where: { id: taskId },
          select: {
            status: true,
            llmCalls: true,
            searchCalls: true,
            crawlCalls: true,
          },
        })
        .then((row) => console.log(JSON.stringify(row)));
    }, 15000);
    try {
      await executeResearchTask(claim, new AbortController());
    } finally {
      clearInterval(ticker);
    }
  };
  let view = await researchTaskView(userId, taskId);
  if (
    !auditOnly &&
    process.argv.includes("--retry") &&
    ["failed", "cancelled", "interrupted", "budget_exhausted"].includes(
      view.status,
    )
  ) {
    if (v2Grant) {
      const previous = Array.isArray(state.checks.previousFailures)
        ? state.checks.previousFailures
        : [];
      state.checks.previousFailures = [
        ...previous,
        {
          status: view.status,
          llmCalls: view.llmCalls,
          error: view.error,
          recordedAt: new Date().toISOString(),
        },
      ];
      await persist();
    }
    const first = view.stages.find((stage) => stage.status !== "completed");
    if (!first) throw Error("No unfinished stage to retry.");
    const used = await countCalls();
    const stored = await db.researchTask.findUniqueOrThrow({
      where: { id: taskId },
    });
    const plan = stored.plan as unknown as ResearchPlan;
    const remaining = state.authorized - used + (state.baselineCalls ?? 0);
    if (remaining < 1) throw Error("No authorized calls remain.");
    plan.limits.llm = Math.min(
      view.llmCalls + remaining,
      view.llmCalls + (mediumGrant ? 12 : mode === "explore" ? 10 : 20),
    );
    plan.limits.crawl =
      mode === "full" ? 15 : mediumGrant ? stored.crawlCalls + 8 : 5;
    if (v2Grant) {
      plan.limits.search = originalGrant ? 12 : 6;
      plan.limits.crawl = originalGrant ? 15 : 8;
    }
    if (mediumGrant && mode === "explore")
      plan.limits.search = stored.searchCalls + 12;
    await db.researchTask.update({
      where: { id: taskId },
      data: {
        plan: researchJson(plan),
        ...(mode === "full"
          ? {
              configSnapshot: researchJson({
                ...(stored.configSnapshot as object),
                deerflowUrl: state.checks.productionUrl,
              }),
            }
          : {}),
        ...(mediumGrant
          ? {
              reasoningEffort: "medium",
              deadlineAt: new Date(Date.now() + 25 * 60000),
            }
          : {}),
      },
    });
    await retryResearchStage(userId, taskId, first.id, randomUUID(), {
      renewTime: v2Grant,
    });
    view = await researchTaskView(userId, taskId);
  }
  if (!auditOnly && view.status === "queued") await run();
  view = await researchTaskView(userId, taskId);
  if (
    !auditOnly &&
    mode === "full" &&
    view.status === "failed" &&
    (await countCalls()) - (state.baselineCalls ?? 0) < state.authorized &&
    view.stages.find((stage) => stage.kind === "produce")?.status === "failed"
  ) {
    const completed = view.stages
      .filter((stage) => stage.status === "completed")
      .map((stage) => ({
        id: stage.id,
        text: stage.text,
        attempts: stage.attempts.length,
      }));
    const evidenceIds = view.evidence.map((source) => source.id).sort();
    const packageVersion = (
      view.stages.find((stage) => stage.kind === "synthesize")?.result as {
        finalResearchPackage?: { version?: string };
      } | null
    )?.finalResearchPackage?.version;
    const stored = await db.researchTask.findUniqueOrThrow({
      where: { id: taskId },
    });
    const snapshot = stored.configSnapshot as Record<string, unknown>;
    snapshot.deerflowUrl = state.checks.productionUrl;
    await db.researchTask.update({
      where: { id: taskId },
      data: { configSnapshot: researchJson(snapshot) },
    });
    const stage = view.stages.find((stage) => stage.kind === "produce")!;
    await retryResearchStage(userId, taskId, stage.id, randomUUID());
    await run();
    view = await researchTaskView(userId, taskId);
    const unchanged = completed.every((before) =>
      view.stages.some(
        (after) =>
          after.id === before.id &&
          after.text === before.text &&
          after.attempts.length === before.attempts,
      ),
    );
    const stableEvidence =
      JSON.stringify(evidenceIds) ===
      JSON.stringify(view.evidence.map((source) => source.id).sort());
    const stablePackage =
      packageVersion ===
      (
        view.stages.find((stage) => stage.kind === "synthesize")?.result as {
          finalResearchPackage?: { version?: string };
        } | null
      )?.finalResearchPackage?.version;
    state.checks.productionOnlyRetry = {
      completedStagesUnchanged: unchanged,
      stableEvidenceIds: stableEvidence,
      stableFinalPackageVersion: stablePackage,
      attempts: view.stages.find((stage) => stage.kind === "produce")?.attempts
        .length,
    };
    if (
      !unchanged ||
      !stableEvidence ||
      !stablePackage ||
      (v2Grant && !packageVersion)
    )
      throw Error("Production retry changed the completed research basis.");
  }
  state.checks[mode] = {
    status: view.status,
    llmCalls: view.llmCalls,
    evidence: view.evidence.length,
    artifacts: view.artifacts.map((file) => file.filename),
    error: view.error,
  };
  if (mode === "native") {
    const source = await researchTaskView(userId, state.tasks.full);
    const sameEvidence =
      JSON.stringify(view.evidence.map((row) => row.id).sort()) ===
      JSON.stringify(source.evidence.map((row) => row.id).sort());
    state.checks.nativeVersionReuse = {
      onlyProductionStage:
        view.stages.length === 1 && view.stages[0].kind === "produce",
      sameEvidence,
      sourceTaskId: view.sourceTaskId,
    };
    if (!sameEvidence || view.stages.length !== 1)
      throw Error("Native export did not retain its research version.");
  }
  const afterCredits = (
    await db.user.findUniqueOrThrow({ where: { id: userId } })
  ).credits;
  state.checks.creditsUnchanged = beforeCredits === afterCredits;
  state.checks.totalCalls = await countCalls();
  if (
    Number(state.checks.totalCalls) - (state.baselineCalls ?? 0) >
    state.authorized
  )
    throw Error("Acceptance exceeded its explicit authorization.");
  if (originalGrant) {
    const destination = "output/research-v2-integration/original-case";
    await mkdir(destination, { recursive: true });
    const files = await db.researchArtifact.findMany({ where: { taskId } });
    const checks = [];
    for (const file of files) {
      const bytes = await readResearchFile(file.storageKey);
      const valid =
        bytes.length === file.sizeBytes &&
        createHash("sha256").update(bytes).digest("hex") === file.sha256;
      if (!valid) throw Error(`Artifact bytes changed: ${file.filename}`);
      validateResearchArtifact(file.filename, bytes);
      await writeFile(
        path.join(destination, path.basename(file.filename)),
        bytes,
      );
      checks.push({
        filename: file.filename,
        sizeBytes: bytes.length,
        sha256: file.sha256,
        basisTaskId: file.basisTaskId,
        valid,
      });
    }
    state.checks.artifactIntegrity = checks;
    await writeFile(
      path.join(destination, "case-audit.json"),
      JSON.stringify(
        {
          taskId,
          status: view.status,
          brief: view.brief,
          error: view.error,
          modelId: view.modelId,
          reasoningEffort: view.reasoningEffort,
          stages: view.stages.map((stage) => ({
            kind: stage.kind,
            status: stage.status,
            attempts: stage.attempts.length,
            result: stage.result,
          })),
          checks: state.checks,
        },
        null,
        2,
      ),
    );
  }
  if (mediumGrant)
    state.checks.newAuthorizedCallsUsed =
      Number(state.checks.totalCalls) - (state.baselineCalls ?? 0);
  await persist();
  console.log(JSON.stringify(state.checks, null, 2));
  if (!auditOnly && view.status !== "completed")
    throw Error(
      `${mode} did not complete; inspect the saved task rather than resubmitting it.`,
    );
}
main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
