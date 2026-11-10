import { PageHeader } from "@/components/page-header";
import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { ProfileForm } from "@/components/profile-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit profile" };
export default async function BusinessPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
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
  return (
    <div className="app-page">
      <PageHeader
        title={<>Business profile</>}
        description={<>Update your name, website, and products or services.</>}
      ></PageHeader>
      {access.role === "salesperson" ? (
        <dl className="flex flex-col gap-6 rounded-2xl border border-border bg-card p-6">
          {[
            { label: "Business name", value: profile.name },
            { label: "Products or services", value: profile.offering },
            { label: "Search area", value: profile.homeMarket || "Not set" },
            { label: "Website", value: profile.website || "Not set" },
          ].map((field) => (
            <div key={field.label}>
              <dt className="text-sm text-muted-foreground">{field.label}</dt>
              <dd className="mt-2 whitespace-pre-wrap">{field.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
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
      )}
    </div>
  );
}
