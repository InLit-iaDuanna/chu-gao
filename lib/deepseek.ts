// 服务端 DeepSeek 客户端：把图像提示词优化得更具体、风格更统一。
// 配置来源：lib/ai-config（DB 优先，env 兜底）。
// 设计原则：永不让增强失败中断主流程——任何错误都回退到原始/拼接提示词。

import { getDeepSeekConfig, getDeepSeekSystemPrompt } from "@/lib/ai-config";
import { logger } from "@/lib/logger";
import { withModelCall, type ModelCallContext } from "@/lib/model-call-log";
import { providerError } from "@/lib/providers/diagnostics";
import type { SlideType } from "@/lib/ppt-templates";

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_CONCURRENCY = 4;

export async function isDeepSeekConfigured(): Promise<boolean> {
  const config = await getDeepSeekConfig();
  return config.enabled && Boolean(config.apiKey);
}

// 拼接回退：不变 + 变的提示词。
function concatPrompt(fixedPrompt: string, variablePrompt: string): string {
  return [fixedPrompt, variablePrompt]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
}

function extractContent(data: unknown): string | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }

  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }

  const message = (choices[0] as { message?: { content?: unknown } }).message;
  const content = message?.content;

  return typeof content === "string" ? content.trim() : null;
}

// 调用 DeepSeek chat completions。失败抛出，由上层回退。
async function callDeepSeek(
  systemPrompt: string,
  userPrompt: string,
  logContext?: ModelCallContext & { operation?: string },
): Promise<string | null> {
  const config = await getDeepSeekConfig();

  if (!config.enabled || !config.apiKey) {
    return null;
  }

  const url = `${config.baseUrl.replace(/\/+$/, "")}/v1/chat/completions`;
  const requestBody = {
    model: config.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.7,
    max_tokens: 400,
  };
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error("Prompt optimizer timeout")),
    REQUEST_TIMEOUT_MS,
  );

  try {
    return await withModelCall(
      {
        ...logContext,
        secrets: [config.apiKey],
        kind: "llm",
        operation: logContext?.operation ?? "prompt.optimize",
        modelId: config.model,
        providerName: "DeepSeek",
        endpoint: url,
        requestContent: requestBody,
      },
      async (call) => {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });

        call.response(response);
        if (!response.ok)
          throw await providerError(
            response,
            "DeepSeek",
            "chat-completions",
            url,
          );

        const data: unknown = await response.json();
        call.usage(data);
        const content = extractContent(data);
        if (!content)
          throw new Error("Invalid or empty content from prompt optimizer");
        return content;
      },
    );
  } finally {
    clearTimeout(timeout);
  }
}

export interface OptimizeImagePromptInput {
  logContext?: ModelCallContext & { operation?: string };
  // 额外的上下文系统提示词（如 PPT 专属约束），叠加在 DeepSeek 优化系统提示词之上。
  contextSystemPrompt?: string;
  // 不变提示词（整套统一风格 / 约束）。
  fixedPrompt: string;
  // 该页变的提示词（本页内容）。
  variablePrompt: string;
}

// 将（不变 + 该页变的）优化成最终出图 prompt。
// 系统提示词 = 后台「DeepSeek 优化系统提示词」(+ 可选上下文)。
// 未配置 / 关闭 / 出错时，回退为拼接文本，绝不抛出。
export async function optimizeImagePrompt({
  contextSystemPrompt,
  fixedPrompt,
  variablePrompt,
  logContext,
}: OptimizeImagePromptInput): Promise<string> {
  const fallback = concatPrompt(fixedPrompt, variablePrompt);

  try {
    const baseSystemPrompt = await getDeepSeekSystemPrompt();
    const systemPrompt = contextSystemPrompt?.trim()
      ? `${baseSystemPrompt}\n\n${contextSystemPrompt.trim()}`
      : baseSystemPrompt;

    const userPrompt = [
      fixedPrompt.trim()
        ? `整体风格 / 约束（所有页面统一）：\n${fixedPrompt.trim()}`
        : "",
      `本页内容：\n${variablePrompt.trim()}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const optimized = await callDeepSeek(systemPrompt, userPrompt, logContext);
    return optimized && optimized.length > 0 ? optimized : fallback;
  } catch (error) {
    logger.warn({ error }, "DeepSeek optimize failed; using concatenation.");
    return fallback;
  }
}

interface EnhanceInput {
  logContext?: ModelCallContext;
  prompt: string;
  theme: string;
  slideType: SlideType;
}

// 旧版逐条增强（保留兼容）。无 key / 出错时原样返回，绝不抛出。
export async function enhanceSlidePrompt({
  prompt,
  theme,
  slideType,
  logContext,
}: EnhanceInput): Promise<string> {
  try {
    const systemPrompt = `你是图像生成提示词优化专家，负责优化 PPT 幻灯片的英文图像提示词。
规则：
1. 保留原有风格方向与布局要求，不改变主题。
2. 强化视觉细节（配色、光影、构图、材质）并加入专业设计术语。
3. 仅输出英文提示词本身，控制在 60-120 个单词，不要任何解释。
当前主题：${theme}；幻灯片类型：${slideType}。`;

    const optimized = await callDeepSeek(
      systemPrompt,
      `优化这条提示词：\n${prompt}`,
      { ...logContext, operation: "ppt.optimize" },
    );
    return optimized && optimized.length > 0 ? optimized : prompt;
  } catch (error) {
    logger.warn({ error }, "DeepSeek enhancement failed; using original.");
    return prompt;
  }
}

// 批量优化（有界并发）。失败条目回退原始提示词，保持顺序。
export async function enhanceSlidePrompts(
  inputs: EnhanceInput[],
): Promise<string[]> {
  if (!(await isDeepSeekConfigured())) {
    return inputs.map((input) => input.prompt);
  }

  const results = new Array<string>(inputs.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < inputs.length) {
      const index = cursor;
      cursor += 1;
      const input = inputs[index];
      if (input) {
        results[index] = await enhanceSlidePrompt(input);
      }
    }
  }

  const poolSize = Math.min(MAX_CONCURRENCY, inputs.length);
  await Promise.all(Array.from({ length: poolSize }, () => worker()));

  return results;
}
