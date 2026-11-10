import type { MetadataRoute } from "next";
import { publicPaths, siteOrigin } from "@/lib/public-site";
export default function sitemap(): MetadataRoute.Sitemap {
  return publicPaths.map((path) => ({
    url: `${siteOrigin}${path === "/" ? "" : path}`,
    changeFrequency: path === "/pricing" ? "monthly" : "yearly",
    priority: path === "/" ? 1 : path === "/pricing" ? 0.9 : 0.5,
  }));
}
