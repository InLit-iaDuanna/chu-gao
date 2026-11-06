import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { LoginForm } from "./LoginForm";

vi.mock("@/lib/session-device", () => ({
  CLIENT_DEVICE_ID_HEADER: "x-chugao-device-id",
  CLIENT_DEVICE_TYPE_HEADER: "x-chugao-device-type",
  CLIENT_DEVICE_TOUCH_POINTS_HEADER: "x-chugao-device-touch-points",
  detectBrowserDeviceType: () => "WEB",
  detectBrowserTouchPoints: () => "0",
  getBrowserDeviceId: () => "test-browser-device-id",
  withBrowserAuthLock: (callback: () => unknown) => callback(),
}));

const fetchMock = vi.fn<typeof fetch>();
const assign = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("location", { assign });
});
afterEach(() => vi.unstubAllGlobals());

async function submit() {
  const user = userEvent.setup();
  await user.type(
    screen.getByRole("textbox", { name: "邮箱" }),
    "review@test.invalid",
  );
  await user.type(screen.getByPlaceholderText("输入密码"), "test-password-123");
  await user.click(screen.getByRole("button", { name: "登录" }));
}

it.each([
  [
    "/app/agent/authorize?user_code=ABCD-EFGH",
    "/app/agent/authorize?user_code=ABCD-EFGH",
  ],
  ["https://outside.invalid/", "/app"],
])(
  "starts a fresh document navigation after login for %s",
  async (nextPath, expected) => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: {} })),
    );
    render(<LoginForm nextPath={nextPath} />);
    await submit();
    await waitFor(() =>
      expect(assign).toHaveBeenCalledExactlyOnceWith(expected),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/login",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-chugao-device-id": "test-browser-device-id",
          "x-chugao-device-type": "WEB",
        }),
        body: JSON.stringify({
          email: "review@test.invalid",
          password: "test-password-123",
        }),
      }),
    );
  },
);

it("keeps a failed login on the form without navigating", async () => {
  fetchMock.mockResolvedValue(
    new Response(
      JSON.stringify({ ok: false, error: { message: "邮箱或密码错误" } }),
      { status: 401 },
    ),
  );
  render(<LoginForm nextPath="/app/agent/authorize" />);
  await submit();
  expect(await screen.findByText("邮箱或密码错误")).toBeInTheDocument();
  expect(assign).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "登录" })).toBeEnabled();
});
