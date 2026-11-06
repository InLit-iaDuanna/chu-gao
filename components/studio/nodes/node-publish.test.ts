import { describe, expect, it } from "vitest";

import type { NodeGraphState, NodeRunState } from "./node-graph-types";
import { buildNodePublishPreload } from "./node-publish";

const graph: NodeGraphState = {
  viewport: { x: 0, y: 0, zoom: 1 },
  edges: [
    { id: "edge-1", from: "prompt-1", to: "generate-1", toPort: "prompt" },
    { id: "edge-2", from: "style-1", to: "generate-1", toPort: "prompt" },
  ],
  nodes: [
    {
      id: "prompt-1",
      kind: "prompt",
      x: 0,
      y: 0,
      data: { text: "CONNECTED_PROMPT_SECRET" },
    },
    {
      id: "style-1",
      kind: "style",
      x: 0,
      y: 60,
      data: { preset: "custom", text: "CONNECTED_STYLE_SECRET" },
    },
    {
      id: "note-1",
      kind: "note",
      x: 0,
      y: 120,
      data: { text: "UNCONNECTED_NOTE_SECRET" },
    },
    {
      id: "prompt-2",
      kind: "prompt",
      x: 0,
      y: 180,
      data: { text: "UNCONNECTED_PROMPT_SECRET" },
    },
    { id: "generate-1", kind: "generate", x: 300, y: 0, data: {} },
  ],
};

describe("node inspiration publishing", () => {
  it("exports successful images without leaking connected or disconnected node text", () => {
    const runs: Record<string, NodeRunState> = {
      "generate-1": {
        status: "succeeded",
        generationId: "generation-private",
        progress: 100,
        error: null,
        images: [{ id: "image-1", url: "/full", thumbnailUrl: "/thumb" }],
      },
    };

    const result = buildNodePublishPreload(graph, runs);
    expect(result).toMatchObject({
      source: "NODES",
      shape: "WORK",
      title: "节点工作流作品",
      story: "由节点工作流完成的一次生成探索，公开内容仅包含流程结构与结果图。",
      promptVisibility: "STRUCTURE_ONLY",
      media: [
        { sourceGeneratedImageId: "image-1", preview: "/thumb", isCover: true },
      ],
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("generation-private");
    expect(serialized).not.toContain("CONNECTED_PROMPT_SECRET");
    expect(serialized).not.toContain("CONNECTED_STYLE_SECRET");
    expect(serialized).not.toContain("UNCONNECTED_NOTE_SECRET");
    expect(serialized).not.toContain("UNCONNECTED_PROMPT_SECRET");
  });

  it("refuses a workflow without a successful result image", () => {
    expect(buildNodePublishPreload(graph, {})).toBeNull();
  });
});
