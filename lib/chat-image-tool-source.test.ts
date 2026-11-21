import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * source_images: referencing images generated earlier in the conversation.
 *
 * The db mock evaluates the generation scope the resolver sends, so the
 * tests check that another user's, another conversation's, deleted or failed
 * images can never be referenced.
 */

interface FixtureGeneration {
  id: string;
  userId: string;
  conversationId: string | null;
  messageConversationIds: string[];
  deletedAt: Date | null;
  status: string;
  createdAt: number;
  images: string[];
}

const fixtures = vi.hoisted(() => ({ generations: [] as FixtureGeneration[] }));

type Scope = {
  userId: string;
  deletedAt: null;
  status: string;
  OR: Array<
    | { conversationId: string }
    | { messages: { some: { conversationId: string } } }
  >;
};

function inScope(generation: FixtureGeneration, scope: Scope) {
  return (
    generation.userId === scope.userId &&
    generation.deletedAt === scope.deletedAt &&
    generation.status === scope.status &&
    scope.OR.some((clause) =>
      "conversationId" in clause
        ? generation.conversationId === clause.conversationId
        : generation.messageConversationIds.includes(
            clause.messages.some.conversationId,
          ),
    )
  );
}

vi.mock("@/lib/db", () => ({
  db: {
    generation: {
      findFirst: vi.fn(async ({ where }: { where: Scope }) => {
        const match = fixtures.generations
          .filter(
            (generation) => inScope(generation, where) && generation.images.length,
          )
          .sort((a, b) => b.createdAt - a.createdAt)[0];
        return match ? { images: match.images.map((id) => ({ id })) } : null;
      }),
    },
    generatedImage: {
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: { id: { in: string[] }; generation: Scope };
        }) =>
          fixtures.generations
            .filter((generation) => inScope(generation, where.generation))
            .flatMap((generation) => generation.images)
            .filter((id) => where.id.in.includes(id))
            .map((id) => ({ id })),
      ),
    },
  },
}));
vi.mock("@/lib/generations", () => ({
  createGeneration: vi.fn(),
  GenerationRequestError: class extends Error {},
  generationRequestSchema: { parse: (value: unknown) => value },
}));

import {
  ChatImageToolError,
  mergeSourceImages,
  parseChatImageToolArgs,
  resolveConversationSourceImages,
} from "./chat-image-tool";

const parse = (value: unknown) => parseChatImageToolArgs(JSON.stringify(value));

const generation = (
  overrides: Partial<FixtureGeneration> & { id: string; images: string[] },
): FixtureGeneration => ({
  userId: "user-a",
  conversationId: null,
  messageConversationIds: ["conversation-a"],
  deletedAt: null,
  status: "SUCCEEDED",
  createdAt: 1,
  ...overrides,
});

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as ChatImageToolError;
  }
  throw new Error("expected a rejection");
}

describe("source_images arguments", () => {
  it("keeps ids and latest selectors, normalized and without duplicates", () => {
    expect(
      parse({
        prompt: "把背景换成夜景",
        source_images: [" img_1 ", "LATEST", "latest:1", "latest:3", "img_1"],
      }),
    ).toEqual({
      ok: true,
      value: {
        prompt: "把背景换成夜景",
        source_images: ["img_1", "latest", "latest:3"],
      },
      ignored: [],
    });
  });

  it("accepts a single string", () => {
    expect(parse({ prompt: "p", source_images: "latest" })).toMatchObject({
      ok: true,
      value: { source_images: ["latest"] },
    });
  });

  it("drops links, paths and other junk, and reports a fully unusable value", () => {
    expect(
      parse({
        prompt: "p",
        source_images: ["https://x.example/a.png", "../etc/passwd", "latest:0", 7],
      }),
    ).toEqual({ ok: true, value: { prompt: "p" }, ignored: ["source_images"] });
    expect(
      parse({ prompt: "p", source_images: ["https://x.example/a.png", "img-2"] }),
    ).toMatchObject({ ok: true, value: { source_images: ["img-2"] }, ignored: [] });
  });

  it("treats null and an empty list as not set", () => {
    expect(parse({ prompt: "p", source_images: null })).toEqual({
      ok: true,
      value: { prompt: "p" },
      ignored: [],
    });
    expect(parse({ prompt: "p", source_images: [] })).toEqual({
      ok: true,
      value: { prompt: "p" },
      ignored: [],
    });
  });
});

describe("resolveConversationSourceImages", () => {
  beforeEach(() => {
    fixtures.generations = [
      generation({ id: "g-old", createdAt: 1, images: ["old-1"] }),
      generation({
        id: "g-new",
        createdAt: 2,
        images: ["new-1", "new-2"],
      }),
      // Linked through Generation.conversationId instead of a message.
      generation({
        id: "g-direct",
        createdAt: 0,
        conversationId: "conversation-a",
        messageConversationIds: [],
        images: ["direct-1"],
      }),
      generation({ id: "g-other-user", userId: "user-b", createdAt: 9, images: ["foreign-1"] }),
      generation({
        id: "g-other-conversation",
        createdAt: 9,
        messageConversationIds: ["conversation-b"],
        images: ["elsewhere-1"],
      }),
      generation({
        id: "g-deleted",
        createdAt: 9,
        deletedAt: new Date(),
        images: ["deleted-1"],
      }),
      generation({ id: "g-failed", createdAt: 9, status: "FAILED", images: ["failed-1"] }),
    ];
  });

  it("resolves explicit ids of this conversation in the given order", async () => {
    await expect(
      resolveConversationSourceImages("user-a", "conversation-a", [
        "new-2",
        "old-1",
        "direct-1",
      ]),
    ).resolves.toEqual(["new-2", "old-1", "direct-1"]);
  });

  it("resolves latest and latest:N to the images of the most recent generation", async () => {
    await expect(
      resolveConversationSourceImages("user-a", "conversation-a", ["latest"]),
    ).resolves.toEqual(["new-1"]);
    await expect(
      resolveConversationSourceImages("user-a", "conversation-a", [
        "latest:2",
        "latest",
        "new-1",
      ]),
    ).resolves.toEqual(["new-2", "new-1"]);
  });

  it.each([
    ["another user's image", "foreign-1"],
    ["another conversation's image", "elsewhere-1"],
    ["a deleted generation's image", "deleted-1"],
    ["a failed generation's image", "failed-1"],
    ["an unknown id", "missing-1"],
  ])("refuses %s", async (_label, id) => {
    const error = await rejection(
      resolveConversationSourceImages("user-a", "conversation-a", [id]),
    );
    expect(error).toBeInstanceOf(ChatImageToolError);
    expect(error.code).toBe("SOURCE_IMAGE_NOT_FOUND");
    expect(error.message).toContain(id);
  });

  it("refuses latest:N past the most recent generation's images", async () => {
    const error = await rejection(
      resolveConversationSourceImages("user-a", "conversation-a", ["latest:3"]),
    );
    expect(error.code).toBe("SOURCE_IMAGE_NOT_FOUND");
  });

  it("refuses latest in a conversation without generated images", async () => {
    const error = await rejection(
      resolveConversationSourceImages("user-a", "conversation-empty", ["latest"]),
    );
    expect(error.code).toBe("SOURCE_IMAGE_NOT_FOUND");
  });

  it("refuses more than four selectors", async () => {
    const error = await rejection(
      resolveConversationSourceImages("user-a", "conversation-a", [
        "a",
        "b",
        "c",
        "d",
        "e",
      ]),
    );
    expect(error.code).toBe("TOO_MANY_SOURCE_IMAGES");
  });
});

describe("mergeSourceImages", () => {
  it("keeps this turn's references first and adds each earlier image once", () => {
    expect(
      mergeSourceImages(
        [
          { kind: "upload", key: "uploads/u.png" },
          { kind: "generated", id: "new-1" },
        ],
        ["new-1", "old-1"],
      ),
    ).toEqual([
      { kind: "upload", key: "uploads/u.png" },
      { kind: "generated", id: "new-1" },
      { kind: "generated", id: "old-1" },
    ]);
  });
});
