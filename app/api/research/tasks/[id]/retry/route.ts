import { z } from "zod";
import { ok } from "@/lib/api-response";
import {
  researchAdmin,
  researchBody,
  researchFailure,
} from "@/lib/research/http";
import { retryResearchStage } from "@/lib/research/service";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await researchAdmin(request);
  if (auth.response) return auth.response;
  try {
    const input = await researchBody(
      request,
      z.object({
        stageId: z.string().max(100),
        clientRequestId: z.uuid(),
        renewTime: z.boolean().default(false),
      }),
    );
    return ok(
      await retryResearchStage(
        auth.userId!,
        (await context.params).id,
        input.stageId,
        input.clientRequestId,
        { renewTime: input.renewTime },
      ),
    );
  } catch (error) {
    return researchFailure(error);
  }
}
