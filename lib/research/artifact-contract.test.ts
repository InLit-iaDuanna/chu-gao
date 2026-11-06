import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  validateRemoteArtifactBytes,
  validateRemoteProposal,
} from "./artifact-contract";

const version = "a".repeat(64);
const data = Buffer.from(
  "synthetic bytes; Office validation is a separate gate",
);
const entry = {
  name: "proposal.pptx",
  format: "pptx",
  bytes: data.length,
  sha256: createHash("sha256").update(data).digest("hex"),
};
const input = () => ({
  result: {
    packageVersion: version,
    evidenceIds: ["retained-source"],
    artifactManifest: [structuredClone(entry)],
  },
  files: [{ name: "proposal.pptx", size: data.length }],
  packageVersion: version,
  evidenceIds: ["retained-source"],
  requestedFormats: ["pptx"],
});

describe("remote proposal import boundary", () => {
  it("accepts exactly the requested, versioned bundle and preserves actual citations", () => {
    expect(validateRemoteProposal(input())).toEqual({
      files: [entry],
      evidenceIds: ["retained-source"],
    });
    expect(() => validateRemoteArtifactBytes(entry, data)).not.toThrow();
  });
  it("rejects another final package even if its files are valid", () => {
    const value = input();
    value.result.packageVersion = "b".repeat(64);
    expect(() => validateRemoteProposal(value)).toThrow(/终稿版本/);
  });
  it("rejects a task-owned source that was not retained in this final package", () => {
    const value = input();
    value.result.evidenceIds = ["older-task-source"];
    expect(() => validateRemoteProposal(value)).toThrow(/终稿包以外/);
  });
  it("rejects duplicate evidence identifiers", () => {
    const value = input();
    value.result.evidenceIds.push("retained-source");
    expect(() => validateRemoteProposal(value)).toThrow(/终稿包以外/);
  });
  it.each(["../proposal.pptx", "different.pptx", "proposal.pptx.exe"])(
    "rejects unexpected filename %s",
    (name) => {
      const value = input();
      value.files[0].name = name;
      expect(() => validateRemoteProposal(value)).toThrow(/清单格式/);
    },
  );
  it("requires every requested format before any import", () => {
    const value = input();
    value.requestedFormats.push("docx");
    expect(() => validateRemoteProposal(value)).toThrow(/所需格式/);
  });
  it("rejects duplicate manifest formats and duplicated listings", () => {
    const value = input();
    value.result.artifactManifest.push(structuredClone(entry));
    value.files.push({ ...value.files[0] });
    expect(() => validateRemoteProposal(value)).toThrow(/格式重复/);
  });
  it("rejects a manifest whose file extension does not match its declared format", () => {
    const value = input();
    value.result.artifactManifest[0].format = "docx";
    value.requestedFormats = ["docx"];
    expect(() => validateRemoteProposal(value)).toThrow(/格式重复/);
  });
  it("rejects a listing with a conflicting byte count", () => {
    const value = input();
    value.files[0].size++;
    expect(() => validateRemoteProposal(value)).toThrow(/大小不符/);
  });
  it("rejects malformed or oversized entries before fetching", () => {
    const value = input();
    value.result.artifactManifest[0].bytes = 33 * 1024 * 1024;
    expect(() => validateRemoteProposal(value)).toThrow(/清单格式/);
  });
  it("rejects changed download bytes even when their size is unchanged", () => {
    const damaged = Buffer.from(data);
    damaged[0] ^= 1;
    expect(() => validateRemoteArtifactBytes(entry, damaged)).toThrow(
      /原子清单/,
    );
  });
});
