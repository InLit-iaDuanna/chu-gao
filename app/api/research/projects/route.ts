import { z } from "zod";
import { ok } from "@/lib/api-response";
import {
  researchAdmin,
  researchBody,
  researchFailure,
} from "@/lib/research/http";
import {
  createResearchProject,
  listResearchProjects,
} from "@/lib/research/service";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const auth = await researchAdmin(request);
  if (auth.response) return auth.response;
  try {
    return ok(await listResearchProjects(auth.userId!));
  } catch (error) {
    return researchFailure(error);
  }
}
export async function POST(request: Request) {
  const auth = await researchAdmin(request);
  if (auth.response) return auth.response;
  try {
    const body = await researchBody(
      request,
      z.object({
        title: z.string().min(1).max(160),
        conversationId: z.string().max(100).optional(),
      }),
    );
    return ok(
      await createResearchProject(
        auth.userId!,
        body.title,
        body.conversationId,
      ),
    );
  } catch (error) {
    return researchFailure(error);
  }
}
