import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getClientIp, isAdminIpAllowed, parseAdminIpAllowlist } from "@/lib/network";

const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://chinese-fonts-cdn.deno.dev; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' https: wss:; font-src 'self' data: https://fonts.gstatic.com https://chinese-fonts-cdn.deno.dev; object-src 'none'",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
} as const;

function withSecurityHeaders(response: NextResponse) {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }

  return response;
}

function isAdminPath(pathname: string): boolean {
  return pathname.startsWith("/admin") || pathname.startsWith("/api/admin/");
}

export function middleware(request: NextRequest) {
  if (
    isAdminPath(request.nextUrl.pathname) &&
    parseAdminIpAllowlist().length > 0 &&
    !isAdminIpAllowed(request.headers)
  ) {
    if (request.nextUrl.pathname.startsWith("/api/admin/")) {
      return withSecurityHeaders(
        NextResponse.json(
          {
            ok: false,
            error: {
              code: "FORBIDDEN",
              message: "当前 IP 不允许访问管理后台",
              details: {
                ip: getClientIp(request.headers) ?? "unknown",
              },
            },
          },
          { status: 403 },
        ),
      );
    }

    return withSecurityHeaders(
      new NextResponse("Forbidden", {
        status: 403,
        headers: { "content-type": "text/plain; charset=utf-8" },
      }),
    );
  }

  return withSecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"],
};
