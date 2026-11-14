/**
 * Prints the exact system instructions and tool definition a Studio chat turn
 * sends, for review. Reads no database and no environment.
 *
 *   node --import tsx scripts/print-chat-instructions.ts [--web]
 */
import { DEFAULT_CONVERSATION_SYSTEM_PROMPT } from "../lib/ai-config";
import {
  CHAT_IMAGE_TOOL,
  chatImageToolOutput,
} from "../lib/chat-image-tool-definition";
import { chatTurnInstructions } from "../lib/chat-instructions";

const webSearch = process.argv.includes("--web");
const instructions = chatTurnInstructions(
  DEFAULT_CONVERSATION_SYSTEM_PROMPT,
  webSearch,
);

console.log(`===== instructions (webSearch=${webSearch}) =====`);
console.log(instructions);
console.log(`\n===== ${instructions.length} chars =====`);
console.log("\n===== tool =====");
console.log(JSON.stringify(CHAT_IMAGE_TOOL, null, 2));
console.log("\n===== receipts =====");
console.log(
  chatImageToolOutput({
    ok: true,
    generationId: "generation-example",
    status: "PENDING",
    estimatedCredits: 6,
    modelId: "gpt-image-2",
  }),
);
console.log(
  chatImageToolOutput({
    ok: false,
    code: "INSUFFICIENT_CREDITS",
    message: "图片生成点数不足",
  }),
);
