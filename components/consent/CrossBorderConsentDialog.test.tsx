import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getMe: vi.fn(),
}));

vi.mock("@/components/studio/lib/api", () => ({
  getMe: mocks.getMe,
}));

import { CrossBorderConsentDialog } from "./CrossBorderConsentDialog";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cross-border consent dialog", () => {
  it("asks legacy users who never consented", async () => {
    mocks.getMe.mockResolvedValue({ id: "user-1", crossBorderConsentAt: null });

    render(<CrossBorderConsentDialog />);

    expect(
      await screen.findByRole("heading", { name: "关于境外模型处理" }),
    ).toBeVisible();
  });

  it("stays hidden once the consent timestamp exists", async () => {
    mocks.getMe.mockResolvedValue({
      id: "user-1",
      crossBorderConsentAt: "2026-11-01T00:00:00.000Z",
    });

    render(<CrossBorderConsentDialog />);

    await waitFor(() => expect(mocks.getMe).toHaveBeenCalled());
    expect(
      screen.queryByRole("heading", { name: "关于境外模型处理" }),
    ).not.toBeInTheDocument();
  });

  it("records consent and closes", async () => {
    const user = userEvent.setup();
    mocks.getMe.mockResolvedValue({ id: "user-1", crossBorderConsentAt: null });
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          data: { crossBorderConsentAt: "2026-11-21T00:00:00.000Z" },
        }),
      ),
    );

    render(<CrossBorderConsentDialog />);
    await screen.findByRole("heading", { name: "关于境外模型处理" });
    await user.click(screen.getByRole("button", { name: "同意并继续" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/me/consent",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ crossBorder: true }),
        }),
      ),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "关于境外模型处理" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("closes without blocking and remembers the dismissal for this session", async () => {
    const user = userEvent.setup();
    mocks.getMe.mockResolvedValue({ id: "user-1", crossBorderConsentAt: null });

    render(<CrossBorderConsentDialog />);
    await screen.findByRole("heading", { name: "关于境外模型处理" });
    await user.click(screen.getByRole("button", { name: "暂不同意" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "关于境外模型处理" }),
      ).not.toBeInTheDocument(),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      sessionStorage.getItem("chugao.cross-border-consent.dismissed"),
    ).toBe("1");

    render(<CrossBorderConsentDialog />);
    expect(
      screen.queryByRole("heading", { name: "关于境外模型处理" }),
    ).not.toBeInTheDocument();
  });
});
