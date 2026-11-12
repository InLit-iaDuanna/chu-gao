import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  defaultGraph,
  defaultNodeData,
  nodeCanConnectToPort,
  nodeHasOutput,
} from "./node-graph-types";
import { useNodeGraph } from "./useNodeGraph";

describe("node graph", () => {
  beforeEach(() => window.localStorage.clear());

  it("defines the new executable and canvas-only node types", () => {
    expect(defaultNodeData("style")).toMatchObject({ preset: "cinematic" });
    expect(defaultNodeData("quality")).toEqual({
      quality: "high",
      background: "auto",
    });
    expect(nodeCanConnectToPort("style", "prompt")).toBe(true);
    expect(nodeCanConnectToPort("quality", "prompt")).toBe(false);
    expect(nodeCanConnectToPort("text", "layer")).toBe(true);
    expect(nodeCanConnectToPort("shape", "layer")).toBe(true);
    expect(nodeCanConnectToPort("prompt", "layer")).toBe(false);
    expect(defaultNodeData("frame")).toMatchObject({
      width: 1080,
      height: 1350,
    });
    expect(nodeHasOutput("note")).toBe(false);
  });

  it("adds, duplicates, undoes, and redoes nodes", () => {
    const { result } = renderHook(() => useNodeGraph("history-test"));
    const initialCount = result.current.graph.nodes.length;
    let id = "";

    act(() => {
      id = result.current.addNode("style", { x: 120, y: 80 });
    });
    expect(result.current.graph.nodes).toHaveLength(initialCount + 1);

    act(() => result.current.duplicateNode(id));
    expect(result.current.graph.nodes).toHaveLength(initialCount + 2);

    act(() => result.current.undo());
    expect(result.current.graph.nodes).toHaveLength(initialCount + 1);

    act(() => result.current.redo());
    expect(result.current.graph.nodes).toHaveLength(initialCount + 2);
  });

  it("replaces the previous edge on single-value ports", () => {
    const { result } = renderHook(() => useNodeGraph("ports-test"));
    let first = "";
    let second = "";

    act(() => {
      first = result.current.addNode("quality");
      second = result.current.addNode("quality");
      result.current.connect(first, "default-generate", "quality");
      result.current.connect(second, "default-generate", "quality");
    });

    const qualityEdges = result.current.graph.edges.filter(
      (edge) => edge.to === "default-generate" && edge.toPort === "quality",
    );
    expect(qualityEdges).toHaveLength(1);
    expect(qualityEdges[0]?.from).toBe(second);
  });

  it("duplicates a selected group with its internal edges", () => {
    const { result } = renderHook(() => useNodeGraph("group-copy-test"));
    let copied: string[] = [];

    act(() => {
      copied = result.current.duplicateNodes([
        "default-prompt",
        "default-generate",
      ]);
    });

    expect(copied).toHaveLength(2);
    expect(result.current.graph.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining(copied),
    );
    expect(
      result.current.graph.edges.some(
        (edge) =>
          edge.from === copied[0] &&
          edge.to === copied[1] &&
          edge.toPort === "prompt",
      ),
    ).toBe(true);
    expect(
      result.current.graph.edges.some(
        (edge) =>
          (edge.from === copied[0] && edge.to === "default-generate") ||
          (edge.from === "default-prompt" && edge.to === copied[1]),
      ),
    ).toBe(false);
  });

  it("reorders reference edges without changing their targets", () => {
    const { result } = renderHook(() => useNodeGraph("reference-order-test"));
    let first = "";
    let second = "";

    act(() => {
      first = result.current.addNode("reference");
      second = result.current.addNode("reference");
      result.current.connect(first, "default-generate", "reference");
      result.current.connect(second, "default-generate", "reference");
    });

    expect(
      result.current.graph.edges
        .filter(
          (edge) =>
            edge.to === "default-generate" && edge.toPort === "reference",
        )
        .map((edge) => edge.from),
    ).toEqual([first, second]);

    const secondEdge = result.current.graph.edges.find(
      (edge) => edge.from === second,
    );
    expect(secondEdge).toBeDefined();

    act(() => result.current.reorderEdge(secondEdge!.id, "up"));

    expect(
      result.current.graph.edges
        .filter(
          (edge) =>
            edge.to === "default-generate" && edge.toPort === "reference",
        )
        .map((edge) => edge.from),
    ).toEqual([second, first]);
  });

  it("removes legacy unsupported nodes without resetting the graph", async () => {
    const graph = defaultGraph();
    window.localStorage.setItem(
      "chugao.node-graph.v1.migration-test",
      JSON.stringify({
        ...graph,
        nodes: [
          ...graph.nodes,
          {
            id: "keep-note",
            kind: "note",
            x: 700,
            y: 40,
            data: { text: "保留" },
          },
          { id: "old-seed", kind: "seed", x: 40, y: 500, data: { value: 42 } },
        ],
        edges: [
          ...graph.edges,
          {
            id: "old-seed-edge",
            from: "old-seed",
            to: "default-generate",
            toPort: "seed",
          },
        ],
      }),
    );

    const { result } = renderHook(() => useNodeGraph("migration-test"));
    await waitFor(() =>
      expect(
        result.current.graph.nodes.some((node) => node.id === "keep-note"),
      ).toBe(true),
    );
    expect(
      result.current.graph.nodes.some((node) => node.id === "old-seed"),
    ).toBe(false);
    expect(
      result.current.graph.edges.some((edge) => edge.id === "old-seed-edge"),
    ).toBe(false);
  });
});
