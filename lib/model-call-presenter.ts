import type { JsonValue } from "@/lib/model-call-content";

export {
  isRecord,
  parseModelCallContent,
  type JsonValue,
  type ModelCallSseFrame,
  type ParsedModelCallContent,
} from "@/lib/model-call-content";

export function prettyModelCallValue(value: JsonValue): string {
  if (typeof value === "string") return value;
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number")
    return String(value);
  return JSON.stringify(value, null, 2);
}

export const MODEL_CALL_FIELD_LABELS: Record<string, string> = {
  model: "模型",
  model_id: "模型 ID",
  messages: "消息",
  message: "消息",
  system: "系统指令",
  input: "输入",
  prompt: "提示词",
  prompt_id: "提示词 ID",
  size: "尺寸",
  quality: "质量",
  background: "背景",
  n: "数量",
  stream: "流式返回",
  response_format: "返回格式",
  tools: "工具",
  tool_choice: "工具选择",
  tool_calls: "工具调用",
  function: "函数",
  arguments: "参数",
  content: "内容",
  text: "文本",
  output_text: "输出文本",
  choices: "候选回复",
  data: "结果数据",
  usage: "用量",
  error: "错误",
  type: "类型",
  code: "错误代码",
  finish_reason: "结束原因",
  created: "创建时间",
  id: "ID",
  object: "对象类型",
  images: "参考图",
  image: "图片",
  image_url: "图片地址",
};

export const MODEL_CALL_ROLE_LABELS: Record<string, string> = {
  system: "系统指令",
  developer: "开发者指令",
  user: "用户",
  assistant: "助手",
  tool: "工具",
  function: "函数",
};

export function modelCallFieldLabel(key: string): string {
  return MODEL_CALL_FIELD_LABELS[key] ?? key.replaceAll("_", " ");
}

export function modelCallRoleLabel(role: string): string {
  return MODEL_CALL_ROLE_LABELS[role] ?? role;
}
