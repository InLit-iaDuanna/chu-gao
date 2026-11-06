import { ok } from "@/lib/api-response";
import {
  researchAdmin,
  researchBody,
  researchFailure,
} from "@/lib/research/http";
import { researchPlanInputSchema } from "@/lib/research/types";
import { getResearchConfig, makeResearchPlan } from "@/lib/research/config";
export async function POST(request: Request) {
  const auth = await researchAdmin(request);
  if (auth.response) return auth.response;
  try {
    const input = await researchBody(request, researchPlanInputSchema);
    const config = await getResearchConfig();
    return ok(makeResearchPlan(input, config.limits[input.scope]));
  } catch (error) {
    return researchFailure(error);
  }
}
