// Opus 5.5 client for prompt enhancement and PPT prompt preparation.
// Any upstream failure falls back to the original prompt so image generation
// itself is never blocked by this optional language-model step.

import { getPromptOptimizerSystemPrompt } from "@/lib/ai-config";
import { getOpusConfig } from "@/lib/opus-config";
import { fetchWithTimeout } from "@/lib/http";
import { logger } from "@/lib/logger";
import { withModelCall, type ModelCallContext } from "@/lib/model-call-log";
import { providerError } from "@/lib/providers/diagnostics";
import type { SlideType } from "@/lib/ppt-templates";

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_CONCURRENCY = 4;

export async function isPromptOptimizerConfigured(): Promise<boolean> {
  const config = await getOpusConfig();
  return config.enabled && Boolean(config.apiKey);
}

function concatPrompt(fixedPrompt: string, variablePrompt: string): string {
  return [fixedPrompt, variablePrompt]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
}

function extractContent(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const content = (choices[0] as { message?: { content?: unknown } }).message
    ?.content;
  return typeof content === "string" ? content.trim() : null;
}

async function callOpus(
  systemPrompt: string,
  userPrompt: string,
  logContext?: ModelCallContext & { operation?: string },
): Promise<string | null> {
  const config = await getOpusConfig();
  if (!config.enabled || !config.apiKey) return null;

  const url = `${config.baseUrl.replace(/\/+$/, "")}/v1/chat/completions`;
  const requestBody = {
    model: config.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    reasoning_effort: "low",
    max_tokens: 400,
  };
  return withModelCall(
    {
      ...logContext,
      secrets: [config.apiKey],
      kind: "llm",
      operation: logContext?.operation ?? "prompt.optimize",
      modelId: config.model,
      providerName: "Opus 5.5",
      endpoint: url,
      requestContent: requestBody,
    },
    async (call) => {
      const response = await fetchWithTimeout(url, {
        method: "POST",
        timeoutMs: REQUEST_TIMEOUT_MS,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(requestBody),
      });

      call.response(response);
      if (!response.ok)
        throw await providerError(
          response,
          "Opus 5.5",
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
}

export interface OptimizeImagePromptInput {
  logContext?: ModelCallContext & { operation?: string };
  contextSystemPrompt?: string;
  fixedPrompt: string;
  variablePrompt: string;
}

export async function optimizeImagePrompt({
  contextSystemPrompt,
  fixedPrompt,
  variablePrompt,
  logContext,
}: OptimizeImagePromptInput): Promise<string> {
  const fallback = concatPrompt(fixedPrompt, variablePrompt);

  try {
    const baseSystemPrompt = await getPromptOptimizerSystemPrompt();
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
    const optimized = await callOpus(systemPrompt, userPrompt, logContext);
    return optimized && optimized.length > 0 ? optimized : fallback;
  } catch (error) {
    logger.warn(
      { error },
      "Opus prompt optimization failed; using concatenation.",
    );
    return fallback;
  }
}

interface EnhanceInput {
  logContext?: ModelCallContext;
  prompt: string;
  theme: string;
  slideType: SlideType;
}

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
    const optimized = await callOpus(
      systemPrompt,
      `优化这条提示词：\n${prompt}`,
      { ...logContext, operation: "ppt.optimize" },
    );
    return optimized && optimized.length > 0 ? optimized : prompt;
  } catch (error) {
    logger.warn({ error }, "Opus PPT enhancement failed; using original.");
    return prompt;
  }
}

export async function enhanceSlidePrompts(
  inputs: EnhanceInput[],
): Promise<string[]> {
  if (!(await isPromptOptimizerConfigured()))
    return inputs.map((input) => input.prompt);

  const results = new Array<string>(inputs.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < inputs.length) {
      const index = cursor++;
      const input = inputs[index];
      if (input) results[index] = await enhanceSlidePrompt(input);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(MAX_CONCURRENCY, inputs.length) }, () =>
      worker(),
    ),
  );
  return results;
}
