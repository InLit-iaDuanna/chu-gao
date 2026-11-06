import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { parseEnv } from "node:util";
import { spawn } from "node:child_process";

const env = {
  ...(existsSync(".env") ? parseEnv(readFileSync(".env", "utf8")) : {}),
  ...process.env,
};
const base = new URL(env.RESEARCH_TEST_DATABASE_URL ?? env.DATABASE_URL);
if (
  !["postgres:", "postgresql:"].includes(base.protocol) ||
  !["localhost", "127.0.0.1", "[::1]", "::1"].includes(base.hostname)
)
  throw Error("Research checks require local PostgreSQL");
const name = `chugao_research_it_${randomBytes(6).toString("hex")}`;
const maintenance = new URL(base);
maintenance.pathname = "/postgres";
const scratch = new URL(base);
scratch.pathname = `/${name}`;
const admin = new PrismaClient({
  datasources: { db: { url: maintenance.href } },
  log: [],
});
const run = (args) =>
  new Promise((resolve, reject) => {
    const child = spawn("pnpm", args, {
      stdio: "inherit",
      env: {
        ...env,
        DATABASE_URL: scratch.href,
        RESEARCH_INTEGRATION_TEST: "1",
        PRISMA_LOG_LEVEL: "silent",
      },
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(Error(`Check exited ${code}`)),
    );
  });
try {
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  await run(["exec", "prisma", "migrate", "deploy"]);
  await run(["exec", "vitest", "run", "--config", "vitest.research.config.ts"]);
} finally {
  await admin.$executeRawUnsafe(
    `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`,
  );
  await admin.$disconnect();
}
