import { createHash } from "node:crypto";

import { Prisma } from "@prisma/client";

import { fail, ok } from "@/lib/api-response";
import { audit } from "@/lib/audit";
import {
  adminFailureResponse,
  authenticatedUser,
  checkSession,
} from "@/lib/auth";
import { encrypt } from "@/lib/crypto";
import { db } from "@/lib/db";
import { redactSensitiveText } from "@/lib/providers/diagnostics";
import { normalizeProviderBaseUrl } from "@/lib/providers/protocols";
import { providerAccountImportSchema } from "@/lib/validators";

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseLine(line: string) {
  const parts = line.includes(",")
    ? line.split(",").map((part) => part.trim())
    : line.trim().split(/\s+/);

  const [baseUrl, apiKey, maxConcurrency, weight, name] = parts;

  if (!baseUrl || !apiKey) {
    return null;
  }

  return {
    baseUrl,
    apiKey,
    maxConcurrency: maxConcurrency ? Number(maxConcurrency) : undefined,
    weight: weight ? Number(weight) : undefined,
    name,
  };
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  result.push(current.trim());
  return result;
}

type ParsedImportRow =
  | {
      ok: true;
      lineNumber: number;
      name?: string;
      baseUrl: string;
      apiKey: string;
      maxConcurrency?: number;
      weight?: number;
      note?: string;
    }
  | {
      ok: false;
      lineNumber: number;
      name?: string;
      reason: string;
    };

function parseCsvRows(text: string, defaultBaseUrl: string): ParsedImportRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return [];
  }

  const header = splitCsvLine(lines[0]).map((cell) => cell.trim().toLowerCase());
  const required = ["api_key"];

  if (required.some((cell) => !header.includes(cell))) {
    return [
      {
        ok: false,
        lineNumber: 1,
        reason: "CSV 缺少 api_key 列",
      },
    ];
  }

  const getValue = (cells: string[], key: string) => {
    const index = header.indexOf(key);
    return index >= 0 ? (cells[index] ?? "").trim() : "";
  };

  return lines.slice(1).map((line, rowIndex) => {
    const cells = splitCsvLine(line);
    const name = getValue(cells, "name") || getValue(cells, "id") || undefined;
    const apiKey = getValue(cells, "api_key");
    const status = getValue(cells, "status");
    const sourceId = getValue(cells, "id");
    const error = getValue(cells, "error");
    const lineNumber = rowIndex + 2;

    if (!apiKey) {
      return {
        ok: false,
        lineNumber,
        name,
        reason: "api_key 为空",
      };
    }

    const notes = [
      status ? `status=${status}` : "",
      sourceId ? `sourceId=${sourceId}` : "",
      error ? `sourceError=${redactSensitiveText(error).slice(0, 120)}` : "",
    ].filter(Boolean);

    return {
      ok: true,
      lineNumber,
      name,
      baseUrl: defaultBaseUrl,
      apiKey,
      note: notes.length > 0 ? notes.join(" | ") : undefined,
    };
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const sessionResult = await checkSession(request);
  const { id } = await context.params;
  const failure = adminFailureResponse(sessionResult);

  if (failure) {
    return failure;
  }

  if (!process.env.DATABASE_URL) {
    return fail("SERVICE_UNAVAILABLE", "号池服务未配置数据库", { status: 503 });
  }

  const json = (await request.json()) as unknown;
  const parsed = providerAccountImportSchema.safeParse(json);

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "批量导入参数不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  const provider = await db.provider.findUnique({
    where: { id },
    select: { id: true, protocol: true, baseUrl: true },
  });

  if (!provider) {
    return fail("NOT_FOUND", "渠道池不存在", { status: 404 });
  }

  const admin = authenticatedUser(sessionResult);
  const sourceText =
    parsed.data.mode === "csv"
      ? parsed.data.csvText ?? ""
      : parsed.data.text ?? "";
  const rows: ParsedImportRow[] =
    parsed.data.mode === "csv"
      ? parseCsvRows(sourceText, provider.baseUrl)
      : sourceText
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line, index) => {
            const parsedLine = parseLine(line);

            if (!parsedLine) {
              return {
                ok: false,
                lineNumber: index + 1,
                reason: "每行至少需要 baseUrl 和 apiKey",
              } satisfies ParsedImportRow;
            }

            return {
              ok: true,
              lineNumber: index + 1,
              name: parsedLine.name,
              baseUrl: parsedLine.baseUrl,
              apiKey: parsedLine.apiKey,
              maxConcurrency: parsedLine.maxConcurrency,
              weight: parsedLine.weight,
            } satisfies ParsedImportRow;
          });
  let created = 0;
  let skipped = 0;
  let failed = 0;
  const errors: Array<{ lineNumber: number; name?: string; reason: string }> = [];

  for (const row of rows) {
    if (!row.ok) {
      failed += 1;
      errors.push({
        lineNumber: row.lineNumber,
        name: row.name,
        reason: row.reason,
      });
      continue;
    }

    const baseUrl = normalizeProviderBaseUrl(row.baseUrl, provider.protocol);

    try {
      await db.providerAccount.create({
        data: {
          providerId: id,
          name: row.name,
          baseUrl,
          apiKeyEnc: encrypt(row.apiKey),
          apiKeyFingerprint: fingerprint(row.apiKey),
          maxConcurrency:
            row.maxConcurrency && Number.isFinite(row.maxConcurrency)
              ? row.maxConcurrency
              : parsed.data.defaultMaxConcurrency,
          weight:
            row.weight && Number.isFinite(row.weight)
              ? row.weight
              : parsed.data.defaultWeight,
          note: row.note,
        },
      });

      created += 1;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        skipped += 1;
        continue;
      }

      failed += 1;
      errors.push({
        lineNumber: row.lineNumber,
        name: row.name,
        reason: error instanceof Error ? error.message : "导入失败",
      });
    }
  }

  await audit({
    actorId: admin.id,
    action: "admin.provider_account.import",
    target: id,
    diff: {
      mode: parsed.data.mode,
      created,
      skipped,
      failed,
    },
    request,
  });

  return ok({ created, skipped, failed, errors });
}
