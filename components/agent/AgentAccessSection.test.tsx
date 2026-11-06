import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentAccessSection } from "./AgentAccessSection";
import type { AgentAuthorization } from "./api";

const fetchMock = vi.fn<typeof fetch>();

function success(data: unknown) {
  return new Response(JSON.stringify({ ok: true, data }));
}

function failure(message: string) {
  return new Response(JSON.stringify({ ok: false, error: { code: "SERVICE_UNAVAILABLE", message } }), { status: 503 });
}

function authorization(overrides: Partial<AgentAuthorization> = {}): AgentAuthorization {
  return {
    id: "client/1",
    clientName: "Chugao CLI",
    mode: "timed",
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    lastUsedAt: null,
    revokedAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe("AgentAccessSection", () => {
  it("loads with the current session and provides the authenticated Skill download", async () => {
    let resolve!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    render(<AgentAccessSection />);

    expect(screen.getByRole("region", { name: "Agent 接入" })).toHaveAttribute("id", "agent");
    expect(screen.getByRole("status", { name: "正在加载授权列表" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "下载 Skill" })).toHaveAttribute("href", "/api/agent/skill");
    expect(fetchMock).toHaveBeenCalledWith("/api/agent/authorizations", expect.objectContaining({ credentials: "same-origin", cache: "no-store" }));

    await act(async () => resolve(success([])));
    expect(await screen.findByText("暂无授权客户端")).toBeInTheDocument();
  });

  it("shows concrete list errors and can retry", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(failure("授权服务暂不可用"))
      .mockResolvedValueOnce(success([authorization()]));
    render(<AgentAccessSection />);

    expect(await screen.findByRole("alert")).toHaveTextContent("授权服务暂不可用");
    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("Chugao CLI")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps recent expired and revoked clients without offering to revoke them again", async () => {
    fetchMock.mockResolvedValueOnce(success([
      authorization(),
      authorization({ id: "expired", clientName: "旧客户端", mode: "single", expiresAt: new Date(Date.now() - 1000).toISOString(), lastUsedAt: new Date().toISOString() }),
      authorization({ id: "revoked", clientName: "已撤销客户端", revokedAt: new Date().toISOString() }),
    ]));
    render(<AgentAccessSection />);

    const list = await screen.findByRole("list", { name: "已授权客户端" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(within(list).getByText("已到期")).toBeInTheDocument();
    expect(within(list).getByText("已撤销")).toBeInTheDocument();
    expect(within(list).getAllByText("到期时间")).toHaveLength(3);
    expect(within(list).getAllByText("最近使用")).toHaveLength(3);
    expect(within(list).getAllByText("尚未使用")).toHaveLength(2);
    expect(within(list).getByText("单次任务")).toBeInTheDocument();
    expect(within(list).getAllByRole("button")).toHaveLength(1);
  });

  it("shows a server-invalidated authorization as invalid even before expiry", async () => {
    fetchMock.mockResolvedValueOnce(success([
      authorization({ status: "invalidated" }),
    ]));
    render(<AgentAccessSection />);

    const list = await screen.findByRole("list", { name: "已授权客户端" });
    expect(within(list).getByText("已失效")).toBeInTheDocument();
    expect(within(list).queryByText("有效")).not.toBeInTheDocument();
    expect(within(list).queryByRole("button")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("requires confirmation, locks pending revocation and updates the row only after success", async () => {
    const user = userEvent.setup();
    let resolve!: (response: Response) => void;
    fetchMock.mockResolvedValueOnce(success([authorization({ status: "active" })]))
      .mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    render(<AgentAccessSection />);

    await user.click(await screen.findByRole("button", { name: "撤销 Chugao CLI 的授权" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const dialog = screen.getByRole("dialog", { name: "撤销授权" });
    await user.click(within(dialog).getByRole("button", { name: "确认撤销" }));

    expect(within(dialog).getByRole("button", { name: /确认撤销/ })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "取消" })).toBeDisabled();
    expect(screen.getByText("有效")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(dialog).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith("/api/agent/authorizations/client%2F1", expect.objectContaining({
      method: "DELETE",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
    }));

    await act(async () => resolve(success({ revoked: true })));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("已撤销")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Chugao CLI 的授权已撤销");
    expect(screen.queryByRole("button", { name: "撤销 Chugao CLI 的授权" })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retains the authorization on a revoke error and permits a confirmed retry", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(success([authorization()]))
      .mockResolvedValueOnce(failure("撤销未成功，请重试"))
      .mockResolvedValueOnce(success({ revoked: true }));
    render(<AgentAccessSection />);

    await user.click(await screen.findByRole("button", { name: "撤销 Chugao CLI 的授权" }));
    await user.click(screen.getByRole("button", { name: "确认撤销" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("撤销未成功，请重试");
    expect(screen.getByText("有效")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认撤销" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "确认撤销" }));
    expect(await screen.findByText("已撤销")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not send a mutation when confirmation is canceled", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(success([authorization()]));
    render(<AgentAccessSection />);
    await user.click(await screen.findByRole("button", { name: "撤销 Chugao CLI 的授权" }));
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
