import {
  ASK_USER_ANTHROPIC_TOOL,
  ASK_USER_RESPONSES_TOOL,
  ASK_USER_TOOL,
  CHECK_CREDITS_ANTHROPIC_TOOL,
  CHECK_CREDITS_RESPONSES_TOOL,
  CHECK_CREDITS_TOOL,
  READ_URL_ANTHROPIC_TOOL,
  READ_URL_RESPONSES_TOOL,
  READ_URL_TOOL,
  SUGGEST_REPLIES_ANTHROPIC_TOOL,
  SUGGEST_REPLIES_RESPONSES_TOOL,
  SUGGEST_REPLIES_TOOL,
} from "@/lib/chat-agent-tools";
import {
  PLAN_PRESENTATION_ANTHROPIC_TOOL,
  PLAN_PRESENTATION_RESPONSES_TOOL,
  PLAN_PRESENTATION_TOOL,
} from "@/lib/chat-deck-tool";
import {
  CHAT_IMAGE_ANTHROPIC_TOOL,
  CHAT_IMAGE_RESPONSES_TOOL,
  CHAT_IMAGE_TOOL,
} from "@/lib/chat-image-tool-definition";
import {
  CHAT_SEARCH_ANTHROPIC_TOOL,
  CHAT_SEARCH_TOOL,
} from "@/lib/chat-search-tool";

export type ChatToolTransport =
  | "chat_completions_sse"
  | "responses_sse"
  | "anthropic_messages_sse";

/**
 * Upper bound of upstream requests in one turn: the first answer, two tool
 * rounds (for example a search and an image) and the final reply. The worker
 * drops all tools from the request that has no room for another one.
 */
export const CHAT_TOOL_MAX_REQUESTS = 4;

/**
 * Every application tool a Studio turn offers, in one fixed order.
 *
 * Turn admission (chat-turns.ts, for the reserve) and the worker build their
 * requests from this one list so the two can never drift apart. The list is
 * the same for every request of a turn — limits are enforced on the result,
 * not by withdrawing tools — so continuation requests keep the provider's
 * prompt cache, whose prefix starts with the tool definitions.
 */
export function chatRequestTools(
  transport: ChatToolTransport | string,
  options: { searchTool?: boolean } = {},
): unknown[] {
  if (transport === "anthropic_messages_sse")
    return [
      ...(options.searchTool ? [CHAT_SEARCH_ANTHROPIC_TOOL] : []),
      CHAT_IMAGE_ANTHROPIC_TOOL,
      READ_URL_ANTHROPIC_TOOL,
      CHECK_CREDITS_ANTHROPIC_TOOL,
      PLAN_PRESENTATION_ANTHROPIC_TOOL,
      ASK_USER_ANTHROPIC_TOOL,
      SUGGEST_REPLIES_ANTHROPIC_TOOL,
    ];
  if (transport === "responses_sse")
    return [
      CHAT_IMAGE_RESPONSES_TOOL,
      READ_URL_RESPONSES_TOOL,
      CHECK_CREDITS_RESPONSES_TOOL,
      PLAN_PRESENTATION_RESPONSES_TOOL,
      ASK_USER_RESPONSES_TOOL,
      SUGGEST_REPLIES_RESPONSES_TOOL,
    ];
  return [
    ...(options.searchTool ? [CHAT_SEARCH_TOOL] : []),
    CHAT_IMAGE_TOOL,
    READ_URL_TOOL,
    CHECK_CREDITS_TOOL,
    PLAN_PRESENTATION_TOOL,
    ASK_USER_TOOL,
    SUGGEST_REPLIES_TOOL,
  ];
}

/** Whether search runs as the application search_web tool on this transport. */
export function chatSearchAsTool(transport: string, webSearch?: boolean) {
  return transport === "anthropic_messages_sse" && Boolean(webSearch);
}
