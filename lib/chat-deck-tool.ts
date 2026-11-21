/**
 * plan_presentation: the chat agent drafts a slide outline in the
 * conversation. The tool is terminal like ask_user. The worker stores the
 * outline as a PPTGeneration draft (lib/ppt-deck.ts) and appends a fenced
 * block that the Studio renders as an outline card, where the user confirms
 * the outline and chooses how the deck is made:
 *
 *   ```chugao-deck
 *   {"id":"…","title":"…","style":"…","slides":[{"title":"…","points":["…"],"visual":"…"}]}
 *   ```
 *
 * The block carries the whole outline, so a later turn (for example "排版成
 * 可编辑幻灯片") can read it back from the context without a database lookup.
 */

import {
  cleanToolText,
  parseToolArguments,
  repairRelayValue,
} from "@/lib/chat-agent-tools";

export const PLAN_PRESENTATION_TOOL_NAME = "plan_presentation";
export const DECK_BLOCK_LANGUAGE = "chugao-deck";

export const DECK_TITLE_MAX = 60;
export const DECK_STYLE_MAX = 400;
export const DECK_SLIDES_MIN = 1;
export const DECK_SLIDES_MAX = 20;
export const DECK_SLIDE_TITLE_MAX = 60;
export const DECK_POINTS_MAX = 6;
export const DECK_POINT_MAX = 80;
export const DECK_VISUAL_MAX = 120;

export const PLAN_PRESENTATION_TOOL_DESCRIPTION =
  "为用户起草一份演示文稿（PPT / 幻灯片）的逐页大纲，并结束本轮回答。用户明确要做 PPT、幻灯片、演示文稿、路演或汇报材料时调用；只是问怎么做 PPT 或要一段文案时不要调用。大纲会以卡片展示，用户在卡片上确认大纲并选择制作方式（整页设计图，或可编辑的排版幻灯片）后才会开始制作，调用本身不扣积分。结合对话里已有的内容写出每页真实、具体的标题和要点，不要写占位文字；一般 6~12 页，最多 20 页，第一页是封面，按需要加目录、章节页和结尾页。调用后正文只用一两句话说明思路，不要在正文里重复列出大纲，同一轮不要生图。用户要修改大纲时，按修改后的完整大纲重新调用。用户要把已有大纲“排版成可编辑幻灯片”时不要调用，直接输出 html 幻灯片。";

const planPresentationParameters = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description: "演示文稿标题，不超过 60 字。",
    },
    style: {
      type: "string",
      description:
        "整套统一的视觉风格：基调、配色、字体气质、版式倾向，以及用户提到的品牌要求，不超过 400 字。用户没说时按主题和用途给出一个克制、具体的方案。",
    },
    slides: {
      type: "array",
      minItems: DECK_SLIDES_MIN,
      maxItems: DECK_SLIDES_MAX,
      description: "按顺序排列的每一页，1~20 页。",
      items: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "这一页的标题，不超过 60 字。",
          },
          points: {
            type: "array",
            maxItems: DECK_POINTS_MAX,
            description:
              "这一页要出现的要点，0~6 条，每条不超过 80 字；封面可以只写副标题、署名或日期。",
            items: { type: "string" },
          },
          visual: {
            type: "string",
            description:
              "可选。这一页的画面或版式建议，例如“左文右图，配一张城市夜景”“三列数据卡片”，不超过 120 字。",
          },
        },
        required: ["title"],
        additionalProperties: false,
      },
    },
  },
  required: ["title", "slides"],
  additionalProperties: false,
} as const;

export const PLAN_PRESENTATION_TOOL = {
  type: "function" as const,
  function: {
    name: PLAN_PRESENTATION_TOOL_NAME,
    description: PLAN_PRESENTATION_TOOL_DESCRIPTION,
    parameters: planPresentationParameters,
  },
};
export const PLAN_PRESENTATION_RESPONSES_TOOL = {
  type: "function" as const,
  strict: false as const,
  name: PLAN_PRESENTATION_TOOL_NAME,
  description: PLAN_PRESENTATION_TOOL_DESCRIPTION,
  parameters: planPresentationParameters,
};
export const PLAN_PRESENTATION_ANTHROPIC_TOOL = {
  name: PLAN_PRESENTATION_TOOL_NAME,
  description: PLAN_PRESENTATION_TOOL_DESCRIPTION,
  input_schema: planPresentationParameters,
};

export interface DeckOutlineSlide {
  title: string;
  points: string[];
  visual?: string;
}

export interface DeckOutline {
  title: string;
  style: string;
  slides: DeckOutlineSlide[];
}

function asRecord(value: unknown): Record<string, unknown> {
  const repaired = repairRelayValue(value);
  return repaired && typeof repaired === "object" && !Array.isArray(repaired)
    ? (repaired as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  const repaired = repairRelayValue(value);
  if (Array.isArray(repaired)) return repaired;
  return typeof repaired === "string" && repaired.trim() ? [repaired] : [];
}

/** Clean a plan_presentation call; null when no usable slide remains. */
export function sanitizeDeckOutline(
  raw: string | Record<string, unknown>,
): DeckOutline | null {
  const args = typeof raw === "string" ? parseToolArguments(raw) : raw;
  const slides: DeckOutlineSlide[] = [];
  for (const value of asArray(args.slides)) {
    const item =
      typeof value === "string" ? { title: value } : asRecord(value);
    const title = cleanToolText(item.title, DECK_SLIDE_TITLE_MAX);
    if (!title) continue;
    const points: string[] = [];
    for (const point of asArray(item.points)) {
      const text = cleanToolText(point, DECK_POINT_MAX);
      if (text && !points.includes(text)) points.push(text);
      if (points.length === DECK_POINTS_MAX) break;
    }
    const visual = cleanToolText(item.visual, DECK_VISUAL_MAX);
    slides.push(visual ? { title, points, visual } : { title, points });
    if (slides.length === DECK_SLIDES_MAX) break;
  }
  if (slides.length < DECK_SLIDES_MIN) return null;
  return {
    title: cleanToolText(args.title, DECK_TITLE_MAX) || slides[0].title,
    style: cleanToolText(args.style, DECK_STYLE_MAX),
    slides,
  };
}

/** The per-slide text stored on PPTSlide.originalContent (image mode prompt input). */
export function deckSlideContent(slide: DeckOutlineSlide): string {
  return [
    `标题：${slide.title}`,
    slide.points.length
      ? `要点：\n${slide.points.map((point) => `- ${point}`).join("\n")}`
      : "",
    slide.visual ? `画面与版式：${slide.visual}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Single-line JSON that can never close the surrounding ``` fence. */
function fenceJson(value: unknown) {
  return JSON.stringify(value).replace(/`/g, "\\u0060");
}

export function deckBlock(id: string, outline: DeckOutline): string {
  return `\`\`\`${DECK_BLOCK_LANGUAGE}\n${fenceJson({
    id,
    title: outline.title,
    style: outline.style,
    slides: outline.slides,
  })}\n\`\`\``;
}

/** The marker a past deck block becomes when the conversation is sent again. */
export function deckBlockContextText(body: string): string {
  const data = parseToolArguments(body.trim());
  const outline = sanitizeDeckOutline(data);
  if (!outline) return "[已给出 PPT 大纲]";
  const id = cleanToolText(data.id, 64);
  const lines = outline.slides.map((slide, index) => {
    const points = slide.points.length ? `：${slide.points.join("；")}` : "";
    const visual = slide.visual ? `（画面：${slide.visual}）` : "";
    return `${index + 1}. ${slide.title}${points}${visual}`;
  });
  return [
    `[已给出 PPT 大纲《${outline.title}》${id ? `（id ${id}）` : ""}，共 ${outline.slides.length} 页，用户在卡片上确认并选择制作方式。`,
    outline.style ? `整体风格：${outline.style}` : "",
    ...lines,
    "]",
  ]
    .filter(Boolean)
    .join("\n");
}

/** The message the outline card's editable option sends (DeckCard codeDeckRequest). */
export function isDeckLayoutRequest(content: unknown): boolean {
  return typeof content === "string" && /排版成可编辑幻灯片/.test(content);
}

export const PLAN_PRESENTATION_LAYOUT_OUTPUT =
  "[plan_presentation] 没有执行：用户已经确认了大纲，并选择做成可编辑幻灯片。不要再起草大纲，也不要调用其他工具：现在就按最近一份 [已给出 PPT 大纲] 输出一个 html 代码块，每页一个 <section class=\"slide\">，固定 1280×720。";

export const PLAN_PRESENTATION_RECORDED_OUTPUT =
  "[plan_presentation] 大纲已保存，会在本轮回答末尾以卡片展示；用户确认大纲并选择制作方式后才开始制作。不要在正文里重复大纲，也不要生图；用一两句话收尾即可。";

export const PLAN_PRESENTATION_INVALID_OUTPUT =
  "[plan_presentation] 大纲里没有可用的页面（每页至少要有标题），没有展示。请按参数要求重新调用一次。";

export function planPresentationFailedOutput(message: string) {
  return `[plan_presentation] 大纲没有保存成功：${message}。用文字把大纲告诉用户，并说明可以稍后再试；本轮不要再调用。`;
}
