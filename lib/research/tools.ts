import {
  activeResearchAttempt,
  waitForResearchCall,
  finishResearchCall,
} from "./budget";
import {
  readResearchFile,
  saveResearchSource,
  canonicalResearchUrl,
} from "./storage";
import { db } from "@/lib/db";
import { researchEvent } from "./service";
import { ResearchError } from "./errors";
import { assessCandidate, normalizeResearchSearchQuery } from "./quality";
import { RESEARCH_QUALITY_VERSION } from "./workflow-quality";
import type { ResearchBriefInput } from "./types";

export async function researchTool(
  attemptId: string,
  kind: "search" | "crawl" | "embed",
  input: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const active = await activeResearchAttempt(attemptId);
  const brief = (
    await db.researchBrief.findUniqueOrThrow({
      where: { id: active.stage.task.briefId },
    })
  ).content as unknown as ResearchBriefInput;
  const requestedQuery = String(input.q ?? input.query ?? "");
  const normalized =
    kind === "search"
      ? normalizeResearchSearchQuery(requestedQuery, brief)
      : null;
  if (normalized && !normalized.query)
    throw new ResearchError("EMPTY_QUERY", "搜索问题不能为空");
  if (kind === "search") {
    input = { ...input, q: normalized!.query, query: normalized!.query };
    const completed = await db.researchEvent.findMany({
      where: { taskId: active.stage.taskId, type: "search.completed" },
      orderBy: { seq: "desc" },
      take: 200,
      select: { payload: true },
    });
    const saved = completed
      .map((event) => event.payload as Record<string, unknown>)
      .find(
        (event) =>
          event.query === normalized!.query &&
          event.policyVersion === RESEARCH_QUALITY_VERSION &&
          Array.isArray(event.results),
      );
    if (saved) {
      await researchEvent(
        active.stage.taskId,
        "search.reused",
        {
          attemptId,
          query: normalized!.query,
          count: (saved.results as unknown[]).length,
        },
        active.stage.task.executionToken!,
      );
      return {
        results: saved.results,
        cached: true,
        policyVersion: RESEARCH_QUALITY_VERSION,
      };
    }
  } else if (kind === "crawl" && input.url) {
    const canonicalUrl = canonicalResearchUrl(String(input.url));
    const saved = await db.researchEvidence.findFirst({
      where: {
        taskId: active.stage.taskId,
        canonicalUrl,
        contentKey: { not: null },
        purgedAt: null,
      },
    });
    const capture = (
      saved?.media as { capture?: { screenshotStatus?: string } } | null
    )?.capture;
    if (
      saved?.contentKey &&
      (!input.screenshot ||
        saved.screenshotKey ||
        capture?.screenshotStatus === "not_applicable")
    ) {
      const markdown = (await readResearchFile(saved.contentKey)).toString(
        "utf8",
      );
      const quality = assessCandidate(
        {
          url: saved.originalUrl,
          title: saved.title,
          excerpt: markdown.slice(0, 16000),
          content: markdown,
        },
        brief,
      );
      await researchEvent(
        active.stage.taskId,
        "evidence.reused",
        { attemptId, evidenceId: saved.id, url: saved.originalUrl },
        active.stage.task.executionToken!,
      );
      return {
        url: saved.originalUrl,
        title: saved.title,
        markdown,
        evidenceId: saved.id,
        quality,
        cached: true,
      };
    }
  }
  const { call, task, config } = await waitForResearchCall(
    attemptId,
    kind,
    input,
    signal,
  );
  const abort = new AbortController();
  const stop = () => abort.abort();
  signal?.addEventListener("abort", stop, { once: true });
  if (signal?.aborted) stop();
  const timeout = setTimeout(stop, kind === "crawl" ? 90000 : 60000);
  const checking = setInterval(() => {
    void activeResearchAttempt(attemptId).catch(stop);
  }, 1500);
  try {
    let url: string;
    let init: RequestInit;
    if (kind === "search") {
      const query = String(input.q ?? input.query ?? "")
        .trim()
        .slice(0, 2000);
      if (!query) throw new ResearchError("EMPTY_QUERY", "搜索问题不能为空");
      const search = new URL(`${config.searxUrl}/search`);
      search.searchParams.set("q", query);
      search.searchParams.set("format", "json");
      search.searchParams.set("categories", "general");
      url = search.toString();
      init = {};
    } else {
      url = `${kind === "crawl" ? config.crawlUrl : config.embeddingUrl}/${kind === "crawl" ? "crawl" : "v1/embeddings"}`;
      init = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      };
    }
    const response = await fetch(url, { ...init, signal: abort.signal });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const detail = body?.detail;
      const typed =
        kind === "crawl" &&
        detail &&
        typeof detail === "object" &&
        typeof detail.code === "string" &&
        /^CRAWL_[A-Z_]+$/.test(detail.code) &&
        typeof detail.message === "string";
      throw new ResearchError(
        typed ? detail.code : "SELF_HOSTED_TOOL_FAILED",
        typed
          ? detail.message.slice(0, 300)
          : `自建${kind === "search" ? "搜索" : kind === "crawl" ? "采集" : "向量"}服务返回 ${response.status}`,
        502,
        typed
          ? {
              retryable: detail.retryable === true,
              reason: detail.code,
              httpStatus:
                typeof detail.httpStatus === "number"
                  ? detail.httpStatus
                  : undefined,
            }
          : undefined,
      );
    }
    const result = await response.json();
    if (kind === "search") {
      result.results = (
        Array.isArray(result.results) ? result.results : []
      ).slice(0, 20);
      const candidates: Array<Record<string, unknown>> = [];
      const seen = new Set<string>();
      for (const source of result.results) {
        if (!source.url) continue;
        let canonical: string;
        try {
          canonical = canonicalResearchUrl(source.url);
        } catch {
          continue;
        }
        if (seen.has(canonical)) continue;
        seen.add(canonical);
        const assessment = assessCandidate(
          {
            url: source.url,
            title: String(source.title ?? ""),
            excerpt: String(source.content ?? ""),
          },
          brief,
        );
        const evidence = await saveResearchSource(
          task.id,
          {
            url: source.url,
            title: source.title,
            excerpt: source.content,
            assessment,
          },
          task.executionToken!,
        );
        source.evidenceId = evidence.id;
        source.quality = assessment;
        if (assessment.decision !== "reject") candidates.push(source);
      }
      const candidateCount = result.results.length;
      result.results = candidates
        .sort(
          (a, b) =>
            Number((b.quality as { score: number }).score) -
            Number((a.quality as { score: number }).score),
        )
        .slice(0, 8);
      await researchEvent(
        task.id,
        "search.completed",
        {
          attemptId,
          query: normalized!.query,
          requestedQuery: requestedQuery.slice(0, 2000),
          queryAdjusted: normalized!.changed,
          policyVersion: RESEARCH_QUALITY_VERSION,
          candidateCount,
          filteredCount: candidateCount - result.results.length,
          count: result.results.length,
          results: result.results.map((row: Record<string, unknown>) => ({
            url: row.url,
            title: row.title,
            content: String(row.content ?? "").slice(0, 1800),
            evidenceId: row.evidenceId,
            quality: row.quality,
          })),
        },
        task.executionToken!,
      );
    } else if (kind === "crawl") {
      const assessment = assessCandidate(
        {
          url: String(input.url),
          title: String(result.title ?? ""),
          excerpt: String(result.markdown ?? "").slice(0, 16000),
          content: String(result.markdown ?? ""),
        },
        brief,
      );
      const evidence = await saveResearchSource(
        task.id,
        {
          url: String(input.url),
          title: result.title,
          excerpt: result.markdown?.slice(0, 1200),
          content: result.markdown,
          screenshot: result.screenshot,
          media: {
            ...(result.media &&
            typeof result.media === "object" &&
            !Array.isArray(result.media)
              ? result.media
              : {}),
            capture: {
              method: result.captureMethod ?? "browser-crawl4ai",
              sourceFormat: result.sourceFormat ?? "html",
              httpStatus: result.httpStatus ?? null,
              screenshotStatus:
                result.screenshotStatus ??
                (result.screenshot ? "captured" : "not_requested"),
              warnings: result.captureWarnings ?? [],
              ...(result.document ? { document: result.document } : {}),
            },
          },
          originUrl: result.originUrl,
          assessment,
        },
        task.executionToken!,
      );
      result.evidenceId = evidence.id;
      result.quality = assessment;
      await researchEvent(
        task.id,
        "evidence.captured",
        {
          evidenceId: evidence.id,
          title: evidence.title,
          url: evidence.originalUrl,
          screenshot: Boolean(evidence.screenshotKey),
          captureMethod: result.captureMethod ?? "browser-crawl4ai",
          screenshotStatus: result.screenshotStatus ?? null,
          captureWarnings: result.captureWarnings ?? [],
          attemptId,
          quality: assessment,
        },
        task.executionToken!,
      );
      delete result.screenshot;
    }
    await finishResearchCall(call.id, {
      usage: kind === "embed" ? result.usage : undefined,
    });
    return result;
  } catch (error) {
    await finishResearchCall(call.id, {
      errorCode: error instanceof ResearchError ? error.code : "TOOL_FAILED",
    });
    if (kind === "crawl" && input.url) {
      await saveResearchSource(
        task.id,
        {
          url: String(input.url),
          failed: true,
        },
        task.executionToken!,
      ).catch(() => {});
      await researchEvent(
        task.id,
        "evidence.capture_failed",
        {
          attemptId,
          callId: call.id,
          url: String(input.url),
          code: error instanceof ResearchError ? error.code : "TOOL_FAILED",
          message:
            error instanceof ResearchError ? error.message : "网页采集未完成",
          httpStatus:
            error instanceof ResearchError
              ? (error.details?.httpStatus ?? null)
              : null,
        },
        task.executionToken!,
      ).catch(() => {});
    }
    throw error;
  } finally {
    clearInterval(checking);
    clearTimeout(timeout);
    signal?.removeEventListener("abort", stop);
  }
}
