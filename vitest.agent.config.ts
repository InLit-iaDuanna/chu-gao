import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
  test: {
    environment: "node",
    include: [
      "lib/agent-*.test.ts",
      "lib/generation-submission.test.ts",
      "lib/model-pricing.test.ts",
      "lib/creative-settlement.test.ts",
    ],
    maxWorkers: 1,
  },
});
