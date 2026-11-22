import { isListenSilence } from "@/lib/chat-conversation-mode";

/**
 * 倾听 (admin preview): how Xiie reacts the moment the user pauses after a
 * line, before any real reply. Pure, so the client can share the names.
 */
export const LISTEN_REACTIONS = [
  "listen",
  "nod",
  "care",
  "happy",
  "wow",
  "curious",
] as const;
export type ListenReaction = (typeof LISTEN_REACTIONS)[number];

/** A spoken reaction is a murmur, never a reply. */
export const REACT_LINE_CHARS = 8;
const REACT_HISTORY = 6;
const REACT_ITEM_CHARS = 300;
const REACT_LINES = 12;
const REACT_LINE_INPUT_CHARS = 500;
const REACT_MURMURS = 6;

export const LISTEN_REACT_PROMPT = `你是 Xiie，一只陪人说话的小蜥蜴。现在是“倾听”模式：对方一句一句往下说，还没说完，你先不正式回答，只在他停顿的一瞬间给一个很轻的反应，像朋友边听边点头。
按他刚说的这一句的意思和情绪，选一个反应：
listen：平常的叙述，安静听着（最常见）
nod：说出了一个决定、结论，或你能理解的感受
care：累、难过、委屈、生病、被欺负、失去了什么
happy：好消息、开心、做成了一件事
wow：出乎意料、很突然、很大的事
curious：话说了一半、有悬念，或者你没太听懂
只输出一行：反应词，可以再跟一个空格和一句不超过 6 个字的轻声回应，例如：
nod 嗯嗯
care 辛苦了
curious 然后呢
大多数时候只输出反应词本身，不要每句都出声：一段话里最多出声一两次，这一段已经说过的话不要再说。出声也只是语气词或很短的接话：不提建议，不分析，不评价对错，不复述他的话，不替任何人猜想法，不加表情符号。`;

const clip = (text: string, limit: number) =>
  text.length > limit ? `${text.slice(0, limit)}…` : text;

/**
 * What Flash sees: a few earlier messages for context, the lines said in
 * this stretch with the newest one last, and what Xiie already murmured.
 */
export function reactMessages(
  history: { role: string; content: string }[],
  lines: string[],
  murmurs: string[] = [],
): { role: "system" | "user" | "assistant"; content: string }[] {
  const spoken = murmurs
    .map((murmur) => murmur.trim())
    .filter(Boolean)
    .slice(-REACT_MURMURS)
    .map((murmur) => clip(murmur, REACT_LINE_CHARS));
  const said = lines
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-REACT_LINES)
    .map((line) => clip(line, REACT_LINE_INPUT_CHARS));
  const earlier = history
    .filter((message) => message.content.trim())
    .slice(-REACT_HISTORY)
    .map((message) => {
      const assistant = message.role.toLowerCase() === "assistant";
      const text =
        assistant && isListenSilence(message.content)
          ? "（安静地听着）"
          : clip(message.content.trim(), REACT_ITEM_CHARS);
      return `${assistant ? "你" : "他"}：${text}`;
    });
  const latest = said.at(-1) ?? "";
  const before = said.slice(0, -1);
  return [
    { role: "system", content: LISTEN_REACT_PROMPT },
    {
      role: "user",
      content: [
        earlier.length ? `前面聊过：\n${earlier.join("\n")}` : "",
        before.length ? `这一段他已经说了：\n${before.join("\n")}` : "",
        spoken.length
          ? `这一段你已经出过声：${spoken.join("、")}（这次能不出声就不出声，绝不重复）`
          : "",
        `他刚说的这一句：${latest}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  ];
}

const isReaction = (value: string): value is ListenReaction =>
  (LISTEN_REACTIONS as readonly string[]).includes(value);

/** The reaction word and an optional murmur; anything unusable is silence. */
export function parseReaction(text: string): {
  reaction: ListenReaction;
  line: string | null;
} {
  const first =
    text
      .replace(/\[\[[^\]]*\]\]/g, "")
      .trim()
      .split(/\n+/)[0] ?? "";
  const match = first.match(/^[\s"“'`*]*([a-zA-Z]+)[\s:：|｜,，、-]*(.*)$/);
  const word = match?.[1]?.toLowerCase() ?? "";
  if (!isReaction(word)) return { reaction: "listen", line: null };
  const murmur = (match?.[2] ?? "")
    .replace(/^["“”'「」（(\s]+|["“”'「」）)\s]+$/g, "")
    .trim();
  const line =
    murmur &&
    murmur.length <= REACT_LINE_CHARS &&
    !/[a-zA-Z]{3,}/.test(murmur) &&
    /[\p{L}\p{N}]/u.test(murmur)
      ? murmur
      : null;
  return { reaction: word, line };
}
