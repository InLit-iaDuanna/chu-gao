// PPT 视图模型（API ↔ 组件契约）。
// 新版为「手动页面构建器」：用户提供一次性的不变提示词 + 每页变的提示词，
// 每页最终出图 prompt 由 DeepSeek（lib/deepseek.optimizeImagePrompt）生成，
// 实际出图复用标准生成队列（lib/generations.createAndEnqueueGeneration）。
// 注意：此模块会被客户端组件 import，禁止引入任何 node: 内置依赖。

export type PPTGenerationStatusView =
  | "preparing"
  | "enhancing"
  | "generating"
  | "completed"
  | "failed";

export type PPTSlideStatusView =
  | "pending"
  | "enhancing"
  | "generating"
  | "completed"
  | "failed";

export interface PPTSlide {
  id: string;
  index: number;
  title?: string;
  // 该页「变的提示词」（用户逐页输入）。
  variablePrompt: string;
  // DeepSeek 优化后的最终出图 prompt。
  finalPrompt: string;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  // 公开到灵感圈时只传图片记录 ID；服务端仍会校验归属并复制公开快照。
  imageId?: string;
  status: PPTSlideStatusView;
  error?: string;
  generationId?: string;
  seed?: number;
}

export interface PPTGeneration {
  id: string;
  userId: string;
  conversationId?: string;
  title?: string;
  // 不变提示词：整套统一风格 / 约束。
  fixedPrompt: string;
  // 整套幻灯片共用的视觉参考图。
  referenceImageKeys: string[];
  status: PPTGenerationStatusView;
  progress: number;
  createdAt: string;
  updatedAt: string;
  slides: PPTSlide[];
}

export const MAX_PPT_SLIDES = 30;
