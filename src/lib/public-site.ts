import type { Metadata } from "next";

export const siteOrigin = "https://leadrelay.nmtsolutions.in";
export const publicPaths = [
  "/",
  "/pricing",
  "/getting-started",
  "/contact",
  "/privacy-policy",
  "/terms",
  "/refund-policy",
  "/cancellation-policy",
  "/service-delivery",
] as const;
export function publicMetadata(
  title: string,
  description: string,
  path: string,
): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    robots: { index: true, follow: true },
    openGraph: {
      title: `${title} · Lead Relay`,
      description,
      url: `${siteOrigin}${path}`,
      siteName: "Lead Relay",
      type: "website",
    },
    twitter: { card: "summary", title: `${title} · Lead Relay`, description },
  };
}
