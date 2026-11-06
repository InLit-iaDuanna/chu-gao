import { ok } from "@/lib/api-response";
import {
  researchAdmin,
  researchBody,
  researchFailure,
} from "@/lib/research/http";
import { researchTaskInputSchema } from "@/lib/research/types";
import { createResearchTask } from "@/lib/research/service";
export async function POST(request: Request) {
  const auth = await researchAdmin(request);
  if (auth.response) return auth.response;
  try {
    return ok(
      await createResearchTask(
        auth.userId!,
        await researchBody(request, researchTaskInputSchema),
      ),
    );
  } catch (error) {
    return researchFailure(error);
  }
}
