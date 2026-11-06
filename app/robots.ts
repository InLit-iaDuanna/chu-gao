import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "https://chugao.art";
  return {
    rules: [
      { userAgent: "*", allow: ["/", "/inspiration", "/u/"], disallow: ["/app/", "/admin/", "/api/"] },
    ],
    sitemap: `${origin.replace(/\/$/, "")}/sitemap.xml`,
  };
}
