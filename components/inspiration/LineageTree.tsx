"use client";

import Link from "next/link";
import { useMemo } from "react";

export interface LineageNode {
  id: string;
  title: string;
  authorName: string;
  shape: string;
  discipline: string;
}

export interface LineageData {
  rootId: string;
  nodes: LineageNode[];
  edges: Array<{ from: string; to: string }>;
}

export interface LineageBranch extends LineageNode {
  children: LineageBranch[];
}

const SHAPE_LABELS: Record<string, string> = {
  WORK: "作品",
  TEARDOWN: "拆解",
  PATTERN: "模式",
  QUESTION: "命题",
  REFERENCE: "参考",
  PROCESS: "过程",
};

const DISCIPLINE_LABELS: Record<string, string> = {
  GRAPHIC: "视觉平面",
  PRODUCT: "产品体验",
  INDUSTRIAL: "工业硬件",
  SERVICE: "服务流程",
  SPATIAL: "空间环境",
  BRAND: "品牌策略",
  MOTION: "动态影像",
  DATAVIZ: "信息可视化",
};

export function buildLineageForest(data: LineageData): LineageBranch[] {
  const nodesById = new Map(data.nodes.map((node) => [node.id, node]));
  const childrenById = new Map<string, string[]>();
  const childIds = new Set<string>();

  for (const edge of data.edges) {
    if (
      edge.from === edge.to ||
      !nodesById.has(edge.from) ||
      !nodesById.has(edge.to)
    ) {
      continue;
    }
    const children = childrenById.get(edge.from) ?? [];
    if (!children.includes(edge.to)) children.push(edge.to);
    childrenById.set(edge.from, children);
    childIds.add(edge.to);
  }

  const rootCandidates = [
    ...(nodesById.has(data.rootId) ? [data.rootId] : []),
    ...data.nodes
      .map((node) => node.id)
      .filter((id) => id !== data.rootId && !childIds.has(id)),
    ...data.nodes.map((node) => node.id),
  ];
  const attached = new Set<string>();

  const buildBranch = (
    id: string,
    ancestors: ReadonlySet<string>,
  ): LineageBranch | null => {
    const node = nodesById.get(id);
    if (!node || ancestors.has(id) || attached.has(id)) return null;
    attached.add(id);
    const nextAncestors = new Set(ancestors).add(id);
    const children = (childrenById.get(id) ?? [])
      .map((childId) => buildBranch(childId, nextAncestors))
      .filter((child): child is LineageBranch => child !== null);
    return { ...node, children };
  };

  return rootCandidates
    .map((id) => buildBranch(id, new Set()))
    .filter((branch): branch is LineageBranch => branch !== null);
}

function LineageTreeItem({
  branch,
  currentPostId,
  depth,
  basePath,
}: {
  branch: LineageBranch;
  currentPostId: string;
  depth: number;
  basePath: string;
}) {
  const isCurrent = branch.id === currentPostId;
  const hasChildren = branch.children.length > 0;

  return (
    <li
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={isCurrent}
      aria-expanded={hasChildren ? true : undefined}
      className="relative"
    >
      <div className="relative flex min-w-0 items-center gap-3">
        {depth > 0 ? (
          <span
            aria-hidden="true"
            className="absolute -left-5 top-1/2 h-px w-5 bg-border-strong"
          />
        ) : null}
        <span
          aria-hidden="true"
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border font-mono text-[10px] ${
            isCurrent
              ? "border-brand bg-brand text-on-accent"
              : "border-border-strong bg-surface-2 text-text-muted"
          }`}
        >
          {depth + 1}
        </span>
        <Link
          href={`${basePath}/${branch.id}`}
          aria-current={isCurrent ? "page" : undefined}
          className={`min-w-0 flex-1 rounded-lg border p-3 transition-colors hover:border-border-strong ${
            isCurrent ? "border-brand bg-brand/5" : "border-border"
          }`}
        >
          <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-text-faint">
            <span>
              {SHAPE_LABELS[branch.shape] ?? branch.shape} ·{" "}
              {DISCIPLINE_LABELS[branch.discipline] ?? branch.discipline}
            </span>
            {depth === 0 ? (
              <span className="rounded-full bg-surface-2 px-1.5 py-0.5">
                分支起点
              </span>
            ) : null}
            {isCurrent ? (
              <span className="rounded-full bg-brand/10 px-1.5 py-0.5 text-brand">
                当前帖子
              </span>
            ) : null}
          </div>
          <p className="mt-1 line-clamp-2 text-sm font-medium">
            {branch.title}
          </p>
          <p className="mt-1 text-xs text-text-muted">{branch.authorName}</p>
        </Link>
      </div>

      {hasChildren ? (
        <>
          <div
            aria-hidden="true"
            className="ml-4 h-3 border-l border-border-strong"
          />
          <ul
            role="group"
            className="ml-4 space-y-2 border-l border-border-strong pl-5"
          >
            {branch.children.map((child) => (
              <LineageTreeItem
                key={child.id}
                branch={child}
                currentPostId={currentPostId}
                depth={depth + 1}
                basePath={basePath}
              />
            ))}
          </ul>
        </>
      ) : null}
    </li>
  );
}

export function LineageTree({
  data,
  currentPostId,
  basePath = "/inspiration",
}: {
  data: LineageData;
  currentPostId: string;
  basePath?: string;
}) {
  const branches = useMemo(() => buildLineageForest(data), [data]);

  return (
    <ul role="tree" aria-label="想法传承关系" className="mt-5 space-y-3">
      {branches.map((branch) => (
        <LineageTreeItem
          key={branch.id}
          branch={branch}
          currentPostId={currentPostId}
          depth={0}
          basePath={basePath}
        />
      ))}
    </ul>
  );
}
