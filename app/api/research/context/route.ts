import { db } from "@/lib/db";
import { ok } from "@/lib/api-response";
import { researchAdmin, researchFailure } from "@/lib/research/http";
import { ResearchError } from "@/lib/research/errors";
export async function GET(request: Request) {
  const auth = await researchAdmin(request);
  if (auth.response) return auth.response;
  try {
    const id = new URL(request.url).searchParams.get("conversationId");
    const conversation = id
      ? await db.conversation.findFirst({
          where: { id, userId: auth.userId! },
          select: {
            title: true,
            messages: {
              orderBy: { createdAt: "desc" },
              take: 30,
              select: { id: true, role: true, content: true },
            },
          },
        })
      : null;
    if (!conversation) throw new ResearchError("NOT_FOUND", "对话不存在", 404);
    return ok({
      title: conversation.title,
      messages: conversation.messages.reverse(),
    });
  } catch (error) {
    return researchFailure(error);
  }
}
