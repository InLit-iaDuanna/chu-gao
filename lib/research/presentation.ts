import {
  STATUS_LABELS,
  STAGE_LABELS,
  type ResearchArtifactView,
  type ResearchTaskView,
} from "./types";
// This module runs in the browser. The decision validator also uses node:crypto,
// so only its erased types may cross this boundary.
import type { DecisionCard, DecisionGap } from "./decision-evidence";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function synthesisPhase(value: unknown) {
  return value === "draft" || value === "report" || value === "metadata"
    ? value
    : null;
}

/** Presentation-only allowlist; never interpret checkpoint content in the browser. */
export function researchSynthesisPhaseLabel(
  stage:
    | Pick<ResearchTaskView["stages"][number], "kind" | "status" | "result">
    | null
    | undefined,
) {
  if (stage?.kind !== "synthesize" || stage.status !== "running") return null;
  const phase = synthesisPhase(record(stage.result)?.synthesisPhase);
  if (!phase) return null;
  return {
    draft: "正在整理研究发现与依据",
    report: "研究材料已整理，正在编写完整报告",
    metadata: "报告已成文，正在整理摘要与交付内容",
  }[phase];
}

function clearSynthesisPhase(value: unknown) {
  const result = record(value);
  if (!result || !("synthesisPhase" in result)) return value;
  const next = { ...result };
  delete next.synthesisPhase;
  return next;
}

export type ResearchDecisionGap = Pick<
  DecisionGap,
  | "id"
  | "decision"
  | "acquisitionStatus"
  | "status"
  | "finding"
  | "implication"
  | "nextCheck"
  | "changeCondition"
> & { evidenceIds: string[] };

export interface ResearchDecisionPresentation {
  cards: DecisionCard[];
  gaps: ResearchDecisionGap[];
  version: string | null;
}

function nonemptyText(value: unknown, max: number): value is string {
  return (
    typeof value === "string" && value.trim().length >= 2 && value.length <= max
  );
}

function sourceIds(value: unknown): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.filter(
            (id): id is string =>
              typeof id === "string" && !!id.trim() && id.length <= 100,
          ),
        ),
      ].slice(0, 12)
    : [];
}

function decisionCards(value: unknown, knownIds: Set<string>): DecisionCard[] {
  if (!Array.isArray(value)) return [];
  const cards: DecisionCard[] = [];
  const ids = new Set<string>();
  for (const item of value.slice(0, 6)) {
    const row = record(item);
    if (
      !row ||
      typeof row.id !== "string" ||
      !row.id.trim() ||
      row.id.length > 80 ||
      ids.has(row.id) ||
      !nonemptyText(row.title, 120) ||
      ![
        "finding",
        "interpretation",
        "action",
        "tradeoff",
        "nextTest",
        "changeCondition",
      ].every((key) => nonemptyText(row[key], 900)) ||
      !["evidence_informed", "hypothesis", "unknown"].includes(
        String(row.status),
      )
    )
      continue;
    const evidenceIds = sourceIds(row.evidenceIds);
    ids.add(row.id);
    cards.push({
      id: row.id,
      title: row.title,
      finding: row.finding as string,
      interpretation: row.interpretation as string,
      action: row.action as string,
      tradeoff: row.tradeoff as string,
      nextTest: row.nextTest as string,
      changeCondition: row.changeCondition as string,
      // A legacy/malformed packet may outlive its source records. Keep its text
      // inspectable without presenting a missing link as an available basis.
      status:
        row.status === "evidence_informed" &&
        !evidenceIds.some((id) => knownIds.has(id))
          ? "unknown"
          : (row.status as DecisionCard["status"]),
      evidenceIds,
    });
  }
  return cards;
}

function decisionGaps(value: unknown): ResearchDecisionGap[] {
  if (!Array.isArray(value)) return [];
  const gaps: ResearchDecisionGap[] = [];
  const ids = new Set<string>();
  for (const item of value.slice(0, 40)) {
    const row = record(item);
    if (
      !row ||
      typeof row.id !== "string" ||
      !row.id.trim() ||
      row.id.length > 100 ||
      ids.has(row.id) ||
      !nonemptyText(row.decision, 1000) ||
      !["insufficient", "conflicting"].includes(String(row.status))
    )
      continue;
    ids.add(row.id);
    const text = (key: string, max = 1000) =>
      typeof row[key] === "string" ? row[key].slice(0, max) : "";
    gaps.push({
      id: row.id,
      decision: row.decision,
      status: row.status as ResearchDecisionGap["status"],
      acquisitionStatus: [
        "not_searched",
        "searched",
        "read",
        "unavailable",
      ].includes(String(row.acquisitionStatus))
        ? (row.acquisitionStatus as ResearchDecisionGap["acquisitionStatus"])
        : "not_searched",
      finding: text("finding", 2000),
      implication: text("implication"),
      nextCheck: text("nextCheck"),
      changeCondition: text("changeCondition"),
      evidenceIds: sourceIds(
        Array.isArray(row.citations)
          ? row.citations.map((citation) => record(citation)?.evidenceId)
          : [],
      ),
    });
  }
  return gaps;
}

/** Display persisted judgments without importing server validation or inventing
 * cards for an older report. An available final packet is authoritative, even
 * when its optional card list is absent or empty. */
export function researchDecisions(
  task: Pick<ResearchTaskView, "stages" | "evidence">,
): ResearchDecisionPresentation {
  const knownIds = new Set(task.evidence.map((source) => source.id));
  for (const kind of ["synthesize", "produce"]) {
    for (const stage of [...task.stages]
      .reverse()
      .filter((row) => row.kind === kind && row.status === "completed")) {
      const packet = record(record(stage.result)?.finalResearchPackage);
      if (packet?.schemaVersion !== 2) continue;
      return {
        cards: decisionCards(packet.decisionCards, knownIds),
        gaps: decisionGaps(packet.decisionGaps),
        version: typeof packet.version === "string" ? packet.version : null,
      };
    }
  }
  // While final synthesis has not completed, a completed review can already
  // expose its unresolved questions. Old text-only results keep the old view.
  const review = [...task.stages]
    .reverse()
    .find((stage) => stage.kind === "verify" && stage.status === "completed");
  return {
    cards: [],
    gaps: decisionGaps(record(review?.result)?.decisionGaps),
    version: null,
  };
}

export function researchDecisionLabel(status: DecisionCard["status"]) {
  return {
    evidence_informed: "材料启发的方向",
    hypothesis: "设计假设",
    unknown: "依据待核对",
  }[status];
}

export function researchDecisionGapLabel(
  gap: Pick<ResearchDecisionGap, "status" | "acquisitionStatus">,
) {
  const acquisition = {
    not_searched: "尚未检索",
    searched: "已检索",
    read: "已读材料",
    unavailable: "材料暂不可用",
  }[gap.acquisitionStatus];
  const status = {
    insufficient: "证据不足",
    conflicting: "材料存在冲突",
    supported: "材料支持（模型判断）",
    contradicted: "材料反驳（模型判断）",
  }[gap.status];
  return `${status} · ${acquisition}`;
}

export type ResearchQualityStatus = "draft" | "insufficient" | "supported";
export interface ResearchQualityPresentation {
  status: ResearchQualityStatus;
  issues: Array<{ code: string; severity: string; message: string }>;
}

// Old task records do not have a quality verdict. Execution success must never
// be used as a substitute, including when an old task has many output files.
export function researchQuality(task: Pick<ResearchTaskView, "stages">) {
  const stages = [...task.stages].reverse();
  for (const kind of ["synthesize", "produce", "verify"]) {
    for (const stage of stages.filter(
      (item) => item.kind === kind && item.status === "completed",
    )) {
      const value = record(record(stage.result)?.quality);
      if (
        value?.schemaVersion !== 1 ||
        !["draft", "insufficient", "supported"].includes(String(value.status))
      )
        continue;
      return {
        status: value.status as ResearchQualityStatus,
        issues: Array.isArray(value.issues)
          ? value.issues.flatMap((issue) => {
              const row = record(issue);
              return row && typeof row.message === "string"
                ? [
                    {
                      code: typeof row.code === "string" ? row.code : "",
                      severity:
                        typeof row.severity === "string"
                          ? row.severity
                          : "warning",
                      message: row.message,
                    },
                  ]
                : [];
            })
          : [],
      } satisfies ResearchQualityPresentation;
    }
  }
  return null;
}

export function researchQualityLabel(status: ResearchQualityStatus | null) {
  switch (status) {
    case "supported":
      return "自动材料门槛满足，结论仍需核验";
    case "draft":
      return "研究草稿 · 待补证";
    case "insufficient":
      return "证据不足 · 尚不能支撑研究结论";
    default:
      return "质量未评估";
  }
}

export function researchExecutionLabel(status: string) {
  return status === "completed" ? "执行完成" : STATUS_LABELS[status] || status;
}

export interface ResearchContextSource {
  evidenceId: string;
  capturedChars: number | null;
  includedChars: number;
  truncated: boolean;
  omittedReason: string | null;
  availability: string | null;
}

export function researchContextManifest(
  task: Pick<ResearchTaskView, "stages">,
) {
  for (const stage of [...task.stages].reverse()) {
    const value = record(record(stage.result)?.contextManifest);
    if (value?.schemaVersion !== 1 || !Array.isArray(value.sources)) continue;
    const sources = new Map<string, ResearchContextSource>();
    for (const source of value.sources) {
      const row = record(source);
      if (
        !row ||
        typeof row.evidenceId !== "string" ||
        typeof row.includedChars !== "number" ||
        !Number.isSafeInteger(row.includedChars) ||
        row.includedChars < 0 ||
        !(
          row.capturedChars === null ||
          (typeof row.capturedChars === "number" &&
            Number.isSafeInteger(row.capturedChars) &&
            row.capturedChars >= 0)
        )
      )
        continue;
      sources.set(row.evidenceId, {
        evidenceId: row.evidenceId,
        capturedChars: row.capturedChars,
        includedChars: row.includedChars,
        truncated: row.truncated === true,
        omittedReason:
          typeof row.omittedReason === "string" ? row.omittedReason : null,
        availability:
          typeof row.availability === "string" ? row.availability : null,
      });
    }
    return { stageKind: stage.kind, sources };
  }
  return null;
}

export function researchContextLabel(source: ResearchContextSource) {
  const captured =
    source.capturedChars === null
      ? "原文长度未知"
      : `留档正文 ${source.capturedChars.toLocaleString("zh-CN")} 字符`;
  if (source.includedChars > 0)
    return `${captured} · 纳入 ${source.includedChars.toLocaleString("zh-CN")} 字符${source.truncated ? "（节选）" : ""}`;
  const reason: Record<string, string> = {
    budget: "上下文预算不足",
    low_relevance: "相关性不足",
    fetch_failed: "采集失败",
    not_fetched: "尚未采集原文",
    purged: "留档已清理",
    unavailable: "原文暂不可用",
    captured_empty: "采集到的正文为空",
    pending_decision_route: "尚未确认对应的设计问题",
  };
  const detail = source.omittedReason && reason[source.omittedReason];
  return `${captured} · 本阶段未纳入正文${detail ? `（${detail}）` : ""}`;
}

export function researchArtifactLabel(
  file: Pick<ResearchArtifactView, "kind" | "title">,
) {
  return file.kind === "board" ? "网页留档 / 视觉资料" : file.title;
}

export function researchElapsed(createdAt: string, end: number) {
  const start = Date.parse(createdAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "—";
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} 分 ${seconds % 60} 秒`;
}

export interface ResearchStreamEvent {
  seq: number;
  type: string;
  payload: Record<string, unknown>;
}

export function parseResearchEvent(value: unknown): ResearchStreamEvent | null {
  const event = record(value);
  if (
    !event ||
    typeof event.seq !== "number" ||
    !Number.isSafeInteger(event.seq) ||
    event.seq < 1 ||
    typeof event.type !== "string" ||
    !record(event.payload)
  )
    return null;
  return { seq: event.seq, type: event.type, payload: record(event.payload)! };
}

// The database snapshot includes text through nextSeq. Apply only a contiguous
// suffix and request a fresh snapshot on gaps; never concatenate across attempts.
export function applyResearchEvent(
  view: ResearchTaskView,
  event: ResearchStreamEvent,
) {
  if (event.seq <= view.nextSeq)
    return { view, needsSnapshot: false, applied: false };
  if (event.seq !== view.nextSeq + 1)
    return { view, needsSnapshot: true, applied: false };
  const next = { ...view, nextSeq: event.seq };
  if (event.type === "call.started") {
    const kind = event.payload.kind;
    if (kind === "llm") next.llmCalls++;
    if (kind === "search") next.searchCalls++;
    if (kind === "crawl") next.crawlCalls++;
    return { view: next, needsSnapshot: false, applied: true };
  }
  const stageId = event.payload.stageId;
  const stage = view.stages.find((row) => row.id === stageId);
  const attemptId = event.payload.attemptId;
  if (["stage.started", "stage.retry_queued"].includes(event.type)) {
    if (!stage || typeof attemptId !== "string")
      return { view: next, needsSnapshot: true, applied: false };
    const running = event.type === "stage.started";
    next.status = running ? "running" : "queued";
    next.stages = view.stages.map((row) =>
      row.id === stageId
        ? {
            ...row,
            status: running ? "running" : "pending",
            activeAttemptId: attemptId,
            text: "",
            result:
              row.kind === "synthesize"
                ? clearSynthesisPhase(row.result)
                : row.result,
          }
        : row,
    );
    return { view: next, needsSnapshot: true, applied: true };
  }
  if (event.type === "stage.activity") {
    if (!stage || typeof attemptId !== "string" || stage.status !== "running")
      return { view, needsSnapshot: true, applied: false };
    if (attemptId !== stage.activeAttemptId)
      return { view: next, needsSnapshot: true, applied: false };
    if (stage.kind === "synthesize" && event.payload.phase !== undefined) {
      const phase = synthesisPhase(event.payload.phase);
      if (!phase) return { view: next, needsSnapshot: false, applied: false };
      next.stages = view.stages.map((row) =>
        row.id === stageId
          ? {
              ...row,
              result: {
                ...(record(row.result) ?? {}),
                synthesisPhase: phase,
              },
            }
          : row,
      );
    }
    return { view: next, needsSnapshot: false, applied: true };
  }
  if (event.type === "stage.text") {
    // Legacy events without identity are recoverable from persisted snapshots.
    // Guessing an attempt would risk reviving a cancelled attempt's output.
    if (!stage || typeof attemptId !== "string" || stage.status !== "running")
      return { view, needsSnapshot: true, applied: false };
    if (attemptId !== stage.activeAttemptId)
      return { view: next, needsSnapshot: true, applied: false };
    const replacement = event.payload.text;
    const delta = event.payload.delta;
    if (typeof replacement !== "string" && typeof delta !== "string")
      return { view, needsSnapshot: true, applied: false };
    next.stages = view.stages.map((row) =>
      row.id === stageId
        ? {
            ...row,
            text:
              typeof replacement === "string" ? replacement : row.text + delta,
          }
        : row,
    );
    return { view: next, needsSnapshot: false, applied: true };
  }
  if (event.type === "stage.completed") {
    if (
      !stage ||
      typeof attemptId !== "string" ||
      attemptId !== stage.activeAttemptId
    )
      return { view: next, needsSnapshot: true, applied: false };
    next.stages = view.stages.map((row) =>
      row.id === stageId ? { ...row, status: "completed" } : row,
    );
    return { view: next, needsSnapshot: true, applied: true };
  }
  const terminal: Record<string, string> = {
    "task.completed": "completed",
    "task.failed": "failed",
    "task.cancelled": "cancelled",
  };
  if (terminal[event.type]) next.status = terminal[event.type];
  return {
    view: next,
    needsSnapshot: !["stage.activity", "call.started"].includes(event.type),
    applied: true,
  };
}

export function researchActivityMessage(event: ResearchStreamEvent) {
  if (event.type === "task.completed")
    return "任务执行完成，研究质量见报告标记";
  if (typeof event.payload.message === "string") return event.payload.message;
  if (typeof event.payload.title === "string") return event.payload.title;
  if (event.type === "call.started") {
    const calls: Record<string, string> = {
      llm: "模型请求已开始，等待返回",
      search: "搜索请求已开始，等待候选来源",
      crawl: "正在读取网页资料",
      embed: "正在建立资料索引",
    };
    return calls[String(event.payload.kind)] || "工具请求已开始，等待返回";
  }
  const labels: Record<string, string> = {
    "stage.started": `开始${STAGE_LABELS[String(event.payload.kind)] || "研究"}`,
    "stage.retry_queued": "已排队继续未完成的阶段",
    "stage.completed": "阶段执行完成",
    "call.completed": "模型调用已完成",
    "call.retrying": "正在重试当前调用",
    "evidence.captured": "网页资料已留档",
    "task.failed": "任务执行失败，已有材料已保留",
    "task.cancelled": "任务已取消",
  };
  if (event.type === "search.completed")
    return `搜索完成，找到 ${typeof event.payload.count === "number" ? event.payload.count : "若干"} 个候选来源`;
  return labels[event.type] ?? null;
}

