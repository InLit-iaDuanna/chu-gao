import { Prisma, PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import IORedis from "ioredis";
import { createCipheriv, randomBytes, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { createParser } from "eventsource-parser";
import { auditChatLedger } from "../lib/chat-ledger-audit";
import type { ChatTurnEvent, ChatTurnView } from "../lib/chat-turn-types";
import {
  AcceptanceError,
  MAX_UPSTREAM_REQUESTS,
  SOL_MODEL,
  FIXTURE_TEXT,
  FIXTURE_PARTIAL,
  FIXTURE_SOURCE,
  array,
  check,
  directLoopbackRequest,
  hash,
  object,
  startAcceptanceTransport,
  type AcceptanceTransport,
  type TransportCapture,
  type TransportPlan,
} from "./verify-chat-transport";

// Opt-in only. This file does not import the application's environment-bound db.
// Run after the final production build; do not point a running app at this script.
const HELP = `Usage: node --env-file=.env --import tsx scripts/verify-chat-runtime.ts --run [options]
  --real                       Forward to a real upstream (never the default)
  --key-stdin                  Read one credential line from non-TTY stdin
  --max-requests=N              Lower the shared hard cap of 24 provider requests
  --probes=efforts,vision,image-order,context-summary,vision-history
                               Optional, separately reported capability probes
  --keep-alive, --interactive   Keep app/worker/transport alive for browser checks
  --help                       No processes, databases or requests
Environment:
  CHAT_VERIFY_POSTGRES_URL      Local PG login; DATABASE_URL is a fallback login only
                               Maintenance always uses /postgres, never /appdb
  CHAT_VERIFY_REDIS_URL         Local Redis login; REDIS_URL fallback, DB forced to 15
  CHAT_VERIFY_UPSTREAM_BASE_URL Required with --real; /v1/responses is appended
  CHAT_VERIFY_UPSTREAM_KEY      Credential alternative to --key-stdin
No flags auto-enable Sol capabilities. No proxy, upstream retry or redirect is used.
SIGINT/SIGTERM clean up this run's database, processes, heartbeat and temp directory.
In interactive mode the HTML prompt always uses the mock, even with --real.
`;

interface CheckResult {
  name: string;
  status: "passed" | "failed";
  durationMs: number;
  code?: string;
  metrics?: Record<string, number | boolean | string | null>;
}
interface ManagedProcess {
  name: string;
  child: ChildProcess;
  closed: Promise<void>;
  exited: boolean;
  spawnFailed: boolean;
  logBytes: number;
}
interface ConversationView {
  id: string;
  messages: Array<{
    id: string;
    role: string;
    content: string;
    chatAttemptId?: string;
    chatTurnId?: string;
    chatStatus?: string;
    chatSources?: unknown;
    chatUsage?: unknown;
  }>;
}
type Envelope<T> = { ok: boolean; data: T; error?: { code: string } };
type ProbeName =
  | "efforts"
  | "vision"
  | "image-order"
  | "context-summary"
  | "vision-history";
type CaseFunction = () => Promise<Record<
  string,
  number | boolean | string | null
> | void>;
const repo = resolve(fileURLToPath(new URL("../", import.meta.url)));
const INITIAL_CREDITS = 100;
const PRICE = 0.2;
const HEARTBEAT_PREFIX = "chat:worker:heartbeat:";
const TERMINAL = new Set([
  "completed",
  "failed",
  "incomplete",
  "cancelled",
  "interrupted",
]);
const equal = (a: unknown, b: unknown, code: string) =>
  check(isDeepStrictEqual(a, b), code);
const amount = (value: unknown) =>
  new Prisma.Decimal(String(value)).toDecimalPlaces(6);

function parseOptions() {
  const flags = process.argv.slice(2);
  const probes = new Set<ProbeName>();
  let maxRequests = MAX_UPSTREAM_REQUESTS;
  for (const flag of flags) {
    if (flag.startsWith("--max-requests="))
      maxRequests = Number(flag.slice("--max-requests=".length));
    else if (flag.startsWith("--probes=")) {
      for (const value of flag.slice("--probes=".length).split(",")) {
        check(
          [
            "efforts",
            "vision",
            "image-order",
            "context-summary",
            "vision-history",
          ].includes(value),
          "UNKNOWN_PROBE",
        );
        probes.add(value as ProbeName);
      }
    } else
      check(
        [
          "--run",
          "--real",
          "--key-stdin",
          "--keep-alive",
          "--interactive",
          "--help",
        ].includes(flag),
        "UNKNOWN_OPTION",
      );
  }
  check(
    Number.isInteger(maxRequests) &&
      maxRequests > 0 &&
      maxRequests <= MAX_UPSTREAM_REQUESTS,
    "INVALID_REQUEST_BUDGET",
  );
  check(
    !flags.includes("--key-stdin") || flags.includes("--real"),
    "KEY_STDIN_REQUIRES_REAL_MODE",
  );
  return {
    run: flags.includes("--run"),
    real: flags.includes("--real"),
    keyStdin: flags.includes("--key-stdin"),
    help: flags.includes("--help"),
    maxRequests,
    probes,
    keepAlive:
      flags.includes("--keep-alive") || flags.includes("--interactive"),
  };
}

function localUrl(raw: string | undefined, protocols: string[], code: string) {
  check(raw, code);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AcceptanceError(code);
  }
  check(
    protocols.includes(url.protocol) &&
      ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname),
    code,
  );
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  // Discard host/schema/options/db query overrides before connecting anywhere.
  url.search = "";
  url.hash = "";
  return url;
}

function encrypted(plain: string, key: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  const bytes = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), bytes]
    .map((part) => part.toString("base64"))
    .join(".");
}

async function realCredential(stdin: boolean, signal: AbortSignal) {
  let key = process.env.CHAT_VERIFY_UPSTREAM_KEY?.trim() ?? "";
  delete process.env.CHAT_VERIFY_UPSTREAM_KEY;
  if (stdin) {
    check(!process.stdin.isTTY, "KEY_STDIN_MUST_BE_PIPED_WITHOUT_ECHO");
    key = await new Promise<string>((resolveKey, reject) => {
      let text = "";
      const timer = setTimeout(() => {
        cleanup();
        reject(new AcceptanceError("CREDENTIAL_STDIN_TIMEOUT"));
      }, 60_000);
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        process.stdin.off("data", onData);
        process.stdin.off("end", onEnd);
        process.stdin.off("error", onError);
        process.stdin.pause();
      };
      const finish = () => {
        cleanup();
        resolveKey(text.trim());
      };
      const onData = (chunk: Buffer) => {
        text += chunk.toString("utf8");
        if (text.length > 4096) {
          cleanup();
          reject(new AcceptanceError("CREDENTIAL_TOO_LONG"));
        } else if (text.includes("\n")) {
          text = text.split("\n")[0];
          finish();
        }
      };
      const onEnd = () => finish();
      const onError = () => {
        cleanup();
        reject(new AcceptanceError("CREDENTIAL_STDIN_FAILED"));
      };
      const onAbort = () => {
        cleanup();
        reject(new AcceptanceError("INTERRUPTED"));
      };
      process.stdin
        .on("data", onData)
        .once("end", onEnd)
        .once("error", onError);
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
  }
  check(
    key.length > 0 && key.length <= 4096 && !/[\r\n]/.test(key),
    "REAL_CREDENTIAL_REQUIRED",
  );
  const raw = process.env.CHAT_VERIFY_UPSTREAM_BASE_URL;
  check(raw, "REAL_BASE_URL_REQUIRED");
  let endpoint: URL;
  try {
    endpoint = new URL(raw);
  } catch {
    throw new AcceptanceError("INVALID_REAL_BASE_URL");
  }
  check(
    endpoint.protocol === "https:" &&
      !endpoint.username &&
      !endpoint.password &&
      !endpoint.search &&
      !endpoint.hash,
    "REAL_BASE_URL_MUST_BE_HTTPS_WITHOUT_CREDENTIALS_OR_QUERY",
  );
  endpoint.pathname =
    endpoint.pathname.replace(/\/+$/, "").replace(/\/v1(?:\/responses)?$/, "") +
    "/v1/responses";
  return { key, endpoint };
}

async function freeAppPort() {
  for (let port = 3004; port < 3104; port++) {
    const socket = createServer();
    const bound = await new Promise<boolean>((resolveBound) => {
      socket.once("error", () => resolveBound(false));
      socket.listen(port, "127.0.0.1", () => resolveBound(true));
    });
    if (bound) {
      await new Promise<void>((resolveClosed) =>
        socket.close(() => resolveClosed()),
      );
      return port;
    }
  }
  throw new AcceptanceError("NO_FREE_APP_PORT_3004_TO_3103");
}

function scratchEnvironment(
  database: URL,
  redis: URL,
  dir: string,
  port: number,
  buildId: string,
) {
  const env: NodeJS.ProcessEnv = { NODE_ENV: "production" };
  for (const key of [
    "PATH",
    "HOME",
    "LANG",
    "LC_ALL",
    "SystemRoot",
    "USERPROFILE",
  ])
    if (process.env[key]) env[key] = process.env[key];
  return Object.assign(env, {
    NODE_ENV: "production",
    DATABASE_URL: database.href,
    DIRECT_URL: database.href,
    SHADOW_DATABASE_URL: database.href,
    REDIS_URL: redis.href,
    ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    SESSION_SECRET: randomBytes(48).toString("base64url"),
    NEXTAUTH_SECRET: randomBytes(48).toString("base64url"),
    AUTH_CANONICAL_HOST: "127.0.0.1",
    SESSION_COOKIE_DOMAIN: "127.0.0.1",
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
    ADMIN_IP_ALLOWLIST: "",
    DEV_AUTH_BYPASS: "0",
    DEV_AUTH_DB_BYPASS: "0",
    DEV_AUTH_ENABLED: "0",
    PRIVATE_STORAGE_DIR: resolve(dir, "private"),
    TMPDIR: dir,
    LOG_LEVEL: "silent",
    PRISMA_LOG_LEVEL: "silent",
    NEXT_TELEMETRY_DISABLED: "1",
    CHAT_WORKER_CONCURRENCY: "2",
    CHAT_WORKER_BUILD_ID: buildId,
    RATE_LIMIT_LOGIN_PER_MIN: "10",
    NODE_USE_ENV_PROXY: "0",
    HTTP_PROXY: "",
    HTTPS_PROXY: "",
    ALL_PROXY: "",
    http_proxy: "",
    https_proxy: "",
    all_proxy: "",
    NO_PROXY: "*",
    // A standalone Next build may contain .env. Empty overrides prevent any
    // inherited provider defaults from supplying an alternate paid execution path.
    CONVERSATION_API_KEY: "",
    DEEPSEEK_API_KEY: "",
    OPENAI_API_KEY: "",
    CONVERSATION_BASE_URL: "http://127.0.0.1:1",
    DEEPSEEK_BASE_URL: "http://127.0.0.1:1",
    CHAT_VERIFY_UPSTREAM_KEY: "",
    CHAT_VERIFY_UPSTREAM_BASE_URL: "",
  });
}

function managedProcess(
  name: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): ManagedProcess {
  const child = spawn(process.execPath, args, {
    cwd: repo,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const row: ManagedProcess = {
    name,
    child,
    closed: Promise.resolve(),
    exited: false,
    spawnFailed: false,
    logBytes: 0,
  };
  // Drain without storing or printing arbitrary framework/provider output.
  child.stdout?.on("data", (bytes: Buffer) => {
    row.logBytes += bytes.length;
  });
  child.stderr?.on("data", (bytes: Buffer) => {
    row.logBytes += bytes.length;
  });
  row.closed = new Promise((resolveClosed) => {
    child.once("error", () => {
      row.spawnFailed = true;
      row.exited = true;
      resolveClosed();
    });
    child.once("close", () => {
      row.exited = true;
      resolveClosed();
    });
  });
  return row;
}

async function stopProcess(row: ManagedProcess) {
  if (row.exited) return;
  const kill = (signal: NodeJS.Signals) => {
    try {
      if (row.child.pid) process.kill(-row.child.pid, signal);
    } catch {
      row.child.kill(signal);
    }
  };
  const wait = async (ms: number) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        row.closed,
        new Promise<void>((done) => {
          timer = setTimeout(done, ms);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  kill("SIGTERM");
  await wait(21_000);
  if (!row.exited) {
    kill("SIGKILL");
    await wait(5_000);
  }
  check(row.exited, "OWNED_PROCESS_DID_NOT_EXIT");
}

async function main() {
  const startedAt = new Date().toISOString();
  let options: ReturnType<typeof parseOptions>;
  try {
    options = parseOptions();
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        type: "chat-runtime-acceptance",
        status: "failed",
        code: error instanceof AcceptanceError ? error.code : "INVALID_OPTIONS",
      }) + "\n",
    );
    process.exitCode = 1;
    return;
  }
  if (options.help || !options.run) {
    process.stdout.write(HELP);
    return;
  }
  const runId = `${Date.now().toString(36)}_${randomBytes(6).toString("hex")}`;
  const databaseName = `chat_accept_${runId}`;
  const buildTag = `acceptance-${runId}`;
  const interactivePrompt = `CHAT_VERIFY_HTML_${runId}`;
  const processes: ManagedProcess[] = [];
  const checks: CheckResult[] = [];
  const probes: CheckResult[] = [];
  const abort = new AbortController();
  let interrupted: NodeJS.Signals | null = null;
  let holding = false;
  let wake: (() => void) | undefined;
  let db: PrismaClient | undefined;
  let maintenance: PrismaClient | undefined;
  let redis: IORedis | undefined;
  let transport: AcceptanceTransport | undefined;
  let dir: string | undefined;
  let created = false;
  let phase = "preflight";
  let port: number | null = null;
  let buildHash: string | null = null;
  const cleanup: Record<string, boolean | number | string> = {};
  const signal = (name: NodeJS.Signals) => {
    interrupted = name;
    abort.abort();
    wake?.();
  };
  const onInt = () => signal("SIGINT");
  const onTerm = () => signal("SIGTERM");
  process.on("SIGINT", onInt);
  process.on("SIGTERM", onTerm);
  const pause = async (ms: number) => {
    abort.signal.throwIfAborted();
    await new Promise<void>((done, reject) => {
      const timer = setTimeout(finish, ms);
      const onAbort = () => {
        clearTimeout(timer);
        abort.signal.removeEventListener("abort", onAbort);
        reject(new AcceptanceError("INTERRUPTED"));
      };
      function finish() {
        abort.signal.removeEventListener("abort", onAbort);
        done();
      }
      abort.signal.addEventListener("abort", onAbort, { once: true });
    });
  };
  const runCase = async (
    name: string,
    action: CaseFunction,
    target = checks,
  ) => {
    const start = Date.now();
    try {
      abort.signal.throwIfAborted();
      const metrics = await action();
      target.push({
        name,
        status: "passed",
        durationMs: Date.now() - start,
        ...(metrics ? { metrics } : {}),
      });
    } catch (error) {
      target.push({
        name,
        status: "failed",
        durationMs: Date.now() - start,
        code: interrupted
          ? "INTERRUPTED"
          : error instanceof AcceptanceError
            ? error.code
            : "UNEXPECTED_RUNTIME_ERROR",
      });
      if (interrupted) throw new AcceptanceError("INTERRUPTED");
    } finally {
      transport?.releaseAll();
    }
  };
  const report = (status: string) => ({
    type: "chat-runtime-acceptance",
    schemaVersion: 1,
    status,
    mode: options.real ? "real" : "mock",
    startedAt,
    pid: process.pid,
    port,
    buildHash,
    checks,
    probes,
    capabilityFlagsChanged: false,
    upstream: transport?.stats() ?? null,
    wire: transport?.captures.map((row) => ({
      label: row.label,
      kind: row.kind,
      httpStatus: row.httpStatus,
      responseStatus: row.responseStatus,
      contractErrors: row.contractErrors,
      textCharacters: row.finalRawText?.length ?? row.rawText.length,
      searched: row.searched,
      citations: row.annotations.length,
      usageReported: row.usage !== null,
      faultInjected: row.injected,
      finished: row.done,
      protocolError: row.protocolError,
    })),
    cleanup,
    limitations: [
      "Synthetic identities and scratch data only; no production acceptance claim.",
      "Real search/citation behavior depends on the provider; no search result is fabricated in real mode.",
      "Failure scenarios deliberately inject faults after a real delta in real mode.",
      "Direct capability probes do not bypass or change the application's capability gates.",
      "Redis rate-limit keys expire naturally; only this worker's heartbeat may be removed.",
      "SIGKILL or host failure cannot run finally; SIGINT/SIGTERM are handled.",
    ],
  });

  try {
    const real = options.real
      ? await realCredential(options.keyStdin, abort.signal)
      : undefined;
    const postgres = localUrl(
      process.env.CHAT_VERIFY_POSTGRES_URL ?? process.env.DATABASE_URL,
      ["postgres:", "postgresql:"],
      "POSTGRES_MUST_BE_LOCAL",
    );
    postgres.pathname = "/postgres";
    const scratch = new URL(postgres);
    scratch.pathname = `/${databaseName}`;
    scratch.searchParams.set("connection_limit", "5");
    scratch.searchParams.set("connect_timeout", "5");
    const redisUrl = localUrl(
      process.env.CHAT_VERIFY_REDIS_URL ??
        process.env.REDIS_URL ??
        "redis://127.0.0.1:6379",
      ["redis:", "rediss:"],
      "REDIS_MUST_BE_LOCAL",
    );
    redisUrl.pathname = "/15";
    const serverPath = resolve(repo, ".next/standalone/server.js");
    await access(serverPath).catch(() => {
      throw new AcceptanceError("FINAL_STANDALONE_BUILD_REQUIRED");
    });
    buildHash = hash(
      await readFile(resolve(repo, ".next/standalone/.next/BUILD_ID"), "utf8"),
    );
    check(
      /^chat_accept_[a-z0-9_]+$/.test(databaseName),
      "INVALID_SCRATCH_NAME",
    );
    dir = await mkdtemp(resolve(tmpdir(), "chat-runtime-acceptance-"));
    port = await freeAppPort();
    const env = scratchEnvironment(scratch, redisUrl, dir, port, buildTag);
    redis = new IORedis(redisUrl.href, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      commandTimeout: 2000,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    });
    redis.on("error", () => undefined);
    await redis.connect();
    await redis.ping();
    maintenance = new PrismaClient({
      datasources: { db: { url: postgres.href } },
      log: [],
    });
    phase = "create-scratch-database";
    await maintenance.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
    created = true;
    phase = "migrations";
    const migration = managedProcess(
      "migrations",
      [
        resolve(repo, "node_modules/prisma/build/index.js"),
        "migrate",
        "deploy",
        "--schema",
        resolve(repo, "prisma/schema.prisma"),
      ],
      env,
    );
    processes.push(migration);
    let migrationTimer: ReturnType<typeof setTimeout> | undefined;
    let migrationAbort: (() => void) | undefined;
    try {
      await Promise.race([
        migration.closed,
        new Promise<never>((_, reject) => {
          migrationTimer = setTimeout(
            () => reject(new AcceptanceError("MIGRATION_TIMEOUT")),
            120_000,
          );
          migrationAbort = () => reject(new AcceptanceError("INTERRUPTED"));
          abort.signal.addEventListener("abort", migrationAbort, {
            once: true,
          });
          if (abort.signal.aborted) migrationAbort();
        }),
      ]);
    } finally {
      clearTimeout(migrationTimer);
      if (migrationAbort)
        abort.signal.removeEventListener("abort", migrationAbort);
    }
    check(
      !migration.spawnFailed && migration.child.exitCode === 0,
      "MIGRATE_DEPLOY_FAILED",
    );
    db = new PrismaClient({
      datasources: { db: { url: scratch.href } },
      log: [],
    });
    const database = db;
    const actualDb = await database.$queryRaw<
      Array<{ name: string }>
    >`SELECT current_database() AS name`;
    equal(actualDb[0].name, databaseName, "SCRATCH_DATABASE_IDENTITY");
    const migrations = await database.$queryRaw<
      Array<{ migration_name: string }>
    >`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    const requiredMigrations = (
      await readdir(resolve(repo, "prisma/migrations"), { withFileTypes: true })
    )
      .filter((row) => row.isDirectory())
      .map((row) => row.name);
    equal(
      migrations.map((row) => row.migration_name).sort(),
      requiredMigrations.sort(),
      "ALL_MIGRATIONS_APPLIED",
    );
    await database.contextSnapshot.count();
    checks.push({
      name: "scratch-migrations",
      status: "passed",
      durationMs: 0,
      metrics: { migrations: migrations.length, contextSnapshotsTable: true },
    });

    phase = "seed-synthetic-identities";
    const password = randomBytes(24).toString("base64url");
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await database.user.create({
      data: {
        email: `user-${runId}@example.invalid`,
        passwordHash,
        name: "Synthetic acceptance user",
        credits: INITIAL_CREDITS,
        concurrentLimit: 16,
      },
    });
    const admin = await database.user.create({
      data: {
        email: `admin-${runId}@example.invalid`,
        passwordHash,
        name: "Synthetic acceptance admin",
        role: "ADMIN",
        credits: INITIAL_CREDITS,
      },
    });
    transport = await startAcceptanceTransport({
      real,
      maxRequests: options.maxRequests,
      interactivePrompt,
    });
    const relay = transport;
    const solCipher = encrypted(relay.token, env.ENCRYPTION_KEY!);
    await database.systemConfig.createMany({
      data: [
        { key: "conversation.sol.enabled", value: true },
        { key: "conversation.sol.baseUrl", value: relay.baseUrl },
        { key: "conversation.sol.apiKeyEnc", value: solCipher },
        { key: "conversation.sol.credits", value: PRICE },
        { key: "conversation.enabled", value: false },
        { key: "conversation.luna.enabled", value: false },
        { key: "deepseek.enabled", value: false },
        {
          key: "conversation.systemPrompt",
          value:
            "Synthetic acceptance. Follow the user's short answer format. Never add unrelated content.",
        },
        {
          key: "chat.runtime",
          value: {
            enabled: true,
            profiles: [SOL_MODEL],
            userAllowlist: [user.id],
            queueTimeoutMs: null,
          },
        },
      ],
    });
    check(solCipher !== relay.token, "SOL_KEY_MUST_BE_ENCRYPTED");
    equal(
      await database.systemConfig.count({
        where: {
          key: {
            in: ["conversation.luna.apiKeyEnc", "conversation.apiKeyEnc"],
          },
        },
      }),
      0,
      "NO_COPIED_PROVIDER_KEYS",
    );

    phase = "start-app-worker";
    const app = managedProcess("app", [serverPath], env);
    processes.push(app);
    const baseUrl = `http://127.0.0.1:${port}`;
    const cookies = { user: "", admin: "" };
    type Actor = keyof typeof cookies | "anonymous";
    const rateWindows = new Map<string, number[]>();
    const pace = async (path: string, method: string) => {
      const scope =
        method === "POST" && path === "/api/chat/turns"
          ? "create"
          : method === "POST" && path.endsWith("/retry")
            ? "retry"
            : null;
      if (!scope) return;
      const cap = scope === "create" ? 18 : 8;
      const times = (rateWindows.get(scope) ?? []).filter(
        (time) => Date.now() - time < 61_000,
      );
      if (times.length >= cap) await pause(61_010 - (Date.now() - times[0]));
      rateWindows.set(scope, [
        ...times.filter((time) => Date.now() - time < 61_000),
        Date.now(),
      ]);
    };
    const request = async (
      path: string,
      init: RequestInit = {},
      actor: Actor = "user",
      timeout = 210_000,
    ) => {
      await pace(path, init.method ?? "GET");
      const headers = new Headers(init.headers);
      headers.set("Origin", baseUrl);
      headers.set("User-Agent", "SyntheticChatAcceptance/1.0");
      if (actor !== "anonymous" && cookies[actor])
        headers.set("Cookie", cookies[actor]);
      if (init.body) headers.set("Content-Type", "application/json");
      return directLoopbackRequest(baseUrl + path, {
        ...init,
        headers,
        redirect: "manual",
        signal: AbortSignal.any([
          abort.signal,
          AbortSignal.timeout(timeout),
          ...(init.signal ? [init.signal] : []),
        ]),
      });
    };
    const api = async <T>(
      path: string,
      init: RequestInit = {},
      actor: Actor = "user",
      status = 200,
      code?: string,
    ): Promise<T> => {
      const response = await request(path, init, actor);
      check(
        response.status === status,
        `HTTP_STATUS_${status}_EXPECTED_GOT_${response.status}`,
      );
      let envelope: Envelope<T>;
      try {
        envelope = (await response.json()) as Envelope<T>;
      } catch {
        throw new AcceptanceError("API_MUST_RETURN_JSON");
      }
      check(envelope.ok === status < 400, "API_ENVELOPE_STATUS");
      if (code) equal(envelope.error?.code, code, "API_ERROR_CODE");
      return envelope.data;
    };
    const post = (body: unknown): RequestInit => ({
      method: "POST",
      body: JSON.stringify(body),
    });
    const until = async <T>(
      probe: () => Promise<T | null | false>,
      code: string,
      ms = 120_000,
    ): Promise<T> => {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        check(!app.exited && !app.spawnFailed, "APP_PROCESS_EXITED");
        const value = await probe();
        if (value !== null && value !== false) return value;
        await pause(100);
      }
      throw new AcceptanceError(code);
    };
    await until(async () => {
      try {
        const response = await request(
          "/api/health/chat",
          {},
          "anonymous",
          2000,
        );
        await response.body?.cancel();
        return [200, 503].includes(response.status);
      } catch {
        return false;
      }
    }, "APP_START_TIMEOUT");
    const worker = managedProcess(
      "worker",
      ["--import", "tsx", resolve(repo, "workers/chat.worker.ts")],
      env,
    );
    processes.push(worker);
    const heartbeatRows = async () => {
      const rows: Array<{
        key: string;
        raw: string;
        value: Record<string, unknown>;
      }> = [];
      let cursor = "0";
      do {
        const page = await redis!.scan(
          cursor,
          "MATCH",
          HEARTBEAT_PREFIX + "*",
          "COUNT",
          100,
        );
        cursor = page[0];
        for (const key of page[1]) {
          const raw = await redis!.get(key);
          if (raw) {
            try {
              rows.push({ key, raw, value: object(JSON.parse(raw)) });
            } catch {
              /* Foreign malformed heartbeat. */
            }
          }
        }
        check(rows.length < 10_000, "REDIS_HEARTBEAT_SCAN_LIMIT");
      } while (cursor !== "0");
      return rows;
    };
    await until(async () => {
      check(!worker.exited && !worker.spawnFailed, "WORKER_PROCESS_EXITED");
      return (await heartbeatRows()).some(
        (row) =>
          row.value.buildId === buildTag &&
          row.value.pid === worker.child.pid &&
          row.value.status === "accepting" &&
          array(row.value.protocolVersions).includes(2),
      );
    }, "OWN_WORKER_HEARTBEAT_TIMEOUT");

    phase = "http-acceptance";
    await runCase("real-login-and-device-sessions", async () => {
      for (const [actor, identity] of [
        ["user", user],
        ["admin", admin],
      ] as const) {
        const response = await request(
          "/api/auth/login",
          post({ email: identity.email, password }),
          "anonymous",
        );
        equal(response.status, 200, "SYNTHETIC_LOGIN_STATUS");
        const data = (await response.json()) as Envelope<{ id: string }>;
        equal(data.data.id, identity.id, "LOGIN_IDENTITY");
        const jar = new Map<string, string>();
        for (const header of response.headers.getSetCookie()) {
          const pair = header.split(";")[0];
          const split = pair.indexOf("=");
          if (split > 0 && pair.slice(split + 1))
            jar.set(pair.slice(0, split), pair.slice(split + 1));
        }
        check(
          jar.has("chugao_session") && jar.has("chugao_device_id"),
          "LOGIN_MUST_SET_BOTH_COOKIES",
        );
        cookies[actor] = [...jar]
          .map(([name, value]) => `${name}=${value}`)
          .join("; ");
        const slot = await database.deviceSession.findFirstOrThrow({
          where: { userId: identity.id },
        });
        equal(
          slot.deviceId,
          jar.get("chugao_device_id"),
          "PERSISTENT_DEVICE_BINDING",
        );
        const me = await api<{ id: string }>("/api/me", {}, actor);
        equal(me.id, identity.id, "AUTHENTICATED_ME");
      }
      await api(
        "/api/chat/turns?conversationId=synthetic-absent",
        {},
        "anonymous",
        401,
        "UNAUTHORIZED",
      );
      await api("/api/admin/chat-runtime", {}, "user", 401, "UNAUTHORIZED");
      return { sessions: await database.deviceSession.count() };
    });
    check(cookies.user && cookies.admin, "LOGIN_PREREQUISITE_FAILED");

    const conversation = async (name: string) =>
      api<ConversationView>(
        "/api/conversations",
        post({ title: `Synthetic ${name}` }),
      );
    const input = (
      conversationId: string,
      name: string,
      extra: Record<string, unknown> = {},
    ) => ({
      conversationId,
      clientRequestId: randomUUID(),
      modelId: SOL_MODEL,
      reasoningEffort: "low",
      webSearch: false,
      referenceImageKeys: [],
      sourceImageIds: [],
      content: `CHAT_VERIFY_${runId}_${name}\nReply with exactly: Synthetic answer 731. No extra commentary.`,
      ...extra,
    });
    const submit = async (
      body: ReturnType<typeof input>,
      plan: TransportPlan,
    ) => {
      relay.schedule(body.content.split("\n")[0], plan);
      return api<ChatTurnView>("/api/chat/turns", post(body));
    };
    const terminal = (id: string) =>
      until(
        async () => {
          const view = await api<ChatTurnView>(`/api/chat/turns/${id}`);
          return TERMINAL.has(view.status) ? view : null;
        },
        "TURN_TERMINAL_TIMEOUT",
        options.real ? 210_000 : 30_000,
      );
    const capture = (label: string) => {
      const matches = relay.captures.filter((row) => row.label === label);
      equal(matches.length, 1, "EXACTLY_ONE_UPSTREAM_REQUEST");
      return matches[0];
    };
    const assertWire = (row: TransportCapture, marker?: string) => {
      equal(row.contractErrors, [], "UPSTREAM_WIRE_CONTRACT");
      if (marker) {
        const current = array(row.body.input)
          .filter((value) => object(value).role === "user")
          .flatMap((value) =>
            array(object(value).content).filter(
              (part) =>
                typeof object(part).text === "string" &&
                String(object(part).text).includes(marker),
            ),
          );
        equal(current.length, 1, "CURRENT_USER_MUST_APPEAR_EXACTLY_ONCE");
      }
    };

    const streamEvents = async (
      id: string,
      after = 0,
      disconnectOnText = false,
      headerCursor = false,
    ) => {
      const controller = new AbortController();
      const path =
        `/api/chat/turns/${id}/events` +
        (headerCursor ? "" : `?after=${after}`);
      const response = await request(path, {
        headers: headerCursor ? { "Last-Event-ID": `${id}:${after}` } : {},
        signal: controller.signal,
      });
      equal(response.status, 200, "EVENT_STREAM_STATUS");
      check(
        response.headers.get("content-type")?.includes("text/event-stream") &&
          response.body,
        "EVENT_STREAM_CONTENT_TYPE",
      );
      check(
        response.headers.get("cache-control")?.includes("no-store"),
        "PRIVATE_EVENT_CACHE",
      );
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const events: ChatTurnEvent[] = [];
      let seq = after;
      const parser = createParser({
        onEvent(frame) {
          equal(frame.event, "turn", "EVENT_TYPE");
          const value = JSON.parse(frame.data) as ChatTurnEvent;
          equal(value.v, 1, "EVENT_VERSION");
          equal(value.turnId, id, "EVENT_TURN");
          equal(value.seq, seq + 1, "CONTIGUOUS_EVENT_CURSOR");
          equal(frame.id, `${id}:${value.seq}`, "EVENT_ID");
          seq = value.seq;
          events.push(value);
        },
      });
      try {
        while (true) {
          const part = await reader.read();
          parser.feed(decoder.decode(part.value, { stream: !part.done }));
          if (
            disconnectOnText &&
            events.some(
              (row) =>
                row.type === "text.delta" || row.type === "text.snapshot",
            )
          )
            break;
          if (part.done) {
            parser.feed("\n\n");
            break;
          }
        }
      } finally {
        controller.abort();
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      return events;
    };

    const assertEvents = async (
      view: ChatTurnView,
      supplied?: ChatTurnEvent[],
    ) => {
      const events = supplied ?? (await streamEvents(view.id));
      const persisted = await database.chatEvent.findMany({
        where: { turnId: view.id },
        orderBy: { seq: "asc" },
      });
      equal(
        events,
        persisted.map((row) => ({
          v: 1,
          turnId: row.turnId,
          attemptId: row.attemptId,
          seq: row.seq,
          type: row.type,
          payload: row.payload,
        })),
        "SSE_DATABASE_EVENT_PARITY",
      );
      equal(events.at(-1)?.seq, view.lastSeq, "LAST_SEQUENCE_PARITY");
      let text = "";
      for (const row of events) {
        if (row.type === "attempt.started") text = "";
        if (row.type === "text.snapshot") text = String(row.payload.text);
        if (row.type === "text.delta") {
          equal(row.payload.offset, text.length, "UTF16_DELTA_OFFSET");
          equal(row.payload.offsetEncoding, "utf16", "DELTA_OFFSET_ENCODING");
          text += String(row.payload.text);
        }
        if (row.type === "attempt.terminal") {
          equal(text, row.payload.text, "DELTA_TERMINAL_TEXT_PARITY");
          equal(
            row.payload.status,
            (
              await database.chatAttempt.findUniqueOrThrow({
                where: { id: row.attemptId },
              })
            ).status,
            "TERMINAL_ATTEMPT_PARITY",
          );
        }
      }
      equal(text, view.text, "REPLAY_FINAL_TEXT_PARITY");
      const last = events.at(-1)!;
      equal(last.type, "attempt.terminal", "LAST_EVENT_TERMINAL");
      equal(
        object(last.payload.billing).state,
        view.billingState,
        "TERMINAL_BILLING_PARITY",
      );
      equal(last.payload.sources, view.sources, "TERMINAL_SOURCES_PARITY");
      equal(last.payload.usage, view.usage, "TERMINAL_USAGE_PARITY");
      const empty = await streamEvents(view.id, view.lastSeq, false, true);
      equal(empty.length, 0, "EXHAUSTED_CURSOR_MUST_NOT_REPLAY");
      return events;
    };

    const assertBalance = async () => {
      const entries = await database.creditEntry.findMany({
        where: { userId: user.id },
      });
      const expected = entries.reduce(
        (sum, row) => sum.plus(row.availableDelta),
        amount(INITIAL_CREDITS),
      );
      const me = await api<{ credits: number }>("/api/me");
      const account = await database.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      check(
        expected.eq(amount(account.credits)) && expected.eq(amount(me.credits)),
        "LEDGER_DB_API_BALANCE_PARITY",
      );
    };

    const assertTurn = async (
      view: ChatTurnView,
      label: string,
      expectedStatus: string,
      marker: string,
    ) => {
      equal(view.status, expectedStatus, "TURN_STATUS");
      const row = await database.chatTurn.findUniqueOrThrow({
        where: { id: view.id },
        include: { attempts: { orderBy: { ordinal: "asc" } } },
      });
      const attempt = row.attempts.at(-1)!;
      const source = capture(label);
      assertWire(source, marker);
      equal(attempt.id, view.attemptId, "LATEST_ATTEMPT_ID");
      equal(row.status, view.status, "TURN_DATABASE_STATUS");
      equal(attempt.status, view.status, "ATTEMPT_DATABASE_STATUS");
      equal(attempt.rawText, view.text, "RAW_TEXT_API_PARITY");
      equal(attempt.sources ?? [], view.sources, "SOURCES_API_PARITY");
      equal(attempt.usage, view.usage, "USAGE_API_PARITY");
      equal(row.activeConversationId, null, "TERMINAL_RELEASES_CONVERSATION");
      const saved = await database.conversationMessage.findMany({
        where: { chatAttemptId: view.attemptId },
      });
      equal(saved.length, 1, "ONE_ASSISTANT_PER_ATTEMPT");
      equal(saved[0].content, view.text, "SAVED_ASSISTANT_TEXT");
      equal(saved[0].chatStatus, view.status, "SAVED_ASSISTANT_STATUS");
      equal(saved[0].chatUsage, view.usage, "SAVED_ASSISTANT_USAGE");
      equal(
        saved[0].chatSources ?? [],
        view.sources,
        "SAVED_ASSISTANT_SOURCES",
      );
      const history = await api<ConversationView>(
        `/api/conversations/${view.conversationId}`,
      );
      const apiMessage = history.messages.find(
        (message) => message.chatAttemptId === view.attemptId,
      );
      check(apiMessage, "ASSISTANT_IN_HISTORY_API");
      equal(apiMessage.content, view.text, "HISTORY_TEXT_API_PARITY");
      equal(apiMessage.chatStatus, view.status, "HISTORY_STATUS_PARITY");
      equal(apiMessage.chatSources, view.sources, "HISTORY_SOURCES_PARITY");
      equal(apiMessage.chatUsage, view.usage, "HISTORY_USAGE_PARITY");
      const entries = await database.creditEntry.findMany({
        where: { attemptId: view.attemptId },
      });
      equal(entries.length, 2, "ONE_RESERVE_ONE_CLOSE");
      equal(
        entries.filter(
          (entry) => entry.operationKey === `reserve:${view.attemptId}`,
        ).length,
        1,
        "RESERVE_IDEMPOTENCY",
      );
      const close = entries.find(
        (entry) => entry.operationKey === `close:${view.attemptId}`,
      )!;
      check(close, "CLOSE_IDEMPOTENCY");
      const completed = view.status === "completed";
      equal(
        close.kind,
        completed ? "chat.settle" : "chat.release",
        "CREDIT_ENTRY_KIND",
      );
      equal(
        view.billingState,
        completed ? "charged" : "released",
        "BILLING_STATE",
      );
      check(
        amount(close.consumedDelta).eq(completed ? PRICE : 0),
        "CONSUMED_AMOUNT",
      );
      equal(view.chargedCredits, completed ? PRICE : 0, "CHARGED_AMOUNT");
      const usage = await database.usageLog.findUnique({
        where: { id: `chat_settle_${view.id}` },
      });
      equal(Boolean(usage), completed, "USAGE_ONLY_ON_SUCCESS");
      if (usage) {
        equal(usage.creditsDelta, -PRICE, "USAGE_DELTA");
        equal(
          object(usage.metadata).attemptId,
          view.attemptId,
          "USAGE_ATTEMPT",
        );
      }
      if (source.kind !== "non-sse") {
        equal(
          attempt.requestHash,
          source.requestHash,
          "ACTUAL_WIRE_REQUEST_HASH",
        );
        const manifest = object(attempt.contextManifest);
        equal(
          manifest.requestHash,
          source.requestHash,
          "MANIFEST_BINDS_ACTUAL_WIRE_REQUEST",
        );
        equal(
          manifest.snapshotId ?? null,
          attempt.contextSnapshotId,
          "MANIFEST_SNAPSHOT_ID",
        );
        const userMessage = await database.conversationMessage.findFirstOrThrow(
          { where: { chatTurnId: view.id, role: "USER" } },
        );
        equal(
          manifest.currentMessageId,
          userMessage.id,
          "CURRENT_MESSAGE_IDENTITY",
        );
      }
      if (!view.sources.length && source.finalRawText !== null && completed)
        equal(view.text, source.finalRawText, "PROVIDER_FINAL_RAW_PARITY");
      if (!completed && source.kind !== "non-sse")
        equal(view.text, source.rawText, "PROVIDER_PARTIAL_RETAINED");
      await assertEvents(view);
      await assertBalance();
      return {
        characters: view.text.length,
        events: view.lastSeq,
        attempts: row.attempts.length,
        charged: completed,
      };
    };

    let plain: ChatTurnView | undefined;
    let plainBody: ReturnType<typeof input> | undefined;
    await runCase("catalog-and-legacy-426", async () => {
      const catalog = await api<{ models: Array<Record<string, unknown>> }>(
        "/api/conversations/chat",
      );
      equal(catalog.models.length, 1, "ONLY_INDEPENDENT_SOL_ENABLED");
      equal(catalog.models[0].id, SOL_MODEL, "SOL_CATALOG");
      equal(
        catalog.models[0].reasoningEfforts,
        ["low", "medium", "high", "xhigh", "max"],
        "VERIFIED_EFFORT_CATALOG",
      );
      equal(catalog.models[0].supportsVision, true, "VERIFIED_VISION_CATALOG");
      const before = relay.stats().calls;
      await api(
        "/api/conversations/chat",
        post({ content: "Synthetic legacy request", modelId: SOL_MODEL }),
        "user",
        426,
        "CLIENT_UPGRADE_REQUIRED",
      );
      const conv = await conversation("legacy");
      await api(
        `/api/conversations/${conv.id}/messages`,
        post({
          messages: [
            { role: "assistant", content: "Synthetic client-owned response" },
          ],
        }),
        "user",
        426,
        "CLIENT_UPGRADE_REQUIRED",
      );
      equal(relay.stats().calls, before, "LEGACY_NEVER_EXECUTES");
      await assertBalance();
    });

    await runCase("plain-stream-idempotency", async () => {
      const conv = await conversation("plain");
      plainBody = input(conv.id, "plain");
      const accepted = await submit(plainBody, {
        label: "plain",
        kind: "plain",
      });
      const replay = await api<ChatTurnView>(
        "/api/chat/turns",
        post(plainBody),
      );
      equal(replay.id, accepted.id, "CREATE_REPLAY_SAME_TURN");
      await api(
        "/api/chat/turns",
        post({ ...plainBody, content: plainBody.content + " changed" }),
        "user",
        409,
        "IDEMPOTENCY_CONFLICT",
      );
      plain = await terminal(accepted.id);
      const byRequest = await api<ChatTurnView>(
        `/api/chat/turns?conversationId=${conv.id}&clientRequestId=${plainBody.clientRequestId}`,
      );
      equal(byRequest.id, plain.id, "LOOKUP_BY_REQUEST");
      equal(
        await database.chatTurn.count({ where: { conversationId: conv.id } }),
        1,
        "NO_DUPLICATE_TURN",
      );
      equal(
        await database.conversationMessage.count({
          where: { conversationId: conv.id, role: "USER" },
        }),
        1,
        "NO_DUPLICATE_USER_MESSAGE",
      );
      if (!options.real)
        equal(plain.text, FIXTURE_TEXT, "EXACT_WHITESPACE_UNICODE_TEXT");
      return assertTurn(
        plain,
        "plain",
        "completed",
        plainBody.content.split("\n")[0],
      );
    });

    if (options.real && plain?.status !== "completed")
      throw new AcceptanceError(
        "REAL_BASELINE_FAILED_CAPABILITY_PROBES_NOT_RUN",
      );

    for (const scenario of [
      "web",
      "web-idle",
      "citation",
      "partial",
      "malformed",
      "non-sse",
      "no-usage",
    ] as const) {
      await runCase(scenario, async () => {
        const conv = await conversation(scenario);
        const web = ["web", "web-idle", "citation"].includes(scenario);
        const body = input(conv.id, scenario, {
          webSearch: web,
          ...(web && scenario !== "web-idle"
            ? {
                content: `CHAT_VERIFY_${runId}_${scenario}\nUse native web search to find IANA's reserved example domains and cite the authoritative source. Keep the answer under 80 words.`,
              }
            : {}),
        });
        const accepted = await submit(body, {
          label: scenario,
          kind: scenario,
          web,
        });
        const view = await terminal(accepted.id);
        const status =
          scenario === "partial"
            ? "incomplete"
            : scenario === "malformed"
              ? "interrupted"
              : scenario === "non-sse"
                ? "failed"
                : "completed";
        const metrics = await assertTurn(
          view,
          scenario,
          status,
          body.content.split("\n")[0],
        );
        const source = capture(scenario);
        if (scenario === "partial" || scenario === "malformed") {
          check(view.text.trim(), "NONEMPTY_FAILURE_PARTIAL");
          if (!options.real)
            equal(view.text, FIXTURE_PARTIAL, "PARTIAL_WHITESPACE_EXACT");
        }
        if (scenario === "no-usage")
          equal(view.usage, null, "MISSING_USAGE_IS_UNKNOWN");
        if (!options.real && scenario === "web-idle") {
          const events = await database.chatEvent.findMany({
            where: { turnId: view.id, type: "activity.updated" },
          });
          check(
            events.every((row) => object(row.payload).searched !== true),
            "SEARCH_PERMISSION_IS_NOT_SEARCH_ACTIVITY",
          );
        }
        if (scenario === "web" || scenario === "citation")
          check(source.searched, "NATIVE_SEARCH_NOT_OBSERVED");
        if (scenario === "citation") {
          check(
            source.annotations.some(
              (value) => object(value).type === "url_citation",
            ),
            "NATIVE_CITATION_NOT_OBSERVED",
          );
          check(
            view.sources.length > 0 &&
              view.sources.every((entry) => view.text.includes(entry.url)),
            "CITATION_TEXT_SOURCE_PARITY",
          );
          if (!options.real)
            check(
              view.text.includes(FIXTURE_SOURCE),
              "MOCK_CITATION_DECORATION",
            );
          const parts = object(view.parts);
          check(
            array(parts.parts).some(
              (part) => array(object(part).annotations).length > 0,
            ),
            "RAW_PART_ANNOTATIONS_RETAINED",
          );
        }
        return {
          ...metrics,
          searched: source.searched,
          citations: source.annotations.length,
        };
      });
    }

    let retryBody: ReturnType<typeof input> | undefined;
    let retryRequestId: string | undefined;
    let retryPrevious: string | undefined;
    let retried: ChatTurnView | undefined;
    await runCase("cancel-retry-attempt-binding", async () => {
      const conv = await conversation("cancel-retry");
      retryBody = input(conv.id, "cancel-retry");
      const marker = retryBody.content.split("\n")[0];
      const accepted = await submit(retryBody, {
        label: "cancel",
        kind: "cancel",
      });
      await until(async () => {
        const view = await api<ChatTurnView>(`/api/chat/turns/${accepted.id}`);
        const observed = relay.captures.find((row) => row.label === "cancel");
        return observed?.held &&
          view.status === "running" &&
          view.text.trim() &&
          view.text === observed.rawText
          ? view
          : null;
      }, "CANCEL_REQUIRES_COMMITTED_PARTIAL");
      await api(
        `/api/chat/turns/${accepted.id}/cancel`,
        post({}),
        "user",
        400,
        "VALIDATION_ERROR",
      );
      await api(
        `/api/chat/turns/${accepted.id}/cancel`,
        post({ expectedAttemptId: "synthetic-stale-attempt" }),
        "user",
        409,
        "ATTEMPT_CHANGED",
      );
      const cancelled = await api<ChatTurnView>(
        `/api/chat/turns/${accepted.id}/cancel`,
        post({ expectedAttemptId: accepted.attemptId }),
      );
      await assertTurn(cancelled, "cancel", "cancelled", marker);
      relay.release("cancel");
      await pause(250);
      const replayCancel = await api<ChatTurnView>(
        `/api/chat/turns/${accepted.id}/cancel`,
        post({ expectedAttemptId: accepted.attemptId }),
      );
      equal(replayCancel.text, cancelled.text, "CANCEL_TERMINAL_IMMUTABLE");
      await api(
        `/api/chat/turns/${accepted.id}/retry`,
        post({ clientRequestId: randomUUID() }),
        "user",
        400,
        "VALIDATION_ERROR",
      );
      retryRequestId = randomUUID();
      retryPrevious = accepted.attemptId;
      relay.schedule(marker, { label: "retry", kind: "reconnect" });
      const retryInput = {
        clientRequestId: retryRequestId,
        expectedPreviousAttemptId: retryPrevious,
      };
      const next = await api<ChatTurnView>(
        `/api/chat/turns/${accepted.id}/retry`,
        post(retryInput),
      );
      check(
        next.attemptId !== retryPrevious && next.attemptNumber === 2,
        "NEW_RETRY_ATTEMPT",
      );
      const duplicate = await api<ChatTurnView>(
        `/api/chat/turns/${accepted.id}/retry`,
        post(retryInput),
      );
      equal(duplicate.attemptId, next.attemptId, "RETRY_IDEMPOTENCY");
      await api(
        `/api/chat/turns/${accepted.id}/cancel`,
        post({ expectedAttemptId: retryPrevious }),
        "user",
        409,
        "ATTEMPT_CHANGED",
      );
      await api(
        `/api/chat/turns/${accepted.id}/retry`,
        post({
          clientRequestId: randomUUID(),
          expectedPreviousAttemptId: retryPrevious,
        }),
        "user",
        409,
        "ATTEMPT_CHANGED",
      );
      await until(
        async () =>
          relay.captures.some(
            (row) => row.label === "retry" && row.rawText.trim(),
          ) || false,
        "RETRY_UPSTREAM_TIMEOUT",
      );
      relay.release("retry");
      retried = await terminal(accepted.id);
      equal(
        await database.conversationMessage.count({
          where: { chatTurnId: accepted.id, role: "USER" },
        }),
        1,
        "RETRY_NO_SECOND_USER_MESSAGE",
      );
      await api(
        `/api/chat/turns/${accepted.id}/retry`,
        post({
          clientRequestId: randomUUID(),
          expectedPreviousAttemptId: retried.attemptId,
        }),
        "user",
        409,
        "CHAT_TURN_BUSY",
      );
      return assertTurn(retried, "retry", "completed", marker);
    });

    const patchRuntime = (body: unknown) =>
      api(
        "/api/admin/chat-runtime",
        { method: "PATCH", body: JSON.stringify(body) },
        "admin",
      );
    await runCase("reconnect-runtime-gate-and-active-history", async () => {
      const conv = await conversation("reconnect");
      const body = input(conv.id, "reconnect");
      const accepted = await submit(body, {
        label: "reconnect",
        kind: "reconnect",
      });
      const first = await streamEvents(accepted.id, 0, true);
      check(
        first.some((row) => row.type === "text.delta"),
        "LIVE_DELTA_BEFORE_TERMINAL",
      );
      const running = await api<ChatTurnView>(`/api/chat/turns/${accepted.id}`);
      equal(running.status, "running", "DISCONNECT_MUST_NOT_CANCEL");
      equal(running.billingState, "reserved", "RUNNING_HOLD");
      equal(
        await database.usageLog.count({
          where: { id: `chat_settle_${accepted.id}` },
        }),
        0,
        "NO_PREMATURE_SETTLEMENT",
      );
      await api(
        `/api/conversations/${conv.id}/messages`,
        { method: "DELETE" },
        "user",
        409,
        "CHAT_TURN_BUSY",
      );
      await api(
        `/api/conversations/${conv.id}`,
        { method: "PATCH", body: JSON.stringify({ archived: true }) },
        "user",
        409,
        "CHAT_TURN_BUSY",
      );
      const before = relay.stats().calls;
      try {
        await patchRuntime({ enabled: false });
        await api(
          "/api/chat/turns",
          post(input(conv.id, "paused")),
          "user",
          503,
          "CHAT_RUNTIME_PAUSED",
        );
        const replay = await api<ChatTurnView>("/api/chat/turns", post(body));
        equal(replay.id, accepted.id, "PAUSED_REPLAY_REMAINS_AVAILABLE");
        equal(relay.stats().calls, before, "GATE_AND_REPLAY_NO_EXECUTION");
        relay.release("reconnect");
        const completed = await terminal(accepted.id);
        const rest = await streamEvents(
          accepted.id,
          first.at(-1)!.seq,
          false,
          true,
        );
        await assertEvents(completed, [...first, ...rest]);
        await assertTurn(
          completed,
          "reconnect",
          "completed",
          body.content.split("\n")[0],
        );
        await api(
          `/api/chat/turns/${completed.id}/events?after=${completed.lastSeq + 1}`,
          {},
          "user",
          400,
          "VALIDATION_ERROR",
        );
      } finally {
        relay.release("reconnect");
        await patchRuntime({ enabled: true });
      }
      const blockedConv = await conversation("allowlist");
      try {
        await patchRuntime({ userAllowlist: [admin.id] });
        await api(
          "/api/chat/turns",
          post(input(blockedConv.id, "not-admitted")),
          "user",
          503,
          "CHAT_RUNTIME_NOT_ADMITTED",
        );
        await patchRuntime({ userAllowlist: [user.id], profiles: [] });
        await api(
          "/api/chat/turns",
          post(input(blockedConv.id, "profile-not-admitted")),
          "user",
          503,
          "CHAT_RUNTIME_NOT_ADMITTED",
        );
      } finally {
        await patchRuntime({ profiles: [SOL_MODEL], userAllowlist: [user.id] });
      }
      equal(
        await database.chatTurn.count({
          where: { conversationId: blockedConv.id },
        }),
        0,
        "GATE_HAS_NO_TASK_SIDE_EFFECTS",
      );
      return { resumedEvents: true, pausedWorkCompleted: true };
    });

    await runCase("cleared-create-and-retry-receipts", async () => {
      check(
        retried && retryBody && retryRequestId && retryPrevious,
        "RETRY_PREREQUISITE",
      );
      const before = relay.stats().calls;
      const entries = await database.creditEntry.findMany({
        where: { turnId: retried.id },
        orderBy: { id: "asc" },
      });
      await api(`/api/conversations/${retried.conversationId}/messages`, {
        method: "DELETE",
      });
      await api(
        "/api/chat/turns",
        post(retryBody),
        "user",
        410,
        "CONTENT_CLEARED",
      );
      await api(
        `/api/chat/turns/${retried.id}/retry`,
        post({
          clientRequestId: retryRequestId,
          expectedPreviousAttemptId: retryPrevious,
        }),
        "user",
        410,
        "CONTENT_CLEARED",
      );
      await api(
        `/api/chat/turns?conversationId=${retried.conversationId}&clientRequestId=${retryBody.clientRequestId}`,
        {},
        "user",
        410,
        "CONTENT_CLEARED",
      );
      await api(`/api/chat/turns/${retried.id}`, {}, "user", 404, "NOT_FOUND");
      equal(
        await database.chatTurn.count({ where: { id: retried.id } }),
        0,
        "CLEARED_TASKS_REMOVED",
      );
      equal(
        await database.chatEvent.count({ where: { turnId: retried.id } }),
        0,
        "CLEARED_EVENTS_REMOVED",
      );
      equal(
        await database.conversationMessage.count({
          where: { conversationId: retried.conversationId },
        }),
        0,
        "CLEARED_MESSAGES_REMOVED",
      );
      const receipts = await database.chatRequestReceipt.findMany({
        where: { turnId: retried.id },
      });
      equal(receipts.length, 2, "CREATE_RETRY_RECEIPTS_RETAINED");
      check(
        receipts.every((row) => row.contentClearedAt !== null),
        "CONTENT_TOMBSTONES",
      );
      equal(
        await database.creditEntry.findMany({
          where: { turnId: retried.id },
          orderBy: { id: "asc" },
        }),
        entries,
        "LEDGER_SURVIVES_CLEAR",
      );
      equal(relay.stats().calls, before, "CLEARED_REPLAY_NEVER_EXECUTES");
      await assertBalance();
    });

    // Probes intentionally bypass app capability admission at the transport only.
    // Their results cannot alter the Sol catalog or encrypted configuration.
    const directProbe = async (
      label: string,
      body: Record<string, unknown>,
      effort = "low",
    ) => {
      const key = `probe-${randomUUID()}`;
      relay.schedule(key, { label, kind: "probe", effort });
      const response = await directLoopbackRequest(
        relay.baseUrl + "/v1/responses",
        {
          ...post(body),
          headers: {
            Authorization: `Bearer ${relay.token}`,
            "Content-Type": "application/json",
            "Accept-Encoding": "identity",
            "x-chat-verify-probe": key,
          },
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(210_000)]),
          redirect: "manual",
        },
      );
      await response.arrayBuffer();
      const observed = capture(label);
      assertWire(observed);
      check(
        response.ok &&
          observed.responseStatus === "completed" &&
          observed.finalRawText?.trim(),
        "PROBE_UPSTREAM_NOT_COMPLETED",
      );
      check(!observed.protocolError, "PROBE_PROTOCOL_ERROR");
      return observed;
    };
    const probeBody = (prompt: string) => ({
      model: SOL_MODEL,
      instructions:
        "Synthetic acceptance. Answer only the requested short output.",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: prompt }],
        },
      ],
      reasoning: { effort: "low" },
      max_output_tokens: 4096,
      stream: true,
      store: false,
    });

    if (options.probes.has("efforts")) {
      await runCase(
        "effort-control-low",
        async () => {
          check(options.real, "CAPABILITY_PROBE_REQUIRES_REAL_MODE");
          check(
            plain && capture("plain").responseStatus === "completed",
            "PLAIN_LOW_CONTROL_REQUIRED",
          );
          return { controlReusesPlain: true, onlyVariable: "reasoning.effort" };
        },
        probes,
      );
      for (const effort of ["medium", "high", "xhigh"])
        await runCase(
          `effort-${effort}`,
          async () => {
            check(options.real, "CAPABILITY_PROBE_REQUIRES_REAL_MODE");
            const body = structuredClone(capture("plain").body);
            body.reasoning = { ...object(body.reasoning), effort };
            const result = await directProbe(`effort-${effort}`, body, effort);
            return {
              characters: result.finalRawText!.length,
              onlyVariable: "reasoning.effort",
              appCapabilityEnabled: false,
            };
          },
          probes,
        );
    }

    if (options.probes.has("vision") || options.probes.has("image-order")) {
      const sharp = (await import("sharp")).default;
      const image = async (background: string) => ({
        type: "input_image",
        image_url: `data:image/png;base64,${(
          await sharp({
            create: { width: 96, height: 96, channels: 3, background },
          })
            .png()
            .toBuffer()
        ).toString("base64")}`,
        detail: "low",
      });
      const red = await image("#ff0000");
      const blue = await image("#0000ff");
      if (options.probes.has("vision"))
        await runCase(
          "vision-single-image",
          async () => {
            check(options.real, "CAPABILITY_PROBE_REQUIRES_REAL_MODE");
            const body = probeBody(
              "Name the solid color in the attached image. If there is no image, answer NONE. Output only RED, BLUE or NONE.",
            );
            const control = await directProbe("vision-control", body);
            check(
              /^NONE[.!]?$/i.test(control.finalRawText!.trim()),
              "VISION_TEXT_CONTROL",
            );
            const treatment = structuredClone(body);
            (treatment.input[0].content as unknown[]).push(red);
            const result = await directProbe("vision-image", treatment);
            check(
              /^RED[.!]?$/i.test(result.finalRawText!.trim()),
              "VISION_SYNTHETIC_COLOR",
            );
            return {
              onlyVariable: "one input_image",
              appCapabilityEnabled: false,
            };
          },
          probes,
        );
      if (options.probes.has("image-order"))
        await runCase(
          "two-image-order",
          async () => {
            check(options.real, "CAPABILITY_PROBE_REQUIRES_REAL_MODE");
            const body = probeBody(
              "Name the two solid colors in attachment order. Output only RED,BLUE or BLUE,RED, without spaces.",
            );
            (body.input[0].content as unknown[]).push(red, blue);
            const first = await directProbe("image-order-red-blue", body);
            const reverse = structuredClone(body);
            (reverse.input[0].content as unknown[]).splice(1, 2, blue, red);
            const second = await directProbe("image-order-blue-red", reverse);
            check(
              first.finalRawText!.trim().toUpperCase() === "RED,BLUE" &&
                second.finalRawText!.trim().toUpperCase() === "BLUE,RED",
              "IMAGE_ORDER_SEMANTICS",
            );
            return {
              onlyVariable: "attachment order",
              appCapabilityEnabled: false,
            };
          },
          probes,
        );
    }

    if (options.probes.has("context-summary"))
      await runCase(
        "durable-summary-current-wire-request",
        async () => {
          const conv = await conversation("summary");
          // Historical fixture is authored here, not imported from any user's history.
          const origin = Date.now() - 60_000;
          for (let index = 0; index < 7; index++)
            await database.conversationMessage.createMany({
              data: [
                {
                  conversationId: conv.id,
                  role: "USER",
                  content:
                    `Synthetic history ${index}: SYNTHETIC_ANCHOR_731. Approved count 7. ` +
                    "Synthetic background facts only. ".repeat(90),
                  createdAt: new Date(origin + index * 10),
                },
                {
                  conversationId: conv.id,
                  role: "ASSISTANT",
                  content:
                    `Synthetic confirmed history ${index}. Keep count 7 and anchor SYNTHETIC_ANCHOR_731. ` +
                    "Synthetic agreement. ".repeat(40),
                  createdAt: new Date(origin + index * 10 + 1),
                },
              ],
            });
          await database.conversation.update({
            where: { id: conv.id },
            data: { contextRevision: { increment: 1 } },
          });
          relay.schedule("summary", {
            label: "context-summary",
            kind: "summary",
          });
          const compacted = await api<{
            summary: string;
            compactedMessages: number;
          }>(
            "/api/conversations/context",
            post({ conversationId: conv.id, modelId: SOL_MODEL }),
          );
          check(
            compacted.summary && compacted.compactedMessages > 0,
            "HTTP_SUMMARY_COMPACTED",
          );
          const summary = capture("context-summary");
          assertWire(summary);
          check(
            compacted.summary.includes("SYNTHETIC_ANCHOR_731"),
            "SUMMARY_SYNTHETIC_ANCHOR",
          );
          const snapshots = await database.contextSnapshot.findMany({
            where: { conversationId: conv.id },
          });
          equal(snapshots.length, 1, "DURABLE_POSTGRES_SUMMARY");
          equal(
            snapshots[0].summary,
            compacted.summary,
            "SUMMARY_API_DB_PARITY",
          );
          const body = input(conv.id, "after-summary", {
            content: `CHAT_VERIFY_${runId}_after-summary\nRepeat the approved synthetic anchor and count from the saved history in one short line.`,
          });
          const accepted = await submit(body, {
            label: "after-summary",
            kind: "plain",
          });
          const view = await terminal(accepted.id);
          await assertTurn(
            view,
            "after-summary",
            "completed",
            body.content.split("\n")[0],
          );
          const attempt = await database.chatAttempt.findUniqueOrThrow({
            where: { id: view.attemptId },
          });
          equal(
            attempt.contextSnapshotId,
            snapshots[0].id,
            "CURRENT_REQUEST_USES_SNAPSHOT",
          );
          const wire = capture("after-summary");
          check(
            array(wire.body.input).some((item) =>
              array(object(item).content).some(
                (part) =>
                  typeof object(part).text === "string" &&
                  (object(part).text as string).includes(compacted.summary),
              ),
            ),
            "ACTUAL_CURRENT_REQUEST_CONTAINS_SUMMARY",
          );
          if (options.real)
            check(
              view.text.includes("SYNTHETIC_ANCHOR_731") &&
                view.text.includes("7"),
              "SUMMARY_CURRENT_ANSWER_SEMANTICS",
            );
          const before = relay.stats().calls;
          const compactAgain = await api<{ summary: string }>(
            "/api/conversations/context?conversationId=" + conv.id,
          );
          equal(
            compactAgain.summary,
            compacted.summary,
            "SUMMARY_REUSED_AFTER_APPEND",
          );
          equal(relay.stats().calls, before, "SUMMARY_READ_NO_UPSTREAM_CALL");
          return {
            summaryCalls: 1,
            snapshots: 1,
            actualRequestHashBound: true,
            syntheticHistoryOnly: true,
          };
        },
        probes,
      );

    if (options.probes.has("vision-history"))
      await runCase(
        "website-ordered-and-multiturn-vision",
        async () => {
          check(options.real, "CAPABILITY_PROBE_REQUIRES_REAL_MODE");
          const sharp = (await import("sharp")).default;
          const red = await sharp({
            create: {
              width: 96,
              height: 96,
              channels: 3,
              background: "#ff0000",
            },
          })
            .png()
            .toBuffer();
          const blue = await sharp({
            create: {
              width: 96,
              height: 96,
              channels: 3,
              background: "#0000ff",
            },
          })
            .png()
            .toBuffer();
          const uploadKey = `uploads/${user.id}/${randomUUID()}.png`;
          const generatedKey = `generated/${user.id}/${randomUUID()}.png`;
          for (const [key, bytes] of [
            [uploadKey, red],
            [generatedKey, blue],
          ] as const) {
            const destination = resolve(env.PRIVATE_STORAGE_DIR!, key);
            await mkdir(dirname(destination), { recursive: true });
            await writeFile(destination, bytes);
          }
          const conv = await conversation("website-vision-history");
          const firstBody = input(conv.id, "vision-remember", {
            content: `CHAT_VERIFY_${runId}_vision-remember\nFor this turn only, look at the attached image and reply only ACK. Do not describe its color.`,
            references: [{ kind: "upload", key: uploadKey, label: "image 1" }],
          });
          const first = await submit(firstBody, {
            label: "vision-remember",
            kind: "plain",
          });
          const firstView = await terminal(first.id);
          await assertTurn(
            firstView,
            "vision-remember",
            "completed",
            firstBody.content.split("\n")[0],
          );
          check(
            /^ACK[.!]?$/i.test(firstView.text.trim()),
            "VISION_FIRST_TURN_DOES_NOT_LEAK_COLOR",
          );
          const secondBody = input(conv.id, "vision-recall", {
            content: `CHAT_VERIFY_${runId}_vision-recall\nName the solid color in the image attached earlier. Output only RED or BLUE.`,
            references: [],
          });
          const second = await submit(secondBody, {
            label: "vision-recall",
            kind: "plain",
          });
          const secondView = await terminal(second.id);
          await assertTurn(
            secondView,
            "vision-recall",
            "completed",
            secondBody.content.split("\n")[0],
          );
          check(
            /^RED[.!]?$/i.test(secondView.text.trim()),
            "VISION_HISTORY_RECALL",
          );
          const imageParts = (label: string) =>
            array(capture(label).body.input)
              .flatMap((item) => array(object(item).content))
              .filter((part) => object(part).type === "input_image");
          equal(
            imageParts("vision-recall").length,
            1,
            "ACTUAL_REQUEST_RETAINS_HISTORICAL_IMAGE",
          );
          const recalledAttempt = await database.chatAttempt.findUniqueOrThrow({
            where: { id: secondView.attemptId },
          });
          check(
            array(object(recalledAttempt.contextManifest).assets).some(
              (asset) => object(object(asset).reference).key === uploadKey,
            ),
            "HISTORICAL_IMAGE_MANIFEST",
          );
          const mixedConv = await conversation("mixed-reference-order");
          const generation = await database.generation.create({
            data: {
              userId: user.id,
              modelId: "gpt-image-2",
              prompt: "Synthetic blue reference fixture",
              aspectRatio: "1:1",
              paramsRaw: {},
              referenceImageKeys: [],
              status: "SUCCEEDED",
            },
          });
          const generated = await database.generatedImage.create({
            data: {
              generationId: generation.id,
              storageKey: generatedKey,
              width: 96,
              height: 96,
              sizeBytes: blue.length,
              mimeType: "image/png",
            },
          });
          const mixedBody = input(mixedConv.id, "vision-mixed", {
            content: `CHAT_VERIFY_${runId}_vision-mixed\nName the two image colors in attachment order. Output only the two uppercase English color names separated by a comma, without spaces.`,
            references: [
              { kind: "generated", id: generated.id, label: "image 1" },
              { kind: "upload", key: uploadKey, label: "image 2" },
            ],
          });
          const mixed = await submit(mixedBody, {
            label: "vision-mixed",
            kind: "plain",
          });
          const mixedView = await terminal(mixed.id);
          await assertTurn(
            mixedView,
            "vision-mixed",
            "completed",
            mixedBody.content.split("\n")[0],
          );
          equal(
            mixedView.text
              .trim()
              .replace(/\s/g, "")
              .replace(/[.!]$/, "")
              .toUpperCase(),
            "BLUE,RED",
            "MIXED_GENERATED_UPLOAD_ORDER",
          );
          equal(
            imageParts("vision-mixed").length,
            2,
            "ACTUAL_MIXED_IMAGE_COUNT",
          );
          return {
            websiteImageTurns: 3,
            historicalImagesReplayed: true,
            generatedUploadOrder: true,
            syntheticImagesOnly: true,
          };
        },
        probes,
      );

    await runCase("final-ledger-api-and-runtime-parity", async () => {
      await assertBalance();
      const audit = auditChatLedger({
        users: await database.user.findMany(),
        conversations: await database.conversation.findMany(),
        turns: await database.chatTurn.findMany(),
        attempts: await database.chatAttempt.findMany(),
        entries: await database.creditEntry.findMany(),
        receipts: await database.chatRequestReceipt.findMany(),
        usages: await database.usageLog.findMany(),
        messages: await database.conversationMessage.findMany(),
        events: await database.chatEvent.findMany(),
      });
      check(audit.clean, "CREDIT_LEDGER_AUDIT_FAILED");
      check(audit.quiescent, "OUTSTANDING_TASKS_OR_HOLDS");
      const runtime = await api<{
        drained: boolean;
        outstanding: Record<string, number>;
      }>("/api/admin/chat-runtime", {}, "admin");
      check(
        runtime.drained &&
          Object.values(runtime.outstanding).every((value) => value === 0),
        "HTTP_RUNTIME_DRAINED",
      );
      const apiUsage = await api<{
        items: Array<{ id: string; creditsDelta: number }>;
      }>("/api/me/usage?limit=50");
      const dbUsage = await database.usageLog.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
      });
      equal(
        apiUsage.items.map((row) => ({ id: row.id, delta: row.creditsDelta })),
        dbUsage.map((row) => ({ id: row.id, delta: row.creditsDelta })),
        "USAGE_API_DATABASE_PARITY",
      );
      equal(relay.stats().denied, 0, "NO_UNPLANNED_OR_OVER_BUDGET_REQUESTS");
      check(
        relay.stats().actualCalls <= options.maxRequests,
        "GLOBAL_REAL_REQUEST_CAP",
      );
      return {
        ledgerClean: true,
        quiescent: true,
        consumed: audit.totals.consumed,
      };
    });

    if (options.keepAlive && !interrupted) {
      holding = true;
      phase = "interactive-browser-acceptance";
      process.stdout.write(
        JSON.stringify({
          ...report("ready-for-browser"),
          browser: {
            url: baseUrl + "/app",
            loginUrl: baseUrl + "/login",
            email: user.email,
            password,
            syntheticOnly: true,
            htmlPrompt: interactivePrompt,
            markdownPrompt: `${interactivePrompt}_MARKDOWN`,
            partialHtmlPrompt: `${interactivePrompt}_PARTIAL`,
            sentinelBase: relay.sentinelBase,
            statusUrl: relay.statusUrl,
            expectedSentinelRequests: 0,
            stop: "SIGTERM triggers final report and cleanup",
          },
        }) + "\n",
      );
      await new Promise<void>((done) => {
        wake = done;
        if (abort.signal.aborted) done();
      });
      check(
        relay.stats().sentinelRequests === 0 &&
          relay.stats().unexpectedRequests === 0,
        "BROWSER_SENTINEL_OR_UNEXPECTED_REQUESTS",
      );
    }
  } catch (error) {
    checks.push({
      name: phase,
      status: "failed",
      durationMs: 0,
      code:
        interrupted && !holding
          ? "INTERRUPTED"
          : error instanceof AcceptanceError
            ? error.code
            : "SETUP_OR_RUNTIME_FAILED",
    });
  } finally {
    for (const plan of transport?.captures ?? [])
      transport?.release(plan.label);
    for (const row of [...processes].reverse()) {
      try {
        await stopProcess(row);
      } catch {
        cleanup[`${row.name}StopFailed`] = true;
      }
    }
    cleanup.processesStopped = processes.every((row) => row.exited);
    try {
      await transport?.close();
      cleanup.transportClosed = true;
    } catch {
      cleanup.transportClosed = false;
    }
    // No FLUSH/KEYS or broad deletion: compare-and-delete only our unique build/pid.
    if (redis?.status === "ready") {
      try {
        let cursor = "0";
        let removed = 0;
        do {
          const page = await redis.scan(
            cursor,
            "MATCH",
            HEARTBEAT_PREFIX + "*",
            "COUNT",
            100,
          );
          cursor = page[0];
          for (const key of page[1]) {
            const raw = await redis.get(key);
            if (!raw) continue;
            let value: Record<string, unknown>;
            try {
              value = object(JSON.parse(raw));
            } catch {
              continue;
            }
            if (
              value.buildId !== buildTag ||
              !processes.some(
                (row) => row.name === "worker" && row.child.pid === value.pid,
              )
            )
              continue;
            removed += Number(
              await redis.eval(
                'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end',
                1,
                key,
                raw,
              ),
            );
          }
        } while (cursor !== "0");
        cleanup.ownHeartbeatsRemoved = removed;
        cleanup.heartbeatCleanup = true;
      } catch {
        cleanup.heartbeatCleanup = false;
      }
    }
    redis?.disconnect();
    try {
      await db?.$disconnect();
      cleanup.scratchClientClosed = true;
    } catch {
      cleanup.scratchClientClosed = false;
    }
    if (created && maintenance) {
      try {
        check(
          /^chat_accept_[a-z0-9_]+$/.test(databaseName),
          "INVALID_DROP_TARGET",
        );
        await maintenance.$executeRawUnsafe(
          `DROP DATABASE "${databaseName}" WITH (FORCE)`,
        );
        cleanup.scratchDatabaseDropped = true;
      } catch {
        cleanup.scratchDatabaseDropped = false;
      }
    }
    try {
      await maintenance?.$disconnect();
    } catch {
      /* Already disconnected. */
    }
    if (dir) {
      try {
        await rm(dir, { recursive: true, force: true });
        cleanup.tempDirectoryRemoved = true;
      } catch {
        cleanup.tempDirectoryRemoved = false;
      }
    }
    process.off("SIGINT", onInt);
    process.off("SIGTERM", onTerm);
  }
  const failed =
    [...checks, ...probes].some((row) => row.status === "failed") ||
    Object.values(cleanup).some((value) => value === false) ||
    Object.keys(cleanup).some((key) => key.endsWith("StopFailed"));
  process.stdout.write(
    JSON.stringify({
      ...report(
        interrupted && !holding ? "interrupted" : failed ? "failed" : "passed",
      ),
      finishedAt: new Date().toISOString(),
    }) + "\n",
  );
  process.exitCode = interrupted && !holding ? 130 : failed ? 1 : 0;
}

void main().catch(() => {
  process.stdout.write(
    '{"type":"chat-runtime-acceptance","status":"failed","code":"HARNESS_FATAL_ERROR"}\n',
  );
  process.exitCode = 1;
});
