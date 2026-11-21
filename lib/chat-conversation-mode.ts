/**
 * Conversation modes (admin preview): how much the assistant says per turn.
 *
 * - detail   详答: the existing behaviour, a complete answer. Default.
 * - dialogue 对谈: short back-and-forth, one point per reply.
 * - listen   倾听: the user talks; the assistant mostly listens, may stay
 *                   silent, and gives a brief recap when a thought is done.
 *
 * The mode instruction rides in the latest user message (like the runtime
 * clock), never in the system instructions, so the prompt-cache prefix and
 * the tool list stay identical for every mode.
 */

export const CONVERSATION_MODES = ["detail", "dialogue", "listen"] as const;
export type ConversationMode = (typeof CONVERSATION_MODES)[number];

export const DEFAULT_CONVERSATION_MODE: ConversationMode = "detail";

export const CONVERSATION_MODE_LABELS: Record<ConversationMode, string> = {
  dialogue: "对谈",
  listen: "倾听",
  detail: "详答",
};

/** The whole reply when the assistant chooses not to speak in listen mode. */
export const LISTEN_SILENCE_MARKER = "[[listening]]";

/** After this many silent replies in a row the next reply must recap. */
export const LISTEN_SILENCE_STREAK_MAX = 5;

/** Loose per-request output ceiling for the short modes (includes thinking). */
export const SHORT_MODE_MAX_OUTPUT_TOKENS = 8_192;

export function normalizeConversationMode(value: unknown): ConversationMode {
  return typeof value === "string" &&
    (CONVERSATION_MODES as readonly string[]).includes(value)
    ? (value as ConversationMode)
    : DEFAULT_CONVERSATION_MODE;
}

export function isShortConversationMode(mode: ConversationMode) {
  return mode !== "detail";
}

/** True when a stored assistant reply is only the listen-mode silence. */
export function isListenSilence(text: string | null | undefined) {
  return (text ?? "").trim() === LISTEN_SILENCE_MARKER;
}

/**
 * The model may wrap the marker in stray text; a reply that contains the
 * marker plus real words keeps the words.
 */
export function normalizeListenReply(text: string): string {
  if (!text.includes(LISTEN_SILENCE_MARKER)) return text;
  const rest = text.split(LISTEN_SILENCE_MARKER).join("").trim();
  return rest ? rest : LISTEN_SILENCE_MARKER;
}

/** Count trailing silent assistant replies, newest first. */
export function trailingSilenceStreak(
  assistantTextsNewestFirst: Array<string | null | undefined>,
) {
  let streak = 0;
  for (const text of assistantTextsNewestFirst) {
    if (!isListenSilence(text)) break;
    streak++;
  }
  return streak;
}

const SHARED_SHORT_RULES = `- 像面对面聊天那样说话：整条回复写成一段，不空行分段；不用标题、列表、表格和加粗，不写开场白和客套总结。
- 不调用 ask_user 和 suggest_replies；需要问就在句子里直接问一句。
- 只有用户明确要求画图时才调用 generate_image；用户明确要求写代码、网页或长文时，不再反问，按合理默认直接完整给出，这一条不受长度限制。`;

/**
 * The mode block appended to the latest user message. detail returns ""
 * so the default turn is byte-identical to the pre-mode behaviour.
 */
export function conversationModeInstruction(
  mode: ConversationMode,
  options: { silenceStreak?: number } = {},
): string {
  if (mode === "dialogue")
    return `[本轮对话模式：对谈]
这条回复的硬性长度：一段话，最多三句，80 个汉字以内（写代码等明确要求的内容除外）。
用户想和你一来一回地讨论，而不是听你讲完整答案。
- 每次最多三句、80 字以内，只推进一个点；可以追问，可以直接表达不同意见。读起来像一条微信消息；想到的第二点、第三点留到用户接话之后再说。
- 不必每次都以提问结尾：只在答案会改变你下一句话时才问，否则说出你的看法，把话头留给用户。
${SHARED_SHORT_RULES}`;
  if (mode === "listen") {
    const mustRecap =
      (options.silenceStreak ?? 0) >= LISTEN_SILENCE_STREAK_MAX;
    return `[本轮对话模式：倾听]
用户想一直说下去，由你倾听。默认不开口，只在下面几种情况才说话：
- 用户还在铺陈、话没说完、在描述经过或感受、或者只是在记录想法时，不开口：整条回复只输出 ${LISTEN_SILENCE_MARKER}，不加任何别的字，也不要回“我在听”之类的话。
- 用户说出一个关键转折、明显的自我否定，或者一段想法说完了，才开口。
- 开口时只说一两句、一般不超过 60 字：点出用户刚才说的重点。以陈述为主，不要追问细节，也不要把话题引到你想聊的方向；用户没有请你解决问题时不给方案。
- 你判断用户一段想法已经说完时，用两到四句、120 字以内回应前面这一段：他讲了什么、你听出的关键。不给建议和做法，除非用户开口问；也不要猜测用户没说过的原因。
- 用户在列清单或记事时，每一条都不开口；等用户说记完了，或者系统要求你开口时，才用一句话复述记下的要点，不加解读和建议。
- 用户直接问你问题时正常回答，但只说两三句、100 字以内，不以反问结尾：先给最关键的判断，再说一条理由或建议；用户想深入会再问。
${SHARED_SHORT_RULES}${mustRecap ? `\n- 你已经连续 ${options.silenceStreak} 条没有开口：这一条必须开口，按上面的规则简短回应前面这些内容。` : ""}`;
  }
  return "";
}

/** Text appended after the user's own words for the latest message. */
export function latestMessageSuffix(input: {
  modeInstruction?: unknown;
  runtimeTime?: unknown;
}) {
  return (
    (typeof input.modeInstruction === "string" && input.modeInstruction
      ? `\n\n${input.modeInstruction}`
      : "") +
    (typeof input.runtimeTime === "string"
      ? `\n\n[本轮运行时间]\n${input.runtimeTime}`
      : "")
  );
}
