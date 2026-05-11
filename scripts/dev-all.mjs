import { spawn } from "node:child_process";

const commands = [
  ["dev", ["pnpm", "dev"]],
  ["worker", ["pnpm", "worker"]],
];
const children = [];
let shuttingDown = false;

function stopAll(signal = "SIGTERM") {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  for (const child of children) {
    if (!child.killed) {
      child.kill(signal);
    }
  }
}

for (const [label, command] of commands) {
  const child = spawn(command[0], command.slice(1), {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });

  children.push(child);

  child.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }

    stopAll();
    process.exitCode = code ?? (signal ? 1 : 0);
    console.error(`${label} exited; stopped dev stack.`);
  });
}

process.on("SIGINT", () => stopAll("SIGINT"));
process.on("SIGTERM", () => stopAll("SIGTERM"));
