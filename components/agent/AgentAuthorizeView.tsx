"use client";

import Link from "next/link";
import { Check, Clock3, KeyRound, Search, ShieldCheck, X } from "lucide-react";
import { useEffect, useState } from "react";

import { isApiError } from "@/components/studio/lib/api";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { RadioGroup } from "@/components/ui/RadioGroup";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { formatDate } from "@/lib/utils";

import {
  decideAgentAuthorization,
  getAgentDeviceAuthorization,
  type AgentAuthorizationMode,
  type AgentDeviceAuthorization,
} from "./api";
import { parseDurationHours, type DurationUnit } from "./duration";

const statusLabels: Record<AgentDeviceAuthorization["status"], string> = {
  pending: "待确认",
  approved: "已批准授权",
  denied: "已拒绝授权",
  consumed: "授权码已使用",
  expired: "授权码已过期",
};

export function AgentAuthorizeView({
  initialUserCode = "",
}: {
  initialUserCode?: string;
}) {
  const [code, setCode] = useState(initialUserCode.trim());
  const [lookup, setLookup] = useState({
    code: initialUserCode.trim(),
    attempt: 0,
  });
  const [busy, setBusy] = useState(false);

  return (
    <div className="min-w-0 space-y-6">
      <form
        className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          if (!code.trim() || busy) return;
          setLookup((current) => ({
            code: code.trim(),
            attempt: current.attempt + 1,
          }));
        }}
      >
        <FormField label="授权码" className="min-w-0 flex-1 sm:max-w-sm">
          <Input
            id="agent-user-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="XXXX-XXXX"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={30}
            disabled={busy}
            controlSize="lg"
            className="font-mono"
          />
        </FormField>
        <Button type="submit" disabled={busy || !code.trim()} className="h-10">
          <Search size={16} aria-hidden="true" />
          核对授权码
        </Button>
      </form>

      {lookup.code && lookup.code === code.trim() ? (
        <AuthorizationRequest
          key={`${lookup.code}:${lookup.attempt}`}
          userCode={lookup.code}
          onBusyChange={setBusy}
        />
      ) : null}

      <Button asChild variant="link">
        <Link href="/app/settings#agent">返回 Agent 接入设置</Link>
      </Button>
    </div>
  );
}

type RequestState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: AgentDeviceAuthorization };

function AuthorizationRequest({
  userCode,
  onBusyChange,
}: {
  userCode: string;
  onBusyChange: (busy: boolean) => void;
}) {
  const [state, setState] = useState<RequestState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [mode, setMode] = useState<AgentAuthorizationMode>("single");
  const [duration, setDuration] = useState("7");
  const [unit, setUnit] = useState<DurationUnit>("days");
  const [decision, setDecision] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState("");
  const [authorizationExpiresAt, setAuthorizationExpiresAt] =
    useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    getAgentDeviceAuthorization(userCode, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ kind: "ready", data });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setState({
            kind: "error",
            message:
              cause instanceof Error ? cause.message : "授权请求读取失败",
          });
        }
      });
    return () => controller.abort();
  }, [userCode, attempt]);

  const data = state.kind === "ready" ? state.data : null;

  useEffect(() => {
    if (!data || data.status !== "pending" || decision) return;
    const timeout = window.setTimeout(
      () => {
        setState({ kind: "ready", data: { ...data, status: "expired" } });
      },
      Math.max(0, new Date(data.expiresAt).getTime() - Date.now()),
    );
    return () => window.clearTimeout(timeout);
  }, [data, decision]);

  const durationHours = parseDurationHours(duration, unit);
  const durationError =
    mode === "timed" && durationHours === null
      ? `请输入 1 至 ${unit === "days" ? 30 : 720} 的整数。`
      : undefined;

  async function decide(nextDecision: "approve" | "deny") {
    if (!data || data.status !== "pending" || decision) return;
    if (new Date(data.expiresAt).getTime() <= Date.now()) {
      setState({ kind: "ready", data: { ...data, status: "expired" } });
      return;
    }
    if (
      nextDecision === "approve" &&
      mode === "timed" &&
      durationHours === null
    )
      return;
    setDecision(nextDecision);
    onBusyChange(true);
    setError("");
    try {
      const result = await decideAgentAuthorization({
        userCode: data.userCode,
        decision: nextDecision,
        mode,
        ...(nextDecision === "approve" &&
        mode === "timed" &&
        durationHours !== null
          ? { durationHours }
          : {}),
      });
      setAuthorizationExpiresAt(result.expiresAt);
      setState({ kind: "ready", data: { ...data, status: result.status } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "提交失败，请稍后重试");
      if (isApiError(cause) && cause.code === "EXPIRED_CODE") {
        setState({ kind: "ready", data: { ...data, status: "expired" } });
      } else if (isApiError(cause) && cause.code === "CODE_ALREADY_USED") {
        setAttempt((current) => current + 1);
      }
    } finally {
      setDecision(null);
      onBusyChange(false);
    }
  }

  if (state.kind === "loading") {
    return (
      <div
        role="status"
        className="flex items-center gap-2 border-t border-border py-6 text-sm text-text-muted"
      >
        <Spinner />
        正在读取授权请求
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <p
        role="alert"
        className="break-words border-t border-border pt-5 text-sm text-danger"
      >
        {state.message}
      </p>
    );
  }

  const request = state.data;
  const pending = request.status === "pending";
  const StatusIcon =
    request.status === "approved"
      ? ShieldCheck
      : request.status === "denied"
        ? X
        : request.status === "expired"
          ? Clock3
          : KeyRound;

  return (
    <section
      aria-labelledby="agent-request-heading"
      className="min-w-0 border-t border-border pt-5"
    >
      <header className="flex flex-wrap items-center gap-3">
        <h2 id="agent-request-heading" className="text-base font-semibold">
          授权请求
        </h2>
        <Badge
          variant={
            pending
              ? "warning"
              : request.status === "approved"
                ? "success"
                : "outline"
          }
        >
          {statusLabels[request.status]}
        </Badge>
      </header>

      <p className="mt-3 text-sm leading-6 text-text-muted">
        该客户端可上传参考图、生成及读取图片，生成费用从当前账户积分扣除。
      </p>

      <dl className="mt-5 grid min-w-0 gap-x-8 gap-y-5 text-sm sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-xs text-text-muted">客户端</dt>
          <dd className="mt-1 break-words font-medium [overflow-wrap:anywhere]">
            {request.clientName}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-text-muted">当前账户</dt>
          <dd className="mt-1 break-all">{request.account.email}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-text-muted">请求授权码</dt>
          <dd className="mt-1 break-all font-mono">{request.userCode}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">账户余额</dt>
          <dd className="mt-1 font-mono tabular-nums">
            {request.account.credits.toLocaleString("zh-CN")} 点
          </dd>
        </div>
        {pending ? (
          <div className="sm:col-span-2">
            <dt className="text-xs text-text-muted">授权码到期时间</dt>
            <dd className="mt-1">
              <time dateTime={request.expiresAt}>
                {formatDate(request.expiresAt)}
              </time>
            </dd>
          </div>
        ) : null}
      </dl>

      {pending ? (
        <div className="mt-6 border-t border-border pt-5">
          <p id="agent-mode-label" className="mb-3 text-sm font-medium">
            授权方式
          </p>
          <RadioGroup
            name="agent-mode"
            aria-labelledby="agent-mode-label"
            value={mode}
            onValueChange={(value) => setMode(value as AgentAuthorizationMode)}
            disabled={decision !== null}
            orientation="horizontal"
            options={[
              { value: "single", label: "单次任务" },
              { value: "timed", label: "自定义时长" },
            ]}
          />
          {mode === "timed" ? (
            <div className="mt-4">
              <div className="grid max-w-sm grid-cols-[minmax(0,1fr)_6rem] gap-3">
                <FormField label="授权时长" error={durationError}>
                  <Input
                    id="agent-duration"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={unit === "days" ? 30 : 720}
                    step={1}
                    value={duration}
                    onChange={(event) => setDuration(event.target.value)}
                    disabled={decision !== null}
                    invalid={Boolean(durationError)}
                    aria-describedby="agent-duration-range"
                    controlSize="lg"
                  />
                </FormField>
                <div className="space-y-1.5">
                  <p
                    id="agent-duration-unit-label"
                    className="text-xs font-medium text-text-muted"
                  >
                    单位
                  </p>
                  <Select
                    aria-labelledby="agent-duration-unit-label"
                    value={unit}
                    onValueChange={(value) => setUnit(value as DurationUnit)}
                    disabled={decision !== null}
                    controlSize="lg"
                    options={[
                      { value: "hours", label: "小时" },
                      { value: "days", label: "天" },
                    ]}
                  />
                </div>
              </div>
              <p
                id="agent-duration-range"
                className="mt-2 text-xs text-text-muted"
              >
                可选范围：1 小时至 30 天
              </p>
            </div>
          ) : null}
          <div className="mt-6 flex flex-col gap-3 sm:flex-row-reverse sm:justify-end">
            <Button
              variant="primary"
              className="h-10 sm:w-40"
              disabled={decision !== null || Boolean(durationError)}
              loading={decision === "approve"}
              onClick={() => void decide("approve")}
            >
              <Check size={16} aria-hidden="true" />
              批准授权
            </Button>
            <Button
              className="h-10 sm:w-40"
              disabled={decision !== null}
              loading={decision === "deny"}
              onClick={() => void decide("deny")}
            >
              <X size={16} aria-hidden="true" />
              拒绝
            </Button>
          </div>
        </div>
      ) : (
        <div
          role="status"
          className="mt-6 space-y-2 border-t border-border pt-5"
        >
          <p className="flex items-center gap-2 text-sm font-medium">
            <StatusIcon size={17} aria-hidden="true" />
            {statusLabels[request.status]}
          </p>
          {authorizationExpiresAt && request.status === "approved" ? (
            <p className="text-sm text-text-muted">
              授权到期时间：
              <time dateTime={authorizationExpiresAt}>
                {formatDate(authorizationExpiresAt)}
              </time>
            </p>
          ) : null}
        </div>
      )}
      {error ? (
        <p role="alert" className="mt-4 break-words text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}
