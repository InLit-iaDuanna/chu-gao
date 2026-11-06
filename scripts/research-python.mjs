#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const output = path.resolve(
  root,
  process.env.CHUGAO_REPLAY_OUTPUT ??
    "output/research-v2-integration/cross-language",
);
const args = process.argv
  .slice(2)
  .map((value) =>
    value === output || value.startsWith(output + path.sep)
      ? path.posix.join(
          "/replay-output",
          path.relative(output, value).split(path.sep).join("/"),
        )
      : value.startsWith(root + path.sep)
        ? "/workspace/" + path.relative(root, value).split(path.sep).join("/")
        : value,
  );
const child = spawnSync(
  "docker",
  [
    "run",
    "--rm",
    "--network",
    "none",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    "--tmpfs",
    "/tmp",
    "--env",
    "PYTHONDONTWRITEBYTECODE=1",
    "--mount",
    `type=bind,source=${root},target=/workspace,readonly`,
    "--mount",
    `type=bind,source=${output},target=/replay-output`,
    "--workdir",
    "/workspace",
    "--entrypoint",
    "python",
    "chugao-research-deerflow",
    ...args,
  ],
  { stdio: "inherit" },
);
if (child.error) throw child.error;
process.exitCode = child.status ?? 1;
