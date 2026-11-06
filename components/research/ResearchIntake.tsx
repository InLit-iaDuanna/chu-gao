"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Loader2,
  Paperclip,
  RefreshCw,
  Sparkles,
  Square,
} from "lucide-react";
import { Button, IconButton, Textarea } from "@/components/ui";
import {
  researchTerminal,
  type ResearchBriefInput,
  type ResearchIntakeResult,
  type ResearchIntakeView,
  type ResearchPlanInput,
} from "@/lib/research/types";
import { cn } from "@/lib/utils";
import {
  currentIntakeResult,
  intakeBrief,
  intakeSnapshotIncludesTask,
} from "./intake-presentation";

import {
  clearIntakeReceipt,
  readIntakeReceipt,
  saveIntakeReceipt,
  type IntakeSubmissionReceipt,
} from "./intake-receipt";

class IntakeRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}
async function intakeApi<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json" },
  });
  const body = await response.json();
  if (!response.ok || !body.ok)
    throw new IntakeRequestError(
      body.error?.message || "需求对话暂时无法连接",
      response.status,
      body.error?.code,
    );
  return body.data;
}

export function ResearchIntake({
  projectId,
  input,
  ensureProject,
  onDraft,
  onUpload,
  onPendingChange,
  disabled,
}: {
  projectId: string;
  input: ResearchPlanInput;
  ensureProject: () => Promise<string>;
  onDraft: (
    brief: ResearchBriefInput,
    ready: boolean,
    products: ResearchIntakeResult["products"],
    settings?: ResearchIntakeView["settings"],
    confirmedTaskId?: string,
  ) => void;
  onUpload: () => void;
  onPendingChange?: (pending: boolean) => void;
  disabled: boolean;
}) {
  const [view, setView] = useState<ResearchIntakeView | null>(null);
  const [answer, setAnswer] = useState(projectId ? "" : input.brief.question);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [uncertainSend, setUncertainSend] = useState(false);
  const [connectionLost, setConnectionLost] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const currentInput = useRef(input);
  const currentView = useRef(view);
  const answerRef = useRef(answer);
  const optimisticRef = useRef(optimistic);
  const receipt = useRef<IntakeSubmissionReceipt | null>(null);
  const onDraftRef = useRef(onDraft);
  const epoch = useRef(0);
  const project = useRef(projectId);
  const acceptedTask = useRef<string | null>(null);
  const submitting = useRef(false);
  const restored = useRef(false);
  const userEdited = useRef(false);
  currentInput.current = input;
  currentView.current = view;
  onDraftRef.current = onDraft;
  answerRef.current = answer;
  optimisticRef.current = optimistic;

  const invalidateDraft = useCallback(() => {
    const current = currentInput.current;
    onDraftRef.current(current.brief, false, current.products);
  }, []);

  const apply = useCallback(
    (next: ResearchIntakeView) => {
      if (
        !intakeSnapshotIncludesTask(
          next,
          acceptedTask.current,
          currentView.current,
        )
      )
        return;
      // Only the server's submission identity can recover a lost POST response.
      // Another tab can submit identical words with different settings/files.
      const pending = receipt.current;
      if (
        pending &&
        ((pending.acceptedTaskId &&
          intakeSnapshotIncludesTask(next, pending.acceptedTaskId)) ||
          (next.task && next.latestClientRequestId === pending.clientRequestId))
      ) {
        clearIntakeReceipt(pending.projectId);
        receipt.current = null;
        setUncertainSend(false);
      }
      currentView.current = next;
      setView(next);
      setConnectionLost(false);
      if (!receipt.current) setError(null);
      if (next.task && !researchTerminal(next.task.status)) {
        acceptedTask.current = next.task.id;
        setPendingId(next.task.id);
      } else {
        acceptedTask.current = null;
        setPendingId(null);
      }
      if (
        !submitting.current &&
        next.messages.some(
          (message) =>
            message.id === `${next.task?.id}-user` &&
            message.content === optimisticRef.current,
        )
      )
        setOptimistic("");
      if (next.result) {
        const brief = intakeBrief(
          currentInput.current.brief,
          next,
          restored.current,
        );
        restored.current = true;
        const ready =
          !!currentIntakeResult(next)?.ready &&
          !submitting.current &&
          !receipt.current &&
          !answerRef.current.trim();
        onDraftRef.current(
          brief,
          ready,
          next.result.products,
          next.settings,
          ready ? next.task?.id : undefined,
        );
      } else if (next.task) {
        const brief = intakeBrief(
          currentInput.current.brief,
          next,
          restored.current,
        );
        restored.current = true;
        onDraftRef.current(
          brief,
          false,
          next.settings?.products ?? currentInput.current.products,
          next.settings,
        );
      } else {
        invalidateDraft();
      }
    },
    [invalidateDraft],
  );

  const load = useCallback(
    async (id: string, signal?: AbortSignal) => {
      const version = epoch.current;
      const next = await intakeApi<ResearchIntakeView>(
        `/api/research/intake?projectId=${encodeURIComponent(id)}`,
        { signal },
      );
      if (
        !signal?.aborted &&
        version === epoch.current &&
        project.current === id
      )
        apply(next);
      return next;
    },
    [apply],
  );

  useEffect(() => {
    if (project.current && project.current !== projectId) {
      epoch.current++;
      acceptedTask.current = null;
      receipt.current = null;
      submitting.current = false;
      restored.current = false;
      userEdited.current = false;
      currentView.current = null;
      answerRef.current = "";
      setView(null);
      setPendingId(null);
      setSending(false);
      setUncertainSend(false);
      setOptimistic("");
      setAnswer("");
      setError(null);
      invalidateDraft();
    }
    project.current = projectId;
    if (!projectId) return;
    const savedReceipt = readIntakeReceipt(projectId);
    if (savedReceipt && !receipt.current) {
      receipt.current = savedReceipt;
      acceptedTask.current = savedReceipt.acceptedTaskId ?? null;
      setPendingId(savedReceipt.acceptedTaskId ?? null);
      setUncertainSend(!savedReceipt.acceptedTaskId);
      setOptimistic(savedReceipt.answer);
      setError("正在确认上次回答的保存状态。");
      invalidateDraft();
    }
    const abort = new AbortController();
    setLoading(true);
    void load(projectId, abort.signal)
      .catch((caught) => {
        if (!abort.signal.aborted)
          setError(
            caught instanceof Error ? caught.message : "需求对话恢复失败",
          );
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [projectId, load, invalidateDraft]);

  useEffect(() => {
    if (
      !projectId &&
      !userEdited.current &&
      !currentView.current?.messages.length
    ) {
      answerRef.current = input.brief.question;
      setAnswer(input.brief.question);
    }
  }, [projectId, input.brief.question]);

  const taskId =
    pendingId ||
    (view?.task && !researchTerminal(view.task.status) ? view.task.id : null);
  const active = !!taskId;
  useEffect(() => {
    if (!taskId || !projectId) return;
    const abort = new AbortController();
    const source = new EventSource(
      `/api/research/tasks/${taskId}/events?after=0`,
    );
    let fetching = false;
    let refreshAgain = false;
    const refresh = async () => {
      if (abort.signal.aborted) return;
      if (fetching) {
        refreshAgain = true;
        return;
      }
      fetching = true;
      try {
        const next = await load(projectId, abort.signal);
        if (next.task && researchTerminal(next.task.status)) source.close();
      } catch (caught) {
        if (!abort.signal.aborted)
          setError(caught instanceof Error ? caught.message : "回复读取失败");
      } finally {
        fetching = false;
        if (refreshAgain && !abort.signal.aborted) {
          refreshAgain = false;
          void refresh();
        }
      }
    };
    source.addEventListener("terminal", () => void refresh());
    source.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (
          [
            "task.completed",
            "task.failed",
            "task.cancelled",
            "task.interrupted",
            "task.budget_exhausted",
            "call.started",
            "call.retry_scheduled",
            "intake.retry_scheduled",
          ].includes(message.type)
        )
          void refresh();
      } catch {
        // A malformed event cannot manufacture a reply or restart the model.
        void refresh();
      }
    };
    source.onopen = () => setConnectionLost(false);
    source.onerror = () => {
      setConnectionLost(true);
      void refresh();
    };
    void refresh();
    return () => {
      source.close();
      abort.abort();
    };
  }, [taskId, projectId, load]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [view?.messages.length, sending]);
  useEffect(
    () => () => {
      epoch.current++;
    },
    [],
  );

  const send = async (
    retry = false,
    repeatedAnswer?: string,
    questionTaskId?: string,
  ) => {
    const text = retry
      ? (receipt.current?.answer ?? "")
      : (repeatedAnswer ?? answerRef.current).trim();
    if (
      !text ||
      submitting.current ||
      active ||
      acceptedTask.current ||
      (!retry && receipt.current) ||
      disabled ||
      loading ||
      (uncertainSend && !retry)
    )
      return;
    // Capture the question the user actually answered before awaiting project
    // creation. A newer snapshot must not silently rebind an older choice.
    const previousTaskId = currentView.current?.task?.id ?? null;
    if (
      questionTaskId &&
      (questionTaskId !== previousTaskId ||
        currentView.current?.resultTaskId !== questionTaskId ||
        !currentIntakeResult(currentView.current)?.nextQuestion ||
        currentIntakeResult(currentView.current)?.ready ||
        answerRef.current.trim())
    )
      return;
    const version = epoch.current;
    submitting.current = true;
    setSending(true);
    setError(null);
    setOptimistic(text);
    invalidateDraft();
    if (!retry) {
      answerRef.current = "";
      setAnswer("");
    }
    let accepted = false;
    let attemptedPost = retry;
    try {
      const id =
        retry && receipt.current
          ? receipt.current.projectId
          : await ensureProject();
      if (version !== epoch.current) return;
      project.current = id;
      window.history.replaceState(
        null,
        "",
        `/app/research?project=${encodeURIComponent(id)}`,
      );
      if (!retry || !receipt.current) {
        const current = currentInput.current;
        const clientRequestId = crypto.randomUUID();
        receipt.current = {
          clientRequestId,
          answer: text,
          projectId: id,
          previousTaskId,
          body: JSON.stringify({
            ...current,
            brief: {
              ...current.brief,
              question: current.brief.question.trim() || text,
            },
            projectId: id,
            previousTaskId,
            answer: text,
            clientRequestId,
          }),
        };
      }
      saveIntakeReceipt(receipt.current);
      attemptedPost = true;
      const response = await intakeApi<{ taskId: string; projectId: string }>(
        "/api/research/intake",
        {
          method: "POST",
          body: receipt.current.body,
        },
      );
      if (version !== epoch.current) return;
      accepted = true;
      acceptedTask.current = response.taskId;
      setPendingId(response.taskId);
      if (receipt.current) {
        receipt.current.acceptedTaskId = response.taskId;
        saveIntakeReceipt(receipt.current);
      }
      setUncertainSend(false);
      submitting.current = false;
      setSending(false);
      await load(id);
    } catch (caught) {
      if (version !== epoch.current) return;
      if (accepted) {
        setError(
          "回答已提交，暂时无法读取回复。可以重新读取对话，无需再发送一次。",
        );
      } else {
        const definiteFailure =
          !attemptedPost ||
          (caught instanceof IntakeRequestError && caught.status < 500);
        setUncertainSend(!definiteFailure && !!receipt.current);
        if (definiteFailure || !receipt.current) {
          if (receipt.current) clearIntakeReceipt(receipt.current.projectId);
          receipt.current = null;
          setOptimistic("");
          if (!answerRef.current) {
            answerRef.current = text;
            setAnswer(text);
          }
        }
        setError(caught instanceof Error ? caught.message : "回答未能提交");
        if (
          caught instanceof IntakeRequestError &&
          ["INTAKE_CHANGED", "INTAKE_ACTIVE"].includes(caught.code ?? "") &&
          project.current
        ) {
          // Another tab won the server's existing previousTaskId/active-turn
          // check. Read its result, preserve this answer, never repost it.
          try {
            await load(project.current);
            if (version === epoch.current)
              setError(
                "需求对话已在其他页面更新。你的回答保留在输入框，请查看最新对话后再发送。",
              );
          } catch {
            if (version === epoch.current)
              setError(
                "需求对话已在其他页面更新，暂时无法读取。你的回答已保留，可以重新读取对话。",
              );
          }
        }
      }
    } finally {
      if (version === epoch.current) {
        submitting.current = false;
        setSending(false);
      }
    }
  };

  const reread = async () => {
    if (!project.current || loading) return;
    setLoading(true);
    setError(null);
    const version = epoch.current;
    try {
      await load(project.current);
    } catch (caught) {
      if (version === epoch.current)
        setError(caught instanceof Error ? caught.message : "需求对话恢复失败");
    } finally {
      if (version === epoch.current) setLoading(false);
    }
  };
  const changeAnswer = (value: string) => {
    userEdited.current = true;
    answerRef.current = value;
    setAnswer(value);
    if (value.trim()) invalidateDraft();
    else if (currentView.current) apply(currentView.current);
  };
  const waiting = sending || active;
  const pending = waiting || loading || uncertainSend;
  useEffect(() => {
    onPendingChange?.(pending);
    return () => onPendingChange?.(false);
  }, [onPendingChange, pending]);
  const latestFailure =
    view?.task &&
    !["completed", "queued", "running"].includes(view.task.status);
  const result = currentIntakeResult(view);
  const showSuggestions =
    !!result?.nextQuestion &&
    !result.ready &&
    result.suggestions.length >= 2 &&
    !pending &&
    !disabled &&
    !answer.trim() &&
    !optimistic;
  const messages = view?.messages || [];
  const failedAnswer = latestFailure
    ? messages.filter((message) => message.role === "user").at(-1)?.content
    : undefined;
  const retries = Math.max(0, (view?.task?.llmCalls ?? 0) - 1);
  const failureMessage =
    retries > 0 &&
    ["UPSTREAM_INCOMPLETE", "UPSTREAM_ERROR"].includes(
      view?.task?.error?.code ?? "",
    )
      ? `自动重试 ${retries} 次后仍未完成回复，你的回答已保存。`
      : view?.task?.error?.code === "UPSTREAM_INCOMPLETE"
        ? "模型服务未能完成这次回复，你的回答已保存。"
        : view?.task?.error?.message;
  const showSummary = !!result?.ready && !waiting && !uncertainSend;
  const displayedMessages = messages.filter(
    (message) =>
      !(
        showSummary &&
        message.id === view?.resultTaskId &&
        message.role === "assistant" &&
        message.content.trim() === result?.summary.trim()
      ),
  );
  const hasOptimistic =
    optimistic &&
    !messages.some(
      (message) =>
        message.role === "user" &&
        message.content === optimistic &&
        message.id === `${view?.task?.id}-user`,
    );

  return (
    <section aria-label="研究需求对话" className="min-w-0">
      <div
        role="log"
        aria-label="需求对话记录"
        aria-live="polite"
        aria-busy={waiting}
        className="space-y-6 pb-5"
      >
        {!messages.length && !optimistic && !loading && (
          <div className="flex items-start gap-3 py-3">
            <Sparkles
              size={18}
              aria-hidden="true"
              className="mt-1 shrink-0 text-brand"
            />
            <p className="text-sm leading-7">
              这次想研究什么？直接说说你的想法就好。
            </p>
          </div>
        )}
        {displayedMessages.map((message) => (
          <div
            key={message.id}
            data-role={message.role}
            className={cn(
              "flex min-w-0",
              message.role === "user" ? "justify-end" : "items-start gap-3",
            )}
          >
            {message.role === "assistant" && (
              <Sparkles
                size={17}
                aria-hidden="true"
                className="mt-1.5 shrink-0 text-brand"
              />
            )}
            <p
              className={cn(
                "whitespace-pre-wrap break-words text-sm leading-7",
                message.role === "user"
                  ? "max-w-[90%] rounded-lg bg-surface-2 px-4 py-2.5"
                  : "min-w-0 flex-1",
              )}
            >
              {message.content}
            </p>
          </div>
        ))}
        {showSuggestions && (
          <div className="space-y-2 pl-7">
            <div
              role="group"
              aria-label="建议回答"
              aria-describedby="research-intake-suggestions-help"
              className="flex flex-wrap gap-2"
            >
              {result.suggestions.map((suggestion) => (
                <Button
                  key={suggestion}
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-auto max-w-full justify-start whitespace-normal break-words rounded-lg border border-border bg-surface px-3 py-2 text-left text-sm font-normal leading-6 hover:border-text-faint"
                  onClick={() =>
                    void send(
                      false,
                      suggestion,
                      view?.resultTaskId ?? undefined,
                    )
                  }
                >
                  {suggestion}
                </Button>
              ))}
            </div>
            <p
              id="research-intake-suggestions-help"
              className="text-xs leading-6 text-text-faint"
            >
              可以点选一句作为回答，也可以在下面自由输入。
            </p>
          </div>
        )}
        {hasOptimistic && (
          <div className="flex justify-end">
            <p className="max-w-[90%] whitespace-pre-wrap break-words rounded-lg bg-surface-2 px-4 py-2.5 text-sm leading-7">
              {optimistic}
            </p>
          </div>
        )}
        {(waiting || loading) && (
          <p
            role="status"
            className="flex items-center gap-2 text-xs text-text-muted"
          >
            <Loader2 size={14} className="animate-spin" />
            {sending
              ? "正在发送你的想法…"
              : loading && !waiting
                ? "正在恢复需求对话"
                : connectionLost
                  ? "连接暂时中断，正在读取已保存的对话…"
                  : view?.task?.status === "queued"
                    ? "需求对话排队中…"
                    : view?.task?.status === "running"
                      ? retries > 0
                        ? `正在自动重试回复（${retries}/${Math.max(1, view.task.plan.limits.llm - 1)}）…`
                        : "需求助手正在整理你的想法…"
                      : "正在读取已提交的回答…"}
          </p>
        )}
      </div>

      {result && showSummary && (
        <section
          aria-label="已理解的研究需求"
          className="mb-5 rounded-lg border border-border bg-surface-2/40 px-4 py-4"
        >
          <h3 className="mb-2 text-sm font-medium">我理解的研究方向</h3>
          <p className="whitespace-pre-wrap break-words text-sm leading-7">
            {result.summary}
          </p>
          {!!result.unknowns?.length && (
            <p className="mt-3 break-words text-xs leading-6 text-text-muted">
              研究中继续澄清：{result.unknowns.join("；")}
            </p>
          )}
          <p className="mt-3 text-xs leading-6 text-text-faint">
            {answer.trim()
              ? "发送这次修改后，会更新这里的理解。"
              : "可以直接开始研究；想调整的话，继续在下面告诉我。"}
          </p>
        </section>
      )}

      <div ref={end} />
      {(error || latestFailure || uncertainSend) && (
        <div className="mb-4 space-y-2">
          <p role="alert" className="text-sm leading-6 text-danger">
            {error || failureMessage || "这次整理未完成，已有回答仍然保留。"}
          </p>
          {uncertainSend && (
            <p className="text-xs leading-6 text-text-muted">
              发送状态尚未确认。重试会使用同一次提交记录。
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {failedAnswer && !uncertainSend && !answer.trim() && (
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled || waiting || loading}
                onClick={() => void send(false, failedAnswer)}
              >
                <RefreshCw size={13} />
                重新整理这条回答
              </Button>
            )}
            {uncertainSend && (
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled || sending || loading}
                onClick={() => void send(true)}
              >
                重试发送
              </Button>
            )}
            {!!project.current && (
              <Button
                size="sm"
                variant="ghost"
                disabled={loading}
                onClick={() => void reread()}
              >
                <RefreshCw size={13} />
                重新读取对话
              </Button>
            )}
          </div>
        </div>
      )}
      <div className="rounded-lg border border-border bg-surface shadow-sm focus-within:border-text-faint focus-within:ring-2 focus-within:ring-foreground/25">
        <Textarea
          ref={editor}
          aria-label="告诉研究助手你的想法"
          aria-describedby="research-intake-help"
          value={answer}
          maxLength={8000}
          onChange={(event) => changeAnswer(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing &&
              !window.matchMedia("(pointer: coarse)").matches
            ) {
              event.preventDefault();
              void send();
            }
          }}
          placeholder={
            messages.length
              ? "直接回答，也可以修改前面的想法…"
              : "我想为一款无糖饮料做包装，先了解市场和设计机会…"
          }
          rows={3}
          disabled={disabled}
          className="max-h-52 resize-y border-0 bg-transparent px-4 py-3 text-sm leading-7 shadow-none focus:shadow-none focus-visible:outline-none! focus-visible:shadow-none! focus-visible:ring-0!"
        />
        <div className="flex items-center justify-between px-2 pb-2">
          <IconButton
            aria-label="添加参考资料（可选）"
            title="添加参考资料（可选）"
            onClick={onUpload}
            disabled={disabled || waiting}
          >
            <Paperclip size={17} />
          </IconButton>
          {waiting ? (
            <IconButton
              title="停止整理"
              aria-label="停止整理"
              disabled={!taskId || sending}
              onClick={() => {
                if (!taskId) return;
                const version = epoch.current;
                void intakeApi(`/api/research/tasks/${taskId}/cancel`, {
                  method: "POST",
                  body: "{}",
                })
                  .then(() => {
                    if (version === epoch.current) return load(project.current);
                  })
                  .catch((caught) => {
                    if (version === epoch.current)
                      setError(
                        caught instanceof Error
                          ? caught.message
                          : "停止整理失败",
                      );
                  });
              }}
            >
              <Square size={15} />
            </IconButton>
          ) : (
            <IconButton
              title="发送回答"
              aria-label="发送回答"
              disabled={!answer.trim() || disabled || loading || uncertainSend}
              onClick={() => void send()}
              className="bg-foreground text-background hover:bg-foreground/85 disabled:bg-surface-2 disabled:text-text-faint"
            >
              <ArrowUp size={18} />
            </IconButton>
          )}
        </div>
      </div>
      <p
        id="research-intake-help"
        className="mt-3 text-xs leading-6 text-text-faint"
      >
        参考资料可选，开始研究时读取。
      </p>
    </section>
  );
}

