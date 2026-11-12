import {
  ALL_IMAGE_SIZE_OPTIONS,
  IMAGE_QUALITY_OPTIONS,
} from "@/lib/models/options";

export const CHAT_IMAGE_TOOL_NAME = "generate_image";

const imageToolParameters = {
  type: "object",
  properties: {
    prompt: {
      type: "string",
      description:
        "最终要生成的画面描述。把主体、构图、风格、文字和限制写完整。",
    },
    modelId: {
      type: "string",
      description: "可选的图片模型 ID；省略时使用用户当前选择的图片模型。",
    },
    size: {
      type: "string",
      enum: [...ALL_IMAGE_SIZE_OPTIONS],
      description: "可选输出尺寸；只有在用户明确要求时才指定。",
    },
    quality: {
      type: "string",
      enum: [...IMAGE_QUALITY_OPTIONS],
      description: "可选质量档位。",
    },
    outputFormat: {
      type: "string",
      enum: ["png", "jpeg", "webp", "gif"],
      description: "可选输出格式。",
    },
    background: {
      type: "string",
      enum: ["auto", "opaque", "transparent"],
      description: "可选背景模式。",
    },
    n: {
      type: "integer",
      minimum: 1,
      maximum: 4,
      description: "可选生成数量，默认使用当前生图设置。",
    },
  },
  required: ["prompt"],
  additionalProperties: false,
} as const;

export const CHAT_IMAGE_TOOL = {
  type: "function",
  function: {
    name: CHAT_IMAGE_TOOL_NAME,
    description:
      "当用户明确需要生成、重绘或修改图片时调用。工具会把任务交给网站的图片生成队列，并把结果图片接回当前对话。不要把工具参数 JSON 展示给用户。",
    parameters: imageToolParameters,
  },
} as const;

export const CHAT_IMAGE_RESPONSES_TOOL = {
  type: "function",
  name: CHAT_IMAGE_TOOL_NAME,
  description:
    "当用户明确需要生成、重绘或修改图片时调用。工具会把任务交给网站的图片生成队列，并把结果图片接回当前对话。不要把工具参数 JSON 展示给用户。",
  parameters: imageToolParameters,
} as const;
