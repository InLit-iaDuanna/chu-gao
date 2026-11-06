import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  active: vi.fn(),
  reserve: vi.fn(),
  finish: vi.fn(),
  event: vi.fn(),
  source: vi.fn(),
  read: vi.fn(),
  fetch: vi.fn(),
  brief: vi.fn(),
  evidence: vi.fn(),
}));

vi.mock("./budget", () => ({
  activeResearchAttempt: mocks.active,
  waitForResearchCall: mocks.reserve,
  finishResearchCall: mocks.finish,
}));
vi.mock("./service", () => ({ researchEvent: mocks.event }));
vi.mock("./storage", () => ({
  readResearchFile: mocks.read,
  saveResearchSource: mocks.source,
  canonicalResearchUrl: (url: string) => new URL(url).toString(),
}));
vi.mock("@/lib/db", () => ({
  db: {
    researchBrief: { findUniqueOrThrow: mocks.brief },
    researchEvidence: { findFirst: mocks.evidence },
  },
}));

import { researchTool } from "./tools";

describe("research crawl failure records", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("fetch", mocks.fetch);
    const task = {
      id: "task-crawl",
      briefId: "brief-1",
      executionToken: "run-1",
    };
    mocks.active.mockResolvedValue({ stage: { task, taskId: task.id } });
    mocks.reserve.mockResolvedValue({
      call: { id: "call-1" },
      task,
      config: { crawlUrl: "http://offline.invalid" },
    });
    mocks.brief.mockResolvedValue({ content: { question: "Synthetic test" } });
    mocks.evidence.mockResolvedValue(null);
    mocks.source.mockResolvedValue({ id: "source-1" });
    mocks.event.mockResolvedValue(undefined);
    mocks.read.mockResolvedValue(
      Buffer.from("Known retained appliance source with a 1200 W rated power."),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("retains the typed source status in the call and progress event", async () => {
    mocks.fetch.mockResolvedValue(
      Response.json(
        {
          detail: {
            code: "CRAWL_BLOCKED",
            message: "来源网站拒绝访问，未取得正文",
            httpStatus: 403,
            retryable: false,
          },
        },
        { status: 502 },
      ),
    );
    await expect(
      researchTool("attempt-1", "crawl", { url: "https://example.com/" }),
    ).rejects.toMatchObject({
      code: "CRAWL_BLOCKED",
      details: { httpStatus: 403 },
    });
    expect(mocks.finish).toHaveBeenCalledWith("call-1", {
      errorCode: "CRAWL_BLOCKED",
    });
    expect(mocks.event).toHaveBeenCalledWith(
      "task-crawl",
      "evidence.capture_failed",
      expect.objectContaining({ code: "CRAWL_BLOCKED", httpStatus: 403 }),
      "run-1",
    );
    expect(mocks.source).toHaveBeenCalledWith(
      "task-crawl",
      { url: "https://example.com/", failed: true },
      "run-1",
    );
  });

  it("keeps a generic service error for a non-JSON proxy response", async () => {
    mocks.fetch.mockResolvedValue(
      new Response("<html>Bad gateway</html>", { status: 502 }),
    );
    await expect(
      researchTool("attempt-1", "crawl", { url: "https://example.com/" }),
    ).rejects.toMatchObject({ code: "SELF_HOSTED_TOOL_FAILED" });
    expect(mocks.event).toHaveBeenCalledWith(
      "task-crawl",
      "evidence.capture_failed",
      expect.objectContaining({
        code: "SELF_HOSTED_TOOL_FAILED",
        httpStatus: null,
      }),
      "run-1",
    );
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("does not mistake a text cache hit for an available requested screenshot", async () => {
    mocks.evidence.mockResolvedValue({
      id: "source-1",
      contentKey: "retained.md",
      screenshotKey: null,
      originalUrl: "https://example.com/",
      title: "Fixture source",
    });
    mocks.fetch.mockResolvedValue(
      Response.json({
        title: "Fixture source",
        markdown: "Retained body with screenshot failure",
        captureMethod: "http-trafilatura",
        screenshotStatus: "failed",
        captureWarnings: [{ code: "CRAWL_TIMEOUT" }],
        media: {},
      }),
    );
    await researchTool("attempt-1", "crawl", {
      url: "https://example.com/",
      screenshot: true,
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.source).toHaveBeenCalledWith(
      "task-crawl",
      expect.objectContaining({
        content: "Retained body with screenshot failure",
        media: expect.objectContaining({
          capture: expect.objectContaining({
            screenshotStatus: "failed",
            method: "http-trafilatura",
          }),
        }),
      }),
      "run-1",
    );
  });

  it("reuses a PDF body without requesting an inapplicable web screenshot", async () => {
    mocks.evidence.mockResolvedValue({
      id: "source-1",
      contentKey: "retained.md",
      screenshotKey: null,
      originalUrl: "https://example.com/report.pdf",
      title: "Fixture PDF",
      media: { capture: { screenshotStatus: "not_applicable" } },
    });
    await expect(
      researchTool("attempt-1", "crawl", {
        url: "https://example.com/report.pdf",
        screenshot: true,
      }),
    ).resolves.toMatchObject({ cached: true });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
  });
});
