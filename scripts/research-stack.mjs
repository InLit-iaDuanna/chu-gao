import { spawn } from "node:child_process";
import { mkdir, open, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const state = path.join(root, ".data", "research");
const compose = ["compose", "-f", "docker-compose.research.yml"];
const action = process.argv[2] || "status";
const env = {
  ...process.env,
  COMPOSE_PARALLEL_LIMIT: "1",
  HTTP_PROXY: "",
  HTTPS_PROXY: "",
  ALL_PROXY: "",
  NO_PROXY: "*",
};
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(Error(`${command} exited ${code}`)),
    );
  });
}
async function workerStatus() {
  try {
    const pid = Number(await readFile(path.join(state, "worker.pid"), "utf8"));
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}
async function startWorker() {
  if (await workerStatus()) return;
  await mkdir(state, { recursive: true });
  const log = await open(path.join(state, "worker.log"), "a", 0o600);
  const child = spawn(
    process.execPath,
    ["--env-file=.env", "--import", "tsx", "workers/research.worker.ts"],
    { cwd: root, env, detached: true, stdio: ["ignore", log.fd, log.fd] },
  );
  child.unref();
  await log.close();
  await writeFile(path.join(state, "worker.pid"), String(child.pid), {
    mode: 0o600,
  });
  console.log(`Research worker started: ${child.pid}`);
}
try {
  if (action === "up") {
    if (!process.argv.includes("--no-build"))
      for (const service of [
        "crawl4ai",
        "embedding",
        "gpt-researcher",
        "vane",
        "deerflow",
      ])
        await run("docker", [...compose, "build", service]);
    await run("docker", [...compose, "up", "-d", "--no-build"]);
    await startWorker();
    console.log("Research workspace: http://127.0.0.1:3000/app/research");
  } else if (action === "worker") await startWorker();
  else if (action === "dev") {
    await mkdir(state, { recursive: true });
    const log = await open(path.join(state, "dev.log"), "a", 0o600);
    const child = spawn(
      process.execPath,
      [
        "--env-file=.env",
        "node_modules/next/dist/bin/next",
        "dev",
        "--hostname",
        "0.0.0.0",
        "--port",
        "3000",
      ],
      { cwd: root, env, detached: true, stdio: ["ignore", log.fd, log.fd] },
    );
    child.unref();
    await log.close();
    await writeFile(path.join(state, "dev.pid"), String(child.pid), {
      mode: 0o600,
    });
    console.log(`Local dev server starting: ${child.pid}`);
  } else if (action === "stop") {
    const pid = await workerStatus();
    if (pid) process.kill(pid, "SIGTERM");
    await unlink(path.join(state, "worker.pid")).catch(() => {});
    await run("docker", [...compose, "stop"]);
  } else if (action === "status") {
    await run("docker", [...compose, "ps"]);
    console.log("Research worker:", (await workerStatus()) ?? "stopped");
  } else
    throw Error(
      "Usage: node scripts/research-stack.mjs up [--no-build] | worker | status | stop",
    );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
