export type ChatRole = "user" | "assistant";

export interface GenerationView {
  id: string;
  status: string;
  progress: number;
  imageUrl?: string | null;
  downloadUrl?: string | null;
  prompt: string;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  // 文本内容（流式时持续追加）。
  content: string;
  // 思考链（仅当上游返回 reasoning_content 时出现）。
  reasoning?: string;
  // 用户消息附带的图片（data URL）。
  images?: string[];
  // 助手「出图」消息：渲染为内嵌图片卡片而非文本气泡。
  generation?: GenerationView;
  // 标记错误气泡（红色样式）。
  isError?: boolean;
  // 流式进行中（显示光标 / 占位）。
  pending?: boolean;
}

export interface PendingAttachment {
  id: string;
  dataUrl: string;
  name: string;
}
