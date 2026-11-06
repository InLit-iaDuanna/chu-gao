import { ok } from "@/lib/api-response";
import { chatRequestUser, chatTurnFailure } from "@/lib/chat-turn-http";
import { getChatTurn } from "@/lib/chat-turns";

export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await chatRequestUser(request);
  if (auth.response) return auth.response;
  try {
    return ok(await getChatTurn(auth.userId!, (await context.params).id), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return chatTurnFailure(error);
  }
}
