import Link from "next/link";
import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { ProfileForm } from "@/components/profile-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit profile" };
export default async function BusinessPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const { businessId } = await params;
  const profile = await (async () => {
    try {
      return await (
        await getServices()
      ).application.getProfile(await headers(), businessId);
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <Link
          href="/businesses"
          className="mb-5 inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4"
        >
          Back to your Businesses
        </Link>
        <p className="mb-3 text-sm font-medium text-primary">
          Business profile
        </p>
        <h1 className="text-3xl font-semibold tracking-tight wrap-anywhere sm:text-4xl">
          {profile.name}
        </h1>
        <p className="mt-3 leading-relaxed text-muted-foreground">
          Keep the details of what you offer up to date.
        </p>
      </div>
      {(await searchParams).created === "1" && (
        <p
          role="status"
          className="rounded-lg border border-border bg-card p-4 text-sm"
        >
          Business created. Your profile is saved.
        </p>
      )}
      <ProfileForm
        key={profile.id}
        businessId={profile.id}
        initialProfile={{
          name: profile.name,
          offering: profile.offering,
          homeMarket: profile.homeMarket,
          website: profile.website,
        }}
      />
    </div>
  );
}
