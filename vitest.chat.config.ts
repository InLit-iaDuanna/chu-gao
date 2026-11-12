import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
  test: {
    environment: "node",
    include: [
      "lib/chat-responses-stream.test.ts",
      "lib/chat-worker.test.ts",
      "lib/chat-recovery.test.ts",
      "lib/chat-runtime-*.test.ts",
      "lib/chat-turns.integration.test.ts",
      "lib/chat-ledger-audit.test.ts",
      "lib/chat-token-*.test.ts",
      "lib/chat-opus-*.test.ts",
      "components/studio/lib/chat-turn-api.test.ts",
    ],
    setupFiles: [],
  },
});
