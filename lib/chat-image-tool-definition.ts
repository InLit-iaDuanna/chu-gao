import {
  ALL_IMAGE_SIZE_OPTIONS,
  IMAGE_QUALITY_OPTIONS,
} from "@/lib/models/options";

export const CHAT_IMAGE_TOOL_NAME = "generate_image";

/**
 * Model-facing definition of the only function tool in Studio chat.
 *
 * Principles (see docs/CHAT_AGENT_PROMPT.md):
 * - The description says what the tool does, when to call it and what it
 *   returns. Behavioural detail lives in CHAT_IMAGE_TOOL_CONTRACT.
 * - Only expose parameters the model can fill correctly from the conversation.
 *   `modelId` is deliberately absent: the model cannot know valid IDs, and the
 *   user's own image settings already decide it. The server-side schema in
 *   chat-image-tool.ts still accepts it for older in-flight turns.
 * - Every optional parameter defaults to the user's image settings, so each
 *   description states the condition for passing it.
 */
export const CHAT_IMAGE_TOOL_DESCRIPTION =
  "提交一个图片生成任务：文生图，或基于本轮参考图重绘、修改。仅在用户明确要求生成、重绘或修改图片，且画面要求足够具体时调用；每轮最多调用一次。调用只是把任务提交到生成队列并返回提交回执（不是图片本身），图片生成后会自动显示在当前回复下方。本轮的参考图由系统自动附带。";

const imageToolParameters = {
  type: "object",
  properties: {
    prompt: {
      type: "string",
      description:
        "交给图片模型的完整画面描述。图片模型看不到对话，所以要写清主体、场景、构图、风格、光线、色彩、画面中要出现的文字（照抄原文）和需要避免的内容；修改图片时写清保留什么、改动什么。不要包含图片链接或 ID，不超过 4000 字。",
    },
    size: {
      type: "string",
      enum: [...ALL_IMAGE_SIZE_OPTIONS],
      description:
        "输出尺寸，格式为 宽x高，auto 表示自动。仅在用户明确指定尺寸、比例或横竖版时传入，否则省略以使用用户当前的生图设置。gif 只能用 512x512 或 768x768，其他格式不能用这两个尺寸。",
    },
    quality: {
      type: "string",
      enum: [...IMAGE_QUALITY_OPTIONS],
      description:
        "质量档位。仅在用户明确要求更高质量或更快、更省时传入，否则省略。",
    },
    outputFormat: {
      type: "string",
      enum: ["png", "jpeg", "webp", "gif"],
      description:
        "输出格式。仅在用户明确要求某种格式或要动图（gif）时传入，否则省略。",
    },
    background: {
      type: "string",
      enum: ["auto", "opaque", "transparent"],
      description: "背景模式。用户明确要透明背景时传 transparent，否则省略。",
    },
    n: {
      type: "integer",
      minimum: 1,
      maximum: 4,
      description:
        "生成张数。仅在用户明确要多张时传入，否则省略以使用用户当前的生图设置。",
    },
  },
  required: ["prompt"],
  additionalProperties: false,
} as const;

/** Chat Completions shape. */
export const CHAT_IMAGE_TOOL = {
  type: "function",
  function: {
    name: CHAT_IMAGE_TOOL_NAME,
    description: CHAT_IMAGE_TOOL_DESCRIPTION,
    parameters: imageToolParameters,
  },
} as const;

/**
 * Responses shape. Same name, description and parameters.
 *
 * `strict: false` is deliberate. The Responses API treats a function tool
 * without the field as strict, and a strict model fills in every property:
 * measured on production (2026-11-13), Sol sent `n: 1`, `quality: "auto"`,
 * `outputFormat: "png"` and `background: "opaque"` for a plain "画一张…",
 * which silently overrode the user's own image settings. Non-strict, the
 * same requests carried only `prompt` plus what the user actually asked for.
 */
export const CHAT_IMAGE_RESPONSES_TOOL = {
  type: "function",
  strict: false,
  name: CHAT_IMAGE_TOOL_NAME,
  description: CHAT_IMAGE_TOOL_DESCRIPTION,
  parameters: imageToolParameters,
} as const;

export type ChatImageToolResult =
  | {
      ok: true;
      generationId: string;
      status: string;
      estimatedCredits?: number;
      modelId?: string;
      /** Argument names that were dropped; the user's settings applied instead. */
      ignored?: string[];
    }
  | { ok: false; code: string; message: string };

const SUBMITTED_NEXT =
  "任务已进入生成队列，图片还没有生成，稍后会自动显示在这条回复下方。用一两句话告诉用户已提交以及画面思路；不要说已经画好，不要输出图片链接。";

const IGNORED_NEXT =
  " ignored 里的参数没有被采用，这些项按用户当前的生图设置处理；如果其中有用户明确提出的要求，告诉用户这一项没有生效，可以在生图设置里调整。";

const FAILED_FALLBACK_NEXT =
  "图片没有提交。如实告诉用户这次没有成功，可以稍后再试。";

/** What the model should tell the user for each failure the runtime can return. */
const FAILED_NEXT: Record<string, string> = {
  INVALID_TOOL_ARGUMENTS:
    "图片没有提交。按 message 如实告诉用户原因，请用户再发一次需求。",
  INVALID_TOOL_CALL:
    "图片没有提交。告诉用户这次没有提交成功，请再发一次需求，可以补充画面细节。",
  UNSUPPORTED_TOOL_CALL:
    "每轮只能提交一个图片任务，这一个没有提交。告诉用户其余画面请在下一条消息继续。",
  INSUFFICIENT_CREDITS:
    "图片没有提交。告诉用户积分不足，可以充值后重试，或在生图设置里降低质量、尺寸或张数。",
  QUEUE_UNAVAILABLE: "图片没有提交。告诉用户生成服务暂时不可用，请稍后重试。",
  IMAGE_TOOL_UNAVAILABLE:
    "图片没有提交。告诉用户生成服务暂时不可用，请稍后重试。",
  UNSUPPORTED_PARAM:
    "图片没有提交。按 message 说明当前图片模型不支持哪项要求，建议用户去掉该要求，或在生图设置里更换图片模型或参数后重试。",
  MODEL_NOT_AVAILABLE:
    "图片没有提交。告诉用户当前图片模型不可用，请在生图设置里换一个图片模型后重试。",
  REFERENCE_IMAGE_NOT_FOUND:
    "图片没有提交。告诉用户参考图已失效或无法读取，请重新上传或重新选择参考图。",
  MODERATION_REJECTED:
    "图片没有提交。如实告诉用户内容没有通过安全审核，请调整描述；不要帮用户改写来规避审核。",
  CONVERSATION_NOT_FOUND:
    "图片没有提交。告诉用户当前对话不可用，请刷新页面或新建对话。",
};

/**
 * Serializes a tool result into the text the model receives.
 *
 * The receipt is the real submission result minus credits and model name
 * (numbers the model should not quote; the UI owns them), and it always ends
 * with `next`: the one thing to do now.
 */
export function chatImageToolOutput(result: ChatImageToolResult): string {
  return JSON.stringify(
    result.ok
      ? {
          ok: true,
          generationId: result.generationId,
          status: result.status,
          ...(result.ignored?.length ? { ignored: result.ignored } : {}),
          next: result.ignored?.length
            ? SUBMITTED_NEXT + IGNORED_NEXT
            : SUBMITTED_NEXT,
        }
      : {
          ok: false,
          code: result.code,
          message: result.message,
          next: FAILED_NEXT[result.code] ?? FAILED_FALLBACK_NEXT,
        },
  );
}
