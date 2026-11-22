import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("./api", () => ({ updateConversation: mocks.update }));
vi.mock("./local-conversations", () => ({
  saveConversationSnapshot: mocks.save,
  deleteLocalConversation: mocks.remove,
  isLocalStoreAvailable: () => true,
}));

import { resetNativeBridgeForTests } from "@/lib/native-bridge";
import {
  useLocalConversationSync,
  type DraftStorageChoice,
} from "./useLocalConversationSync";
import type { Conversation } from "./types";

function conversation(storage: "local" | "cloud"): Conversation {
  return {
    id: "conv-1",
    title: "手机对话",
    storage,
    lastMessageAt: "2026-11-21T08:00:00.000Z",
    createdAt: "2026-11-21T07:00:00.000Z",
    messages: [
      {
        id: "m1",
        role: "user",
        content: "你好",
        createdAt: "2026-11-21T07:00:01.000Z",
      },
    ],
  };
}

function installBridge() {
  const bridge = { postMessage: vi.fn(), onmessage: null };
  (window as unknown as { ChugaoNative?: unknown }).ChugaoNative = bridge;
}

function Harness({
  value,
  busy = false,
}: {
  value: Conversation | null;
  busy?: boolean;
}) {
  const sync = useLocalConversationSync({ conversation: value, busy });
  return (
    <div>
      <span data-testid="native">{String(sync.isNativeApp)}</span>
      <span data-testid="draft">{sync.draftStorage}</span>
      <span data-testid="tip">{String(sync.tipVisible)}</span>
      <button
        type="button"
        onClick={() =>
          sync.setDraftStorage(
            "cloud" as DraftStorageChoice satisfies DraftStorageChoice,
          )
        }
      >
        选云端
      </button>
      <button
        type="button"
        onClick={() => void sync.changeStorage("conv-1", "cloud")}
      >
        同步到云端
      </button>
      <button
        type="button"
        onClick={() => void sync.changeStorage("conv-1", "local")}
      >
        改回本机
      </button>
    </div>
  );
}

beforeEach(() => {
  resetNativeBridgeForTests();
  delete (window as unknown as { ChugaoNative?: unknown }).ChugaoNative;
  window.localStorage.clear();
  mocks.update.mockReset();
  mocks.save.mockReset();
  mocks.remove.mockReset();
  mocks.update.mockImplementation(
    async (_id: string, patch: { storage: string }) =>
      conversation(patch.storage === "local" ? "local" : "cloud"),
  );
});

afterEach(() => {
  vi.useRealTimers();
  resetNativeBridgeForTests();
  delete (window as unknown as { ChugaoNative?: unknown }).ChugaoNative;
});

describe("useLocalConversationSync", () => {
  it("stays inert in a plain browser", () => {
    render(<Harness value={null} />);

    expect(screen.getByTestId("native").textContent).toBe("false");
    expect(screen.getByTestId("draft").textContent).toBe("local");
    expect(screen.getByTestId("tip").textContent).toBe("false");
  });

  it("shows the one-time tip inside the app only", () => {
    installBridge();
    const first = render(<Harness value={null} />);
    expect(screen.getByTestId("native").textContent).toBe("true");
    expect(screen.getByTestId("tip").textContent).toBe("true");
    first.unmount();

    render(<Harness value={null} />);
    expect(screen.getByTestId("tip").textContent).toBe("false");
  });

  it("does not show the tip when a conversation is already open", () => {
    installBridge();
    render(<Harness value={conversation("local")} />);
    expect(screen.getByTestId("tip").textContent).toBe("false");
  });

  it("snapshots a local conversation after a turn finishes", async () => {
    installBridge();
    vi.useFakeTimers();
    render(<Harness value={conversation("local")} busy />);

    expect(mocks.save).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1_600);
    });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("writes the snapshot once idle", async () => {
    installBridge();
    vi.useFakeTimers();
    const value = conversation("local");
    render(<Harness value={value} busy={false} />);

    await act(async () => {
      vi.advanceTimersByTime(1_600);
    });
    expect(mocks.save).toHaveBeenCalledWith(value);
  });

  it("skips cloud conversations", async () => {
    installBridge();
    vi.useFakeTimers();
    render(<Harness value={conversation("cloud")} busy={false} />);

    await act(async () => {
      vi.advanceTimersByTime(1_600);
    });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("switches storage through the API and clears the local copy on cloud", async () => {
    installBridge();
    render(<Harness value={conversation("local")} />);

    await act(async () => {
      screen.getByText("同步到云端").click();
    });

    expect(mocks.update).toHaveBeenCalledWith("conv-1", { storage: "cloud" });
    expect(mocks.remove).toHaveBeenCalledWith("conv-1");

    await act(async () => {
      screen.getByText("改回本机").click();
    });
    expect(mocks.update).toHaveBeenLastCalledWith("conv-1", {
      storage: "local",
    });
    expect(mocks.save).toHaveBeenCalled();
  });
});
