import { z } from "zod";
import { ResearchError } from "./errors";
import {
  researchIntakeResultSchema,
  type ResearchBriefInput,
  type ResearchIntakeResult,
  type ResearchIntakeSubmission,
} from "./types";

export const INTAKE_DIALOGUE_VERSION = "intake-dialogue-v1" as const;
export const INTAKE_MAX_MODEL_CALLS = 3;
const briefSchema = researchIntakeResultSchema.shape.brief;
const requirementSchema = z.array(z.string().trim().min(1).max(8000)).max(40);

export const intakeModelResultSchema = z
  .object({
    acknowledgement: z.string().trim().max(400),
    nextQuestion: z.string().trim().min(1).max(600).nullable(),
    // Additive to v1: old completed turns and in-flight model replies remain
    // readable. An absent list never manufactures local assistant suggestions.
    suggestions: researchIntakeResultSchema.shape.suggestions.default([]),
    ready: z.boolean(),
    summary: z.string().trim().min(1).max(1600),
    unknowns: z.array(z.string().trim().min(1).max(500)).max(16),
    confirmedRequirements: requirementSchema,
    products: researchIntakeResultSchema.shape.products,
    brief: briefSchema,
  })
  .strict();

function sameBrief(a: unknown, b: ResearchBriefInput) {
  const first = briefSchema.safeParse(a);
  const second = briefSchema.safeParse(b);
  return (
    first.success &&
    second.success &&
    JSON.stringify(first.data) === JSON.stringify(second.data)
  );
}

/** Keep the user's full statement/sentence, so a quote cannot drop a negation. */
function isUserStatement(value: string, messages: readonly string[]) {
  const normalized = value.trim().replace(/[。！？!?；;]+$/u, "");
  return messages.some((message) =>
    [message, ...message.split(/(?<=[。！？!?；;])|\r?\n/u)].some(
      (sentence) =>
        sentence.trim().replace(/[。！？!?；;]+$/u, "") === normalized,
    ),
  );
}

function requirementsFromUser(
  value: readonly string[],
  userMessages: readonly string[],
) {
  return value.every((item) => isUserStatement(item, userMessages));
}

export function confirmedIntakeRequirements(
  result: unknown,
  userMessages: readonly string[],
  executionBrief?: ResearchBriefInput,
): string[] | null {
  const parsed = researchIntakeResultSchema.safeParse(result);
  if (
    !parsed.success ||
    parsed.data.contractVersion !== INTAKE_DIALOGUE_VERSION ||
    !parsed.data.ready ||
    !parsed.data.confirmedRequirements ||
    !requirementsFromUser(parsed.data.confirmedRequirements, userMessages) ||
    (executionBrief && !sameBrief(parsed.data.brief, executionBrief))
  )
    return null;
  return [...new Set(parsed.data.confirmedRequirements)];
}

const intakeConfirmationSchema = z.object({
  taskId: z.string().min(1).max(100).nullable(),
  contractVersion: z.enum([INTAKE_DIALOGUE_VERSION, "legacy-unverified"]),
  brief: briefSchema,
  confirmedRequirements: requirementSchema,
});

/** The writer checks provenance before freezing this application-owned snapshot. */
export function readIntakeConfirmationRequirements(
  snapshot: unknown,
  executionBrief: ResearchBriefInput,
): string[] | null {
  const parsed = intakeConfirmationSchema.safeParse(snapshot);
  if (!parsed.success || !sameBrief(parsed.data.brief, executionBrief))
    return null;
  if (parsed.data.contractVersion === "legacy-unverified") return [];
  if (!parsed.data.taskId) return null;
  return [...new Set(parsed.data.confirmedRequirements)];
}

export function parseIntakeDialogue(
  text: string,
  userMessages: readonly string[],
  intent: ResearchIntakeSubmission["intent"] = "continue",
): ResearchIntakeResult {
  try {
    // A single JSON fence is tolerated; malformed JSON is not repaired or retried.
    const raw = text
      .trim()
      .replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/u, "$1");
    const value = intakeModelResultSchema.parse(JSON.parse(raw));
    if (
      /[?？]/u.test(value.acknowledgement) ||
      !requirementsFromUser(value.confirmedRequirements, userMessages) ||
      (intent === "prepare_research" && !value.ready)
    )
      throw Error("Invalid intake contract");
    if (value.ready) {
      if (
        value.nextQuestion !== null ||
        value.suggestions.length ||
        /[?？]/u.test(value.summary)
      )
        throw Error("Ready is a summary, not another question");
    } else if (
      !value.nextQuestion ||
      (value.nextQuestion.match(/[?？]/gu) ?? []).length !== 1 ||
      !/[?？]$/u.test(value.nextQuestion) ||
      /\n\s*(?:[-*]|\d+[.)、])/u.test(value.nextQuestion)
    ) {
      throw Error("Only one question may be displayed");
    }
    if (
      value.suggestions.length === 1 ||
      new Set(value.suggestions).size !== value.suggestions.length ||
      value.suggestions.some((suggestion) => /[\r\n?？]/u.test(suggestion))
    )
      throw Error(
        "Suggestions must be distinct, optional answers to one question",
      );
    return researchIntakeResultSchema.parse({
      contractVersion: INTAKE_DIALOGUE_VERSION,
      reply: value.ready
        ? value.summary
        : [value.acknowledgement, value.nextQuestion]
            .filter(Boolean)
            .join("\n\n"),
      suggestions: value.suggestions,
      nextQuestion: value.nextQuestion,
      ready: value.ready,
      summary: value.summary,
      unknowns: value.unknowns,
      confirmedRequirements: [...new Set(value.confirmedRequirements)],
      products: value.products,
      brief: value.brief,
    });
  } catch {
    throw new ResearchError(
      "INTAKE_INVALID_RESPONSE",
      "这次回复未满足需求对话格式，你的回答已保留；可以显式重试。",
      502,
    );
  }
}

export const INTAKE_DIALOGUE_INSTRUCTIONS = `你是 Chugao 设计工作台的需求访谈助手，负责真实的一问一答自由对话，可提供便于回答的选项。
理解全部用户原话和纠正。每轮最多问一个当前最影响研究的问题；已经足够明确时直接 ready，不按固定问卷补字段，不要求用户选择引擎或模式。通常一到三轮足够，信息量比轮数重要。
用户说不知道、没有偏好、你来建议时可保留未知或提出明确标为建议的方向；不知道市场、预算、竞品或时间不阻断研究。用户说先开始、按现有信息研究时 ready=true，简短总结现有需求，不再追问非关键项。
应用草稿、默认设置、附件名称和你此前的建议都不是用户确认。只有真实用户消息可证明用户要求。用户纠正后只保留当前仍有效的要求，移除已撤销的旧要求。
confirmedRequirements 只能逐字复制当前有效要求所在的完整用户消息或完整句子（保留否定、条件、单位），不得改写、裁掉否定、把“我不知道/你建议”充当产品约束，不得复制助手或应用草稿中的建议。用户只笼统认可某建议且未复述具体要求时，不自行补造具体数字，可保留在待确认建议中。
brief.question 是整个研究目标，不是本轮短回答。brief 其余字段允许空字符串/空数组；建议若需保留，放 constraints 并写明“待验证建议”。unknowns 列真正未知项，不编造已搜索、看过图片或验证过的事实。附件引用仅表示收到参考材料，不代表内容已阅读。
products 优先遵循用户明确提出的产物，未提出则沿用应用默认；不要擅自增加演示稿或网页。公开对话只展示简短 acknowledgement 加唯一 nextQuestion；ready 时只展示 summary。nextQuestion 必须是一个自然问题并以一个问号结束，不能把多个问题或问卷塞在一起，ready 时为 null。acknowledgement 和 ready 的 summary 不追问，也不要求用户再逐字段确认。
有追问且选项能减少回答负担时，suggestions 提供 2—4 个简短、不同的自然语言回答，每条不超过 100 字，直接回答唯一 nextQuestion。使用可以作为普通用户消息发送的完整意思，不用 A/B、是/否、“其他”、内部模式名或空泛关键词；不要把多个问题塞进选项。通常包括“还不确定，希望你结合研究再建议。”这样的不确定方向，但不能暗示已搜索或把待验证建议当作事实。用户可自由输入、纠正、组合方向，无需逐个作答，也无需在选项中选满。选项只是助手建议，未被用户实际发送前绝不是已确认需求。已确认的信息不再追问，也不为展示选项延长访谈；ready=true 或选项无帮助时 suggestions=[]。不要把选项再抄进 nextQuestion。
只返回一个 JSON 对象，不输出额外说明或伪造工具过程。字段结构：
{"acknowledgement":"简短回应","nextQuestion":"唯一问题？或 null","suggestions":["围绕当前问题的具体回答一。","另一个具体方向。","还不确定，希望你结合研究再建议。"],"ready":false,"summary":"几句话概括目前理解","unknowns":["未确定事项"],"confirmedRequirements":["用户当前有效原话完整句子"],"products":["report"],"brief":{"question":"完整研究目标","market":"","audience":"","timeRange":"","constraints":"","competitors":[],"links":[]}}
products 可选 report、competitors、board、brief、pptx、docx、html。`;

