import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
}));

vi.mock("@/lib/session-device", () => ({
  CLIENT_DEVICE_ID_HEADER: "x-chugao-device-id",
  CLIENT_DEVICE_TYPE_HEADER: "x-chugao-device-type",
  CLIENT_DEVICE_TOUCH_POINTS_HEADER: "x-chugao-device-touch-points",
  detectBrowserDeviceType: () => "WEB",
  detectBrowserTouchPoints: () => "0",
  getBrowserDeviceId: () => "test-browser-device-id",
  withBrowserAuthLock: (callback: () => unknown) => callback(),
}));

import { RegisterForm } from "./RegisterForm";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

async function fillAccount() {
  const user = userEvent.setup();
  await user.type(
    screen.getByRole("textbox", { name: /邮箱/ }),
    "new-user@test.invalid",
  );
  await user.type(
    screen.getByPlaceholderText("至少 8 位"),
    "test-password-123",
  );
  await user.type(
    screen.getByPlaceholderText("再次输入密码"),
    "test-password-123",
  );
  return user;
}

describe("registration consent", () => {
  it("keeps submit disabled until both consent boxes are checked", async () => {
    render(<RegisterForm inviteOnly={false} />);
    const user = await fillAccount();

    const [terms, crossBorder] = screen.getAllByRole("checkbox");
    const submit = screen.getByRole("button", { name: "创建账户" });

    expect(submit).toBeDisabled();

    await user.click(terms);
    expect(submit).toBeDisabled();

    await user.click(crossBorder);
    expect(submit).toBeEnabled();
  });

  it("sends both consent flags with the registration payload", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: {} }), { status: 201 }),
    );

    render(<RegisterForm inviteOnly={false} nextPath="/app" />);
    const user = await fillAccount();

    const [terms, crossBorder] = screen.getAllByRole("checkbox");
    await user.click(terms);
    await user.click(crossBorder);
    await user.click(screen.getByRole("button", { name: "创建账户" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/register",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            email: "new-user@test.invalid",
            password: "test-password-123",
            acceptTerms: true,
            acceptCrossBorder: true,
          }),
        }),
      ),
    );
    expect(navigation.push).toHaveBeenCalledWith("/app");
  });

  it("links the terms and privacy pages from the consent copy", () => {
    render(<RegisterForm inviteOnly={false} />);

    expect(screen.getByRole("link", { name: "《用户协议》" })).toHaveAttribute(
      "href",
      "/legal/terms",
    );
    expect(screen.getByRole("link", { name: "《隐私政策》" })).toHaveAttribute(
      "href",
      "/legal/privacy",
    );
  });
});
