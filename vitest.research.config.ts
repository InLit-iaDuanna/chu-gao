import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
  test: {
    environment: "node",
    include: ["lib/research/*.test.ts"],
    fileParallelism: false,
    testTimeout: 15000,
  },
});
