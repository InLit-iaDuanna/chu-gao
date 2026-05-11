import { fail, ok } from "@/lib/api-response";
import {
  getPublicRuntimeConfig,
  SystemConfigUnavailableError,
} from "@/lib/system-config";

export async function GET() {
  try {
    return ok(await getPublicRuntimeConfig());
  } catch (error) {
    if (error instanceof SystemConfigUnavailableError) {
      return fail("CONFIG_UNAVAILABLE", "系统配置暂不可用", { status: 503 });
    }

    throw error;
  }
}
