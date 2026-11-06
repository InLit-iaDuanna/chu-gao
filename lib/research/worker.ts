import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  Prisma,
  type ResearchTask,
  type ResearchStage,
  type ResearchAttempt,
} from "@prisma/client";
import { db } from "@/lib/db";
import {
  getResearchConfig,
  researchToken,
  type ResearchConfig,
} from "./config";
import {
  appendResearchEvent,
  lockResearchTask,
  researchEvent,
} from "./service";
import { researchModelCall } from "./gateway";
import { responseText } from "./model-protocol";
import {
  assessCandidate,
  assessResearchQuality,
  buildSearchQueries,
  packEvidenceContext,
  validateEvidenceIds,
  type EvidenceDecisionRoute,
} from "./quality";
import { buildResearchEvidenceHandoff } from "./evidence-handoff";
import {
  assertSynthesisCheckpointVersion,
  runResumableSynthesis,
  SYNTHESIS_CHECKPOINT_VERSION,
  type SynthesisCheckpoint,
} from "./synthesis-checkpoint";
import { synthesisReadiness } from "./synthesis-readiness";
import {
  EDITORIAL_GUARD_VERSION,
  validateEditorialReport,
} from "./editorial-contract";
import {
  createFinalResearchPackage,
  finalBriefMarkdown,
  mergeOpenResearchQuestions,
  readFinalResearchPackage,
  researchDeliverablesSchemaV3,
  researchVersion,
  restoreVerificationPlan,
  stageCallCeiling,
  verificationIdentity,
  verificationPlanSchemaV2,
  validateDeliverableEvidence,
  verificationQuestionRelevant,
} from "./workflow-quality";
import {
  assessDecisionAnswers,
  decisionReviewMarkdown,
  inheritDecisionState,
  unresolvedDecisionGaps,
  verificationAssessmentSchema,
  verificationFallbackQuery,
  reconcileDecisionState,
  validateDecisionCards,
  shouldRunVerificationSearch,
} from "./decision-evidence";
import {
  VERIFICATION_PLAN_PROMPT,
  VERIFICATION_ASSESSMENT_PROMPT,
  SYNTHESIS_PROMPT,
  SYNTHESIS_EDITORIAL_PROMPT,
  SYNTHESIS_METADATA_PROMPT,
} from "./research-prompts";
import { researchTool } from "./tools";
import { readResearchFile, saveResearchSource } from "./storage";
import { readResearchAttachments } from "./attachments";
import { cleanupResearchFiles } from "./retention";
import { prepareResearchInputs } from "./inputs";
import { runResearchIntake } from "./intake";
import { confirmedUserRequirements } from "./confirmed-requirements";
import { saveResearchArtifactBatch, csvResearchTable } from "./artifacts";
import {
  validateRemoteArtifactBytes,
  validateRemoteProposal,
} from "./artifact-contract";
import { expireResearchAssets, researchExpiry } from "./lifecycle";
import { ResearchError, researchJson } from "./errors";
import { researchVersionTaskIds } from "./versions";
import type { ResearchBriefInput, ResearchPlan } from "./types";
import { runResearchWorkerLanes, type ResearchTaskLane } from "./worker-lanes";

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", aborted);
      resolve();
    };
    const aborted = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", aborted);
      reject(signal?.reason ?? Error("Stopped"));
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", aborted, { once: true });
  });
const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
type Stage = ResearchStage & { attempt: ResearchAttempt };

async function mutateTask(
  taskId: string,
  token: string,
  fn: (tx: Prisma.TransactionClient) => Promise<void>,
) {
  await db.$transaction(async (tx) => {
    await lockResearchTask(tx, taskId);
    const task = await tx.researchTask.findUniqueOrThrow({
      where: { id: taskId },
    });
    if (task.status !== "running" || task.executionToken !== token)
      throw new ResearchError("TASK_STOPPED", "研究任务已经停止", 409);
    await fn(tx);
  });
}

async function completeResearchTaskInTransaction(
  tx: Prisma.TransactionClient,
  task: ResearchTask,
  brief: ResearchBriefInput,
) {
  const expiresAt = researchExpiry(task.configSnapshot);
  await tx.researchTask.update({
    where: { id: task.id },
    data: {
      status: "completed",
      finishedAt: new Date(),
      expiresAt,
      executionToken: null,
    },
  });
  await expireResearchAssets(tx, task.id, expiresAt);
  await tx.researchAttachment.updateMany({
    where: {
      id: {
        in: brief.attachmentKeys
          .filter((key) => key.startsWith("attachment:"))
          .map((key) => key.slice(11)),
      },
      expiresAt: { lt: expiresAt },
    },
    data: { expiresAt },
  });
  await appendResearchEvent(tx, task.id, "task.completed", {});
}

async function startStage(
  task: ResearchTask,
  stage: ResearchStage,
): Promise<Stage> {
  let attempt: ResearchAttempt | null = null;
  await mutateTask(task.id, task.executionToken!, async (tx) => {
    if (stage.activeAttemptId)
      attempt = await tx.researchAttempt.findUnique({
        where: { id: stage.activeAttemptId },
      });
    if (!attempt || attempt.status !== "queued") {
      const count = await tx.researchAttempt.count({
        where: { stageId: stage.id },
      });
      attempt = await tx.researchAttempt.create({
        data: { stageId: stage.id, ordinal: count + 1 },
      });
    }
    attempt = await tx.researchAttempt.update({
      where: { id: attempt.id },
      data: { status: "running", startedAt: new Date() },
    });
    await tx.researchStage.update({
      where: { id: stage.id },
      data: { status: "running", activeAttemptId: attempt.id, text: "" },
    });
    await appendResearchEvent(tx, task.id, "stage.started", {
      stageId: stage.id,
      attemptId: attempt.id,
      kind: stage.kind,
      engine: stage.engine,
    });
  });
  return { ...stage, attempt: attempt! };
}

function stageText(task: ResearchTask, stage: Stage) {
  let text = "";
  let lastFlush = 0;
  let published = "";
  return {
    get text() {
      return text;
    },
    async append(delta: string) {
      text += delta;
      if (Date.now() - lastFlush >= 120) await this.flush();
    },
    async replace(value: string) {
      text = value;
      await this.flush(true);
    },
    async flush(replace = false) {
      if (published === text) return;
      const delta =
        text.startsWith(published) && !replace
          ? text.slice(published.length)
          : null;
      await mutateTask(task.id, task.executionToken!, async (tx) => {
        await tx.researchStage.update({
          where: { id: stage.id },
          data: { text },
        });
        await tx.researchAttempt.update({
          where: { id: stage.attempt.id },
          data: { text },
        });
        await appendResearchEvent(tx, task.id, "stage.text", {
          stageId: stage.id,
          attemptId: stage.attempt.id,
          ...(delta === null ? { text } : { delta }),
        });
      });
      published = text;
      lastFlush = Date.now();
    },
  };
}

async function evidenceContext(
  task: ResearchTask,
  brief: ResearchBriefInput,
  focus?: string,
  decisionRoutes?: EvidenceDecisionRoute[],
) {
  const versionIds = await researchVersionTaskIds(task);
  const evidence = await db.researchEvidence.findMany({
    where: { taskId: { in: versionIds } },
    orderBy: { createdAt: "asc" },
  });
  const rows = [];
  for (const row of evidence) {
    let content: string | undefined;
    if (row.contentKey && !row.purgedAt) {
      try {
        content = (await readResearchFile(row.contentKey)).toString("utf8");
      } catch {
        /* Missing retained text remains unavailable, never an empty original. */
      }
    }
    rows.push({ ...row, url: row.originalUrl, content });
  }
  return {
    evidence,
    loadedEvidence: rows,
    ...packEvidenceContext(rows, brief, {
      maxChars: 32000,
      perSourceChars: 4000,
      focus,
      decisionRoutes,
      requireDecisionRoutes: decisionRoutes !== undefined,
    }),
  };
}

async function recordStageContext(
  task: ResearchTask,
  stage: Stage,
  context: { sources: unknown[]; manifest: unknown; usedChars: number },
) {
  await mutateTask(task.id, task.executionToken!, async (tx) => {
    const current = await tx.researchStage.findUniqueOrThrow({
      where: { id: stage.id },
    });
    await tx.researchStage.update({
      where: { id: stage.id },
      data: {
        result: researchJson({
          ...(current.result &&
          typeof current.result === "object" &&
          !Array.isArray(current.result)
            ? current.result
            : {}),
          contextManifest: context.manifest,
        }),
      },
    });
    await appendResearchEvent(tx, task.id, "context.prepared", {
      stageId: stage.id,
      attemptId: stage.attempt.id,
      includedSources: context.sources.length,
      usedChars: context.usedChars,
    });
  });
}

async function runVane(
  task: ResearchTask,
  stage: Stage,
  brief: ResearchBriefInput,
  config: ResearchConfig,
  signal: AbortSignal,
) {
  const output = stageText(task, stage);
  const gatewayToken = await researchToken(stage.attempt.id);
  let providerId = "";
  try {
    const providerResponse = await fetch(`${config.vaneUrl}/api/providers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "openai",
        name: `Chugao ${stage.attempt.id}`,
        config: { apiKey: gatewayToken, baseURL: `${config.gatewayUrl}/v1` },
      }),
      signal,
    });
    if (!providerResponse.ok)
      throw new ResearchError(
        "ENGINE_UNAVAILABLE",
        "资料探索引擎尚未就绪",
        503,
      );
    providerId = (await providerResponse.json()).provider.id;
    for (const [type, key] of [
      ["chat", task.modelId],
      ["embedding", "intfloat/multilingual-e5-small"],
    ]) {
      const added = await fetch(
        `${config.vaneUrl}/api/providers/${providerId}/models`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, key, name: key }),
          signal,
        },
      );
      if (!added.ok)
        throw new ResearchError(
          "ENGINE_UNAVAILABLE",
          "资料探索模型配置失败",
          503,
        );
    }
    const response = await fetch(`${config.vaneUrl}/api/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sources: ["web"],
        chatModel: { providerId, key: task.modelId },
        embeddingModel: { providerId, key: "intfloat/multilingual-e5-small" },
        optimizationMode:
          task.scope === "exploratory"
            ? "speed"
            : task.scope === "deep"
              ? "quality"
              : "balanced",
        query: brief.question,
        history: brief.selectedContext
          ? [["human", brief.selectedContext]]
          : [],
        systemInstructions: `用中文提供面向设计工作的资料探索。市场：${brief.market}；用户：${brief.audience}；时间：${brief.timeRange}；指定竞品：${brief.competitors.join("、")}；指定链接：${brief.links.join("、")}；约束：${brief.constraints}。区分事实与假设，保留来源。`,
        stream: true,
        _chugao: { gateway: config.gatewayUrl, token: gatewayToken },
      }),
      signal,
    });
    if (!response.ok || !response.body)
      throw new ResearchError("ENGINE_FAILED", "资料探索请求失败", 502);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let done = false;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        let index: number;
        while ((index = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          if (!line) continue;
          const event = JSON.parse(line.replace(/^data:\s*/, ""));
          if (event.type === "response")
            await output.append(String(event.data ?? ""));
          if (event.type === "sources")
            for (const source of event.data ?? [])
              if (source.metadata?.url)
                await saveResearchSource(
                  task.id,
                  {
                    url: source.metadata.url,
                    title: source.metadata.title,
                    excerpt: source.content,
                  },
                  task.executionToken!,
                );
          if (event.type === "done") done = true;
          if (event.type === "error")
            throw new ResearchError(
              "ENGINE_FAILED",
              "资料探索引擎执行失败",
              502,
            );
        }
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    if (!done)
      throw new ResearchError(
        "ENGINE_INTERRUPTED",
        "资料探索流提前中断，已有内容已保存",
        502,
      );
    await output.flush();
    return { text: output.text };
  } finally {
    await output.flush().catch(() => {});
    if (providerId)
      await fetch(`${config.vaneUrl}/api/providers/${providerId}`, {
        method: "DELETE",
        signal: AbortSignal.timeout(4000),
      }).catch(() => {});
  }
}

async function runEngine(
  task: ResearchTask,
  stage: Stage,
  brief: ResearchBriefInput,
  config: ResearchConfig,
  signal: AbortSignal,
) {
  const base =
    stage.engine === "deerflow" ? config.deerflowUrl : config.gptrUrl;
  let imported = false;
  const output = stageText(task, stage);
  const context = await evidenceContext(task, brief);
  const { sources } = context;
  const ownFinal =
    stage.kind === "produce"
      ? await db.researchStage.findFirst({
          where: { taskId: task.id, kind: "synthesize", status: "completed" },
        })
      : null;
  const basisId = ownFinal ? task.id : (task.sourceTaskId ?? task.id);
  const research = await db.researchStage.findMany({
    where: {
      taskId: basisId,
      status: "completed",
      kind: { in: ["explore", "research", "verify", "synthesize"] },
    },
    orderBy: { ordinal: "asc" },
  });
  const finalStage = research.find((item) => item.kind === "synthesize");
  const finalPackage =
    stage.kind === "produce"
      ? readFinalResearchPackage(
          (finalStage?.result as { finalResearchPackage?: unknown } | undefined)
            ?.finalResearchPackage,
        )
      : null;
  if (stage.kind === "produce" && !finalPackage)
    throw new ResearchError(
      "FINAL_PACKAGE_REQUIRED",
      "此研究尚无可校验的终稿包，请选择“整理旧版并制作”，不要重跑已完成的检索",
      409,
    );
  await recordStageContext(
    task,
    stage,
    finalPackage
      ? {
          sources: finalPackage.evidence,
          manifest: finalPackage.evidenceManifest,
          usedChars: JSON.stringify(finalPackage.evidence).length,
        }
      : context,
  );
  // Screenshots are archives. Only separately vetted assets belong in a proposal.
  const files =
    stage.kind === "produce"
      ? []
      : await readResearchAttachments(task.projectId, brief.attachmentKeys);
  const plan = task.plan as unknown as ResearchPlan;
  const current = await db.researchTask.findUniqueOrThrow({
    where: { id: task.id },
  });
  const previousRuns =
    stage.kind === "research"
      ? await db.researchAttempt.findMany({
          where: {
            stageId: stage.id,
            id: { not: stage.attempt.id },
            remoteRunId: { not: null },
            status: { in: ["failed", "interrupted"] },
          },
          orderBy: { ordinal: "desc" },
          take: 20,
          select: { remoteRunId: true },
        })
      : [];
  const payload = {
    runId: stage.attempt.id,
    gatewayUrl: config.gatewayUrl,
    gatewayToken: await researchToken(stage.attempt.id),
    retentionDays: config.retentionDays,
    model: task.modelId,
    effort: task.reasoningEffort,
    query: brief.question,
    taskSpec: {
      schemaVersion: 1,
      objective: brief.question,
      confirmedRequirements: await confirmedUserRequirements(task, brief),
      audience: brief.audience,
      market: brief.market,
      timeRange: brief.timeRange,
      constraints: brief.constraints,
      decisionQuestions: buildSearchQueries(brief).map((item, index) => ({
        id: "brief-" + (index + 1),
        question: item.query,
      })),
    },
    searchPlan: buildSearchQueries(brief),
    context: [
      JSON.stringify({
        projectBrief: brief,
        notice:
          "这些是任务需求和待确认建议，不是外部研究证据；不得当作已核验市场事实",
      }),
    ],
    links: brief.links,
    scope: task.scope,
    products: (task.plan as unknown as ResearchPlan).products.filter(
      (product) =>
        stage.kind !== "produce" || ["pptx", "docx", "html"].includes(product),
    ),
    maxCalls: Math.max(
      0,
      stageCallCeiling(plan, stage.kind, "llm") - current.llmCalls,
    ),
    maxPages: Math.max(
      0,
      stageCallCeiling(plan, stage.kind, "crawl") - current.crawlCalls,
    ),
    research: finalPackage?.report.text ?? "",
    evidence: finalPackage?.evidence ?? sources,
    previousRunIds: previousRuns.map((attempt) => attempt.remoteRunId!),
    contextDiagnostics: context.diagnostics,
    brief: finalPackage?.finalBrief ?? brief,
    finalResearchPackage: finalPackage,
    files,
  };
  await db.researchAttempt.update({
    where: { id: stage.attempt.id },
    data: { remoteRunId: stage.attempt.id },
  });
  try {
    const response = await fetch(`${base}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    if (!response.ok)
      throw new ResearchError(
        "ENGINE_UNAVAILABLE",
        `研究引擎无法启动（HTTP ${response.status}）`,
        503,
      );
    let cursor = stage.attempt.remoteCursor;
    while (true) {
      signal.throwIfAborted();
      const response = await fetch(
        `${base}/runs/${stage.attempt.id}?after=${cursor}`,
        { signal, cache: "no-store" },
      );
      if (!response.ok)
        throw new ResearchError(
          "ENGINE_INTERRUPTED",
          "研究执行状态暂时无法获取，已有材料已保留",
          502,
        );
      const remote = await response.json();
      for (const event of remote.events ?? []) {
        if (event.seq <= cursor) continue;
        if (event.type === "text")
          await output.append(String(event.data?.delta ?? ""));
        if (event.type === "activity")
          await researchEvent(
            task.id,
            "stage.activity",
            { ...event.data, stageId: stage.id, attemptId: stage.attempt.id },
            task.executionToken!,
          );
        cursor = event.seq;
      }
      await db.researchAttempt.update({
        where: { id: stage.attempt.id },
        data: { remoteCursor: cursor },
      });
      if (remote.status === "completed" && cursor >= remote.seq) {
        const proposal = finalPackage
          ? validateRemoteProposal({
              result: remote.result,
              files: remote.files,
              packageVersion: finalPackage.version,
              evidenceIds: finalPackage.evidence.map(
                (source) => (source as { id: string }).id,
              ),
              requestedFormats: plan.products.filter((product) =>
                ["pptx", "docx", "html"].includes(product),
              ),
            })
          : null;
        for (const source of remote.result?.sources ?? [])
          if (source.url)
            await saveResearchSource(
              task.id,
              {
                url: source.url,
                title: source.title,
                excerpt: source.raw_content?.slice(0, 12000),
              },
              task.executionToken!,
            );
        const downloadedFiles = [];
        // Only the production engine publishes files. Exploration returns text
        // and tool evidence; it cannot introduce an unrelated artifact bundle.
        for (const file of proposal?.files ?? []) {
          const downloaded = await fetch(
            `${base}/runs/${stage.attempt.id}/files/${encodeURIComponent(file.name)}`,
            { signal },
          );
          if (!downloaded.ok)
            throw new ResearchError(
              "ARTIFACT_UNAVAILABLE",
              "交付文件下载失败，本阶段可以重试",
              502,
            );
          const data = Buffer.from(await downloaded.arrayBuffer());
          validateRemoteArtifactBytes(file, data);
          downloadedFiles.push({
            filename: `${stage.kind}-${stage.attempt.ordinal}-${file.name}`,
            title: file.name,
            kind: file.format,
            data,
            evidenceIds: proposal!.evidenceIds,
          });
        }
        if (downloadedFiles.length)
          await saveResearchArtifactBatch({
            taskId: task.id,
            executionToken: task.executionToken!,
            files: downloadedFiles,
          });
        // A remote "completed" result is only a delivery confirmation after
        // every file has passed byte validation and local atomic publication.
        if (remote.result?.text) await output.replace(remote.result.text);
        await output.flush();
        imported = true;
        return {
          ...remote.result,
          contextManifest: finalPackage?.evidenceManifest ?? context.manifest,
          ...(finalPackage
            ? {
                quality: finalPackage.quality,
                finalPackageVersion: finalPackage.version,
              }
            : {}),
        };
      }
      if (
        ["failed", "cancelled", "interrupted"].includes(remote.status) &&
        cursor >= remote.seq
      )
        throw new ResearchError(
          remote.status === "failed" ? "ENGINE_FAILED" : "ENGINE_INTERRUPTED",
          `${remote.error || "研究引擎未完成本阶段"}${remote.errorDetail ? `：${String(remote.errorDetail).slice(0, 500)}` : ""}`,
          502,
        );
      await sleep(800, signal);
    }
  } finally {
    await output.flush().catch(() => {});
    await fetch(`${base}/runs/${stage.attempt.id}/cancel`, {
      method: "POST",
      signal: AbortSignal.timeout(6000),
    }).catch(() => {});
    if (imported)
      await fetch(`${base}/runs/${stage.attempt.id}/payload`, {
        method: "DELETE",
        signal: AbortSignal.timeout(6000),
      }).catch(() => {});
  }
}

async function capture(
  task: ResearchTask,
  stage: Stage,
  brief: ResearchBriefInput,
  signal: AbortSignal,
) {
  const plan = task.plan as unknown as ResearchPlan;
  const rows = await db.researchEvidence.findMany({
    where: { taskId: task.id },
    orderBy: { createdAt: "asc" },
  });
  let captured = 0;
  let skipped = 0;
  const ranked = rows
    .map((row) => ({
      row,
      assessment: assessCandidate(
        { url: row.originalUrl, title: row.title, excerpt: row.excerpt },
        brief,
      ),
    }))
    .sort((a, b) => b.assessment.score - a.assessment.score);
  for (const { row, assessment } of ranked) {
    if (assessment.decision === "reject" || row.status === "fetch_failed") {
      skipped++;
      continue;
    }
    if (row.originalUrl.startsWith("attachment:")) continue;
    if (row.contentKey && !row.purgedAt && row.screenshotKey) continue;
    signal.throwIfAborted();
    const current = await db.researchTask.findUniqueOrThrow({
      where: { id: task.id },
    });
    if (current.crawlCalls >= stageCallCeiling(plan, stage.kind, "crawl"))
      break;
    try {
      await researchTool(
        stage.attempt.id,
        "crawl",
        { url: row.originalUrl, screenshot: true },
        signal,
      );
      captured++;
    } catch (error) {
      if (
        signal.aborted ||
        (error instanceof ResearchError &&
          ["BUDGET_EXHAUSTED", "TASK_STOPPED"].includes(error.code))
      )
        throw error;
    }
  }
  return {
    captured,
    skipped,
    total: rows.length,
    reservedForLaterStages:
      plan.limits.crawl - stageCallCeiling(plan, stage.kind, "crawl"),
  };
}

async function verify(
  task: ResearchTask,
  stage: Stage,
  brief: ResearchBriefInput,
  signal: AbortSignal,
) {
  const research = await db.researchStage.findMany({
    where: {
      taskId: task.id,
      status: "completed",
      kind: { in: ["research", "explore"] },
    },
    orderBy: { ordinal: "asc" },
    select: { id: true, text: true, result: true },
  });
  const identity = verificationIdentity(
    brief,
    research.map(({ id, text }) => ({ id, text })),
  );
  const stored = stage.result as { verificationCheckpoint?: unknown } | null;
  let checkpoint = restoreVerificationPlan(
    stored?.verificationCheckpoint,
    identity,
  );
  const loaded = await evidenceContext(task, brief);
  const initial = {
    ...loaded,
    ...packEvidenceContext(loaded.loadedEvidence, brief, {
      maxChars: 32000,
      perSourceChars: 4000,
      purpose: "review",
      handoff: buildResearchEvidenceHandoff(
        loaded.loadedEvidence,
        research.map((row) => row.result),
      ),
    }),
  };
  await recordStageContext(task, stage, initial);
  const saveCheckpoint = async () => {
    await mutateTask(task.id, task.executionToken!, async (tx) => {
      const current = await tx.researchStage.findUniqueOrThrow({
        where: { id: stage.id },
      });
      await tx.researchStage.update({
        where: { id: stage.id },
        data: {
          result: researchJson({
            ...((current.result as object) ?? {}),
            verificationCheckpoint: checkpoint,
          }),
        },
      });
    });
  };
  if (!checkpoint) {
    if (stored)
      await researchEvent(
        task.id,
        "verification.plan_invalidated",
        {
          stageId: stage.id,
          attemptId: stage.attempt.id,
          reason: "旧核验计划缺少版本或输入已经变化，只重新规划核验阶段",
          ...identity,
        },
        task.executionToken!,
      );
    const planResponse = await researchModelCall(
      stage.attempt.id,
      {
        messages: [
          {
            role: "system",
            content: VERIFICATION_PLAN_PROMPT,
          },
          {
            role: "user",
            content: JSON.stringify({
              brief,
              confirmedRequirements: await confirmedUserRequirements(
                task,
                brief,
              ),
              research: research.map((row) => ({
                id: row.id,
                text: row.text.slice(0, 14000),
              })),
              suggestedSearchPlan: buildSearchQueries(brief),
              evidence: initial.sources,
              sourceAvailability: initial.diagnostics,
            }),
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "verification_plan_v3",
            strict: true,
            schema: z.toJSONSchema(verificationPlanSchemaV2, {
              target: "draft-7",
            }),
          },
        },
      },
      () => {},
      signal,
      {
        purpose: "research.verify_plan",
        declaredContextHash: researchVersion(initial.sources),
      },
    );
    const plan = verificationPlanSchemaV2.parse(
      JSON.parse(responseText(planResponse)),
    );
    if (!plan.questions.length)
      throw new ResearchError(
        "VERIFICATION_PLAN_EMPTY",
        "没有形成可核对的设计问题，已保留研究原稿，未把空核验视为通过",
        502,
      );
    const allowed = new Set(initial.sources.map((source) => source.id));
    const ids = new Set<string>();
    for (const question of plan.questions) {
      if (
        ids.has(question.id) ||
        question.evidenceIds.some((id) => !allowed.has(id))
      )
        throw new ResearchError(
          "VERIFICATION_PLAN_INVALID",
          "核验问题包含重复编号或未读证据，保留研究原稿等待修正",
          502,
        );
      ids.add(question.id);
      if (!verificationQuestionRelevant(question, brief, initial.sources))
        throw new ResearchError(
          "VERIFICATION_PLAN_IRRELEVANT",
          "核验问题未通过课题相关性检查，已保留研究原稿",
          502,
        );
    }
    checkpoint = {
      ...plan,
      ...identity,
      checkpoint: "verification-v3",
      questionsVersion: researchVersion(plan.questions),
      searched: [],
      unresolved: plan.questions.map((row) => row.id),
      sourceIdsByQuestion: {},
      acquisition: {},
      searchOutcomes: {},
      searchAttemptIds: {},
    };
  } else {
    await researchEvent(
      task.id,
      "stage.activity",
      {
        stageId: stage.id,
        attemptId: stage.attempt.id,
        message:
          "复用同一需求、研究原稿和规划器版本的核验计划；已保存来源可续查",
      },
      task.executionToken!,
    );
  }
  await saveCheckpoint();
  const limits = (task.plan as unknown as ResearchPlan).limits;
  checkpoint.acquisition ??= {};
  checkpoint.searchOutcomes ??= {};
  checkpoint.searchAttemptIds ??= {};
  const saved = checkpoint;
  const searchOnce = async (
    question: (typeof saved.questions)[number],
    slot: "primary" | "fallback",
    query: string,
  ) => {
    const key = `${question.id}/${slot}`;
    // A saved intent with no result is ambiguous: the provider may have run it.
    // Only the user's explicit new attempt can retry uncertain work. Completed
    // searches and all in-attempt re-entry are reused, never automatically sent.
    if (
      !shouldRunVerificationSearch(
        saved.searchOutcomes![key],
        saved.searchAttemptIds![key],
        stage.attempt.id,
      )
    )
      return;
    const current = await db.researchTask.findUniqueOrThrow({
      where: { id: task.id },
    });
    if (current.searchCalls >= limits.search) return;
    saved.searchOutcomes![key] = "reserved";
    saved.searchAttemptIds![key] = stage.attempt.id;
    await saveCheckpoint();
    try {
      const result = await researchTool(
        stage.attempt.id,
        "search",
        { query, purpose: question.decision },
        signal,
      );
      saved.sourceIdsByQuestion[question.id] = [
        ...new Set([
          ...(saved.sourceIdsByQuestion[question.id] ?? []),
          ...(result.results ?? [])
            .slice(0, 2)
            .map((row: { evidenceId: string }) => row.evidenceId)
            .filter(Boolean),
        ]),
      ];
      saved.searchOutcomes![key] = "completed";
      saved.acquisition![question.id] = "searched";
      if (!saved.searched.includes(question.id))
        saved.searched.push(question.id);
      await saveCheckpoint();
    } catch (error) {
      saved.searchOutcomes![key] = "failed";
      saved.acquisition![question.id] = "unavailable";
      await saveCheckpoint();
      throw error;
    }
  };
  for (const question of checkpoint.questions) {
    signal.throwIfAborted();
    if (!checkpoint.searched.includes(question.id)) {
      await searchOnce(question, "primary", question.query);
    }
    const simpler = verificationFallbackQuery(question.query);
    // Empty successful search may justify one narrower, separately budgeted
    // query. Reserve one opportunity for each question still to be searched.
    if (
      simpler &&
      checkpoint.searchOutcomes![`${question.id}/primary`] === "completed" &&
      !(checkpoint.sourceIdsByQuestion[question.id] ?? []).length
    ) {
      const current = await db.researchTask.findUniqueOrThrow({
        where: { id: task.id },
      });
      const pending = checkpoint.questions.filter(
        (row) =>
          row.id !== question.id &&
          !checkpoint.searched.includes(row.id) &&
          !checkpoint.searchOutcomes![`${row.id}/primary`],
      ).length;
      if (limits.search - current.searchCalls > pending)
        await searchOnce(question, "fallback", simpler);
    }
    const candidateIds = [
      ...new Set([
        ...question.evidenceIds,
        ...(checkpoint.sourceIdsByQuestion[question.id] ?? []),
      ]),
    ];
    const rows = await db.researchEvidence.findMany({
      where: {
        taskId: task.id,
        id: { in: candidateIds },
      },
    });
    let readOriginal = false;
    for (const row of rows) {
      if (row.contentKey && !row.purgedAt) {
        try {
          const body = (await readResearchFile(row.contentKey)).toString(
            "utf8",
          );
          if (body.trim()) readOriginal = true;
        } catch {
          /* A retained key is not proof that readable body bytes still exist. */
        }
        continue;
      }
      const current = await db.researchTask.findUniqueOrThrow({
        where: { id: task.id },
      });
      if (
        current.crawlCalls >=
        stageCallCeiling(
          task.plan as unknown as ResearchPlan,
          stage.kind,
          "crawl",
        )
      )
        break;
      try {
        const page = await researchTool(
          stage.attempt.id,
          "crawl",
          { url: row.originalUrl, screenshot: false },
          signal,
        );
        if (String(page.markdown ?? "").trim()) readOriginal = true;
      } catch (error) {
        if (
          signal.aborted ||
          (error instanceof ResearchError &&
            ["TASK_STOPPED", "BUDGET_EXHAUSTED"].includes(error.code))
        )
          throw error;
      }
    }
    checkpoint.acquisition![question.id] = readOriginal
      ? "read"
      : (checkpoint.acquisition![question.id] ??
        (checkpoint.searchOutcomes![`${question.id}/primary`]
          ? "unavailable"
          : "not_searched"));
    // Acquisition is a transport/material state. Only a cited answer below
    // can change the question's decision state.
    await saveCheckpoint();
  }
  const reviewFocus = checkpoint.questions
    .map((row) => `${row.query} ${row.decision}`)
    .join(" ");
  const reviewLoaded = await evidenceContext(task, brief, reviewFocus);
  const handoff = buildResearchEvidenceHandoff(
    reviewLoaded.loadedEvidence,
    research.map((row) => row.result),
    {
      questions: checkpoint.questions,
      sourceIdsByQuestion: checkpoint.sourceIdsByQuestion,
    },
  );
  const updated = {
    ...reviewLoaded,
    ...packEvidenceContext(reviewLoaded.loadedEvidence, brief, {
      maxChars: 32000,
      perSourceChars: 4000,
      focus: reviewFocus,
      purpose: "review",
      handoff,
    }),
  };
  // Keep acquisition, new search results and assessor visibility distinct.
  const questionContextCoverage = checkpoint.questions.map((question) => {
    const requested = new Set([
      ...question.evidenceIds,
      ...(checkpoint.sourceIdsByQuestion[question.id] ?? []),
    ]);
    const supplied = updated.sources.filter(
      (source) =>
        requested.has(source.id) &&
        ["captured_text", "user_provided_text"].includes(source.contentKind) &&
        source.content.trim(),
    );
    return {
      questionId: question.id,
      requestedEvidenceIds: [...requested],
      searchResultEvidenceIds:
        checkpoint.sourceIdsByQuestion[question.id] ?? [],
      suppliedOriginalIds: supplied.map((source) => source.id),
      omittedEvidenceIds: [...requested].filter(
        (id) => !supplied.some((source) => source.id === id),
      ),
    };
  });
  await recordStageContext(task, stage, updated);
  const reviewInputHash = researchVersion({
    contract: "review-handoff-v4",
    prompt: VERIFICATION_ASSESSMENT_PROMPT,
    questions: checkpoint.questions,
    sources: updated.sources,
    acquisition: checkpoint.acquisition,
    questionContextCoverage,
  });
  const output = stageText(task, stage);
  try {
    if (
      checkpoint.reviewInputHash !== reviewInputHash ||
      !checkpoint.decisionGaps ||
      checkpoint.decisionGaps.length !== checkpoint.questions.length
    ) {
      await researchEvent(
        task.id,
        "stage.activity",
        {
          stageId: stage.id,
          attemptId: stage.attempt.id,
          message:
            "正在核对关键设计问题、原文引句和适用条件；读取成功不会自动关闭问题",
        },
        task.executionToken!,
      );
      const result = await researchModelCall(
        stage.attempt.id,
        {
          max_output_tokens: 10000,
          messages: [
            {
              role: "system",
              content: VERIFICATION_ASSESSMENT_PROMPT,
            },
            {
              role: "user",
              content: JSON.stringify({
                brief,
                confirmedRequirements: await confirmedUserRequirements(
                  task,
                  brief,
                ),
                questions: checkpoint.questions,
                acquisition: checkpoint.acquisition,
                questionContextCoverage,
                evidence: updated.sources,
                sourceAvailability: updated.diagnostics,
              }),
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "decision_evidence_review_v3",
              strict: true,
              schema: z.toJSONSchema(verificationAssessmentSchema, {
                target: "draft-7",
              }),
            },
          },
        },
        // This response is structured assessment data, not report prose. Publish
        // real stage activity while it runs; render the completed record once.
        () => {},
        signal,
        {
          purpose: "research.verify_assess",
          declaredContextHash: researchVersion(updated.sources),
        },
      );
      const assessment = verificationAssessmentSchema.parse(
        JSON.parse(responseText(result)),
      );
      const review = assessDecisionAnswers({
        assessment,
        questions: checkpoint.questions,
        sources: updated.sources,
        retained: updated.loadedEvidence,
        acquisition: checkpoint.acquisition!,
      });
      checkpoint.decisionGaps = review.gaps;
      checkpoint.decisionRoutes = review.routes;
      checkpoint.reviewInputHash = reviewInputHash;
      checkpoint.unresolved = unresolvedDecisionGaps(review.gaps).map(
        (gap) => gap.id,
      );
      await saveCheckpoint();
      if (review.issues.length)
        await researchEvent(
          task.id,
          "verification.validation",
          {
            stageId: stage.id,
            attemptId: stage.attempt.id,
            issues: review.issues,
          },
          task.executionToken!,
        );
    }
    await output.replace(decisionReviewMarkdown(checkpoint.decisionGaps!));
    return {
      verificationCheckpoint: checkpoint,
      questions: checkpoint.questions,
      decisionGaps: checkpoint.decisionGaps,
      decisionRoutes: checkpoint.decisionRoutes,
      unresolved: unresolvedDecisionGaps(checkpoint.decisionGaps!).map(
        (gap) => gap.decision,
      ),
      evidenceIds: updated.sources.map((row) => row.id),
      contextManifest: updated.manifest,
      questionContextCoverage,
    };
  } finally {
    await output.flush().catch(() => {});
  }
}

async function synthesize(
  task: ResearchTask,
  stage: Stage,
  brief: ResearchBriefInput,
  signal: AbortSignal,
) {
  const prior = await db.researchStage.findMany({
    where: {
      taskId: task.sourceTaskId ?? task.id,
      status: "completed",
      kind: {
        in: task.sourceTaskId
          ? ["verify", "synthesize"]
          : ["research", "explore", "verify"],
      },
    },
    orderBy: { ordinal: "asc" },
  });
  const inherited = inheritDecisionState(prior.map((row) => row.result));
  const semanticReview = prior.some((row) => {
    const result = row.result as {
      decisionRoutes?: unknown;
      finalResearchPackage?: { decisionRoutes?: unknown };
    } | null;
    return (
      Array.isArray(result?.decisionRoutes) ||
      Array.isArray(result?.finalResearchPackage?.decisionRoutes)
    );
  });
  // New formal contexts do not inherit unversioned legacy review labels.
  const decisionRoutes = semanticReview
    ? inherited.routes.filter(
        (route) =>
          !!route.contentHash && /^[a-f0-9]{64}$/.test(route.contentHash),
      )
    : undefined;
  const loaded = await evidenceContext(
    task,
    brief,
    inherited.gaps.map((gap) => gap.decision).join(" ") || undefined,
    decisionRoutes,
  );
  const packed = {
    ...loaded,
    ...packEvidenceContext(loaded.loadedEvidence, brief, {
      maxChars: 32000,
      perSourceChars: 4000,
      focus: inherited.gaps.map((gap) => gap.decision).join(" ") || undefined,
      decisionRoutes,
      requireDecisionRoutes: decisionRoutes !== undefined,
      purpose: "synthesis",
      handoff: buildResearchEvidenceHandoff(
        loaded.loadedEvidence,
        prior.map((row) => row.result),
      ),
    }),
  };
  const { sources, evidence } = packed;
  await recordStageContext(task, stage, packed);
  const decisionGaps = reconcileDecisionState(
    inherited.gaps,
    packed.loadedEvidence,
  );
  const inheritedOpenQuestions = task.sourceTaskId
    ? prior.flatMap((row) => {
        const result = row.result as { finalResearchPackage?: unknown } | null;
        return (
          readFinalResearchPackage(result?.finalResearchPackage)?.finalBrief
            .openQuestions ?? []
        );
      })
    : [];
  const confirmedRequirements = await confirmedUserRequirements(task, brief);
  const unresolved = unresolvedDecisionGaps(decisionGaps).map(
    (gap) => gap.decision,
  );
  const output = stageText(task, stage);
  try {
    let metadata: z.infer<typeof researchDeliverablesSchemaV3>;
    let synthesisCheckpoint: SynthesisCheckpoint | undefined;
    const storedSynthesis = (
      stage.result as { synthesisCheckpoint?: unknown } | null
    )?.synthesisCheckpoint;
    assertSynthesisCheckpointVersion(storedSynthesis);
    const readiness = synthesisReadiness({
      brief,
      loadedEvidence: packed.loadedEvidence,
      sources,
      decisionRoutes,
      requireDecisionRoutes: semanticReview,
    });
    if (!readiness.canWriteResearch) {
      if (storedSynthesis != null)
        throw new ResearchError(
          "SYNTHESIS_CHECKPOINT_MISMATCH",
          "已有成文记录，但当前可读材料与完成时不再一致。原完成记录已保留，请先恢复原材料再继续，或重新发起研究。",
          409,
        );
      // This is a compact application status document. Background-only material
      // must not trigger additional model calls to pad an empty market report.
      await output.replace(
        `# 研究材料不足\n\n本轮交给终稿的材料尚无可支撑目标问题的相关原文。已采集资料和研究原稿仍保留，未纳入本次上下文不代表原文没有内容。\n\n## 已确认需求\n\n${confirmedRequirements.map((line) => `- ${line}`).join("\n")}\n\n## 本次实际交接\n\n终稿可读正文 ${readiness.readSourceIds.length} 份；其中符合当前问题直接材料门槛 ${readiness.quality.metrics.relevantCapturedSources} 份。背景、链接或待分流材料没有被改写成市场结论。\n\n## 尚待解决\n\n${(unresolved.length ? unresolved : ["取得能回答已确认研究目标的原始材料，并核对市场、品类和时间范围"]).map((line) => `- ${line}`).join("\n")}\n\n程序据此保存材料状态，没有调用模型扩写报告；研究阶段原稿、来源版本及未纳入原因可在阶段记录和上下文清单中核对。`,
      );
      metadata = {
        finalBrief: {
          goal: brief.question,
          scope: `材料不足；保留已确认范围：${confirmedRequirements.join("；") || brief.question}。未确认字段仍待确认。`,
          alternatives: [],
          acceptanceCriteria: [],
          openQuestions: unresolved.length
            ? []
            : ["取得与已确认目标相关、口径明确的原文材料"],
        },
        hypotheses: [],
        caveats: ["本文件由程序根据材料状态生成，不是已经完成的市场研究。"],
        competitors: [],
        decisionCards: [],
      };
      await researchEvent(
        task.id,
        "synthesis.materials_insufficient",
        {
          stageId: stage.id,
          attemptId: stage.attempt.id,
          readSourceIds: readiness.readSourceIds,
          eligibleDirectSources:
            readiness.quality.metrics.relevantCapturedSources,
          skippedModelCalls: [
            "research.synthesize",
            "research.synthesize_editorial",
            "research.synthesize_metadata",
          ],
        },
        task.executionToken!,
      );
    } else {
      const writerInput = {
        brief,
        taskSpec: {
          objective: brief.question,
          audience: brief.audience,
          market: brief.market,
          timeRange: brief.timeRange,
          constraints: brief.constraints,
        },
        confirmedRequirements,
        prior: prior.map((row) => ({
          stage: row.kind,
          text: row.text.slice(0, 18000),
          authority: "draft_or_verification_notes_not_independent_evidence",
        })),
        evidence: sources,
        sourceAvailability: packed.diagnostics,
        unresolved,
        decisionGaps,
        inheritedOpenQuestions,
      };
      const readOriginalIds = sources
        .filter(
          (row) =>
            ["captured_text", "user_provided_text"].includes(row.contentKind) &&
            row.content.trim(),
        )
        .map((row) => row.id);
      const metadataSchema = z.toJSONSchema(researchDeliverablesSchemaV3, {
        target: "draft-7",
      });
      const inputHash = researchVersion({
        contract: SYNTHESIS_CHECKPOINT_VERSION,
        taskId: task.id,
        stageId: stage.id,
        briefId: task.briefId,
        modelId: task.modelId,
        reasoningEffort: task.reasoningEffort,
        configHash: researchVersion(task.configSnapshot),
        writerInput,
        decisionRoutes,
        semanticReview,
        prompts: [
          SYNTHESIS_PROMPT,
          SYNTHESIS_EDITORIAL_PROMPT,
          SYNTHESIS_METADATA_PROMPT,
        ],
        editorialGuard: EDITORIAL_GUARD_VERSION,
        maxAttemptsPerStep: 1,
        metadataSchema,
      });
      const resumed = await runResumableSynthesis({
        inputHash,
        attemptId: stage.attempt.id,
        stored: storedSynthesis,
        writeDraft: async () => {
          const result = await researchModelCall(
            stage.attempt.id,
            {
              max_output_tokens: 12000,
              messages: [
                { role: "system", content: SYNTHESIS_PROMPT },
                { role: "user", content: JSON.stringify(writerInput) },
              ],
            },
            async (event) => {
              if (event.type === "response.output_text.delta")
                await output.append(event.delta);
            },
            signal,
            {
              purpose: "research.synthesize",
              declaredContextHash: researchVersion(sources),
            },
            { maxAttempts: 1 },
          );
          return {
            status: result.status,
            text: responseText(result),
            responseId: result.id,
          };
        },
        validateDraft: (report) => {
          const citations = validateEvidenceIds(
            report,
            sources.map((row) => row.id),
          );
          if (!citations.valid || !citations.referencedIds.length)
            throw new ResearchError(
              "INVALID_EVIDENCE_REFERENCE",
              citations.unknownIds.length
                ? `研究草稿存在无法追溯的来源引用：${citations.unknownIds.join("、")}。正文已保留。`
                : "研究草稿未引用本次提供的稳定来源 ID，正文已保留，未发布为研究结论。",
              502,
            );
        },
        writeReport: async (draft) => {
          const result = await researchModelCall(
            stage.attempt.id,
            {
              max_output_tokens: 12000,
              messages: [
                { role: "system", content: SYNTHESIS_EDITORIAL_PROMPT },
                {
                  role: "user",
                  content: JSON.stringify({
                    draft,
                    brief,
                    taskSpec: writerInput.taskSpec,
                    confirmedRequirements,
                    evidence: sources,
                    sourceAvailability: packed.diagnostics,
                    decisionGaps,
                    unresolved,
                    inheritedOpenQuestions,
                    preserveCitationIds: validateEvidenceIds(
                      draft,
                      sources.map((row) => row.id),
                    ).referencedIds,
                  }),
                },
              ],
            },
            async (event) => {
              if (event.type === "response.output_text.delta")
                await output.append(event.delta);
            },
            signal,
            {
              purpose: "research.synthesize_editorial",
              declaredContextHash: researchVersion(sources),
            },
            { maxAttempts: 1 },
          );
          return {
            status: result.status,
            text: responseText(result),
            responseId: result.id,
          };
        },
        validateReport: (report, draft) => {
          validateEditorialReport(
            report,
            draft,
            sources.map((row) => row.id),
          );
        },
        phaseStarted: async (phase) => {
          const requiredCalls = { draft: 3, report: 2, metadata: 1 }[phase];
          const messages = {
            draft: "正在整理研究发现与依据",
            report: "研究材料已整理，正在编写完整报告",
            metadata: "报告已成文，正在整理摘要与交付内容",
          };
          await mutateTask(task.id, task.executionToken!, async (tx) => {
            const currentTask = await tx.researchTask.findUniqueOrThrow({
              where: { id: task.id },
            });
            const remainingCalls = Math.max(
              0,
              stageCallCeiling(
                currentTask.plan as unknown as ResearchPlan,
                stage.kind,
                "llm",
              ) - currentTask.llmCalls,
            );
            if (remainingCalls < requiredCalls)
              throw new ResearchError(
                "BUDGET_EXHAUSTED",
                `完成剩余成文步骤至少需要 ${requiredCalls} 次模型调用，当前可用 ${remainingCalls} 次。已完成内容保留；如需更多调用，请重新发起研究。`,
                409,
              );
            const currentStage = await tx.researchStage.findUniqueOrThrow({
              where: { id: stage.id },
            });
            await tx.researchStage.update({
              where: { id: stage.id },
              data: {
                result: researchJson({
                  ...((currentStage.result as object) ?? {}),
                  synthesisPhase: phase,
                }),
              },
            });
            await appendResearchEvent(tx, task.id, "stage.activity", {
              stageId: stage.id,
              attemptId: stage.attempt.id,
              phase,
              message: messages[phase],
            });
          });
          // Both calls stream real deltas. Switching phases replaces the buffer
          // so an analysis draft and its edited report never concatenate.
          if (phase !== "metadata") await output.replace("");
        },
        publishReport: (report) => output.replace(report),
        writeMetadata: async (report) => {
          const reportCitationIds = validateEvidenceIds(
            report,
            sources.map((row) => row.id),
          ).referencedIds;
          const result = await researchModelCall(
            stage.attempt.id,
            {
              max_output_tokens: 10000,
              messages: [
                { role: "system", content: SYNTHESIS_METADATA_PROMPT },
                {
                  role: "user",
                  content: JSON.stringify({
                    report,
                    confirmedRequirements,
                    evidenceIds: reportCitationIds,
                    readOriginalIds: readOriginalIds.filter((id) =>
                      reportCitationIds.includes(id),
                    ),
                    sourceRoles: sources
                      .filter((row) => reportCitationIds.includes(row.id))
                      .map((row) => ({
                        id: row.id,
                        contentHash: row.contentHash,
                        routing: row.routing,
                      })),
                    eligibleDirectEvidenceIds: sources
                      .filter(
                        (source) =>
                          reportCitationIds.includes(source.id) &&
                          readOriginalIds.includes(source.id) &&
                          (!semanticReview ||
                            decisionRoutes?.some(
                              (route) =>
                                route.evidenceId === source.id &&
                                route.contentHash === source.contentHash &&
                                route.decisionIds.length &&
                                [
                                  "product_identity",
                                  "task_observation",
                                  "constraint",
                                  "alternative",
                                ].includes(route.role),
                            )),
                      )
                      .map((row) => row.id),
                    decisionGaps,
                    inheritedOpenQuestions,
                  }),
                },
              ],
              response_format: {
                type: "json_schema",
                json_schema: {
                  name: "research_deliverables_v3",
                  strict: true,
                  schema: metadataSchema,
                },
              },
            },
            () => {},
            signal,
            {
              purpose: "research.synthesize_metadata",
              declaredContextHash: researchVersion(sources),
            },
            { maxAttempts: 1 },
          );
          return {
            status: result.status,
            text: responseText(result),
            responseId: result.id,
          };
        },
        validateMetadata: (value, report) => {
          const reportCitationIds = validateEvidenceIds(
            report,
            sources.map((row) => row.id),
          ).referencedIds;
          const errors = validateDeliverableEvidence(
            value,
            reportCitationIds,
            readOriginalIds.filter((id) => reportCitationIds.includes(id)),
          );
          errors.push(
            ...validateDecisionCards(value.decisionCards, sources, {
              decisionRoutes,
              requireDecisionRoutes: semanticReview,
              reportText: report,
            }),
          );
          if (errors.length)
            throw new ResearchError(
              "INVALID_DELIVERABLE_EVIDENCE",
              errors.slice(0, 4).join("；"),
              502,
            );
        },
        persist: async (checkpoint) => {
          await mutateTask(task.id, task.executionToken!, async (tx) => {
            const current = await tx.researchStage.findUniqueOrThrow({
              where: { id: stage.id },
            });
            await tx.researchStage.update({
              where: { id: stage.id },
              data: {
                result: researchJson({
                  ...((current.result as object) ?? {}),
                  synthesisCheckpoint: checkpoint,
                }),
              },
            });
            await appendResearchEvent(
              tx,
              task.id,
              "synthesis.checkpoint_saved",
              {
                stageId: stage.id,
                attemptId: stage.attempt.id,
                phase: checkpoint.metadata
                  ? "metadata"
                  : checkpoint.report
                    ? "report"
                    : "draft",
                inputHash,
                draftHash: checkpoint.draft.hash,
                reportHash: checkpoint.report?.hash ?? null,
              },
            );
          });
        },
        reused: async (phase, originAttemptId) => {
          await researchEvent(
            task.id,
            "stage.activity",
            {
              stageId: stage.id,
              attemptId: stage.attempt.id,
              phase,
              originAttemptId,
              message: {
                draft: "已恢复完成的研究草稿，继续成文",
                report: "已恢复完成的最终报告，继续整理交付",
                metadata: "已恢复报告交付数据，继续保存产物",
              }[phase],
            },
            task.executionToken!,
          );
        },
      });
      metadata = resumed.metadata;
      synthesisCheckpoint = resumed.checkpoint;
    }
    const openQuestions = mergeOpenResearchQuestions(
      inheritedOpenQuestions,
      unresolved,
      metadata.finalBrief.openQuestions,
    );
    if (openQuestions.length > 20)
      throw new ResearchError(
        "OPEN_QUESTIONS_LIMIT",
        "未解决问题超过交接包容量；正文已保留，需要整理问题范围，程序未删除既有未知项",
        422,
      );
    metadata.finalBrief.openQuestions = openQuestions;
    const reportReadIds = new Set(readiness.readSourceIds);
    const quality = assessResearchQuality({
      evidence: packed.loadedEvidence.filter((row) =>
        reportReadIds.has(row.id),
      ),
      brief,
      reportText: output.text,
      allowedEvidenceIds: sources.map((row) => row.id),
      unresolvedQuestions: unresolved,
      executionCompleted: true,
      decisionRoutes: decisionRoutes?.filter((route) =>
        reportReadIds.has(route.evidenceId),
      ),
      requireDecisionRoutes: semanticReview,
    });
    const addIssue = (code: string, message: string) => {
      quality.issues.push({ code, severity: "warning", message });
      if (quality.status === "supported") {
        quality.status = "draft";
        quality.evidenceStatus = "draft";
        quality.label = "研究草稿，存在待核验项";
      }
    };
    if (
      !metadata.competitors.some(
        (row) => row.kind === "sku" && row.status === "observed",
      )
    )
      addIssue(
        "NO_OBSERVED_SKU",
        "当前竞品材料仍是候选或替代路径清单，尚无带来源的具体型号比较。",
      );
    if (metadata.finalBrief.alternatives.length < 2)
      addIssue(
        "ALTERNATIVE_COMPARISON_MISSING",
        "尚未形成两条可比较的设计路径，不能据此认定唯一方案最优。",
      );
    if (metadata.finalBrief.openQuestions.length)
      addIssue(
        "OPEN_DESIGN_QUESTIONS",
        `${metadata.finalBrief.openQuestions.length} 项设计问题仍待回答。`,
      );
    metadata.caveats = [
      ...new Set([
        ...metadata.caveats,
        ...quality.issues.map((issue) => issue.message),
        "自动材料门槛与引用存在性检查不能代替事实核验、用户研究和工程测试。",
      ]),
    ];
    const citations = validateEvidenceIds(
      output.text,
      sources.map((row) => row.id),
    );
    const actualIds = [
      ...new Set([
        ...citations.referencedIds,
        ...metadata.competitors.flatMap((row) => row.evidenceIds),
        ...metadata.hypotheses.flatMap((row) => row.evidenceIds),
        ...metadata.finalBrief.alternatives.flatMap((row) => row.evidenceIds),
        ...metadata.decisionCards.flatMap((row) => row.evidenceIds),
      ]),
    ];
    const cited = new Set(citations.referencedIds);
    const sourceIndex = sources
      .filter((source) => cited.has(source.id))
      .map(
        (source) =>
          `- [${source.id}] ${source.title} | ${source.url.startsWith("attachment:") ? "用户提供附件" : source.url} | ${source.status}（本轮阅读片段，完整可用性见上下文清单）`,
      )
      .join("\n");
    await output.replace(
      `> 当前质量：${quality.label}\n\n${output.text}${sourceIndex ? `\n\n## 本报告实际引用的来源\n\n${sourceIndex}` : ""}`,
    );
    const finalPackage = createFinalResearchPackage({
      taskId: task.id,
      briefId: task.briefId,
      stageId: stage.id,
      attemptId: stage.attempt.id,
      report: output.text,
      metadata,
      confirmedRequirements,
      quality,
      evidenceManifest: packed.manifest,
      evidence: sources,
      generatedAt: new Date().toISOString(),
      decisionGaps,
      decisionRoutes,
      decisionCards: metadata.decisionCards,
    });
    if (!readFinalResearchPackage(finalPackage))
      throw new ResearchError(
        "FINAL_PACKAGE_INVALID",
        "终稿交接包未通过完整结构校验，正文已保留，未交付提案",
        502,
      );
    const artifactFiles: Parameters<
      typeof saveResearchArtifactBatch
    >[0]["files"] = [];
    const save = (
      filename: string,
      title: string,
      kind: string,
      data: string,
      evidenceIds: string[] = [],
    ) => {
      artifactFiles.push({
        filename: `${stage.attempt.ordinal}-${filename}`,
        title,
        kind,
        data: Buffer.from(data, "utf8"),
        evidenceIds,
      });
    };
    await save(
      "report.md",
      quality.status === "supported"
        ? "研究报告（待人工核验）"
        : "研究草稿与证据缺口",
      "report",
      output.text,
      citations.referencedIds,
    );
    const briefText = finalBriefMarkdown(
      finalPackage.finalBrief,
      metadata.hypotheses,
      metadata.caveats,
    );
    await save(
      "brief.md",
      "设计 brief（含假设与验收标准）",
      "brief",
      briefText,
      actualIds,
    );
    await save(
      "competitors.csv",
      "竞品及待核查候选清单",
      "competitors",
      csvResearchTable(metadata.competitors),
      metadata.competitors.flatMap((row) => row.evidenceIds),
    );
    await save(
      "final-research-package.json",
      "终稿交接包与上下文清单",
      "research_package",
      JSON.stringify(finalPackage, null, 2),
      actualIds,
    );
    const products = (task.plan as unknown as ResearchPlan).products;
    if (products.includes("board")) {
      const cards = [];
      let imageCount = 0;
      // The archive remains available in the Evidence tab. The reading board
      // shows material actually used by this report, rather than every search hit.
      const boardRows = evidence.filter((row) =>
        sources.some((source) => source.id === row.id),
      );
      for (const row of boardRows) {
        const assessment = assessCandidate(
          { url: row.originalUrl, title: row.title, excerpt: row.excerpt },
          brief,
        );
        let image = "";
        if (
          assessment.decision !== "reject" &&
          row.screenshotKey &&
          !row.purgedAt &&
          imageCount < 8
        ) {
          try {
            image = `<img src="data:image/png;base64,${(await readResearchFile(row.screenshotKey)).toString("base64")}" alt="${escapeHtml(row.title)}网页留档截图" loading="lazy"/>`;
            imageCount++;
          } catch {
            /* retain metadata without inventing a screenshot */
          }
        }
        const manifest = packed.manifest.sources.find(
          (item) => item.evidenceId === row.id,
        );
        const safeUrl = /^https?:\/\//i.test(row.originalUrl)
          ? row.originalUrl
          : "";
        cards.push(
          `<article>${image}<h2>${escapeHtml(row.title)}</h2><p>${escapeHtml(row.excerpt.slice(0, 480))}</p><p>${escapeHtml(row.id)} · ${escapeHtml(row.status)} · ${escapeHtml(assessment.decision)}</p><p>${escapeHtml(manifest?.omittedReason ?? "本轮有阅读片段")}</p>${safeUrl ? `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">原始来源</a>` : "用户附件"}</article>`,
        );
      }
      await save(
        "board.html",
        "网页留档（尚未完成视觉分析）",
        "board",
        `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; connect-src 'none'"><title>网页留档</title><style>body{font:14px/1.7 system-ui;margin:24px;color:#222;background:#f8f9fa}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}article{min-width:0;border:1px solid #dde3df;border-radius:12px;padding:18px;background:white}img{display:block;width:100%;height:220px;object-fit:contain}h2{font-size:16px}p,a{overflow-wrap:anywhere}</style></head><body><h1>网页留档与待筛选素材</h1><p>这是来源归档。筛选分数仅用于资料分流，未做自动图片理解；本页不代表设计方向板或已验证视觉研究。只展示部分相关候选的已有截图，未读、失败和未入上下文的状态分开保留。</p><main>${cards.join("")}</main></body></html>`,
        boardRows.map((row) => row.id),
      );
    }
    const stageResult = {
      brief: briefText,
      competitors: metadata.competitors,
      evidenceIds: actualIds,
      quality,
      contextManifest: packed.manifest,
      finalResearchPackage: finalPackage,
      ...(synthesisCheckpoint ? { synthesisCheckpoint } : {}),
      unresolved,
      decisionGaps,
      ...(decisionRoutes ? { decisionRoutes } : {}),
      decisionCards: metadata.decisionCards,
    };
    await saveResearchArtifactBatch(
      {
        taskId: task.id,
        executionToken: task.executionToken!,
        files: artifactFiles,
      },
      async (tx) => {
        const current = await tx.researchStage.findUniqueOrThrow({
          where: { id: stage.id },
        });
        if (
          current.taskId !== task.id ||
          current.status !== "running" ||
          current.activeAttemptId !== stage.attempt.id
        )
          throw new ResearchError(
            "TASK_STOPPED",
            "本次阶段执行权已变更，产物未发布",
            409,
          );
        await tx.researchAttempt.update({
          where: { id: stage.attempt.id },
          data: { status: "completed", finishedAt: new Date() },
        });
        await tx.researchStage.update({
          where: { id: stage.id },
          data: { status: "completed", result: researchJson(stageResult) },
        });
        await appendResearchEvent(tx, task.id, "stage.completed", {
          stageId: stage.id,
          attemptId: stage.attempt.id,
        });
        const remaining = await tx.researchStage.count({
          where: { taskId: task.id, status: { not: "completed" } },
        });
        if (remaining === 0)
          await completeResearchTaskInTransaction(tx, task, brief);
      },
    );
    return stageResult;
  } finally {
    await output.flush().catch(() => {});
  }
}

export async function executeResearchTask(
  task: ResearchTask,
  abort: AbortController,
) {
  const config = task.configSnapshot as unknown as ResearchConfig;
  let brief = (
    await db.researchBrief.findUniqueOrThrow({ where: { id: task.briefId } })
  ).content as unknown as ResearchBriefInput;
  let active: Stage | null = null;
  let heartbeatJob: Promise<void> | null = null;
  const heartbeat = setInterval(() => {
    // A slow database must not accumulate overlapping lease writes. Retain the
    // one pending write so shutdown can await it before disconnecting Prisma.
    if (heartbeatJob || abort.signal.aborted) return;
    heartbeatJob = db.researchTask
      .updateMany({
        where: {
          id: task.id,
          status: "running",
          executionToken: task.executionToken,
        },
        data: { heartbeatAt: new Date() },
      })
      .then((result) => {
        if (!result.count) abort.abort();
      })
      .catch(() => abort.abort())
      .finally(() => {
        heartbeatJob = null;
      });
  }, 4000);
  const deadline = setTimeout(
    () =>
      abort.abort(
        new ResearchError("BUDGET_EXHAUSTED", "研究任务达到执行时限", 409),
      ),
    Math.max(1, task.deadlineAt!.getTime() - Date.now()),
  );
  try {
    abort.signal.throwIfAborted();
    // Intake confirms the brief with one model call. Uploaded files/links stay
    // unread until the user explicitly starts the separate research task.
    if (!task.sourceTaskId && task.preset !== "intake")
      brief = await prepareResearchInputs(task, brief, config, abort.signal);
    const stages = await db.researchStage.findMany({
      where: { taskId: task.id },
      orderBy: { ordinal: "asc" },
    });
    for (const stage of stages) {
      if (stage.status === "completed") continue;
      abort.signal.throwIfAborted();
      active = await startStage(task, stage);
      const result =
        stage.kind === "intake"
          ? await runResearchIntake(
              task,
              active.attempt.id,
              brief,
              abort.signal,
            )
          : stage.engine === "vane"
            ? await runVane(task, active, brief, config, abort.signal)
            : ["gpt-researcher", "deerflow"].includes(stage.engine)
              ? await runEngine(task, active, brief, config, abort.signal)
              : stage.kind === "capture"
                ? await capture(task, active, brief, abort.signal)
                : stage.kind === "verify"
                  ? await verify(task, active, brief, abort.signal)
                  : await synthesize(task, active, brief, abort.signal);
      // Synthesis publishes its bundle and completion atomically. Other
      // stages retain the existing completion path.
      if (!(stage.kind === "synthesize" && stage.engine === "chugao")) {
        await mutateTask(task.id, task.executionToken!, async (tx) => {
          await tx.researchAttempt.update({
            where: { id: active!.attempt.id },
            data: { status: "completed", finishedAt: new Date() },
          });
          await tx.researchStage.update({
            where: { id: stage.id },
            data: { status: "completed", result: researchJson(result) },
          });
          await appendResearchEvent(tx, task.id, "stage.completed", {
            stageId: stage.id,
            attemptId: active!.attempt.id,
          });
          if (stage.kind === "intake") {
            const intake = result as Awaited<
              ReturnType<typeof runResearchIntake>
            >;
            await tx.researchStage.update({
              where: { id: stage.id },
              data: { text: intake.reply },
            });
            await tx.researchProject.update({
              where: { id: task.projectId },
              data: { title: intake.brief.question.slice(0, 80) },
            });
          }
          const remaining = await tx.researchStage.count({
            where: { taskId: task.id, status: { not: "completed" } },
          });
          if (remaining === 0)
            await completeResearchTaskInTransaction(tx, task, brief);
        });
      }
      active = null;
    }
    const committed = await db.researchTask.findUniqueOrThrow({
      where: { id: task.id },
    });
    if (committed.status === "completed") return;
    await mutateTask(task.id, task.executionToken!, async (tx) => {
      await completeResearchTaskInTransaction(tx, task, brief);
    });
  } catch (caught) {
    const error =
      abort.signal.aborted && abort.signal.reason instanceof ResearchError
        ? abort.signal.reason
        : caught;
    const code = error instanceof ResearchError ? error.code : "ENGINE_FAILED";
    const interrupted = code === "WORKER_INTERRUPTED";
    if (!(error instanceof ResearchError))
      console.error("Research component failure", {
        taskId: task.id,
        stageId: active?.id,
        detail:
          error instanceof Error
            ? `${error.name}: ${error.message}`.slice(0, 500)
            : "Unknown error",
        cause:
          error instanceof Error &&
          error.cause &&
          typeof error.cause === "object" &&
          "code" in error.cause
            ? String(error.cause.code)
            : undefined,
      });
    const message =
      error instanceof ResearchError
        ? error.message
        : "研究阶段执行失败，已有资料和结果已保存";
    await mutateTask(task.id, task.executionToken!, async (tx) => {
      if (active) {
        await tx.researchAttempt.updateMany({
          where: { id: active.attempt.id, status: "running" },
          data: {
            status: interrupted ? "interrupted" : "failed",
            error: { code, message },
            finishedAt: new Date(),
          },
        });
        await tx.researchStage.updateMany({
          // A lost acknowledgement can follow a committed publication. Never
          // demote a completed stage while recording the execution error.
          where: { id: active.id, status: { not: "completed" } },
          data: { status: interrupted ? "interrupted" : "failed" },
        });
      }
      await tx.researchTask.update({
        where: { id: task.id },
        data: {
          status: interrupted
            ? "interrupted"
            : code === "BUDGET_EXHAUSTED"
              ? "budget_exhausted"
              : "failed",
          finishedAt: new Date(),
          executionToken: null,
          error: { code, message },
          expiresAt: new Date(Date.now() + config.retentionDays * 86400000),
        },
      });
      await expireResearchAssets(tx, task.id, researchExpiry(config));
      if (interrupted)
        await tx.researchCall.updateMany({
          where: { taskId: task.id, status: "running" },
          data: {
            status: "unknown",
            finishedAt: new Date(),
            errorCode: "EXECUTION_UNKNOWN",
          },
        });
      await appendResearchEvent(
        tx,
        task.id,
        interrupted ? "task.interrupted" : "task.failed",
        { code, message, stageId: active?.id },
      );
    }).catch(() => {});
  } finally {
    clearInterval(heartbeat);
    clearTimeout(deadline);
    await heartbeatJob;
  }
}

export async function recoverResearchTasks() {
  const stale = await db.researchTask.findMany({
    where: {
      status: "running",
      heartbeatAt: { lt: new Date(Date.now() - 60000) },
    },
    take: 20,
  });
  for (const task of stale)
    await mutateTask(task.id, task.executionToken!, async (tx) => {
      const current = await tx.researchTask.findUniqueOrThrow({
        where: { id: task.id },
      });
      if (
        current.heartbeatAt &&
        current.heartbeatAt.getTime() >= Date.now() - 60000
      )
        return;
      await tx.researchTask.update({
        where: { id: task.id },
        data: {
          status: "interrupted",
          executionToken: null,
          finishedAt: new Date(),
          expiresAt: researchExpiry(current.configSnapshot),
          error: {
            code: "WORKER_INTERRUPTED",
            message: "执行进程已中断，已有结果已保留，可重试中断的阶段",
          },
        },
      });
      await expireResearchAssets(
        tx,
        task.id,
        researchExpiry(current.configSnapshot),
      );
      await tx.researchStage.updateMany({
        where: { taskId: task.id, status: "running" },
        data: { status: "interrupted" },
      });
      await tx.researchAttempt.updateMany({
        where: { stage: { taskId: task.id }, status: "running" },
        data: { status: "interrupted", finishedAt: new Date() },
      });
      await tx.researchCall.updateMany({
        where: { taskId: task.id, status: "running" },
        data: {
          status: "unknown",
          finishedAt: new Date(),
          errorCode: "EXECUTION_UNKNOWN",
        },
      });
      await appendResearchEvent(tx, task.id, "task.interrupted", {});
    }).catch(() => {});
}

export async function claimResearchTask(lane?: ResearchTaskLane) {
  const config = await getResearchConfig();
  if (!config.enabled) return null;
  return db.$transaction(async (tx) => {
    const [{ acquired }] = await tx.$queryRaw<
      Array<{ acquired: boolean }>
    >`SELECT pg_try_advisory_xact_lock(827364019) AS acquired`;
    if (!acquired) return null;
    const available: Prisma.ResearchTaskWhereInput[] = [];
    for (const candidate of lane ? [lane] : ["research", "intake"]) {
      const filter =
        candidate === "intake"
          ? { preset: "intake" }
          : { preset: { not: "intake" } };
      if (
        !(await tx.researchTask.count({
          where: { status: "running", ...filter },
        }))
      )
        available.push(filter);
    }
    if (!available.length) return null;
    const next = await tx.researchTask.findFirst({
      where: { status: "queued", OR: available },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    if (!next) return null;
    const plan = next.plan as unknown as ResearchPlan;
    const claimed = await tx.researchTask.updateMany({
      where: { id: next.id, status: "queued" },
      data: {
        status: "running",
        executionToken: randomUUID(),
        heartbeatAt: new Date(),
        startedAt: next.startedAt ?? new Date(),
        deadlineAt:
          next.deadlineAt ?? new Date(Date.now() + plan.limits.minutes * 60000),
      },
    });
    return claimed.count
      ? tx.researchTask.findUnique({ where: { id: next.id } })
      : null;
  });
}

export async function startResearchWorker(signal: AbortSignal) {
  if (signal.aborted) return;
  const instanceId = randomUUID();
  const pulse = async () => {
    const value = {
      at: new Date().toISOString(),
      instanceId,
      protocol: 1,
      lanes: { research: 1, intake: 1 },
    };
    await db.systemConfig.upsert({
      where: { key: "research.worker.heartbeat" },
      create: { key: "research.worker.heartbeat", value },
      update: { value },
    });
  };
  let lastCleanup = 0;
  const maintain = async () => {
    if (Date.now() - lastCleanup > 3600000) {
      await cleanupResearchFiles();
      lastCleanup = Date.now();
    }
    await recoverResearchTasks();
  };
  try {
    await runResearchWorkerLanes(signal, {
      claim: claimResearchTask,
      execute: executeResearchTask,
      maintain,
      heartbeat: pulse,
      interruptionReason: new ResearchError(
        "WORKER_INTERRUPTED",
        "执行进程正在退出，已有结果已保留，可明确重试中断的阶段",
        409,
      ),
    });
  } finally {
    // Do not erase another process's later heartbeat between a read and delete.
    await db.systemConfig.deleteMany({
      where: {
        key: "research.worker.heartbeat",
        value: { path: ["instanceId"], equals: instanceId },
      },
    });
  }
}

