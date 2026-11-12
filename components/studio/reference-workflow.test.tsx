import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { ReferenceDropZone } from "./ReferenceDropZone";
import { CopyTextButton } from "./CopyTextButton";
import {
  referenceRequest,
  REFERENCE_DRAG_MIME,
  useReferenceInput,
} from "./lib/reference-input";
import {
  conversationDraftSchema,
  useSessionDraft,
} from "./lib/use-session-draft";
import { CommandDock, type ReferenceItem } from "./CommandDock";
import type { ModelInfo } from "./lib/types";

const { upload, toast } = vi.hoisted(() => ({
  upload: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("./lib/api", () => ({ uploadReferenceImage: upload }));
vi.mock("@/components/ui", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useToast: () => ({ toast }),
}));

export const model = {
  id: "test-image",
  displayName: "Image Test",
  available: true,
  capabilities: {
    supportsReferenceImage: true,
    maxReferenceImages: 2,
    maxN: 1,
    sizes: ["1024x1024"],
    outputFormats: ["png"],
  },
  defaults: { size: "1024x1024", outputFormat: "png" },
} as ModelInfo;
const file = () => new File(["image"], "reference.png", { type: "image/png" });
const source: ReferenceItem = {
  kind: "source",
  key: "image-1",
  previewUrl: "/api/generations/g/images/image-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

describe("reference input", () => {
  it("accepts multi-file drops without navigating away", () => {
    const onFile = vi.fn();
    render(
      <ReferenceDropZone onFile={onFile} onReference={vi.fn()}>
        <textarea aria-label="input" />
      </ReferenceDropZone>,
    );
    const files = [file(), file()];
    fireEvent.drop(screen.getByLabelText("input"), {
      dataTransfer: { types: ["Files"], files, getData: () => "" },
    });
    expect(onFile.mock.calls.map(([item]) => item)).toEqual(files);
  });

  it("accepts gallery references but rejects arbitrary remote image URLs", () => {
    const onReference = vi.fn();
    render(
      <ReferenceDropZone onFile={vi.fn()} onReference={onReference}>
        <textarea aria-label="input" />
      </ReferenceDropZone>,
    );
    for (const item of [
      source,
      { ...source, previewUrl: "https://external.example/image" },
    ]) {
      fireEvent.drop(screen.getByLabelText("input"), {
        dataTransfer: {
          types: [REFERENCE_DRAG_MIME],
          files: [],
          getData: () => JSON.stringify(item),
        },
      });
    }
    expect(onReference).toHaveBeenCalledExactlyOnceWith(source);
  });

  it("pastes image files without intercepting plain-text paste", () => {
    const onFile = vi.fn();
    render(
      <ReferenceDropZone onFile={onFile} onReference={vi.fn()}>
        <textarea aria-label="input" />
      </ReferenceDropZone>,
    );
    const image = file();
    fireEvent.paste(screen.getByLabelText("input"), {
      clipboardData: {
        items: [{ kind: "file", getAsFile: () => image }],
        getData: () => "",
      },
    });
    expect(onFile).toHaveBeenCalledWith(image);
    expect(
      fireEvent.paste(screen.getByLabelText("input"), {
        clipboardData: { items: [], getData: () => "prompt" },
      }),
    ).toBe(true);
  });

  it("reserves upload slots before concurrent requests finish", async () => {
    let resolve!: (value: unknown) => void;
    upload.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const { result } = renderHook(() => {
      const [references, onChange] = useState<ReferenceItem[]>([source]);
      return {
        references,
        ...useReferenceInput({ model, references, onChange }),
      };
    });
    let request!: Promise<void>;
    act(() => {
      request = result.current.upload(file());
      void result.current.upload(file());
    });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(result.current.uploading).toBe(1);
    await act(async () => {
      resolve({ key: "uploads/u/ref.png" });
      await request;
    });
    expect(result.current.references).toHaveLength(2);
    expect(result.current.references[1].previewUrl).toBe(
      "/api/upload?key=uploads%2Fu%2Fref.png",
    );
    expect(result.current.uploading).toBe(0);
    act(() => result.current.add(source));
    expect(result.current.references).toHaveLength(2);
  });

  it("rejects invalid files and separates uploaded and generated references", async () => {
    const { result } = renderHook(() =>
      useReferenceInput({ model, references: [], onChange: vi.fn() }),
    );
    await act(() =>
      result.current.upload(
        new File(["bad"], "file.txt", { type: "text/plain" }),
      ),
    );
    expect(upload).not.toHaveBeenCalled();
    expect(
      referenceRequest([
        source,
        {
          kind: "upload",
          key: "uploads/u/ref.png",
          previewUrl: "/api/upload?key=x",
        },
      ]),
    ).toEqual({
      sourceImageIds: ["image-1"],
      referenceImageKeys: ["uploads/u/ref.png"],
      referenceOrder: ["source:image-1", "upload:uploads/u/ref.png"],
    });
  });
});

describe("copy and draft reuse", () => {
  it("copies the full multiline prompt", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<CopyTextButton text={"第一行\n第二行"} />);
    fireEvent.click(screen.getByLabelText("复制提示词"));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("第一行\n第二行"),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("复制提示词")).toHaveAttribute(
        "title",
        "已复制",
      ),
    );
  });

  it("reports clipboard rejection instead of claiming success", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error()) },
    });
    render(<CopyTextButton text="prompt" />);
    fireEvent.click(screen.getByLabelText("复制提示词"));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "复制失败" }),
      ),
    );
  });

  it("restores each conversation draft without overwriting the next scope", async () => {
    sessionStorage.setItem(
      "chat.a",
      JSON.stringify({ draft: "A", references: [source] }),
    );
    sessionStorage.setItem(
      "chat.b",
      JSON.stringify({ draft: "B", references: [] }),
    );
    const { result, rerender } = renderHook(
      ({ scope }) => {
        const [value, setValue] = useState({
          draft: "",
          references: [] as ReferenceItem[],
        });
        useSessionDraft(scope, value, conversationDraftSchema, (saved) =>
          setValue(saved ?? { draft: "", references: [] }),
        );
        return value;
      },
      { initialProps: { scope: "chat.a" } },
    );
    await waitFor(() => expect(result.current.draft).toBe("A"));
    rerender({ scope: "chat.b" });
    await waitFor(() => expect(result.current.draft).toBe("B"));
    expect(JSON.parse(sessionStorage.getItem("chat.a")!).draft).toBe("A");
    expect(JSON.parse(sessionStorage.getItem("chat.b")!).draft).toBe("B");
  });

  it("does not submit while choosing Chinese characters or uploading", () => {
    const onSubmit = vi.fn();
    const props = {
      prompt: "/生图 街道设计",
      onPromptChange: vi.fn(),
      models: [model],
      model,
      onSelectModel: vi.fn(),
      params: { n: 1, referenceImages: [] },
      onParamsChange: vi.fn(),
      busy: false,
      optimizing: false,
      onOptimize: vi.fn(),
      onUploadFile: vi.fn(),
      onRemoveReference: vi.fn(),
      onSubmit,
      disabledReason: null,
    };
    const { rerender } = render(<CommandDock {...props} />);
    fireEvent.keyDown(screen.getByLabelText("对话输入"), {
      key: "Enter",
      isComposing: true,
    });
    expect(onSubmit).not.toHaveBeenCalled();
    rerender(<CommandDock {...props} uploading={1} />);
    expect(screen.getByLabelText("发送")).toBeDisabled();
    fireEvent.keyDown(screen.getByLabelText("对话输入"), { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
