"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import DOMPurify from "dompurify";
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronRight,
  Compass,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  Loader2,
  Paperclip,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Square,
  X,
} from "lucide-react";
import { Button, IconButton, Select } from "@/components/ui";
import { ChatModelControls } from "@/components/studio/ChatModelControls";
import { ResearchIntake } from "./ResearchIntake";
import type {
  ChatModelOption,
  ReasoningEffort,
} from "@/lib/chat-model-options";
import {
  PRESET_LABELS,
  SCOPE_LABELS,
  PRODUCT_LABELS,
  STAGE_LABELS,
  RESEARCH_PRODUCTS,
  researchTerminal,
  type ResearchTaskView,
  type ResearchProjectView,
  type ResearchPlanInput,
  type ResearchPlan,
  type ResearchArtifactView,
} from "@/lib/research/types";
import { cn } from "@/lib/utils";
import {
  applyResearchEvent,
  parseResearchEvent,
  researchActivityMessage,
  researchArtifactLabel,
  researchContextLabel,
  researchContextManifest,
  researchDecisionGapLabel,
  researchDecisionLabel,
  researchDecisions,
  researchElapsed,
  researchExecutionLabel,
  researchQuality,
  researchQualityLabel,
  researchSynthesisPhaseLabel,
  type ResearchDecisionPresentation,
} from "@/lib/research/presentation";

// Elapsed-time and connection updates must not rebuild unchanged Markdown.
// Keep the existing renderer; stable component identities also preserve links
// and text selections while unrelated status feedback updates.
const ResearchMarkdown = memo(function ResearchMarkdown({
  text,
  className,
  components,
}: {
  text: string;
  className?: string;
  components?: Components;
}) {
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
});

function DecisionSources({
  ids,
  evidence,
  onOpen,
}: {
  ids: string[];
  evidence: ResearchTaskView["evidence"];
  onOpen: (id: string) => void;
}) {
  const available = ids.flatMap((id) => {
    const index = evidence.findIndex((source) => source.id === id);
    return index >= 0 ? [{ source: evidence[index], number: index + 1 }] : [];
  });
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {available.map(({ source, number }) => (
        <button
          key={source.id}
          type="button"
          onClick={() => onOpen(source.id)}
          className="inline-flex max-w-full items-center gap-1 rounded border border-border px-2 py-1.5 text-left text-brand hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <BookOpen size={12} className="shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words">
            来源 {number} · {source.title}
          </span>
        </button>
      ))}
      {ids.length > available.length && (
        <span className="text-text-muted">部分来源未随此版本保存</span>
      )}
      {!ids.length && (
        <span className="text-text-faint">尚无可定位的材料依据</span>
      )}
    </div>
  );
}

const ResearchDecisionOverview = memo(function ResearchDecisionOverview({
  decisions,
  evidence,
  onOpenSource,
}: {
  decisions: ResearchDecisionPresentation;
  evidence: ResearchTaskView["evidence"];
  onOpenSource: (id: string) => void;
}) {
  if (!decisions.cards.length && !decisions.gaps.length) return null;
  return (
    <div className="mb-9 space-y-8">
      {!!decisions.cards.length && (
        <section aria-label="设计决策">
          <h3 className="text-base font-semibold">
            这些材料会怎样改变设计选择
          </h3>
          <p className="mt-1 text-xs leading-6 text-text-muted">
            从材料观察进入方案比较；设计含义与建议动作保留各自的依据和验证条件。
          </p>
          <div className="mt-4 space-y-4">
            {decisions.cards.map((card, index) => (
              <article
                key={card.id}
                aria-labelledby={`decision-${card.id}`}
                className="min-w-0 rounded-lg border border-border p-4 sm:p-5"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="text-xs tabular-nums text-text-faint">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h4
                    id={`decision-${card.id}`}
                    className="min-w-0 flex-1 break-words text-base font-semibold leading-7"
                  >
                    {card.title}
                  </h4>
                  <span className="rounded bg-surface-2 px-2 py-1 text-[11px] text-text-muted">
                    {researchDecisionLabel(card.status)}
                  </span>
                </div>
                <dl className="mt-4 space-y-3 text-sm leading-7">
                  <div>
                    <dt className="text-xs font-medium text-text-muted">
                      材料观察
                    </dt>
                    <dd className="mt-1 whitespace-pre-wrap break-words">
                      {card.finding}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-text-muted">
                      设计含义
                    </dt>
                    <dd className="mt-1 whitespace-pre-wrap break-words">
                      {card.interpretation}
                    </dd>
                  </div>
                  <div className="rounded-md bg-surface-2/70 p-3">
                    <dt className="text-xs font-medium">建议动作</dt>
                    <dd className="mt-1 whitespace-pre-wrap break-words">
                      {card.action}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-text-muted">
                      需要接受的代价
                    </dt>
                    <dd className="mt-1 whitespace-pre-wrap break-words">
                      {card.tradeoff}
                    </dd>
                  </div>
                </dl>
                <details className="mt-4 text-sm leading-7">
                  <summary className="cursor-pointer text-xs font-medium text-text-muted">
                    下一步怎么验证，什么会改变选择
                  </summary>
                  <dl className="mt-3 space-y-3">
                    <div>
                      <dt className="text-xs font-medium text-text-muted">
                        下一步验证
                      </dt>
                      <dd className="mt-1 whitespace-pre-wrap break-words">
                        {card.nextTest}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium text-text-muted">
                        改变选择的条件
                      </dt>
                      <dd className="mt-1 whitespace-pre-wrap break-words">
                        {card.changeCondition}
                      </dd>
                    </div>
                  </dl>
                </details>
                <div className="mt-4 border-t border-border pt-3">
                  <DecisionSources
                    ids={card.evidenceIds}
                    evidence={evidence}
                    onOpen={onOpenSource}
                  />
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
      {!!decisions.gaps.length && (
        <section aria-label="待解关键问题">
          <h3 className="text-base font-semibold">
            还会影响选择的 {decisions.gaps.length} 个问题
          </h3>
          <div className="mt-4 divide-y divide-border border-y border-border">
            {decisions.gaps.map((gap) => (
              <article key={gap.id} className="min-w-0 py-4">
                <p className="mb-1 text-[11px] text-text-muted">
                  {researchDecisionGapLabel(gap)}
                </p>
                <h4 className="break-words text-sm font-semibold leading-7">
                  {gap.decision}
                </h4>
                {!!gap.finding && (
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-text-muted">
                    {gap.finding}
                  </p>
                )}
                {!!gap.nextCheck && (
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7">
                    <span className="font-medium">下一步：</span>
                    {gap.nextCheck}
                  </p>
                )}
                {(gap.implication || gap.changeCondition) && (
                  <details className="mt-2 text-xs leading-6 text-text-muted">
                    <summary className="cursor-pointer">
                      对方案选择的影响
                    </summary>
                    {!!gap.implication && (
                      <p className="mt-2 whitespace-pre-wrap break-words">
                        {gap.implication}
                      </p>
                    )}
                    {!!gap.changeCondition && (
                      <p className="mt-2 whitespace-pre-wrap break-words">
                        改变选择的条件：{gap.changeCondition}
                      </p>
                    )}
                  </details>
                )}
                {!!gap.evidenceIds.length && (
                  <div className="mt-3">
                    <DecisionSources
                      ids={gap.evidenceIds}
                      evidence={evidence}
                      onOpen={onOpenSource}
                    />
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
});

class ResearchRequestError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
  });
  const result = await response.json();
  if (!response.ok || !result.ok)
    throw new ResearchRequestError(
      result.error?.message || "请求未能完成",
      result.error?.code,
    );
  return result.data;
}
const emptyInput: ResearchPlanInput = {
  brief: {
    question: "",
    market: "",
    audience: "",
    timeRange: "",
    constraints: "",
    competitors: [],
    links: [],
    attachmentKeys: [],
    sourceImageIds: [],
    selectedMessageIds: [],
    selectedContext: "",
  },
  preset: "auto",
  scope: "standard",
  products: ["report", "competitors", "board", "brief"],
  collectVisuals: true,
  verify: true,
  modelId: "gpt-6.1-sol",
  reasoningEffort: "medium",
};
type Health = {
  ready: boolean;
  workerReady: boolean;
  modelReady: boolean;
  services: Array<{
    id: string;
    label: string;
    ready: boolean;
    status: string;
  }>;
};
type Tab = "plan" | "process" | "report" | "evidence" | "files";

export function ResearchWorkspace() {
  const [projects, setProjects] = useState<ResearchProjectView[]>([]);
  const [projectId, setProjectId] = useState("");
  const [task, setTask] = useState<ResearchTaskView | null>(null);
  const [input, setInput] = useState<ResearchPlanInput>(emptyInput);
  const [models, setModels] = useState<ChatModelOption[]>([]);
  const [conversationId, setConversationId] = useState<string>();
  const [messages, setMessages] = useState<
    Array<{ id: string; role: string; content: string }>
  >([]);
  const [plan, setPlan] = useState<ResearchPlan | null>(null);
  const [planInputKey, setPlanInputKey] = useState("");
  const [intakeReady, setIntakeReady] = useState(false);
  const [intakePending, setIntakePending] = useState(false);
  const [confirmedIntakeTaskId, setConfirmedIntakeTaskId] = useState<string>();
  const [intakeRefresh, setIntakeRefresh] = useState(0);
  const [tab, setTab] = useState<Tab>("plan");
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<Array<{ seq: number; message: string }>>(
    [],
  );
  const [clock, setClock] = useState(() => Date.now());
  const [subscription, setSubscription] = useState<
    "connecting" | "connected" | "reconnecting"
  >("connecting");
  const [activity, setActivity] = useState<{
    taskId: string;
    stageId?: string;
    message: string;
  } | null>(null);
  const [preview, setPreview] = useState<{
    file: ResearchArtifactView;
    content: string;
  } | null>(null);
  const [highlightedEvidenceId, setHighlightedEvidenceId] = useState<
    string | null
  >(null);
  const [attachments, setAttachments] = useState<
    Array<{ key: string; filename: string }>
  >([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const taskView = useRef<ResearchTaskView | null>(null);
  const requestVersion = useRef(0);
  const currentTaskId = useRef<string | null>(null);
  const generation = useRef(0);
  const projectCreation = useRef<{
    generation: number;
    promise: Promise<string>;
  } | null>(null);

  const commitTask = useCallback((view: ResearchTaskView | null) => {
    const previous = taskView.current;
    if (
      previous?.id !== view?.id ||
      (previous &&
        view &&
        ((researchTerminal(previous.status) &&
          !researchTerminal(view.status)) ||
          previous.stages.find((stage) => stage.status === "running")
            ?.activeAttemptId !==
            view.stages.find((stage) => stage.status === "running")
              ?.activeAttemptId))
    )
      setActivity(null);
    taskView.current = view;
    seq.current = view?.nextSeq ?? 0;
    setTask(view);
  }, []);

  const refreshProjects = useCallback(
    async () =>
      setProjects(await api<ResearchProjectView[]>("/api/research/projects")),
    [],
  );
  const refreshHealth = useCallback(async () => {
    try {
      setHealth(await api<Health>("/api/admin/research"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "服务状态读取失败");
    }
  }, []);
  const openTask = useCallback(
    async (id: string) => {
      const version = ++requestVersion.current;
      generation.current++;
      setLoading(true);
      setError(null);
      try {
        const view = await api<ResearchTaskView>(`/api/research/tasks/${id}`);
        if (version !== requestVersion.current) return;
        currentTaskId.current = id;
        setProjectId(view.projectId);
        commitTask(view);
        setTab(
          view.status === "completed"
            ? view.sourceTaskId
              ? "files"
              : "report"
            : "process",
        );
        setEvents([]);
        setActivity(null);
        setPreview(null);
        setHighlightedEvidenceId(null);
        window.history.replaceState(null, "", `/app/research?task=${id}`);
      } catch (caught) {
        if (version === requestVersion.current)
          setError(caught instanceof Error ? caught.message : "任务读取失败");
      } finally {
        if (version === requestVersion.current) setLoading(false);
      }
    },
    [commitTask],
  );
  const refreshTask = useCallback(
    async (id: string) => {
      const view = await api<ResearchTaskView>(`/api/research/tasks/${id}`);
      if (currentTaskId.current !== id || view.nextSeq < seq.current) return;
      commitTask(view);
    },
    [commitTask],
  );

  useEffect(() => {
    let alive = true;
    void Promise.all([
      refreshProjects(),
      refreshHealth(),
      api<{ models: ChatModelOption[] }>("/api/conversations/chat").then(
        (data) => {
          if (alive)
            setModels(
              data.models.filter((model) => model.reasoningEfforts.length),
            );
        },
      ),
    ])
      .catch((caught) => {
        if (alive) setError(caught.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    const id = new URLSearchParams(window.location.search).get("task");
    if (id) void openTask(id);
    else {
      const project = new URLSearchParams(window.location.search).get(
        "project",
      );
      if (project) setProjectId(project);
      try {
        const value = sessionStorage.getItem("chugao.research.seed.v1");
        if (value) {
          const seed = JSON.parse(value);
          setInput((previous) => ({
            ...previous,
            brief: {
              ...previous.brief,
              question: String(seed.question || ""),
              attachmentKeys: seed.attachmentKeys || [],
              sourceImageIds: seed.sourceImageIds || [],
            },
            modelId: seed.modelId || previous.modelId,
            reasoningEffort: seed.reasoningEffort || previous.reasoningEffort,
          }));
          setConversationId(seed.conversationId);
          sessionStorage.removeItem("chugao.research.seed.v1");
        }
      } catch {
        /* Invalid local drafts are ignored. */
      }
    }
    return () => {
      alive = false;
      // This is a request generation counter, not a DOM ref.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      requestVersion.current++;
    };
  }, [openTask, refreshHealth, refreshProjects]);
  useEffect(() => {
    if (!conversationId) return;
    const abort = new AbortController();
    void api<{ messages: typeof messages }>(
      `/api/research/context?conversationId=${encodeURIComponent(conversationId)}`,
      { signal: abort.signal },
    )
      .then((data) => setMessages(data.messages))
      .catch(() => {});
    return () => abort.abort();
  }, [conversationId]);
  useEffect(() => {
    setPlan(null);
    setPlanInputKey("");
    if (
      task ||
      (!intakeReady && !input.sourceTaskId) ||
      input.brief.question.trim().length < 2
    ) {
      return;
    }
    const abort = new AbortController();
    const inputKey = JSON.stringify(input);
    const timer = setTimeout(() => {
      void api<ResearchPlan>("/api/research/plan", {
        method: "POST",
        body: JSON.stringify(input),
        signal: abort.signal,
      })
        .then((next) => {
          if (abort.signal.aborted) return;
          setPlan(next);
          setPlanInputKey(inputKey);
        })
        .catch(() => {});
    }, 300);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [input, task, intakeReady]);
  const watchedTaskId = task?.id;
  const watching = !!task && !researchTerminal(task.status);
  useEffect(() => {
    if (!watching) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [watching]);
  useEffect(() => {
    if (!watchedTaskId) return;
    const id = watchedTaskId;
    const source = new EventSource(`/api/research/tasks/${id}/events?after=0`);
    let alive = true;
    // Coalesce metadata/gap refreshes. The returned snapshot is authoritative
    // only if it is at least as new as the view's already applied cursor.
    let refreshing = false;
    let refreshAgain = false;
    const synchronize = async () => {
      if (refreshing) {
        refreshAgain = true;
        return;
      }
      refreshing = true;
      do {
        refreshAgain = false;
        try {
          await refreshTask(id);
        } catch {
          if (alive) setSubscription("reconnecting");
        }
      } while (alive && refreshAgain);
      refreshing = false;
    };
    let probing = false;
    const checkLatest = async () => {
      if (!alive || probing || document.visibilityState === "hidden") return;
      probing = true;
      try {
        const meta = await api<{ status: string; nextSeq: number }>(
          `/api/research/tasks/${id}?meta=1`,
        );
        if (
          alive &&
          currentTaskId.current === id &&
          (meta.nextSeq > seq.current ||
            meta.status !== taskView.current?.status)
        )
          await synchronize();
      } catch {
        if (alive && watching) setSubscription("reconnecting");
      } finally {
        probing = false;
      }
    };
    // A terminal SSE connection closes. Another tab or an operator can resume
    // the same task later; poll only its small cursor before loading a snapshot.
    const poll = window.setInterval(() => {
      if (!["completed", "cancelled"].includes(taskView.current?.status ?? ""))
        void checkLatest();
    }, 10000);
    window.addEventListener("focus", checkLatest);
    document.addEventListener("visibilitychange", checkLatest);
    setSubscription("connecting");
    source.onopen = () => {
      if (alive && currentTaskId.current === id) setSubscription("connected");
    };
    source.onerror = () => {
      if (alive && currentTaskId.current === id) {
        setSubscription("reconnecting");
        void synchronize();
      }
    };
    source.onmessage = (message) => {
      if (!alive || currentTaskId.current !== id) return;
      let event;
      try {
        event = parseResearchEvent(JSON.parse(message.data));
      } catch {
        event = null;
      }
      if (!event) {
        void synchronize();
        return;
      }
      const label = researchActivityMessage(event);
      const previous = taskView.current;
      if (!previous || previous.id !== id) return;
      const update = applyResearchEvent(previous, event);
      if (update.view !== previous) commitTask(update.view);
      if (label && update.applied) {
        setEvents((previous) =>
          previous.some((item) => item.seq === event.seq)
            ? previous
            : [...previous, { seq: event.seq, message: label }]
                .sort((left, right) => left.seq - right.seq)
                .slice(-60),
        );
        const stage = update.view.stages.find(
          (row) =>
            row.id === event.payload.stageId ||
            (typeof event.payload.attemptId === "string" &&
              row.activeAttemptId === event.payload.attemptId),
        );
        if (
          !event.payload.attemptId ||
          stage?.activeAttemptId === event.payload.attemptId
        )
          setActivity({
            taskId: id,
            stageId: stage?.id,
            message: label,
          });
      }
      if (update.needsSnapshot) void synchronize();
    };
    const terminal = () => {
      source.close();
      void synchronize();
      void refreshProjects();
    };
    source.addEventListener("terminal", terminal);
    source.addEventListener("reconnect", () => {
      setSubscription("reconnecting");
      void synchronize();
    });
    return () => {
      alive = false;
      window.clearInterval(poll);
      window.removeEventListener("focus", checkLatest);
      document.removeEventListener("visibilitychange", checkLatest);
      source.close();
    };
  }, [watchedTaskId, watching, refreshTask, refreshProjects, commitTask]);

  const setBrief = (key: keyof ResearchPlanInput["brief"], value: unknown) =>
    setInput((previous) => ({
      ...previous,
      brief: { ...previous.brief, [key]: value },
    }));
  const reset = () => {
    generation.current++;
    requestVersion.current++;
    currentTaskId.current = null;
    commitTask(null);
    setIntakeReady(false);
    setConfirmedIntakeTaskId(undefined);
    setBusy(false);
    setProjectId("");
    setInput(emptyInput);
    setConversationId(undefined);
    setMessages([]);
    setAttachments([]);
    setEvents([]);
    setActivity(null);
    setPreview(null);
    setHighlightedEvidenceId(null);
    setTab("plan");
    setError(null);
    window.history.replaceState(null, "", "/app/research");
  };
  const openProjectDraft = (id: string) => {
    reset();
    setProjectId(id);
    window.history.replaceState(null, "", `/app/research?project=${id}`);
  };
  const ensureProject = async () => {
    if (projectId) return projectId;
    const version = generation.current;
    if (projectCreation.current?.generation === version)
      return projectCreation.current.promise;
    const creation = api<{ id: string }>("/api/research/projects", {
      method: "POST",
      body: JSON.stringify({
        title: input.brief.question.slice(0, 80) || "新研究",
        conversationId,
      }),
    }).then((project) => {
      if (version !== generation.current)
        throw new Error("研究页面已切换，需求保留在原项目中");
      setProjectId(project.id);
      void refreshProjects().catch(() => {});
      return project.id;
    });
    projectCreation.current = { generation: version, promise: creation };
    try {
      return await creation;
    } finally {
      if (projectCreation.current?.promise === creation)
        projectCreation.current = null;
    }
  };
  const start = async () => {
    if (
      busy ||
      (!intakeReady && !input.sourceTaskId) ||
      !plan ||
      planInputKey !== JSON.stringify(input)
    )
      return;
    const version = generation.current;
    setBusy(true);
    setError(null);
    try {
      const id = await ensureProject();
      if (version !== generation.current) return;
      const payload = {
        ...input,
        projectId: id,
        ...(!input.sourceTaskId && confirmedIntakeTaskId
          ? { intakeTaskId: confirmedIntakeTaskId }
          : {}),
      };
      let pending: { payload: string; clientRequestId: string } | null = null;
      try {
        pending = JSON.parse(
          sessionStorage.getItem("chugao.research.pending.v1") || "null",
        );
      } catch {
        /* Start a fresh submission if the receipt is malformed. */
      }
      const body = JSON.stringify(payload);
      const clientRequestId =
        pending?.payload === body
          ? pending.clientRequestId
          : crypto.randomUUID();
      sessionStorage.setItem(
        "chugao.research.pending.v1",
        JSON.stringify({ payload: body, clientRequestId }),
      );
      const view = await api<ResearchTaskView>("/api/research/tasks", {
        method: "POST",
        body: JSON.stringify({ ...payload, clientRequestId }),
      });
      if (version !== generation.current) return;
      sessionStorage.removeItem("chugao.research.pending.v1");
      setBusy(false);
      await openTask(view.id);
      await refreshProjects();
    } catch (caught) {
      if (version === generation.current) {
        if (
          caught instanceof ResearchRequestError &&
          ["INTAKE_CHANGED", "INTAKE_NOT_READY"].includes(caught.code ?? "")
        ) {
          setIntakeReady(false);
          setConfirmedIntakeTaskId(undefined);
          setIntakeRefresh((previous) => previous + 1);
          sessionStorage.removeItem("chugao.research.pending.v1");
        }
        setError(caught instanceof Error ? caught.message : "研究未能开始");
      }
    } finally {
      if (version === generation.current) setBusy(false);
    }
  };
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    const version = generation.current;
    setBusy(true);
    setError(null);
    try {
      const id = await ensureProject();
      if (version !== generation.current) return;
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.set("projectId", id);
        form.set("file", file);
        const uploaded = await api<{ key: string; filename: string }>(
          "/api/research/uploads",
          { method: "POST", body: form },
        );
        if (version !== generation.current) return;
        setAttachments((previous) => [...previous, uploaded]);
        setInput((previous) => ({
          ...previous,
          brief: {
            ...previous.brief,
            attachmentKeys: [...previous.brief.attachmentKeys, uploaded.key],
          },
        }));
      }
    } catch (caught) {
      if (version === generation.current)
        setError(caught instanceof Error ? caught.message : "文件上传失败");
    } finally {
      if (version === generation.current) {
        setBusy(false);
        if (fileInput.current) fileInput.current.value = "";
      }
    }
  };
  const operate = async (
    operation: "cancel" | "retry",
    stageId?: string,
    renewTime = false,
  ) => {
    if (!task) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/research/tasks/${task.id}/${operation}`, {
        method: "POST",
        body: JSON.stringify(
          operation === "retry"
            ? { stageId, clientRequestId: crypto.randomUUID(), renewTime }
            : {},
        ),
      });
      await refreshTask(task.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };
  const previewFile = async (file: ResearchArtifactView) => {
    const version = generation.current;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/research/files/${file.id}`);
      if (!response.ok) throw Error("文件无法预览，可能已经过期");
      let content = await response.text();
      if (file.mimeType.startsWith("text/html")) {
        const sanitized = DOMPurify.sanitize(content, {
          WHOLE_DOCUMENT: true,
          RETURN_DOM: true,
          ADD_TAGS: ["style"],
          FORBID_TAGS: [
            "base",
            "script",
            "iframe",
            "object",
            "embed",
            "form",
            "meta",
          ],
        });
        if (!(sanitized instanceof Element)) throw Error("网页预览无法解析");
        // srcdoc otherwise resolves fragment URLs against the parent app URL.
        sanitized.querySelectorAll('a[href^="#"]').forEach((link) => {
          link.setAttribute("href", `about:srcdoc${link.getAttribute("href")}`);
        });
        content =
          `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'; font-src data:; base-uri 'none'; form-action 'none'">` +
          sanitized.outerHTML;
      }
      if (version === generation.current) setPreview({ file, content });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "预览失败");
    } finally {
      setBusy(false);
    }
  };
  const useVersion = () => {
    if (!task) return;
    const ownPackage = task.stages.find(
      (stage) => stage.kind === "synthesize" && stage.status === "completed",
    )?.result as
      | { finalResearchPackage?: { schemaVersion?: number } }
      | undefined;
    const hasPackage =
      ownPackage?.finalResearchPackage?.schemaVersion === 2 ||
      task.stages.some(
        (stage) =>
          stage.kind === "produce" &&
          stage.status === "completed" &&
          !!(stage.result as { finalPackageVersion?: string } | null)
            ?.finalPackageVersion,
      );
    setInput({
      ...emptyInput,
      brief: { ...task.brief, selectedMessageIds: [] },
      preset: "proposal",
      sourceTaskId: ownPackage ? task.id : (task.sourceTaskId ?? task.id),
      sourceMode: hasPackage ? "produce" : "refresh",
      products: hasPackage
        ? ["pptx", "docx", "html"]
        : ["report", "brief", "competitors", "board", "pptx", "docx", "html"],
    });
    generation.current++;
    requestVersion.current++;
    commitTask(null);
    setIntakeReady(true);
    currentTaskId.current = null;
    setActivity(null);
    setPreview(null);
    setTab("plan");
  };
  const report =
    task?.stages.find((stage) => stage.kind === "synthesize")?.text ||
    [...(task?.stages || [])]
      .reverse()
      .find(
        (stage) => ["research", "explore"].includes(stage.kind) && stage.text,
      )?.text ||
    "";
  const selectedProject = projects.find((project) => project.id === projectId);
  const evidenceNumbers = new Map(
    task?.evidence.map((source, index) => [source.id, index + 1]) ?? [],
  );
  const openEvidence = useCallback((id: string) => {
    if (!taskView.current?.evidence.some((source) => source.id === id)) return;
    setHighlightedEvidenceId(id);
    setTab("evidence");
    setPreview(null);
  }, []);
  useEffect(() => {
    if (tab !== "evidence" || !highlightedEvidenceId) return;
    // The evidence tab mounts after the click. Resolve the target after React
    // commits, so navigation does not race a requestAnimationFrame callback.
    const element = document.getElementById(
      `evidence-${highlightedEvidenceId}`,
    );
    element?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    element?.focus({ preventScroll: true });
  }, [tab, highlightedEvidenceId, task?.id]);
  const decisions = useMemo(
    () => (task ? researchDecisions(task) : null),
    [task],
  );
  const reportMarkdown = report.replace(
    /\[([a-zA-Z0-9_-]+)\](?!\()/g,
    (match, id: string) =>
      evidenceNumbers.has(id)
        ? `[来源 ${evidenceNumbers.get(id)}](#evidence-${id})`
        : match,
  );
  const reportLinks = useMemo<Components>(
    () => ({
      a: ({
        href,
        children,
      }: {
        href?: string;
        children?: React.ReactNode;
      }) => (
        <a
          href={href}
          onClick={(event) => {
            if (href?.startsWith("#evidence-")) {
              event.preventDefault();
              openEvidence(href.slice("#evidence-".length));
            }
          }}
        >
          {children}
        </a>
      ),
    }),
    [openEvidence],
  );
  const model = models.find((item) => item.id === input.modelId) ?? null;
  const active = !!task && !researchTerminal(task.status);
  const resumableStage =
    task && !active && task.status !== "completed"
      ? task.stages.find((stage) => stage.status !== "completed")
      : undefined;
  const canResume =
    !!resumableStage &&
    !!task &&
    (task.llmCalls < task.plan.limits.llm ||
      (resumableStage.kind === "synthesize" &&
        resumableStage.savedSynthesisComplete === true)) &&
    (!task.expiresAt || new Date(task.expiresAt).getTime() > Date.now());
  const activeStage = task?.stages.find((stage) => stage.status === "running");
  const activeStageText = activeStage?.text;
  const quality = task ? researchQuality(task) : null;
  const contextManifest = task ? researchContextManifest(task) : null;
  const evidenceCounts =
    task?.evidence.reduce(
      (counts, source) => {
        counts[source.status] = (counts[source.status] || 0) + 1;
        return counts;
      },
      {} as Record<string, number>,
    ) ?? {};
  const currentActivity =
    researchSynthesisPhaseLabel(activeStage) ??
    (activity?.taskId === task?.id &&
    (!activity?.stageId || activity.stageId === activeStage?.id)
      ? activity?.message
      : null);
  const markdownClass =
    "space-y-4 break-words text-sm leading-7 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:pt-4 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:text-brand [&_a]:underline [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:bg-surface-2 [&_pre]:p-3 [&_table]:block [&_table]:overflow-x-auto [&_td]:border [&_td]:border-border [&_td]:p-2 [&_th]:border [&_th]:border-border [&_th]:p-2";

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4 sm:px-7">
        <div className="flex min-w-0 items-center gap-3">
          <Search className="shrink-0 text-brand" size={19} />
          <h1 className="text-base font-semibold">研究工作台</h1>
          <span className="text-xs text-text-faint">管理员内测</span>
        </div>
        <div className="flex items-center gap-1">
          <IconButton
            title="刷新服务状态"
            aria-label="刷新服务状态"
            onClick={() => void refreshHealth()}
          >
            <RefreshCw size={16} />
          </IconButton>
          <IconButton title="研究设置" aria-label="研究设置" asChild>
            <Link href="/admin/research">
              <Settings2 size={16} />
            </Link>
          </IconButton>
          <Button size="sm" onClick={reset}>
            <Plus size={14} />
            新研究
          </Button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-52 shrink-0 overflow-y-auto border-r border-border bg-surface/50 p-3 xl:block">
          <p className="px-2 pb-3 pt-1 text-xs text-text-faint">研究项目</p>
          {projects.map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() =>
                project.tasks[0]
                  ? void openTask(project.tasks[0].id)
                  : openProjectDraft(project.id)
              }
              className={cn(
                "mb-1 flex w-full items-start gap-2 rounded-md px-2 py-2.5 text-left text-xs hover:bg-surface-2",
                project.id === projectId && "bg-surface-2",
              )}
            >
              <FolderOpen
                size={15}
                className="mt-0.5 shrink-0 text-text-muted"
              />
              <span
                className="line-clamp-2 min-w-0 break-words leading-5"
                title={project.title}
              >
                {project.title}
              </span>
            </button>
          ))}
        </aside>
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-5xl px-4 pb-12 pt-5 sm:px-7 sm:pt-7">
            {projects.length > 0 && (
              <div className="mb-5 xl:hidden">
                <Select
                  aria-label="研究项目"
                  className="min-w-0 [&>span:first-child]:block [&>span:first-child]:min-w-0 [&>span:first-child]:truncate"
                  contentClassName="max-w-[calc(100vw-2rem)] [&_[role=option]]:h-auto [&_[role=option]]:min-h-8 [&_[role=option]>span:last-child]:min-w-0 [&_[role=option]>span:last-child]:break-words"
                  value={projectId || "new"}
                  options={[
                    { value: "new", label: "新研究" },
                    ...projects.map((project) => ({
                      value: project.id,
                      label: project.title,
                    })),
                  ]}
                  onValueChange={(value) => {
                    const project = projects.find((row) => row.id === value);
                    if (project?.tasks[0]) void openTask(project.tasks[0].id);
                    else if (project) openProjectDraft(project.id);
                    else reset();
                  }}
                />
              </div>
            )}
            {error && (
              <div
                role="alert"
                className="mb-5 flex items-start justify-between gap-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5 text-sm text-danger"
              >
                <p>{error}</p>
                <IconButton
                  aria-label="关闭提示"
                  onClick={() => setError(null)}
                >
                  <X size={14} />
                </IconButton>
              </div>
            )}
            {!task && health && !health.ready && (
              <div className="mb-6 border-b border-border pb-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">研究环境尚未全部就绪</p>
                  <Link
                    href="/admin/research"
                    className="text-xs text-text-muted underline underline-offset-4"
                  >
                    查看状态
                  </Link>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-xs text-text-muted">
                  {!health.workerReady && <span>执行器未连接</span>}
                  {!health.modelReady && <span>LLM 未配置</span>}
                  {health.services
                    .filter((service) => !service.ready)
                    .map((service) => (
                      <span key={service.id}>
                        {service.label}：{service.status}
                      </span>
                    ))}
                </div>
              </div>
            )}
            {loading ? (
              <div className="flex items-center gap-2 py-10 text-sm text-text-muted">
                <Loader2 size={16} className="animate-spin" />
                正在加载研究项目
              </div>
            ) : !task ? (
              <>
                <div className="mb-7">
                  <p
                    className="mb-2 truncate text-xs text-text-faint"
                    title={selectedProject?.title}
                  >
                    {selectedProject?.title || "新研究"}
                  </p>
                  <h2 className="text-xl font-semibold">
                    {intakeReady ? "需求已整理" : "先聊聊你的想法"}
                  </h2>
                </div>
                {!input.sourceTaskId && (
                  <ResearchIntake
                    key={`${generation.current}-${intakeRefresh}`}
                    projectId={projectId}
                    input={input}
                    ensureProject={ensureProject}
                    onDraft={(
                      brief,
                      ready,
                      products,
                      settings,
                      intakeTaskId,
                    ) => {
                      setInput((previous) => ({
                        ...previous,
                        ...settings,
                        brief,
                        products,
                      }));
                      setIntakeReady(ready);
                      setConfirmedIntakeTaskId(
                        ready ? intakeTaskId : undefined,
                      );
                      void refreshProjects().catch(() => {});
                      void refreshHealth();
                    }}
                    onUpload={() => fileInput.current?.click()}
                    onPendingChange={setIntakePending}
                    disabled={busy}
                  />
                )}
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  accept=".pdf,.docx,.md,.txt,.csv,.png,.jpg,.jpeg,.webp"
                  className="hidden"
                  onChange={(event) => void upload(event.target.files)}
                />
                {input.brief.attachmentKeys.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {input.brief.attachmentKeys.map((key, index) => (
                      <span
                        key={key}
                        className="inline-flex max-w-full items-center gap-1 rounded border border-border px-2 py-1 text-xs"
                      >
                        <Paperclip size={12} />
                        <span className="truncate">
                          {attachments.find((row) => row.key === key)
                            ?.filename || `参考资料 ${index + 1}`}
                        </span>
                        <button
                          type="button"
                          title="移除资料"
                          aria-label="移除资料"
                          disabled={busy}
                          onClick={() =>
                            setBrief(
                              "attachmentKeys",
                              input.brief.attachmentKeys.filter(
                                (value) => value !== key,
                              ),
                            )
                          }
                        >
                          <X size={13} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <fieldset
                  disabled={busy || intakePending}
                  className="mt-5 min-w-0 space-y-6 disabled:opacity-70"
                >
                  <details className="border-b border-border pb-4">
                    <summary className="flex cursor-pointer items-center gap-2 text-xs text-text-muted">
                      <Settings2 size={14} />
                      高级设置（可选）
                      <span className="ml-auto">已安排默认配置</span>
                    </summary>
                    <div className="mt-5 space-y-6">
                      <div
                        className="grid grid-cols-2 gap-1 rounded-md bg-surface-2 p-1 sm:grid-cols-4"
                        role="group"
                        aria-label="研究模式"
                      >
                        {(
                          ["auto", "explore", "research", "proposal"] as const
                        ).map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            aria-pressed={input.preset === preset}
                            onClick={() =>
                              setInput((previous) => ({
                                ...previous,
                                preset,
                                products:
                                  preset === "proposal"
                                    ? [
                                        ...new Set([
                                          ...previous.products,
                                          "pptx" as const,
                                        ]),
                                      ]
                                    : previous.products,
                              }))
                            }
                            className={cn(
                              "flex min-h-10 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded px-2 text-xs sm:text-sm",
                              input.preset === preset
                                ? "bg-surface font-medium text-foreground shadow-sm"
                                : "text-text-muted",
                            )}
                          >
                            {preset === "explore" ? (
                              <Compass size={14} />
                            ) : preset === "proposal" ? (
                              <FileText size={14} />
                            ) : preset === "research" ? (
                              <BookOpen size={14} />
                            ) : (
                              <Search size={14} />
                            )}
                            {PRESET_LABELS[preset]}
                          </button>
                        ))}
                      </div>
                      {messages.length > 0 && (
                        <details className="border-b border-border pb-4">
                          <summary className="cursor-pointer text-sm">
                            引用对话消息{" "}
                            <span className="text-text-faint">
                              {input.brief.selectedMessageIds.length} 条
                            </span>
                          </summary>
                          <div className="mt-3 max-h-60 space-y-2 overflow-y-auto">
                            {messages.map((message) => (
                              <label
                                key={message.id}
                                className="flex items-start gap-2 text-xs leading-5"
                              >
                                <input
                                  type="checkbox"
                                  className="mt-1 accent-current"
                                  checked={input.brief.selectedMessageIds.includes(
                                    message.id,
                                  )}
                                  onChange={(event) =>
                                    setBrief(
                                      "selectedMessageIds",
                                      event.target.checked
                                        ? [
                                            ...input.brief.selectedMessageIds,
                                            message.id,
                                          ]
                                        : input.brief.selectedMessageIds.filter(
                                            (value) => value !== message.id,
                                          ),
                                    )
                                  }
                                />
                                <span>
                                  <span className="text-text-faint">
                                    {message.role === "USER" ? "你" : "助手"}：
                                  </span>
                                  {message.content.slice(0, 400)}
                                </span>
                              </label>
                            ))}
                          </div>
                        </details>
                      )}
                      <div className="flex flex-wrap items-center justify-between gap-4">
                        <div className="w-36">
                          <Select
                            aria-label="研究范围"
                            value={input.scope}
                            options={Object.entries(SCOPE_LABELS).map(
                              ([value, label]) => ({ value, label }),
                            )}
                            onValueChange={(value) =>
                              setInput((previous) => ({
                                ...previous,
                                scope: value as ResearchPlanInput["scope"],
                              }))
                            }
                          />
                        </div>
                        <div className="max-w-full">
                          <ChatModelControls
                            models={models}
                            model={model}
                            reasoningEffort={input.reasoningEffort}
                            onSelectModel={(id) =>
                              setInput((previous) => ({
                                ...previous,
                                modelId: id,
                              }))
                            }
                            onReasoningEffortChange={(
                              effort: ReasoningEffort,
                            ) =>
                              setInput((previous) => ({
                                ...previous,
                                reasoningEffort: effort,
                              }))
                            }
                          />
                        </div>
                      </div>
                      <div>
                        <p className="mb-3 text-xs text-text-muted">最终产物</p>
                        <div className="flex flex-wrap gap-x-5 gap-y-3">
                          {RESEARCH_PRODUCTS.map((product) => (
                            <label
                              key={product}
                              className="inline-flex items-center gap-2 text-sm"
                            >
                              <input
                                type="checkbox"
                                className="accent-current"
                                checked={input.products.includes(product)}
                                onChange={(event) =>
                                  setInput((previous) => ({
                                    ...previous,
                                    products: event.target.checked
                                      ? [...previous.products, product]
                                      : previous.products.filter(
                                          (value) => value !== product,
                                        ),
                                  }))
                                }
                              />
                              {product === "board"
                                ? "网页留档 / 视觉资料"
                                : PRODUCT_LABELS[product]}
                            </label>
                          ))}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-x-6 gap-y-3 border-b border-border pb-5">
                        <label className="inline-flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="accent-current"
                            checked={input.collectVisuals}
                            onChange={(event) =>
                              setInput((previous) => ({
                                ...previous,
                                collectVisuals: event.target.checked,
                              }))
                            }
                          />
                          收集网页截图与视觉资料
                        </label>
                        <label className="inline-flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="accent-current"
                            checked={input.verify}
                            onChange={(event) =>
                              setInput((previous) => ({
                                ...previous,
                                verify: event.target.checked,
                              }))
                            }
                          />
                          核验关键结论
                        </label>
                      </div>
                    </div>
                  </details>
                  {plan && (
                    <details aria-label="研究计划">
                      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 text-xs text-text-muted">
                        查看研究步骤
                        <span className="text-xs text-text-muted">
                          {plan.stages.length} 个阶段
                        </span>
                      </summary>
                      <ol className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-3">
                        {plan.stages.map((stage, index) => (
                          <li
                            key={stage.kind}
                            className="flex items-center gap-2 text-xs"
                          >
                            {index > 0 && (
                              <ChevronRight
                                size={13}
                                className="text-text-faint"
                              />
                            )}
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-surface-2 text-text-muted">
                              {index + 1}
                            </span>
                            {STAGE_LABELS[stage.kind]}
                          </li>
                        ))}
                      </ol>
                      <p className="mt-3 text-xs text-text-faint">
                        {plan.reason}
                        {input.sourceTaskId
                          ? ` · 沿用研究版本 ${input.sourceTaskId.slice(-8)}`
                          : ""}
                      </p>
                      <p className="mt-2 text-xs text-text-faint">
                        最多 {plan.limits.llm} 次模型调用 · 本次时限{" "}
                        {plan.limits.minutes} 分钟
                      </p>
                    </details>
                  )}
                  {(intakeReady || input.sourceTaskId) && (
                    <div className="flex flex-wrap items-center justify-between gap-3 pb-5">
                      <span className="text-xs text-text-muted">
                        内测期间记录成本，不扣积分
                      </span>
                      <Button
                        variant="primary"
                        disabled={
                          !plan ||
                          planInputKey !== JSON.stringify(input) ||
                          !health?.ready ||
                          !model ||
                          !input.products.length
                        }
                        loading={busy}
                        onClick={() => void start()}
                      >
                        <Play size={14} />
                        开始研究
                      </Button>
                    </div>
                  )}
                </fieldset>
              </>
            ) : (
              <>
                <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="mb-2 text-xs text-text-faint">
                      {PRESET_LABELS[task.preset as keyof typeof PRESET_LABELS]}{" "}
                      · {SCOPE_LABELS[task.scope as keyof typeof SCOPE_LABELS]}
                    </p>
                    <h2 className="line-clamp-2 break-words text-lg font-semibold leading-7 sm:text-xl">
                      {task.brief.question.slice(0, 160)}
                    </h2>
                    {task.brief.question.length > 100 && (
                      <details className="mt-2 text-xs text-text-muted">
                        <summary className="cursor-pointer">研究需求</summary>
                        <p className="mt-2 whitespace-pre-wrap break-words leading-6">
                          {task.brief.question}
                        </p>
                      </details>
                    )}
                    <p className="mt-2 text-xs text-text-muted">
                      {researchExecutionLabel(task.status)} ·{" "}
                      {new Date(task.createdAt).toLocaleString("zh-CN")}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {active ? (
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => void operate("cancel")}
                      >
                        <Square size={13} />
                        停止
                      </Button>
                    ) : resumableStage ? (
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={busy || !canResume}
                        onClick={() =>
                          void operate("retry", resumableStage.id, true)
                        }
                      >
                        <Play size={14} />
                        继续研究
                      </Button>
                    ) : task.stages.some(
                        (stage) =>
                          stage.kind === "synthesize" &&
                          stage.status === "completed",
                      ) ? (
                      <Button size="sm" onClick={useVersion}>
                        <FileText size={14} />
                        {(
                          task.stages.find(
                            (stage) => stage.kind === "synthesize",
                          )?.result as {
                            finalResearchPackage?: { schemaVersion?: number };
                          } | null
                        )?.finalResearchPackage?.schemaVersion === 2
                          ? "制作提案"
                          : "整理旧版并制作"}
                      </Button>
                    ) : null}
                  </div>
                </div>
                {selectedProject && selectedProject.tasks.length > 1 && (
                  <div className="mb-4 max-w-sm">
                    <Select
                      aria-label="研究版本"
                      value={task.id}
                      options={selectedProject.tasks.map((version) => ({
                        value: version.id,
                        label: `${new Date(version.createdAt).toLocaleString("zh-CN")} · ${researchExecutionLabel(version.status)}`,
                      }))}
                      onValueChange={(id) => void openTask(id)}
                    />
                  </div>
                )}
                <details
                  aria-label="运行与版本信息"
                  className="mb-4 text-xs text-text-muted"
                >
                  <summary className="cursor-pointer">运行与版本信息</summary>
                  <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 leading-6">
                    <span>
                      模型 {task.llmCalls}/{task.plan.limits.llm}
                    </span>
                    <span>
                      搜索 {task.searchCalls}/{task.plan.limits.search}
                    </span>
                    <span>
                      采集 {task.crawlCalls}/{task.plan.limits.crawl}
                    </span>
                    <span>
                      已知调用成本{" "}
                      {task.costUsd === null
                        ? "未知"
                        : `$${Number(task.costUsd).toFixed(4)}`}
                    </span>
                    {task.unknownCostCalls > 0 && (
                      <span>{task.unknownCostCalls} 次调用费用未知</span>
                    )}
                    {decisions?.version && (
                      <span title={decisions.version}>
                        冻结版本 {decisions.version.slice(0, 12)}
                      </span>
                    )}
                    {task.expiresAt && (
                      <span>
                        文件保留至{" "}
                        {new Date(task.expiresAt).toLocaleDateString("zh-CN")}
                      </span>
                    )}
                  </div>
                </details>
                {(quality || !active) && (
                  <section
                    aria-label="研究质量"
                    className="mb-5 rounded-md border border-border bg-surface-2/60 px-4 py-3"
                  >
                    <p className="text-sm font-medium">
                      {researchQualityLabel(quality?.status ?? null)}
                    </p>
                    <details className="mt-2 text-xs text-text-muted">
                      <summary className="cursor-pointer">
                        材料检查与限制
                        {quality?.issues.length
                          ? `（${quality.issues.length} 项）`
                          : ""}
                      </summary>
                      <p className="mt-2 leading-6">
                        {quality
                          ? "标记反映本轮材料检查结果；判断的依据和限制可在报告与来源中继续核对。"
                          : "这个版本尚未保存质量检查记录；任务执行完成不能说明证据充分。"}
                      </p>
                      {!!quality?.issues.length && (
                        <ul className="mt-2 list-disc space-y-1 pl-4 leading-6">
                          {quality.issues.map((issue, index) => (
                            <li key={`${issue.code}-${index}`}>
                              {issue.message}
                            </li>
                          ))}
                        </ul>
                      )}
                    </details>
                  </section>
                )}
                {active && (
                  <section
                    aria-label="实时研究状态"
                    className="mb-5 rounded-md border border-border px-4 py-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="flex items-center gap-2 text-sm font-medium">
                        <Loader2
                          size={14}
                          className="animate-spin"
                          aria-hidden="true"
                        />
                        {activeStage
                          ? STAGE_LABELS[activeStage.kind] || "正在研究"
                          : "等待执行器领取任务"}
                      </p>
                      <span className="text-xs tabular-nums text-text-faint">
                        任务历时 {researchElapsed(task.createdAt, clock)}
                        （含排队与恢复）
                      </span>
                    </div>
                    <p
                      role="status"
                      className="mt-2 text-xs leading-6 text-text-muted"
                    >
                      {subscription === "reconnecting"
                        ? "订阅正在重连；页面断开不会取消后台任务。"
                        : currentActivity ||
                          (activeStage
                            ? "等待新的阶段活动记录。"
                            : "任务已持久保存，等待执行。")}
                    </p>
                    {activeStage && !activeStageText && (
                      <p className="mt-1 text-xs leading-6 text-text-faint">
                        {activeStage.kind === "produce"
                          ? "文件制作进行中，当前尚未发布完整交付物。"
                          : "尚未收到本阶段正文增量。搜索与读取可能先于正文完成，收到真实内容后会逐步显示。"}
                      </p>
                    )}
                  </section>
                )}
                {task.error?.message && (
                  <div
                    role="alert"
                    className="mb-5 border-l-2 border-danger pl-3 text-sm text-danger"
                  >
                    {task.error.message}
                  </div>
                )}
                {resumableStage && canResume && (
                  <p className="mb-5 text-xs leading-5 text-text-muted">
                    {resumableStage.kind === "synthesize" &&
                    resumableStage.savedSynthesisComplete === true ? (
                      "成文结果已保存，可以继续发布；服务器会再次核对当前输入。"
                    ) : (
                      <>
                        已有资料与完成的阶段保留。续跑时间上限{" "}
                        {task.plan.limits.minutes}
                        {" 分钟，剩余 "}
                        {Math.max(0, task.plan.limits.llm - task.llmCalls)}{" "}
                        次模型调用。
                      </>
                    )}
                  </p>
                )}
                <nav
                  aria-label="研究视图"
                  className="mb-6 flex gap-1 overflow-x-auto border-b border-border"
                  role="tablist"
                >
                  {(
                    [
                      ["process", "过程"],
                      ["report", "报告"],
                      ["evidence", `证据 ${task.evidence.length}`],
                      ["files", `文件 ${task.artifacts.length}`],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      role="tab"
                      aria-selected={tab === value}
                      onClick={() => {
                        setTab(value);
                        setPreview(null);
                      }}
                      className={cn(
                        "shrink-0 border-b-2 px-4 py-3 text-sm",
                        tab === value
                          ? "border-foreground font-medium text-foreground"
                          : "border-transparent text-text-muted",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </nav>
                {tab === "process" && (
                  <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_220px]">
                    <div>
                      <ol className="space-y-0">
                        {task.stages.map((stage, index) => (
                          <li
                            key={stage.id}
                            className="flex min-h-14 gap-3 border-b border-border py-3"
                          >
                            <span
                              className={cn(
                                "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs",
                                stage.status === "completed"
                                  ? "bg-success/10 text-success"
                                  : "bg-surface-2 text-text-muted",
                              )}
                            >
                              {stage.status === "running" ? (
                                <Loader2 size={14} className="animate-spin" />
                              ) : stage.status === "completed" ? (
                                <Check size={14} />
                              ) : (
                                index + 1
                              )}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium">
                                {STAGE_LABELS[stage.kind]}
                              </p>
                              <p className="mt-1 text-xs text-text-faint">
                                {researchExecutionLabel(stage.status)}
                                {stage.attempts.length > 1
                                  ? ` · 第 ${stage.attempts.length} 次尝试`
                                  : ""}
                              </p>
                            </div>
                            {!active &&
                              [
                                "failed",
                                "interrupted",
                                "cancelled",
                                "pending",
                              ].includes(stage.status) &&
                              !task.stages
                                .slice(0, index)
                                .some((row) => row.status !== "completed") && (
                                <IconButton
                                  aria-label={`重试${STAGE_LABELS[stage.kind]}`}
                                  title="仅重试这个阶段"
                                  disabled={busy}
                                  onClick={() =>
                                    void operate("retry", stage.id)
                                  }
                                >
                                  <RefreshCw size={15} />
                                </IconButton>
                              )}
                          </li>
                        ))}
                      </ol>
                      {active && activeStageText && (
                        <ResearchMarkdown
                          className={cn(markdownClass, "mt-6")}
                          text={activeStageText}
                          components={reportLinks}
                        />
                      )}
                    </div>
                    <aside className="border-t border-border pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
                      <h3 className="mb-4 text-xs font-medium text-text-muted">
                        最新动态
                      </h3>
                      <ol className="space-y-3">
                        {events
                          .slice(-20)
                          .reverse()
                          .map((event) => (
                            <li
                              key={event.seq}
                              className="break-words text-xs leading-5 text-text-muted"
                            >
                              {event.message}
                            </li>
                          ))}
                      </ol>
                    </aside>
                  </div>
                )}
                {tab === "report" && (
                  <div>
                    {decisions && (
                      <ResearchDecisionOverview
                        decisions={decisions}
                        evidence={task.evidence}
                        onOpenSource={openEvidence}
                      />
                    )}
                    {report ? (
                      <section aria-label="研究报告全文">
                        {!!(
                          decisions?.cards.length || decisions?.gaps.length
                        ) && (
                          <h3 className="mb-5 border-t border-border pt-5 text-base font-semibold">
                            完整研究报告
                          </h3>
                        )}
                        <ResearchMarkdown
                          className={markdownClass}
                          text={reportMarkdown}
                          components={reportLinks}
                        />
                      </section>
                    ) : (
                      <p className="py-8 text-text-muted">
                        {active
                          ? "资料整理完成后，报告会在这里逐步显示。"
                          : "本版本尚未生成研究报告。"}
                      </p>
                    )}
                  </div>
                )}
                {tab === "evidence" && (
                  <>
                    <section
                      aria-label="来源使用情况"
                      className="mb-5 text-xs leading-6 text-text-muted"
                    >
                      <p>
                        已留档 {evidenceCounts.captured || 0} · 仅链接{" "}
                        {evidenceCounts.link_only || 0} · 采集失败{" "}
                        {evidenceCounts.fetch_failed || 0}
                        {evidenceCounts.provided
                          ? ` · 用户资料 ${evidenceCounts.provided}`
                          : ""}
                      </p>
                      <p className="mt-1 text-text-faint">
                        {contextManifest
                          ? `正文选用范围来自“${STAGE_LABELS[contextManifest.stageKind] || contextManifest.stageKind}”阶段；留档状态与纳入上下文的范围分别显示。`
                          : "这个版本未记录正文选用范围，无法据此判断模型读过哪些留档。"}
                      </p>
                    </section>
                    <div className="grid min-w-0 gap-5 sm:grid-cols-2">
                      {task.evidence.map((evidence, index) => (
                        <article
                          id={`evidence-${evidence.id}`}
                          key={evidence.id}
                          tabIndex={-1}
                          aria-label={`来源 ${index + 1}：${evidence.title}`}
                          className={cn(
                            "min-w-0 overflow-hidden rounded-md border border-border bg-surface outline-none",
                            highlightedEvidenceId === evidence.id &&
                              "ring-2 ring-brand ring-offset-2 ring-offset-surface",
                          )}
                        >
                          {evidence.screenshotKey && !evidence.expired && (
                            <a
                              href={`/api/research/evidence/${evidence.id}/file?kind=screenshot`}
                              target="_blank"
                              rel="noreferrer"
                              className="block border-b border-border bg-surface-2"
                            >
                              <img
                                src={`/api/research/evidence/${evidence.id}/file?kind=screenshot`}
                                alt={evidence.title}
                                className="h-52 w-full object-contain"
                                loading="lazy"
                              />
                            </a>
                          )}
                          <div className="p-4">
                            <p className="mb-2 text-[11px] text-text-faint">
                              来源 {index + 1} ·{" "}
                              {evidence.expired
                                ? "材料已过期"
                                : (
                                    {
                                      captured: "已留档",
                                      link_only: "仅链接",
                                      fetch_failed: "采集失败",
                                      provided: "用户资料",
                                    } as Record<string, string>
                                  )[evidence.status] || evidence.status}
                            </p>
                            {contextManifest?.sources.has(evidence.id) && (
                              <p className="mb-2 text-[11px] leading-5 text-text-muted">
                                {researchContextLabel(
                                  contextManifest.sources.get(evidence.id)!,
                                )}
                              </p>
                            )}
                            <h3 className="break-words text-sm font-medium">
                              {evidence.title}
                            </h3>
                            <p className="mt-2 line-clamp-4 break-words text-xs leading-6 text-text-muted">
                              {evidence.excerpt}
                            </p>
                            {evidence.fetchedAt && (
                              <p className="mt-2 text-[11px] text-text-faint">
                                留档于{" "}
                                {new Date(evidence.fetchedAt).toLocaleString(
                                  "zh-CN",
                                )}
                              </p>
                            )}
                            {evidence.originUrl &&
                              evidence.originUrl !== evidence.canonicalUrl && (
                                <p className="mt-2 text-xs text-text-muted">
                                  与其他材料关联同一原始来源，非独立佐证。
                                </p>
                              )}
                            <div className="mt-3 flex flex-wrap gap-3 text-xs">
                              <a
                                href={
                                  evidence.originalUrl.startsWith("attachment:")
                                    ? `/api/research/attachments/${evidence.originalUrl.slice(11)}`
                                    : evidence.originalUrl
                                }
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-brand"
                              >
                                <ExternalLink size={12} />
                                原始来源
                              </a>
                              {evidence.contentKey && !evidence.expired && (
                                <a
                                  href={`/api/research/evidence/${evidence.id}/file`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-text-muted"
                                >
                                  查看留档原文
                                </a>
                              )}
                            </div>
                            <p className="mt-3 break-all font-mono text-[10px] text-text-faint">
                              {evidence.id}
                            </p>
                          </div>
                        </article>
                      ))}
                      {!task.evidence.length && (
                        <p className="py-8 text-sm text-text-muted">
                          {active ? "正在收集来源。" : "本版本尚未保存证据。"}
                        </p>
                      )}
                    </div>
                  </>
                )}
                {tab === "files" && (
                  <div>
                    {preview ? (
                      <>
                        <div className="mb-4 flex items-center justify-between gap-3">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setPreview(null)}
                          >
                            <ArrowLeft size={14} />
                            文件列表
                          </Button>
                          <a
                            href={`/api/research/files/${preview.file.id}`}
                            className="inline-flex items-center gap-2 text-sm"
                          >
                            <Download size={14} />
                            下载
                          </a>
                        </div>
                        {preview.file.mimeType.startsWith("text/html") ? (
                          <iframe
                            title={researchArtifactLabel(preview.file)}
                            sandbox=""
                            srcDoc={preview.content}
                            className="h-[65vh] min-h-80 w-full rounded-md border border-border bg-white"
                          />
                        ) : preview.file.mimeType.startsWith(
                            "text/markdown",
                          ) ? (
                          <ResearchMarkdown
                            className={markdownClass}
                            text={preview.content}
                          />
                        ) : (
                          <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-surface-2 p-4 text-xs leading-6">
                            {preview.content}
                          </pre>
                        )}
                      </>
                    ) : (
                      <div className="divide-y divide-border">
                        {task.artifacts.map((file) => (
                          <div
                            key={file.id}
                            className="flex min-w-0 items-center gap-3 py-4"
                          >
                            <FileText
                              size={20}
                              className="shrink-0 text-text-muted"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="break-words text-sm font-medium">
                                {researchArtifactLabel(file)}
                              </p>
                              <p className="mt-1 break-all text-xs text-text-faint">
                                {file.filename} ·{" "}
                                {(file.sizeBytes / 1024).toFixed(0)} KB
                                {file.expired ? " · 已过期" : ""}
                              </p>
                            </div>
                            {file.mimeType.startsWith("text/") &&
                              !file.expired && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={busy}
                                  onClick={() => void previewFile(file)}
                                >
                                  预览
                                </Button>
                              )}
                            {!file.expired && (
                              <IconButton
                                asChild
                                aria-label={`下载${researchArtifactLabel(file)}`}
                                title={`下载${researchArtifactLabel(file)}`}
                              >
                                <a href={`/api/research/files/${file.id}`}>
                                  <Download size={16} />
                                </a>
                              </IconButton>
                            )}
                          </div>
                        ))}
                        {!task.artifacts.length && (
                          <p className="py-8 text-sm text-text-muted">
                            {active
                              ? "交付物完成后会保存在这里。"
                              : "本版本尚未生成文件。"}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

