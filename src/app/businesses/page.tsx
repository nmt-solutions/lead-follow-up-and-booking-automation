import Link from "next/link";
import { headers } from "next/headers";
import { ArrowUpRight, Plus } from "lucide-react";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { ProfileForm } from "@/components/profile-form";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your Businesses" };

export default async function BusinessesPage() {
  const businesses = await (async () => {
    try {
      return await (
        await getServices()
      ).application.listBusinesses(await headers());
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  if (!businesses.length)
    return (
      <div className="mx-auto max-w-2xl space-y-8">
        <div>
          <p className="mb-3 text-sm font-medium text-primary">
            Getting started
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Start with your Business.
          </h1>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">
            Add your name and what you offer. You can edit these details
            whenever they change.
          </p>
        </div>
        <ProfileForm />
      </div>
    );
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Your Businesses
          </h1>
          <p className="mt-3 text-muted-foreground">
            Choose a Business to view and edit its profile.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/businesses/new">
            <Plus aria-hidden="true" />
            Add a Business
          </Link>
        </Button>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2">
        {businesses.map((business) => (
          <li key={business.id}>
            <Link
              href={`/businesses/${business.id}`}
              className="group flex h-full flex-col gap-4 rounded-xl border border-border bg-card p-6 transition-colors hover:border-input motion-reduce:transition-none"
            >
              <div className="flex items-start justify-between gap-4">
                <h2 className="min-w-0 text-xl font-semibold wrap-anywhere">
                  {business.name}
                </h2>
                <ArrowUpRight
                  aria-hidden="true"
                  className="size-5 shrink-0 text-primary"
                />
              </div>
              <p className="line-clamp-3 leading-relaxed wrap-anywhere text-muted-foreground">
                {business.offering}
              </p>
              {business.homeMarket && (
                <p className="mt-auto text-sm wrap-anywhere text-muted-foreground">
                  {business.homeMarket}
                </p>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
