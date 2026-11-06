import { ok } from "@/lib/api-response";
import {
  researchAdmin,
  researchBody,
  researchFailure,
} from "@/lib/research/http";
import { researchIntakeInputSchema } from "@/lib/research/types";
import {
  createResearchIntakeTurn,
  researchIntakeView,
} from "@/lib/research/intake";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const auth = await researchAdmin(request);
  if (auth.response) return auth.response;
  try {
    return ok(
      await researchIntakeView(
        auth.userId!,
        new URL(request.url).searchParams.get("projectId") || "",
      ),
    );
  } catch (error) {
    return researchFailure(error);
  }
}
export async function POST(request: Request) {
  const auth = await researchAdmin(request);
  if (auth.response) return auth.response;
  try {
    const input = await researchBody(request, researchIntakeInputSchema);
    const task = await createResearchIntakeTurn(auth.userId!, input);
    return ok({ taskId: task.id, projectId: task.projectId });
  } catch (error) {
    return researchFailure(error);
  }
}
