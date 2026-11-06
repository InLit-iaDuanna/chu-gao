import { createHash } from "node:crypto";
import { z } from "zod";
import { ResearchError } from "./errors";

const filename = z.enum(["proposal.pptx", "proposal.docx", "index.html"]);
const artifact = z
  .object({
    name: filename,
    format: z.enum(["pptx", "docx", "html"]),
    bytes: z
      .number()
      .int()
      .positive()
      .max(32 * 1024 * 1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .passthrough();
const resultSchema = z
  .object({
    packageVersion: z.string().regex(/^[a-f0-9]{64}$/),
    evidenceIds: z.array(z.string().min(1).max(100)).max(100),
    artifactManifest: z.array(artifact).min(1).max(3),
  })
  .passthrough();
const filesSchema = z
  .array(
    z
      .object({
        name: filename,
        size: z
          .number()
          .int()
          .positive()
          .max(32 * 1024 * 1024),
      })
      .passthrough(),
  )
  .min(1)
  .max(3);

/** Validate the application/sidecar boundary before downloading or publishing. */
export function validateRemoteProposal(input: {
  result: unknown;
  files: unknown;
  packageVersion: string;
  evidenceIds: Iterable<string>;
  requestedFormats: string[];
}) {
  const result = resultSchema.safeParse(input.result);
  const files = filesSchema.safeParse(input.files);
  if (!result.success || !files.success)
    throw new ResearchError(
      "INVALID_ARTIFACT_BUNDLE",
      "远端文件组清单格式不合法，未导入",
      502,
    );
  if (result.data.packageVersion !== input.packageVersion)
    throw new ResearchError(
      "ARTIFACT_VERSION_CONFLICT",
      "远端产物不属于本次终稿版本，未导入",
      502,
    );
  const allowed = new Set(input.evidenceIds);
  const actualIds = result.data.evidenceIds;
  if (
    new Set(actualIds).size !== actualIds.length ||
    actualIds.some((id) => !allowed.has(id))
  )
    throw new ResearchError(
      "INVALID_EVIDENCE_REFERENCE",
      "远端产物引用了终稿包以外的材料，未导入",
      502,
    );
  const expected = new Set(input.requestedFormats);
  const manifest = result.data.artifactManifest;
  const formats = new Set(manifest.map((entry) => entry.format));
  const fileNames = new Set(files.data.map((entry) => entry.name));
  if (
    expected.size !== input.requestedFormats.length ||
    manifest.length !== expected.size ||
    formats.size !== expected.size ||
    [...formats].some((format) => !expected.has(format)) ||
    files.data.length !== expected.size ||
    fileNames.size !== files.data.length ||
    manifest.some(
      (entry) =>
        entry.name !==
          (entry.format === "html"
            ? "index.html"
            : `proposal.${entry.format}`) ||
        !files.data.some(
          (file) => file.name === entry.name && file.size === entry.bytes,
        ),
    )
  )
    throw new ResearchError(
      "INVALID_ARTIFACT_BUNDLE",
      "远端文件组缺少所需格式、格式重复或大小不符，未导入",
      502,
    );
  return { files: manifest, evidenceIds: actualIds };
}

export function validateRemoteArtifactBytes(
  entry: { bytes: number; sha256: string },
  data: Buffer,
) {
  if (
    entry.bytes !== data.length ||
    entry.sha256 !== createHash("sha256").update(data).digest("hex")
  )
    throw new ResearchError(
      "ARTIFACT_HASH_MISMATCH",
      "下载内容与远端原子清单不一致，文件组未导入",
      502,
    );
}
