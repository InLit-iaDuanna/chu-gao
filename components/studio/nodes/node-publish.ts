import type { PublishPreloadInput } from "@/components/inspiration/publish-preload";

import type { NodeGraphState, NodeRunState } from "./node-graph-types";

const MEDIA_LIMIT = 9;

export function buildNodePublishPreload(
  graph: NodeGraphState,
  runs: Record<string, NodeRunState>,
): PublishPreloadInput | null {
  const media = graph.nodes
    .filter((node) => node.kind === "generate")
    .flatMap((node) => {
      const run = runs[node.id];
      if (!run || run.status !== "succeeded") return [];
      return run.images;
    })
    .filter(
      (image, index, images) =>
        images.findIndex((candidate) => candidate.id === image.id) === index,
    )
    .slice(0, MEDIA_LIMIT)
    .map((image, index) => ({
      sourceGeneratedImageId: image.id,
      preview: image.thumbnailUrl || image.url,
      role: "FINAL" as const,
      isCover: index === 0,
    }));

  if (!media.length) return null;

  return {
    source: "NODES",
    shape: "WORK",
    discipline: "GRAPHIC",
    title: "节点工作流作品",
    story: "由节点工作流完成的一次生成探索，公开内容仅包含流程结构与结果图。",
    origin: "ORIGINAL",
    sourceNote: `由站内节点工作流生成（${graph.nodes.length} 个节点 / ${graph.edges.length} 条连线）`,
    promptVisibility: "STRUCTURE_ONLY",
    tags: ["节点工作流", "生成过程"],
    media,
  };
}
