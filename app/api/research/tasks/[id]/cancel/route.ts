import { ok } from "@/lib/api-response";
import { researchAdmin, researchFailure } from "@/lib/research/http";
import { cancelResearchTask } from "@/lib/research/service";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await researchAdmin(request);
  if (auth.response) return auth.response;
  try {
    return ok(
      await cancelResearchTask(auth.userId!, (await context.params).id),
    );
  } catch (error) {
    return researchFailure(error);
  }
}
