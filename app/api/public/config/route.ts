import { fail, ok } from "@/lib/api-response";
import { listActiveAnnouncements } from "@/lib/announcements";
import {
  getPublicRuntimeConfig,
  SystemConfigUnavailableError,
} from "@/lib/system-config";

export async function GET() {
  try {
    const [config, announcements] = await Promise.all([
      getPublicRuntimeConfig(),
      listActiveAnnouncements(),
    ]);

    return ok({ ...config, announcements });
  } catch (error) {
    if (error instanceof SystemConfigUnavailableError) {
      return fail("CONFIG_UNAVAILABLE", "系统配置暂不可用", { status: 503 });
    }

    throw error;
  }
}
