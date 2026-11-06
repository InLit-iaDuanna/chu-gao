"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  Check,
  ChevronDown,
  FileText,
  ImageIcon,
  Loader2,
  LockKeyhole,
  Pencil,
  RefreshCw,
  Sparkles,
  UnlockKeyhole,
} from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Select,
  Textarea,
} from "@/components/ui";
import {
  CREATIVE_FIELDS,
  CREATIVE_LABELS,
  CREATIVE_LIMITS,
  creativePrompt,
  creativeReferenceRequest,
  type CreativeField,
  type CreativeDraft,
} from "@/lib/creative-brief";
import type { DockParams, ReferenceItem } from "./CommandDock";
import { sizeLabel } from "./CommandDock";
import { CopyTextButton } from "./CopyTextButton";
import { quoteCreativeGeneration } from "./lib/api";
import type { CreateGenerationInput, ModelInfo } from "./lib/types";
import type { Generation } from "./lib/types";

export interface AgentTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface CreativeBriefPanelProps {
  draft: CreativeDraft;
  onChange: (draft: CreativeDraft) => void;
  turns: AgentTurn[];
  pendingInstruction: string | null;
  agentToolStatus: string | null;
  onSuggestion: (text: string) => void;
  onContinue: (text?: string) => void;
  references: ReferenceItem[];
  model: ModelInfo | null;
  params: DockParams;
  busy: boolean;
  disabledReason: string | null;
  errorMessage: string | null;
  onBusyChange: (busy: boolean) => void;
  onConfirm: (input: CreateGenerationInput) => Promise<boolean>;
  agentGeneration: Generation | null;
  qualityCheck: import("./lib/types").CreativeQualityCheck | null;
  qualityChecking: boolean;
  qualityError: string | null;
  onRecheckQuality: () => void;
}

const editableFields = CREATIVE_FIELDS.filter(
  (field) => field !== "goal",
) as CreativeField[];

export function CreativeBriefPanel({
  draft,
  onChange,
  turns,
  pendingInstruction,
  agentToolStatus,
  onSuggestion,
  onContinue,
  references,
  model,
  params,
  busy,
  disabledReason,
  errorMessage,
  onBusyChange,
  onConfirm,
  agentGeneration,
  qualityCheck,
  qualityChecking,
  qualityError,
  onRecheckQuality,
}: CreativeBriefPanelProps) {
  const [quoting, setQuoting] = useState(false);
  const [confirmation, setConfirmation] =
    useState<CreateGenerationInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const revision = useRef(0);
  useEffect(() => {
    revision.current += 1;
    return () => {
      revision.current += 1;
    };
  }, [
    draft.brief,
    draft.baseReference,
    model?.id,
    params.size,
    params.outputFormat,
  ]);

  const baseKey = draft.baseReference
    ? `${draft.baseReference.kind}:${draft.baseReference.key}`
    : "none";
  const base = references.find(
    (reference) => `${reference.kind}:${reference.key}` === baseKey,
  );
  const baseMissing = Boolean(draft.baseReference && !base);
  const unavailable =
    disabledReason || (baseMissing ? "基图不可用，请重新选择" : null);
  const locked = busy || quoting;
  const hasPlan = Boolean(draft.brief.goal.trim());
  const promptPreview = hasPlan
    ? creativePrompt(draft.brief, Boolean(base))
    : "";

  const review = async () => {
    if (!model || !hasPlan || locked || unavailable) return;
    setQuoting(true);
    onBusyChange(true);
    setError(null);
    const version = revision.current;
    try {
      const settings = {
        modelId: model.id,
        size: params.size ?? model.defaults.size,
        outputFormat: params.outputFormat ?? model.defaults.outputFormat,
      };
      const quote = await quoteCreativeGeneration({
        ...settings,
        brief: draft.brief,
        baseReference: draft.baseReference,
      });
      if (version !== revision.current) return;
      const operationId = draft.operationId ?? crypto.randomUUID();
      onChange({ ...draft, operationId });
      setConfirmation({
        ...settings,
        prompt: quote.prompt,
        n: 1,
        ...creativeReferenceRequest(draft.baseReference),
        creative: {
          operationId,
          brief: draft.brief,
          locked: draft.locked,
          baseReference: draft.baseReference,
          maxCredits: quote.estimatedCredits,
        },
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : "暂时无法确认费用");
    } finally {
      setQuoting(false);
      onBusyChange(false);
    }
  };

  const updateBrief = (field: CreativeField, value: string) => {
    onChange({
      ...draft,
      operationId: null,
      questions: [],
      brief: { ...draft.brief, [field]: value },
    });
  };

  const toggleLock = (field: CreativeField) => {
    const isLocked = draft.locked.includes(field);
    onChange({
      ...draft,
      operationId: null,
      locked: isLocked
        ? draft.locked.filter((item) => item !== field)
        : [...draft.locked, field],
    });
  };

  return (
    <section
      aria-label="创作 Agent"
      className="mx-auto w-full max-w-[50rem] px-1 py-6"
    >
      <header className="flex items-start gap-3 border-b border-border pb-5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
          <Sparkles size={17} />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold">创作 Agent</h2>
          <p className="mt-1 text-sm leading-6 text-text-muted">
            {hasPlan
              ? "我已经整理出当前方案，你可以继续修改，或直接确认生成。"
              : "先告诉我你想做什么，我会边问边整理，不会直接替你猜。"}
          </p>
        </div>
      </header>

      <div className="space-y-5 py-5">
        {!turns.length ? (
          <div className="flex items-start gap-3 text-[15px] leading-7">
            <Sparkles
              size={17}
              className="mt-1 shrink-0 text-text-muted"
              aria-hidden
            />
            <p>
              可以直接说“把这张图的栏杆改成细金属栏杆，其他都不要动”，也可以先拖入参考图，再选作基图。
            </p>
          </div>
        ) : (
          <div className="space-y-4" aria-label="Agent 对话">
            {turns.map((turn) => (
              <div
                key={turn.id}
                className={
                  turn.role === "user"
                    ? "flex justify-end"
                    : "flex items-start gap-3"
                }
              >
                {turn.role === "assistant" ? (
                  <Sparkles
                    size={17}
                    className="mt-1 shrink-0 text-text-muted"
                    aria-hidden
                  />
                ) : null}
                <p
                  className={
                    turn.role === "user"
                      ? "max-w-[88%] rounded-2xl bg-surface-2 px-4 py-2.5 text-[15px] leading-7"
                      : "max-w-[92%] text-[15px] leading-7"
                  }
                >
                  {turn.content}
                </p>
              </div>
            ))}
          </div>
        )}

        {pendingInstruction ? (
          <div className="space-y-3" aria-live="polite">
            <div className="flex justify-end">
              <p className="max-w-[88%] whitespace-pre-wrap break-words rounded-2xl bg-surface-2 px-4 py-2.5 text-[15px] leading-7">
                {pendingInstruction}
              </p>
            </div>
            <p className="flex items-center gap-2 text-sm text-text-muted">
              <Loader2 size={16} className="animate-spin" />
              {agentToolStatus ?? "Agent 正在整理…"}
            </p>
          </div>
        ) : null}

        {agentToolStatus && !pendingInstruction ? (
          <p
            className="flex items-center gap-2 text-sm text-text-muted"
            aria-live="polite"
          >
            <Loader2 size={16} className="animate-spin" />
            {agentToolStatus}
          </p>
        ) : null}

        {agentGeneration ? (
          <div
            className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-2/40 px-4 py-3"
            aria-live="polite"
          >
            <div className="min-w-0">
              <p className="text-xs text-text-muted">当前 Agent 任务</p>
              <p className="mt-1 text-sm font-medium">
                {agentGeneration.status === "PENDING"
                  ? `排队中 · ${agentGeneration.progress}%`
                  : agentGeneration.status === "RUNNING"
                    ? `生成中 · ${agentGeneration.progress}%`
                    : agentGeneration.status === "SUCCEEDED"
                      ? "已完成，正在接回结果"
                      : agentGeneration.status === "CANCELED"
                        ? "已取消"
                        : "生成未完成"}
              </p>
            </div>
            <span className="shrink-0 text-xs text-text-muted">
              {agentGeneration.modelId}
            </span>
          </div>
        ) : null}

        {qualityChecking || qualityCheck || qualityError ? (
          <div className="space-y-2 rounded-lg border border-border bg-surface-2/40 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                {qualityChecking ? (
                  <Loader2 size={17} className="shrink-0 animate-spin" />
                ) : qualityCheck?.status === "pass" ? (
                  <BadgeCheck size={17} className="shrink-0 text-success" />
                ) : (
                  <AlertTriangle size={17} className="shrink-0 text-warning" />
                )}
                <span className="text-sm font-semibold">结果质量检查</span>
              </div>
              {qualityCheck ? (
                <span className="shrink-0 text-xs tabular-nums text-text-muted">
                  {qualityCheck.score}/100
                </span>
              ) : null}
            </div>
            {qualityChecking ? (
              <p className="text-sm leading-6 text-text-muted">
                Agent 正在按当前方案检查生成结果…
              </p>
            ) : qualityCheck ? (
              <>
                <p className="text-sm leading-6">{qualityCheck.summary}</p>
                {qualityCheck.findings.length ? (
                  <ul className="space-y-1 text-xs leading-5 text-text-muted">
                    {qualityCheck.findings.map((finding, index) => (
                      <li key={`${finding}-${index}`}>· {finding}</li>
                    ))}
                  </ul>
                ) : null}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy || qualityChecking}
                    onClick={onRecheckQuality}
                  >
                    <RefreshCw size={14} />
                    再检查
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() => onContinue("继续修改这张图：")}
                  >
                    继续修改这张图
                  </Button>
                </div>
              </>
            ) : qualityError ? (
              <p role="alert" className="text-sm leading-6 text-danger">
                {qualityError}
              </p>
            ) : null}
          </div>
        ) : null}

        {draft.questions.length ? (
          <div className="space-y-2 rounded-lg border border-border bg-surface-2/40 p-4">
            <p className="text-xs font-medium uppercase tracking-[0.08em] text-text-muted">
              需要你决定
            </p>
            <div className="flex flex-wrap gap-2">
              {draft.questions.map((question, index) => (
                <Button
                  key={`${question}-${index}`}
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={locked}
                  onClick={() => onSuggestion(question)}
                  className="h-auto min-h-9 whitespace-normal rounded-full px-3 py-2 text-left text-sm leading-5"
                >
                  {question}
                </Button>
              ))}
            </div>
          </div>
        ) : null}

        {hasPlan && !draft.questions.length ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand/30 bg-brand/5 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">方案已经可以执行</p>
              <p className="mt-1 text-xs leading-5 text-text-muted">
                可以继续补充要求，也可以进入费用确认。
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <CopyTextButton text={promptPreview} label="复制生成提示词" />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={locked}
                onClick={() => onContinue()}
              >
                继续调整
              </Button>
            </div>
          </div>
        ) : null}

        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <FileText size={17} className="shrink-0 text-text-muted" />
              <span className="text-sm font-semibold">当前方案</span>
              <span className="text-xs text-text-muted">
                {hasPlan ? "待确认" : "等待需求"}
              </span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={locked}
              onClick={() => setDetailsOpen((value) => !value)}
              className="shrink-0 gap-1.5 text-text-muted"
            >
              <Pencil size={14} />
              {detailsOpen ? "收起详情" : "编辑方案"}
              <ChevronDown
                size={14}
                className={
                  detailsOpen
                    ? "rotate-180 transition-transform"
                    : "transition-transform"
                }
              />
            </Button>
          </div>

          <div className="space-y-4 p-4">
            {hasPlan ? (
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-text-muted">画面目标</p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">
                    {draft.brief.goal}
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {editableFields.map((field) =>
                    draft.brief[field].trim() ? (
                      <div key={field} className="min-w-0">
                        <p className="text-xs text-text-muted">
                          {CREATIVE_LABELS[field]}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">
                          {draft.brief[field]}
                        </p>
                      </div>
                    ) : null,
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm leading-6 text-text-muted">
                方案会在你发送第一条需求后出现在这里。
              </p>
            )}

            {hasPlan || references.length ? (
              <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-xs text-text-muted">修改基图</p>
                  <Select
                    aria-label="修改基图"
                    value={baseKey}
                    disabled={locked}
                    onValueChange={(value) => {
                      const reference = references.find(
                        (item) => `${item.kind}:${item.key}` === value,
                      );
                      onChange({
                        ...draft,
                        operationId: null,
                        baseReference: reference
                          ? { kind: reference.kind, key: reference.key }
                          : null,
                      });
                    }}
                    options={[
                      { value: "none", label: "不使用基图" },
                      ...references.map((reference, index) => ({
                        value: `${reference.kind}:${reference.key}`,
                        label: `${reference.kind === "source" ? "历史图片" : "上传图片"} ${index + 1}`,
                      })),
                      ...(baseMissing
                        ? [{ value: baseKey, label: "原基图已不可用" }]
                        : []),
                    ]}
                  />
                </div>
                {base ? (
                  <img
                    src={base.previewUrl}
                    alt="选中的修改基图"
                    className="h-14 w-14 rounded-md border border-border object-contain"
                  />
                ) : (
                  <div
                    aria-hidden
                    className="flex h-14 w-14 items-center justify-center rounded-md border border-dashed border-border text-text-muted"
                  >
                    <ImageIcon size={19} />
                  </div>
                )}
              </div>
            ) : null}

            {detailsOpen ? (
              <div className="space-y-4 border-t border-border pt-4">
                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <label
                      htmlFor="creative-goal"
                      className="text-sm font-medium"
                    >
                      画面目标
                    </label>
                    <IconButton
                      variant="ghost"
                      aria-label={`${draft.locked.includes("goal") ? "解锁" : "锁定"}${CREATIVE_LABELS.goal}`}
                      title={`${draft.locked.includes("goal") ? "解锁" : "锁定"}${CREATIVE_LABELS.goal}`}
                      aria-pressed={draft.locked.includes("goal")}
                      disabled={locked}
                      onClick={() => toggleLock("goal")}
                      className="h-8 w-8 text-text-muted"
                    >
                      {draft.locked.includes("goal") ? (
                        <LockKeyhole size={15} className="text-foreground" />
                      ) : (
                        <UnlockKeyhole size={15} />
                      )}
                    </IconButton>
                  </div>
                  <Textarea
                    id="creative-goal"
                    aria-label="画面目标"
                    value={draft.brief.goal}
                    readOnly={draft.locked.includes("goal")}
                    disabled={locked}
                    rows={2}
                    maxLength={CREATIVE_LIMITS.goal}
                    onChange={(event) =>
                      updateBrief("goal", event.target.value)
                    }
                    className="min-h-16 resize-y text-sm leading-6 read-only:bg-surface-2"
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {editableFields.map((field) => {
                    const fieldLocked = draft.locked.includes(field);
                    return (
                      <div key={field}>
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <label
                            htmlFor={`creative-${field}`}
                            className="text-sm font-medium"
                          >
                            {CREATIVE_LABELS[field]}
                          </label>
                          <IconButton
                            variant="ghost"
                            aria-label={`${fieldLocked ? "解锁" : "锁定"}${CREATIVE_LABELS[field]}`}
                            title={`${fieldLocked ? "解锁" : "锁定"}${CREATIVE_LABELS[field]}`}
                            aria-pressed={fieldLocked}
                            disabled={locked}
                            onClick={() => toggleLock(field)}
                            className="h-8 w-8 text-text-muted"
                          >
                            {fieldLocked ? (
                              <LockKeyhole
                                size={15}
                                className="text-foreground"
                              />
                            ) : (
                              <UnlockKeyhole size={15} />
                            )}
                          </IconButton>
                        </div>
                        <Textarea
                          id={`creative-${field}`}
                          aria-label={CREATIVE_LABELS[field]}
                          value={draft.brief[field]}
                          readOnly={fieldLocked}
                          disabled={locked}
                          rows={3}
                          maxLength={CREATIVE_LIMITS[field]}
                          onChange={(event) =>
                            updateBrief(field, event.target.value)
                          }
                          className="min-h-20 resize-y text-sm leading-6 read-only:bg-surface-2"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface-2/40 px-4 py-3">
            <p className="text-xs text-text-muted">
              {model
                ? `${model.displayName} · ${sizeLabel(params.size ?? model.defaults.size)}`
                : "模型加载中"}
            </p>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={locked || !hasPlan || Boolean(unavailable)}
              loading={quoting}
              onClick={() => void review()}
            >
              <Check size={16} />
              核对并生成
            </Button>
          </div>
        </div>

        {unavailable ? (
          <p role="status" className="text-sm text-text-muted">
            {unavailable}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>

      <Dialog
        open={Boolean(confirmation)}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirmation(null);
        }}
      >
        <DialogContent
          hideClose={busy}
          aria-describedby={undefined}
          className="max-h-[85dvh] space-y-5 overflow-y-auto p-5"
        >
          <DialogTitle className="tracking-normal">确认本次生成</DialogTitle>
          <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-3 text-sm">
            <dt className="text-text-muted">模型</dt>
            <dd className="break-words text-right">{model?.displayName}</dd>
            <dt className="text-text-muted">尺寸</dt>
            <dd className="text-right">
              {sizeLabel(confirmation?.size ?? "auto")}
            </dd>
            <dt className="text-text-muted">数量</dt>
            <dd className="text-right">1 张</dd>
            <dt className="text-text-muted">基图</dt>
            <dd className="text-right">{base ? "已选定" : "无"}</dd>
            <dt className="text-text-muted">本次费用</dt>
            <dd className="text-right font-semibold tabular-nums">
              {confirmation?.creative?.maxCredits} 积分
            </dd>
          </dl>
          {base ? (
            <img
              src={base.previewUrl}
              alt="确认生成的基图"
              className="h-24 w-full object-contain"
            />
          ) : null}
          <details className="border-y border-border py-3 text-sm">
            <summary className="cursor-pointer text-text-muted">
              生成提示词
            </summary>
            <p className="mt-3 whitespace-pre-wrap break-words leading-6">
              {confirmation?.prompt}
            </p>
          </details>
          <Button
            className="w-full"
            loading={busy}
            disabled={!confirmation || busy}
            onClick={async () => {
              if (confirmation && (await onConfirm(confirmation)))
                setConfirmation(null);
            }}
          >
            确认生成 · {confirmation?.creative?.maxCredits} 积分
          </Button>
          {errorMessage ? (
            <p role="alert" className="text-sm leading-6 text-danger">
              {errorMessage}
            </p>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
