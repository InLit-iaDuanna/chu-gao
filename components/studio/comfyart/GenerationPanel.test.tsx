import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Editor, TLPageId } from "tldraw";
import { getModel } from "@/lib/models/registry";
import type { ModelInfo } from "../lib/types";
import type { CanvasDraft } from "./canvas-bridge";

vi.mock("./canvas-bridge", () => ({
  selectionReference: vi.fn(),
  uploadUrl: (key: string) => `/api/upload?key=${encodeURIComponent(key)}`,
}));
import { GenerationPanel } from "./GenerationPanel";

describe("canvas generation request", () => {
  it("keeps explicit reference order and native quality through submission", async () => {
    const model = {
      ...getModel("gpt-image-2.5-flare")!,
      pricingRules: undefined,
      available: true,
    } as ModelInfo;
    const page = {
      id: "page:one",
      meta: {
        chugaoDraft: {
          prompt: "Use image 1 as the product and image 2 as the background",
          modelId: model.id,
          size: "1024x1024",
          quality: "high",
          n: 1,
          background: "auto",
          outputFormat: "png",
          references: [
            { key: "uploads/me/one.png", previewUrl: "/one.png", name: "one" },
            { key: "uploads/me/two.png", previewUrl: "/two.png", name: "two" },
          ],
        },
      },
    };
    const editor = {
      getCurrentPage: () => page,
      getPage: () => page,
      updatePage: vi.fn(),
    } as unknown as Editor;
    const generate = vi
      .fn<(draft: CanvasDraft) => Promise<void>>()
      .mockResolvedValue(undefined);
    render(
      <GenerationPanel
        editor={editor}
        pageId={page.id as TLPageId}
        models={[model]}
        selectionCount={0}
        submitting={false}
        onGenerate={generate}
        onError={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "上移参考图 2" }));
    fireEvent.change(screen.getByRole("slider", { name: "生成质量" }), {
      target: { value: "4" },
    });
    fireEvent.click(screen.getByRole("button", { name: "生成图片" }));
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    expect(generate.mock.calls[0][0]).toMatchObject({
      modelId: model.id,
      quality: "max",
      size: "1024x1024",
    });
    expect(
      generate.mock.calls[0][0].references.map((r: { key: string }) => r.key),
    ).toEqual(["uploads/me/two.png", "uploads/me/one.png"]);
  });
});
