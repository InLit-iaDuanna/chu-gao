import { defineConfig, globalIgnores } from "eslint/config";
import { FlatCompat } from "@eslint/eslintrc";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const compat = new FlatCompat({
  baseDirectory: __dirname,
  // Resolve Next's plugins within its installed package under pnpm.
  resolvePluginsRelativeTo: dirname(
    require.resolve("eslint-config-next/package.json"),
  ),
});

const eslintConfig = defineConfig([
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "@next/next/no-img-element": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next.*/**",
    ".next-comfyart/**",
    ".next-comfyart-build/**",
    "out/**",
    "output/**",
    "build/**",
    "coverage/**",
    "kimitest/**",
    "downloads/ComfyArt/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
