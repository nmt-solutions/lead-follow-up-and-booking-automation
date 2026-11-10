import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/public-site";
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/businesses",
        "/platform",
        "/onboarding",
        "/security",
        "/sign-in",
        "/start",
        "/invites",
        "/files/",
      ],
    },
    sitemap: `${siteOrigin}/sitemap.xml`,
  };
}
