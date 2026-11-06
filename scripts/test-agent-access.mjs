import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const config = { ...parseEnv(readFileSync(".env", "utf8")), ...process.env };
const url = new URL(config.DATABASE_URL);
if (!["127.0.0.1", "localhost"].includes(url.hostname))
  throw new Error("Only a local database is allowed.");
const name = `chugao_agent_it_${randomBytes(6).toString("hex")}`;
const container = "newproject2-postgres-1";
process.on("SIGINT", () => {
  process.exitCode = 130;
});
function run(args, options = {}) {
  const result = spawnSync(args[0], args.slice(1), {
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0)
    throw new Error(`${args[0]} failed: ${result.stderr ?? ""}`);
  return result.stdout;
}
try {
  run(["docker", "exec", container, "createdb", "-U", "app", name]);
  const schema = run([
    "docker",
    "exec",
    container,
    "pg_dump",
    "-U",
    "app",
    "--schema-only",
    "--no-owner",
    "app",
  ]);
  run(
    [
      "docker",
      "exec",
      "-i",
      container,
      "psql",
      "-q",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "app",
      "-d",
      name,
    ],
    { input: schema },
  );
  run(
    [
      "docker",
      "exec",
      "-i",
      container,
      "psql",
      "-q",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "app",
      "-d",
      name,
    ],
    {
      input:
        'DROP TABLE IF EXISTS "AgentDeviceAuthorization"; DROP TABLE IF EXISTS "AgentAuthorization" CASCADE; ALTER TABLE "Generation" DROP COLUMN IF EXISTS "agentAuthorizationId";',
    },
  );
  run(
    [
      "docker",
      "exec",
      "-i",
      container,
      "psql",
      "-q",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "app",
      "-d",
      name,
    ],
    {
      input: readFileSync(
        "prisma/migrations/20261020090000_agent_authorizations/migration.sql",
        "utf8",
      ),
    },
  );
  url.pathname = `/${name}`;
  const result = spawnSync(
    process.execPath,
    [
      "node_modules/vitest/vitest.mjs",
      "run",
      "--config",
      "vitest.agent.config.ts",
      "lib/agent-access.integration.test.ts",
    ],
    {
      stdio: "inherit",
      env: {
        ...config,
        DATABASE_URL: url.href,
        AGENT_TEST_DATABASE_URL: url.href,
      },
    },
  );
  process.exitCode = result.status ?? 1;
} finally {
  run(["docker", "exec", container, "dropdb", "--force", "-U", "app", name]);
}
