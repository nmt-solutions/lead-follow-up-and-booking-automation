import Link from "next/link";
import { headers } from "next/headers";
import { ArrowUpRight } from "lucide-react";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { businessSections } from "@/content/business-sections";
import { BusinessPageHeader } from "@/components/business-page-header";

export const dynamic = "force-dynamic";
export const metadata = { title: "Business settings" };

export default async function BusinessSettings({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  const access = await (async () => {
    try {
      return await (
        await getServices()
      ).team.requireBusinessCapability(
        await headers(),
        businessId,
        "profile.read",
      );
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  const canManage = access.role === "owner" || access.role === "admin";
  const entries = Object.entries(businessSections).filter(
    ([key, entry]) =>
      key !== "settings" &&
      entry.group !== "Sales" &&
      (!("manage" in entry) || canManage),
  );
  return (
    <div className="app-page">
      <BusinessPageHeader section="settings" />
      {[
        "Business",
        "Connections",
        "Email and approvals",
        "Billing",
        "Privacy and support",
      ].map((group) => {
        const items = entries.filter(([, entry]) => entry.group === group);
        if (!items.length) return null;
        return (
          <section
            key={group}
            className="flex flex-col gap-4"
            aria-label={group}
          >
            <h2 className="text-lg font-medium">{group}</h2>
            <div className="grid gap-3 md:grid-cols-2">
              {items.map(([key, entry]) => (
                <Link
                  key={key}
                  href={`/businesses/${businessId}/${key}`}
                  className="group flex items-start gap-4 rounded-2xl border border-border bg-card p-5 transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring motion-reduce:transition-none"
                >
                  <entry.icon
                    className="mt-1 size-5 shrink-0 text-primary"
                    aria-hidden="true"
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <span className="font-medium">{entry.title}</span>
                    <span className="text-sm leading-6 text-muted-foreground">
                      {entry.description}
                    </span>
                  </span>
                  <ArrowUpRight
                    className="mt-1 size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
