"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  defaultGraph,
  defaultNodeData,
  estimatedNodeHeight,
  nextGraphId,
  nodeCanConnectToPort,
  SINGLE_INPUT_PORTS,
  type GraphEdge,
  type GraphNode,
  type InputPort,
  type NodeGraphState,
  type NodeKind,
  type Viewport,
} from "./node-graph-types";

const STORAGE_PREFIX = "chugao.node-graph.v1";

function isValidGraph(value: unknown): value is NodeGraphState {
  if (!value || typeof value !== "object") return false;
  const graph = value as NodeGraphState;
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return false;
  const kinds = new Set([
    "prompt",
    "style",
    "reference",
    "model",
    "quality",
    "note",
    "generate",
    "frame",
    "text",
    "shape",
    "design-image",
  ]);
  const ports = new Set(["prompt", "reference", "model", "quality", "layer"]);
  for (const node of graph.nodes) {
    if (
      !node ||
      typeof node.id !== "string" ||
      !kinds.has(node.kind) ||
      typeof node.x !== "number" ||
      typeof node.y !== "number" ||
      !node.data
    ) {
      return false;
    }
  }
  const ids = new Set(graph.nodes.map((node) => node.id));
  for (const edge of graph.edges) {
    if (
      !edge ||
      typeof edge.id !== "string" ||
      !ids.has(edge.from) ||
      !ids.has(edge.to) ||
      !ports.has(edge.toPort)
    ) {
      return false;
    }
  }
  return (
    !!graph.viewport &&
    typeof graph.viewport.x === "number" &&
    typeof graph.viewport.y === "number" &&
    typeof graph.viewport.zoom === "number"
  );
}

function loadGraph(key: string): NodeGraphState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NodeGraphState;
    if (
      !parsed ||
      !Array.isArray(parsed.nodes) ||
      !Array.isArray(parsed.edges)
    ) {
      return null;
    }
    const nodes = parsed.nodes.filter(
      (node) =>
        !["negative", "seed"].includes(
          (node as GraphNode & { kind: string }).kind,
        ),
    );
    const nodeIds = new Set(nodes.map((node) => node.id));
    const edges = parsed.edges.filter(
      (edge) =>
        !["negative", "seed"].includes(
          (edge as GraphEdge & { toPort: string }).toPort,
        ) &&
        nodeIds.has(edge.from) &&
        nodeIds.has(edge.to),
    );
    const sanitized = { ...parsed, nodes, edges };
    return isValidGraph(sanitized) ? sanitized : null;
  } catch {
    return null;
  }
}

export interface NodeGraphApi {
  graph: NodeGraphState;
  hydrated: boolean;
  contentRevision: number;
  addNode: (
    kind: NodeKind,
    position?: { x: number; y: number },
    data?: GraphNode["data"],
  ) => string;
  moveNode: (id: string, x: number, y: number) => void;
  moveNodes: (moves: { id: string; x: number; y: number }[]) => void;
  finishHistoryGroup: () => void;
  updateNodeData: (id: string, patch: Record<string, unknown>) => void;
  initializeNodeData: (id: string, patch: Record<string, unknown>) => void;
  duplicateNode: (id: string) => void;
  duplicateNodes: (ids: string[]) => string[];
  removeNode: (id: string) => void;
  removeNodes: (ids: string[]) => void;
  connect: (from: string, to: string, toPort: InputPort) => void;
  reorderEdge: (edgeId: string, direction: "up" | "down") => void;
  disconnect: (edgeId: string) => void;
  setViewport: (viewport: Viewport) => void;
  clearGraph: () => void;
  autoArrange: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useNodeGraph(storageKey: string): NodeGraphApi {
  const [graph, setGraph] = useState<NodeGraphState>(defaultGraph);
  const graphRef = useRef(graph);
  const [hydrated, setHydrated] = useState(false);
  const skipPersist = useRef(true);
  const pastRef = useRef<NodeGraphState[]>([]);
  const futureRef = useRef<NodeGraphState[]>([]);
  const lastGroupRef = useRef<{ key: string; at: number } | null>(null);
  const contentRevisionRef = useRef(0);

  const key = `${STORAGE_PREFIX}.${storageKey}`;
  const persistTimerRef = useRef<number | null>(null);
  const pendingPersistRef = useRef<{
    key: string;
    graph: NodeGraphState;
  } | null>(null);
  const flushPersist = useCallback(() => {
    if (persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    const pending = pendingPersistRef.current;
    pendingPersistRef.current = null;
    if (!pending) return;
    try {
      window.localStorage.setItem(pending.key, JSON.stringify(pending.graph));
    } catch {
      // 存储失败时退化为会话内状态。
    }
  }, []);

  useEffect(() => {
    const stored = loadGraph(key);
    const next = stored ?? defaultGraph();
    graphRef.current = next;
    contentRevisionRef.current += 1;
    setGraph(next);
    pastRef.current = [];
    futureRef.current = [];
    lastGroupRef.current = null;
    skipPersist.current = true;
    setHydrated(true);
  }, [key]);

  useEffect(() => {
    if (!hydrated) return;
    if (skipPersist.current) {
      skipPersist.current = false;
      return;
    }
    pendingPersistRef.current = { key, graph };
    if (persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current);
    }
    persistTimerRef.current = window.setTimeout(flushPersist, 250);
  }, [flushPersist, hydrated, graph, key]);

  useEffect(() => {
    window.addEventListener("pagehide", flushPersist);
    return () => {
      window.removeEventListener("pagehide", flushPersist);
      flushPersist();
    };
  }, [flushPersist, key]);

  const updateGraph = useCallback(
    (
      updater: (current: NodeGraphState) => NodeGraphState,
      groupKey?: string,
      contentChanged = true,
    ) => {
      const current = graphRef.current;
      const next = updater(current);
      if (next === current) return;

      const now = Date.now();
      const grouped =
        groupKey &&
        lastGroupRef.current?.key === groupKey &&
        (groupKey.startsWith("move:") || now - lastGroupRef.current.at < 700);
      if (!grouped) {
        pastRef.current = [...pastRef.current.slice(-49), current];
      }
      futureRef.current = [];
      lastGroupRef.current = groupKey ? { key: groupKey, at: now } : null;
      graphRef.current = next;
      if (contentChanged) contentRevisionRef.current += 1;
      setGraph(next);
    },
    [],
  );

  const addNode = useCallback(
    (
      kind: NodeKind,
      position?: { x: number; y: number },
      data?: GraphNode["data"],
    ): string => {
      const id = nextGraphId(kind);
      updateGraph((current) => ({
        ...current,
        nodes: [
          ...current.nodes,
          {
            id,
            kind,
            x: position?.x ?? 120,
            y: position?.y ?? 120,
            data: data ?? defaultNodeData(kind),
          } as GraphNode,
        ],
      }));
      return id;
    },
    [updateGraph],
  );

  const moveNode = useCallback(
    (id: string, x: number, y: number) => {
      updateGraph(
        (current) => {
          let changed = false;
          const nodes = current.nodes.map((node) => {
            if (node.id !== id || (node.x === x && node.y === y)) return node;
            changed = true;
            return { ...node, x, y };
          });
          return changed ? { ...current, nodes } : current;
        },
        `move:${id}`,
        false,
      );
    },
    [updateGraph],
  );

  const moveNodes = useCallback(
    (moves: { id: string; x: number; y: number }[]) => {
      if (moves.length === 0) return;
      const positions = new Map(moves.map((move) => [move.id, move]));
      updateGraph(
        (current) => {
          let changed = false;
          const nodes = current.nodes.map((node) => {
            const next = positions.get(node.id);
            if (!next || (node.x === next.x && node.y === next.y)) return node;
            changed = true;
            return { ...node, x: next.x, y: next.y };
          });
          return changed ? { ...current, nodes } : current;
        },
        "move:selection",
        false,
      );
    },
    [updateGraph],
  );

  const finishHistoryGroup = useCallback(() => {
    lastGroupRef.current = null;
  }, []);

  const updateNodeData = useCallback(
    (id: string, patch: Record<string, unknown>) => {
      updateGraph(
        (current) => ({
          ...current,
          nodes: current.nodes.map((node) =>
            node.id === id
              ? ({ ...node, data: { ...node.data, ...patch } } as GraphNode)
              : node,
          ),
        }),
        `data:${id}`,
      );
    },
    [updateGraph],
  );

  const initializeNodeData = useCallback(
    (id: string, patch: Record<string, unknown>) => {
      const current = graphRef.current;
      const next = {
        ...current,
        nodes: current.nodes.map((node) =>
          node.id === id
            ? ({ ...node, data: { ...node.data, ...patch } } as GraphNode)
            : node,
        ),
      };
      graphRef.current = next;
      contentRevisionRef.current += 1;
      setGraph(next);
    },
    [],
  );

  const duplicateNode = useCallback(
    (id: string) => {
      updateGraph((current) => {
        const source = current.nodes.find((node) => node.id === id);
        if (!source) return current;
        return {
          ...current,
          nodes: [
            ...current.nodes,
            {
              ...source,
              id: nextGraphId(source.kind),
              x: source.x + 28,
              y: source.y + 28,
              data: { ...source.data },
            } as GraphNode,
          ],
        };
      });
    },
    [updateGraph],
  );

  const duplicateNodes = useCallback(
    (ids: string[]) => {
      const sourceIds = new Set(ids);
      const idMap = new Map<string, string>();
      const copiedIds: string[] = [];
      updateGraph((current) => {
        const sources = current.nodes.filter((node) => sourceIds.has(node.id));
        if (sources.length === 0) return current;
        const copies = sources.map((source) => {
          const id = nextGraphId(source.kind);
          idMap.set(source.id, id);
          copiedIds.push(id);
          return {
            ...source,
            id,
            x: source.x + 28,
            y: source.y + 28,
            data: { ...source.data },
          } as GraphNode;
        });
        const copiedEdges = current.edges
          .filter((edge) => sourceIds.has(edge.from) && sourceIds.has(edge.to))
          .map((edge) => ({
            ...edge,
            id: nextGraphId("edge"),
            from: idMap.get(edge.from) ?? edge.from,
            to: idMap.get(edge.to) ?? edge.to,
          }));
        return {
          ...current,
          nodes: [...current.nodes, ...copies],
          edges: [...current.edges, ...copiedEdges],
        };
      });
      return copiedIds;
    },
    [updateGraph],
  );

  const removeNode = useCallback(
    (id: string) => {
      updateGraph((current) => ({
        ...current,
        nodes: current.nodes.filter((node) => node.id !== id),
        edges: current.edges.filter(
          (edge) => edge.from !== id && edge.to !== id,
        ),
      }));
    },
    [updateGraph],
  );

  const removeNodes = useCallback(
    (ids: string[]) => {
      const sourceIds = new Set(ids);
      if (sourceIds.size === 0) return;
      updateGraph((current) => ({
        ...current,
        nodes: current.nodes.filter((node) => !sourceIds.has(node.id)),
        edges: current.edges.filter(
          (edge) => !sourceIds.has(edge.from) && !sourceIds.has(edge.to),
        ),
      }));
    },
    [updateGraph],
  );

  const connect = useCallback(
    (from: string, to: string, toPort: InputPort) => {
      updateGraph((current) => {
        const fromNode = current.nodes.find((node) => node.id === from);
        const toNode = current.nodes.find((node) => node.id === to);
        if (
          !fromNode ||
          !toNode ||
          (toNode.kind !== "generate" && toNode.kind !== "frame")
        )
          return current;
        if (from === to) return current;
        // 端口类型必须匹配上游节点类型。
        if (!nodeCanConnectToPort(fromNode.kind, toPort)) return current;

        // 单值端口只允许一条入边（新边替换旧边）。
        const edges = SINGLE_INPUT_PORTS.has(toPort)
          ? current.edges.filter(
              (edge) => !(edge.to === to && edge.toPort === toPort),
            )
          : current.edges;

        // 同一上游到同一端口不重复连线。
        if (
          edges.some(
            (edge) =>
              edge.from === from && edge.to === to && edge.toPort === toPort,
          )
        ) {
          return current;
        }

        return {
          ...current,
          edges: [...edges, { id: nextGraphId("edge"), from, to, toPort }],
        };
      });
    },
    [updateGraph],
  );

  const disconnect = useCallback(
    (edgeId: string) => {
      updateGraph((current) => ({
        ...current,
        edges: current.edges.filter((edge) => edge.id !== edgeId),
      }));
    },
    [updateGraph],
  );

  const reorderEdge = useCallback(
    (edgeId: string, direction: "up" | "down") => {
      updateGraph((current) => {
        const edgeIndex = current.edges.findIndex((edge) => edge.id === edgeId);
        if (edgeIndex < 0) return current;
        const edge = current.edges[edgeIndex];
        const siblingIndexes = current.edges.reduce<number[]>(
          (indexes, candidate, index) => {
            if (candidate.to === edge.to && candidate.toPort === edge.toPort) {
              indexes.push(index);
            }
            return indexes;
          },
          [],
        );
        const siblingPosition = siblingIndexes.indexOf(edgeIndex);
        const targetPosition =
          direction === "up" ? siblingPosition - 1 : siblingPosition + 1;
        const targetIndex = siblingIndexes[targetPosition];
        if (targetIndex === undefined) return current;
        const edges = [...current.edges];
        [edges[edgeIndex], edges[targetIndex]] = [
          edges[targetIndex],
          edges[edgeIndex],
        ];
        return { ...current, edges };
      });
    },
    [updateGraph],
  );

  const setViewport = useCallback(
    (viewport: Viewport) => {
      updateGraph(
        (current) =>
          current.viewport.x === viewport.x &&
          current.viewport.y === viewport.y &&
          current.viewport.zoom === viewport.zoom
            ? current
            : { ...current, viewport },
        "viewport",
        false,
      );
    },
    [updateGraph],
  );

  const clearGraph = useCallback(() => {
    updateGraph((current) => ({
      nodes: [],
      edges: [],
      viewport: current.viewport,
    }));
  }, [updateGraph]);

  const autoArrange = useCallback(() => {
    updateGraph(
      (current) => {
        const sourceKinds: NodeKind[] = [
          "prompt",
          "style",
          "reference",
          "model",
          "quality",
        ];
        const sourceNodes = sourceKinds.flatMap((kind) =>
          current.nodes.filter((node) => node.kind === kind),
        );
        const generateNodes = current.nodes.filter(
          (node) => node.kind === "generate",
        );
        const noteNodes = current.nodes.filter((node) => node.kind === "note");
        const layerNodes = current.nodes.filter((node) =>
          ["text", "shape", "design-image"].includes(node.kind),
        );
        const frameNodes = current.nodes.filter(
          (node) => node.kind === "frame",
        );
        const position = new Map<string, { x: number; y: number }>();
        let sourceY = 40;
        sourceNodes.forEach((node) => {
          position.set(node.id, { x: 40, y: sourceY });
          sourceY += estimatedNodeHeight(node) + 32;
        });
        let generateY = 90;
        generateNodes.forEach((node) => {
          position.set(node.id, { x: 390, y: generateY });
          generateY += estimatedNodeHeight(node) + 44;
        });
        let layerY = 40;
        layerNodes.forEach((node) => {
          position.set(node.id, { x: 740, y: layerY });
          layerY += estimatedNodeHeight(node) + 32;
        });
        let frameY = 40;
        frameNodes.forEach((node) => {
          position.set(node.id, { x: 1090, y: frameY });
          frameY += estimatedNodeHeight(node) + 32;
        });
        let noteY = 40;
        noteNodes.forEach((node) => {
          position.set(node.id, { x: 1440, y: noteY });
          noteY += estimatedNodeHeight(node) + 32;
        });
        return {
          ...current,
          nodes: current.nodes.map((node) => ({
            ...node,
            ...(position.get(node.id) ?? {}),
          })),
        };
      },
      undefined,
      false,
    );
  }, [updateGraph]);

  const undo = useCallback(() => {
    const previous = pastRef.current.at(-1);
    if (!previous) return;
    pastRef.current = pastRef.current.slice(0, -1);
    futureRef.current = [graphRef.current, ...futureRef.current.slice(0, 49)];
    lastGroupRef.current = null;
    graphRef.current = previous;
    contentRevisionRef.current += 1;
    setGraph(previous);
  }, []);

  const redo = useCallback(() => {
    const next = futureRef.current[0];
    if (!next) return;
    futureRef.current = futureRef.current.slice(1);
    pastRef.current = [...pastRef.current.slice(-49), graphRef.current];
    lastGroupRef.current = null;
    graphRef.current = next;
    contentRevisionRef.current += 1;
    setGraph(next);
  }, []);

  return {
    graph,
    hydrated,
    contentRevision: contentRevisionRef.current,
    addNode,
    moveNode,
    moveNodes,
    finishHistoryGroup,
    updateNodeData,
    initializeNodeData,
    duplicateNode,
    duplicateNodes,
    removeNode,
    removeNodes,
    connect,
    reorderEdge,
    disconnect,
    setViewport,
    clearGraph,
    autoArrange,
    undo,
    redo,
    canUndo: pastRef.current.length > 0,
    canRedo: futureRef.current.length > 0,
  };
}
