import { act, render, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  defaultGraph,
  defaultNodeData,
  nodeCanConnectToPort,
  nodeHasOutput,
  type NodeGraphState,
} from "./node-graph-types";
import { NodeCanvas } from "./NodeCanvas";
import { GenerateNodeBody, PromptNodeBody } from "./node-bodies";
import { useNodeGraph } from "./useNodeGraph";

vi.mock("./node-bodies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./node-bodies")>();
  return {
    ...actual,
    PromptNodeBody: vi.fn(() => <div data-testid="prompt-node-body" />),
    GenerateNodeBody: vi.fn(() => <div data-testid="generate-node-body" />),
  };
});

describe("node graph", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

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
    expect(result.current.canUndo).toBe(true);

    act(() => result.current.duplicateNode(id));
    expect(result.current.graph.nodes).toHaveLength(initialCount + 2);

    act(() => result.current.undo());
    expect(result.current.graph.nodes).toHaveLength(initialCount + 1);
    expect(result.current.canRedo).toBe(true);

    act(() => result.current.redo());
    expect(result.current.graph.nodes).toHaveLength(initialCount + 2);
    expect(result.current.canRedo).toBe(false);
  });

  it("keeps content revisions and snapshots stable for spatial no-ops", () => {
    const { result } = renderHook(() => useNodeGraph("revision-test"));
    const initialGraph = result.current.graph;
    const initialRevision = result.current.contentRevision;
    const prompt = initialGraph.nodes.find(
      (node) => node.id === "default-prompt",
    )!;

    act(() => result.current.moveNode(prompt.id, prompt.x, prompt.y));
    expect(result.current.graph).toBe(initialGraph);
    expect(result.current.contentRevision).toBe(initialRevision);

    act(() => {
      result.current.moveNode(prompt.id, prompt.x + 36, prompt.y + 24);
      result.current.setViewport({ x: 80, y: -40, zoom: 1.2 });
    });
    expect(result.current.contentRevision).toBe(initialRevision);
    const movedGraph = result.current.graph;
    const movedPrompt = movedGraph.nodes.find((node) => node.id === prompt.id)!;

    act(() => {
      result.current.moveNodes([
        { id: movedPrompt.id, x: movedPrompt.x, y: movedPrompt.y },
      ]);
      result.current.setViewport({ x: 80, y: -40, zoom: 1.2 });
    });
    expect(result.current.graph).toBe(movedGraph);

    act(() => result.current.updateNodeData(prompt.id, { text: "新的提示词" }));
    expect(result.current.contentRevision).toBeGreaterThan(initialRevision);
    const contentRevision = result.current.contentRevision;

    act(() => result.current.undo());
    expect(result.current.contentRevision).toBeGreaterThan(contentRevision);
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

  it("skips node body renders for viewport-only and unrelated edge updates", () => {
    const graph: NodeGraphState = {
      nodes: [
        {
          id: "prompt-only",
          kind: "prompt",
          x: 40,
          y: 60,
          data: { text: "保持内容" },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    const models: never[] = [];
    const history: never[] = [];
    const view = (nextGraph: NodeGraphState) => (
      <NodeCanvas
        graph={nextGraph}
        models={models}
        history={history}
        runs={{}}
        uploads={{}}
        validationHints={{}}
        onMoveNodes={vi.fn()}
        onInteractionEnd={vi.fn()}
        onUpdateNodeData={vi.fn()}
        onDuplicateNode={vi.fn()}
        onDuplicateNodes={vi.fn()}
        onRemoveNode={vi.fn()}
        onRemoveNodes={vi.fn()}
        onConnect={vi.fn()}
        onReorderReference={vi.fn()}
        onDisconnect={vi.fn()}
        onViewportChange={vi.fn()}
        onRun={vi.fn()}
        onCancel={vi.fn()}
        onUploadFile={vi.fn()}
        onDropFiles={vi.fn()}
        onOpenImage={vi.fn()}
        onResultAsReference={vi.fn()}
        onResultAsDesignImage={vi.fn()}
        onDownloadImage={vi.fn()}
      />
    );
    const { rerender } = render(view(graph));
    const initialRenderCount = vi.mocked(PromptNodeBody).mock.calls.length;
    expect(initialRenderCount).toBeGreaterThan(0);

    rerender(view({ ...graph, viewport: { x: 120, y: -80, zoom: 1 } }));

    expect(vi.mocked(PromptNodeBody).mock.calls).toHaveLength(
      initialRenderCount,
    );

    const edgeGraph: NodeGraphState = {
      nodes: [
        { id: "prompt-a", kind: "prompt", x: 0, y: 0, data: { text: "A" } },
        { id: "prompt-b", kind: "prompt", x: 0, y: 200, data: { text: "B" } },
        { id: "generate-a", kind: "generate", x: 320, y: 0, data: {} },
        { id: "generate-b", kind: "generate", x: 320, y: 300, data: {} },
      ],
      edges: [
        {
          id: "edge-a",
          from: "prompt-a",
          to: "generate-a",
          toPort: "prompt",
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    const { rerender: rerenderEdges } = render(view(edgeGraph));
    const generateMock = vi.mocked(GenerateNodeBody);
    const initialTotal = generateMock.mock.calls.length;
    const initialA = generateMock.mock.calls.filter(
      ([props]) => props.node.id === "generate-a",
    ).length;

    rerenderEdges(
      view({
        ...edgeGraph,
        edges: [
          ...edgeGraph.edges,
          {
            id: "edge-b",
            from: "prompt-b",
            to: "generate-b",
            toPort: "prompt",
          },
        ],
      }),
    );

    expect(
      generateMock.mock.calls.filter(
        ([props]) => props.node.id === "generate-a",
      ),
    ).toHaveLength(initialA);
    expect(generateMock.mock.calls).toHaveLength(initialTotal + 1);
  });

  it("debounces graph persistence and flushes the latest snapshot on unmount", () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useNodeGraph("persist-test"));
    const initialCount = result.current.graph.nodes.length;
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    act(() => {
      result.current.addNode("note", { x: 20, y: 30 });
      result.current.addNode("note", { x: 40, y: 50 });
    });
    expect(setItem).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(249));
    expect(setItem).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(setItem).toHaveBeenCalledTimes(1);

    act(() => result.current.addNode("note", { x: 60, y: 70 }));
    unmount();

    expect(setItem).toHaveBeenCalledTimes(2);
    const persisted = JSON.parse(
      String(setItem.mock.lastCall?.[1]),
    ) as NodeGraphState;
    expect(persisted.nodes).toHaveLength(initialCount + 3);
    expect(persisted.nodes.at(-1)).toMatchObject({ x: 60, y: 70 });
  });
});
