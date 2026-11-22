import { ok } from "@/lib/api-response";
import { readAndroidAppVersion } from "@/lib/app-version";

/**
 * 公开的安卓客户端版本信息。
 * 未配置（或配置不可信）时返回 latestVersionCode: 0 / apkUrl: null，
 * 客户端据此显示“已是最新版本”或“即将上线”。
 */
export function GET() {
  return ok(readAndroidAppVersion(), {
    headers: {
      // 允许 CDN / 客户端缓存 60 秒，发版后一分钟内生效。
      "Cache-Control": "public, max-age=60",
    },
  });
}
