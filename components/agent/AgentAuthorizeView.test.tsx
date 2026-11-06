import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AgentAuthorizePage from "@/app/(app)/app/agent/authorize/page";

import { AgentAuthorizeView } from "./AgentAuthorizeView";
import type { AgentDeviceAuthorization } from "./api";

const fetchMock = vi.fn<typeof fetch>();
vi.mock("@/components/studio/StudioPageShell", () => ({
  StudioPageShell: ({
    title,
    children,
  }: {
    title: string;
    children: import("react").ReactNode;
  }) => (
    <section>
      <h1>{title}</h1>
      {children}
    </section>
  ),
}));

function success(data: unknown) {
  return new Response(JSON.stringify({ ok: true, data }));
}

function failure(code: string, message: string, status: number) {
  return new Response(JSON.stringify({ ok: false, error: { code, message } }), {
    status,
  });
}

function pending(
  overrides: Partial<AgentDeviceAuthorization> = {},
): AgentDeviceAuthorization {
  return {
    userCode: "ABCD-EFGH",
    clientName: "Chugao CLI",
    status: "pending",
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    account: { email: "user@example.com", credits: 1200 },
    ...overrides,
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("AgentAuthorizeView", () => {
  it("resolves promised page search params, shows identity and never approves from the query", async () => {
    fetchMock.mockResolvedValueOnce(success(pending()));
    render(
      await AgentAuthorizePage({
        searchParams: Promise.resolve({ user_code: ["ABCD-EFGH", "ignored"] }),
      }),
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "授权 Agent" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "授权码" })).toHaveValue(
      "ABCD-EFGH",
    );
    expect(
      await screen.findByRole("button", { name: "批准授权" }),
    ).toBeEnabled();
    expect(screen.getByText("Chugao CLI")).toBeInTheDocument();
    expect(screen.getByText("user@example.com")).toBeInTheDocument();
    expect(screen.getByText("1,200 点")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "单次任务" })).toBeChecked();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/agent/authorize?user_code=ABCD-EFGH",
      expect.objectContaining({
        credentials: "same-origin",
        cache: "no-store",
      }),
    );
  });

  it("supports a page without a query code and waits for manual lookup", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(success(pending()));
    render(await AgentAuthorizePage({ searchParams: Promise.resolve({}) }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "核对授权码" })).toBeDisabled();
    await user.type(
      screen.getByRole("textbox", { name: "授权码" }),
      "ABCD-EFGH",
    );
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "核对授权码" }));
    expect(await screen.findByText("Chugao CLI")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("prefills seven days and locks both decisions while an explicit approval is pending", async () => {
    const user = userEvent.setup();
    let resolve!: (response: Response) => void;
    fetchMock.mockResolvedValueOnce(success(pending())).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    render(<AgentAuthorizeView initialUserCode="ABCD-EFGH" />);

    await user.click(await screen.findByRole("radio", { name: "自定义时长" }));
    expect(screen.getByRole("spinbutton", { name: "授权时长" })).toHaveValue(7);
    expect(screen.getByRole("combobox", { name: "单位" })).toHaveTextContent(
      "天",
    );
    await user.click(screen.getByRole("button", { name: "批准授权" }));

    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/agent/authorize",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userCode: "ABCD-EFGH",
          decision: "approve",
          mode: "timed",
          durationHours: 168,
        }),
      }),
    );
    const approve = screen.getByRole("button", { name: /批准授权/ });
    expect(approve).toBeDisabled();
    expect(approve).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "拒绝" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "授权码" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "单次任务" })).toBeDisabled();
    expect(screen.getByRole("spinbutton", { name: "授权时长" })).toBeDisabled();
    await user.click(approve);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () =>
      resolve(
        success({
          status: "approved",
          expiresAt: new Date(Date.now() + 168 * 3_600_000).toISOString(),
        }),
      ),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("已批准授权");
    expect(screen.getByText(/授权到期时间/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "批准授权" }),
    ).not.toBeInTheDocument();
  });

  it("omits duration for a single-task approval", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(success(pending()))
      .mockResolvedValueOnce(success({ status: "approved" }));
    render(<AgentAuthorizeView initialUserCode="ABCD-EFGH" />);
    await user.click(await screen.findByRole("button", { name: "批准授权" }));
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/agent/authorize",
      expect.objectContaining({
        body: JSON.stringify({
          userCode: "ABCD-EFGH",
          decision: "approve",
          mode: "single",
        }),
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("已批准授权");
  });

  it("validates days and hours in the UI and submits the inclusive 720-hour maximum", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(success(pending()))
      .mockResolvedValueOnce(success({ status: "approved" }));
    render(<AgentAuthorizeView initialUserCode="ABCD-EFGH" />);
    await user.click(await screen.findByRole("radio", { name: "自定义时长" }));
    const duration = screen.getByRole("spinbutton", { name: "授权时长" });
    await user.clear(duration);
    await user.type(duration, "31");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "请输入 1 至 30 的整数",
    );
    expect(screen.getByRole("button", { name: "批准授权" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "拒绝" })).toBeEnabled();

    await user.click(screen.getByRole("combobox", { name: "单位" }));
    await user.click(screen.getByRole("option", { name: "小时" }));
    await user.clear(duration);
    await user.type(duration, "721");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "请输入 1 至 720 的整数",
    );
    expect(screen.getByRole("button", { name: "批准授权" })).toBeDisabled();
    await user.clear(duration);
    await user.type(duration, "720");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "批准授权" }));
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/agent/authorize",
      expect.objectContaining({
        body: JSON.stringify({
          userCode: "ABCD-EFGH",
          decision: "approve",
          mode: "timed",
          durationHours: 720,
        }),
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("已批准授权");
  });

  it("allows explicit denial despite invalid custom duration and locks pending denial", async () => {
    const user = userEvent.setup();
    let resolve!: (response: Response) => void;
    fetchMock.mockResolvedValueOnce(success(pending())).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    render(<AgentAuthorizeView initialUserCode="ABCD-EFGH" />);
    await user.click(await screen.findByRole("radio", { name: "自定义时长" }));
    await user.clear(screen.getByRole("spinbutton", { name: "授权时长" }));
    await user.click(screen.getByRole("button", { name: "拒绝" }));
    expect(screen.getByRole("button", { name: /拒绝/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /拒绝/ })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/agent/authorize",
      expect.objectContaining({
        body: JSON.stringify({
          userCode: "ABCD-EFGH",
          decision: "deny",
          mode: "timed",
        }),
      }),
    );
    await act(async () => resolve(success({ status: "denied" })));
    expect(await screen.findByRole("status")).toHaveTextContent("已拒绝授权");
    expect(
      screen.queryByRole("button", { name: "拒绝" }),
    ).not.toBeInTheDocument();
  });

  it.each<AgentDeviceAuthorization["status"]>([
    "approved",
    "denied",
    "consumed",
    "expired",
  ])(
    "renders the concrete %s state without actionable approval controls",
    async (status) => {
      fetchMock.mockResolvedValueOnce(success(pending({ status })));
      render(<AgentAuthorizeView initialUserCode="ABCD-EFGH" />);
      await screen.findByText("Chugao CLI");
      expect(screen.getByRole("status")).toHaveTextContent(
        {
          approved: "已批准授权",
          denied: "已拒绝授权",
          consumed: "授权码已使用",
          expired: "授权码已过期",
          pending: "待确认",
        }[status],
      );
      expect(
        screen.queryByRole("button", { name: "批准授权" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "拒绝" }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: "授权码" })).toBeEnabled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("displays invalid-code errors and accepts a new manually entered code", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(
        failure("INVALID_CODE", "授权码不存在或已失效", 404),
      )
      .mockResolvedValueOnce(success(pending({ userCode: "JKLM-NPQR" })));
    render(<AgentAuthorizeView initialUserCode="invalid" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "授权码不存在或已失效",
    );
    await user.clear(screen.getByRole("textbox", { name: "授权码" }));
    await user.type(
      screen.getByRole("textbox", { name: "授权码" }),
      "JKLM-NPQR",
    );
    await user.click(screen.getByRole("button", { name: "核对授权码" }));
    expect(
      await screen.findByRole("button", { name: "批准授权" }),
    ).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/agent/authorize?user_code=JKLM-NPQR",
      expect.any(Object),
    );
  });

  it("preserves pending state after a server error so a decision can be retried", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(success(pending()))
      .mockResolvedValueOnce(
        failure("SERVICE_UNAVAILABLE", "Agent 服务暂不可用，请稍后重试", 503),
      )
      .mockResolvedValueOnce(success({ status: "denied" }));
    render(<AgentAuthorizeView initialUserCode="ABCD-EFGH" />);
    await user.click(await screen.findByRole("button", { name: "批准授权" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Agent 服务暂不可用，请稍后重试",
    );
    expect(screen.getByRole("button", { name: "批准授权" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "拒绝" }));
    expect(await screen.findByRole("status")).toHaveTextContent("已拒绝授权");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("turns an expired-code mutation error into a terminal state", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(success(pending()))
      .mockResolvedValueOnce(
        failure("EXPIRED_CODE", "授权码已过期，请在 Agent 中重新发起授权", 410),
      );
    render(<AgentAuthorizeView initialUserCode="ABCD-EFGH" />);
    await user.click(await screen.findByRole("button", { name: "批准授权" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "授权码已过期，请在 Agent 中重新发起授权",
    );
    expect(screen.getByRole("status")).toHaveTextContent("授权码已过期");
    expect(
      screen.queryByRole("button", { name: "批准授权" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "授权码" })).toBeEnabled();
  });

  it("refreshes the server state when a different browser has already decided", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(success(pending()))
      .mockResolvedValueOnce(
        failure("CODE_ALREADY_USED", "这次授权请求已处理", 409),
      )
      .mockResolvedValueOnce(success(pending({ status: "denied" })));
    render(<AgentAuthorizeView initialUserCode="ABCD-EFGH" />);
    await user.click(await screen.findByRole("button", { name: "批准授权" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("已拒绝授权"),
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(
      screen.queryByRole("button", { name: "批准授权" }),
    ).not.toBeInTheDocument();
  });

  it("expires an open pending request when its deadline is reached", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(
      success(
        pending({ expiresAt: new Date(Date.now() + 1000).toISOString() }),
      ),
    );
    render(<AgentAuthorizeView initialUserCode="ABCD-EFGH" />);
    await act(async () => {});
    expect(screen.getByRole("button", { name: "批准授权" })).toBeEnabled();
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByRole("status")).toHaveTextContent("授权码已过期");
    expect(
      screen.queryByRole("button", { name: "批准授权" }),
    ).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("cancels a stale lookup and never shows an old client's details for the new code", async () => {
    const user = userEvent.setup();
    let resolve!: (response: Response) => void;
    fetchMock
      .mockReturnValueOnce(
        new Promise((done) => {
          resolve = done;
        }),
      )
      .mockResolvedValueOnce(
        success(pending({ userCode: "JKLM-NPQR", clientName: "新客户端" })),
      );
    render(<AgentAuthorizeView initialUserCode="ABCD-EFGH" />);
    const oldSignal = fetchMock.mock.calls[0][1]?.signal;
    await user.clear(screen.getByRole("textbox", { name: "授权码" }));
    expect(oldSignal?.aborted).toBe(true);
    await user.type(
      screen.getByRole("textbox", { name: "授权码" }),
      "JKLM-NPQR",
    );
    await user.click(screen.getByRole("button", { name: "核对授权码" }));
    expect(await screen.findByText("新客户端")).toBeInTheDocument();
    await act(async () => resolve(success(pending())));
    expect(screen.queryByText("Chugao CLI")).not.toBeInTheDocument();
    expect(screen.getByText("新客户端")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
