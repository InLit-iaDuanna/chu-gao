import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ModelInfo } from "../lib/types";
import { GenerateNodeBody, ModelNodeBody } from "./node-bodies";
import { IDLE_RUN, defaultNodeData, type GraphNode } from "./node-graph-types";

const gifModel = {
  id: "gpt-image-2.6",
  displayName: "Image 2.6",
  available: true,
  capabilities: {
    maxN: 1,
    sizes: ["auto", "1024x1024"],
    gifSizes: ["512x512", "768x768"],
    outputFormats: ["png", "gif"],
    backgrounds: ["auto"],
  },
  defaults: { size: "1024x1024", outputFormat: "png" },
} as ModelInfo;
const pngModel: ModelInfo = {
  ...gifModel,
  id: "gpt-image-2.5",
  displayName: "Image 2.5",
  capabilities: { ...gifModel.capabilities, outputFormats: ["png"] },
};

describe.each(["model", "generate"] as const)(
  "%s node GIF controls",
  (kind) => {
    it("corrects sizes across formats and resets GIF for a PNG-only model", async () => {
      const onUpdate = vi.fn();
      function Node() {
        const [node, setNode] = useState<GraphNode>({
          id: "node",
          kind,
          x: 0,
          y: 0,
          data: {
            ...defaultNodeData(kind),
            modelId: gifModel.id,
            size: "1024x1024",
            outputFormat: "png",
            n: 1,
          },
        } as GraphNode);
        const update = (patch: Record<string, unknown>) => {
          onUpdate(patch);
          setNode(
            (current) =>
              ({
                ...current,
                data: { ...current.data, ...patch },
              }) as GraphNode,
          );
        };
        return node.kind === "model" ? (
          <ModelNodeBody
            node={node}
            models={[gifModel, pngModel]}
            onUpdate={update}
          />
        ) : node.kind === "generate" ? (
          <GenerateNodeBody
            node={node}
            models={[gifModel, pngModel]}
            onUpdate={update}
            edges={[]}
            run={IDLE_RUN}
            validationHint={null}
            modelConnected={false}
            qualityConnected={false}
            onRun={vi.fn()}
            onCancel={vi.fn()}
            onDisconnect={vi.fn()}
            onReorderReference={vi.fn()}
            onOpenImage={vi.fn()}
            onResultAsReference={vi.fn()}
            onResultAsDesignImage={vi.fn()}
            onDownloadImage={vi.fn()}
          />
        ) : null;
      }
      render(<Node />);
      const user = userEvent.setup();
      const formatLabel = kind === "model" ? "输出格式" : "生成节点输出格式";
      const sizeLabel = kind === "model" ? "尺寸" : "生成节点尺寸";
      const modelLabel = kind === "model" ? "模型" : "生成节点模型";

      await user.click(screen.getByRole("combobox", { name: formatLabel }));
      await user.click(screen.getByRole("option", { name: "GIF" }));
      expect(onUpdate).toHaveBeenLastCalledWith({
        size: "512x512",
        outputFormat: "gif",
      });
      await user.click(screen.getByRole("combobox", { name: sizeLabel }));
      expect(
        screen.getByRole("option", { name: "512x512 · 1:1" }),
      ).toBeVisible();
      expect(
        screen.queryByRole("option", { name: "自动" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("option", { name: /1024/ }),
      ).not.toBeInTheDocument();
      await user.click(screen.getByRole("option", { name: "768x768 · 1:1" }));

      await user.click(screen.getByRole("combobox", { name: formatLabel }));
      await user.click(screen.getByRole("option", { name: "PNG" }));
      expect(onUpdate).toHaveBeenLastCalledWith({
        size: "1024x1024",
        outputFormat: "png",
      });
      await user.click(screen.getByRole("combobox", { name: formatLabel }));
      await user.click(screen.getByRole("option", { name: "GIF" }));
      await user.click(screen.getByRole("combobox", { name: modelLabel }));
      await user.click(screen.getByRole("option", { name: "Image 2.5" }));
      expect(onUpdate).toHaveBeenLastCalledWith(
        expect.objectContaining({
          modelId: pngModel.id,
          outputFormat: "png",
          size: "1024x1024",
        }),
      );
      expect(
        screen.queryByRole("combobox", { name: formatLabel }),
      ).not.toBeInTheDocument();
    });
  },
);

it("uses the connected model's GIF sizes and preserves its original preview URL", () => {
  render(
    <GenerateNodeBody
      node={{ id: "generate", kind: "generate", x: 0, y: 0, data: {} }}
      models={[gifModel]}
      onUpdate={vi.fn()}
      edges={[]}
      run={{
        ...IDLE_RUN,
        status: "succeeded",
        images: [
          { id: "gif", url: "/original", thumbnailUrl: "/static-thumb" },
        ],
      }}
      validationHint={null}
      modelConnected
      effectiveModelId={gifModel.id}
      effectiveSize="768x768"
      effectiveN={1}
      effectiveOutputFormat="gif"
      qualityConnected={false}
      onRun={vi.fn()}
      onCancel={vi.fn()}
      onDisconnect={vi.fn()}
      onReorderReference={vi.fn()}
      onOpenImage={vi.fn()}
      onResultAsReference={vi.fn()}
      onResultAsDesignImage={vi.fn()}
      onDownloadImage={vi.fn()}
    />,
  );
  expect(
    screen.getByRole("combobox", { name: "生成节点尺寸" }),
  ).toHaveTextContent("768x768");
  expect(screen.getByRole("combobox", { name: "生成节点尺寸" })).toBeDisabled();
  expect(
    screen.getByRole("combobox", { name: "生成节点输出格式" }),
  ).toHaveTextContent("GIF");
  expect(screen.getByRole("img", { name: "生成结果" })).toHaveAttribute(
    "src",
    "/original",
  );
});

it("corrects a persisted node with an unsupported GIF format", async () => {
  const onUpdate = vi.fn();
  render(
    <ModelNodeBody
      node={{
        id: "model",
        kind: "model",
        x: 0,
        y: 0,
        data: {
          modelId: pngModel.id,
          n: 1,
          outputFormat: "gif",
          size: "768x768",
        },
      }}
      models={[pngModel]}
      onUpdate={onUpdate}
    />,
  );
  await waitFor(() =>
    expect(onUpdate).toHaveBeenCalledWith({
      outputFormat: "png",
      size: "1024x1024",
    }),
  );
});
