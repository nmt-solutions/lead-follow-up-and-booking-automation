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
  searchParams: Promise<{ created?: string; joined?: string }>;
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
  const canManageAi = await (async () => {
    try {
      await (await getServices()).ai.workspace(await headers(), businessId);
      return true;
    } catch {
      return false;
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
          {access.role === "salesperson"
            ? "Your Business profile. Ask an Owner or Admin to update these details."
            : "Keep the details of what you offer up to date."}
        </p>
      </div>
      <Link
        href={`/businesses/${businessId}/configuration`}
        className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4"
      >
        Offerings, buyers and geography
      </Link>
      <Link
        href={`/businesses/${businessId}/operations`}
        className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4"
      >
        Action history and recovery
      </Link>
      {access.role !== "salesperson" && (
        <Link
          href={`/businesses/${businessId}/whatsapp`}
          className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4"
        >
          WhatsApp identity and Meta onboarding
        </Link>
      )}
      {access.role !== "salesperson" && (
        <Link
          href={`/businesses/${businessId}/billing`}
          className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4"
        >
          Billing profile and evidence
        </Link>
      )}
      {access.role !== "salesperson" && (
        <Link
          href={`/businesses/${businessId}/subscription-quotes`}
          className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4"
        >
          Subscription quotes
        </Link>
      )}
      {access.role !== "salesperson" && (
        <Link
          href={`/businesses/${businessId}/subscription-payments`}
          className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4"
        >
          Subscription payments and paid access
        </Link>
      )}
      {access.role !== "salesperson" && (
        <Link
          href={`/businesses/${businessId}/seller-documents`}
          className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4"
        >
          Invoices and credit notes
        </Link>
      )}
      {access.role !== "salesperson" && (
        <Link
          href={`/businesses/${businessId}/calendar`}
          className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4"
        >
          Booking calendar connection
        </Link>
      )}
      {access.role !== "salesperson" && (
        <Link
          href={`/businesses/${businessId}/team`}
          className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4"
        >
          Manage team access
        </Link>
      )}
      <Link
        href={`/businesses/${businessId}/mailboxes`}
        className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4"
      >
        Mailbox processing and optional history
      </Link>
      <Link
        href={`/businesses/${businessId}/knowledge`}
        className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4"
      >
        Approved answers and qualification
      </Link>
      <Link
        href={`/businesses/${businessId}/inbox`}
        className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4"
      >
        Shared sales inbox
      </Link>
      <Link
        href={`/businesses/${businessId}/campaigns`}
        className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4"
      >
        First-outreach campaigns and Owner approvals
      </Link>
      <Link
        href={`/businesses/${businessId}/senders`}
        className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4"
      >
        Sending identities and reply readiness
      </Link>
      <Link
        href={`/businesses/${businessId}/email-eligibility`}
        className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4"
      >
        Email eligibility and opt-outs
      </Link>
      {canManageAi && (
        <Link
          href={`/businesses/${businessId}/ai`}
          className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4"
        >
          AI profiles and previews
        </Link>
      )}
      <Link
        href={`/businesses/${businessId}/discovery`}
        className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4"
      >
        Prospect discovery and sourced potential buyers
      </Link>
      <Link
        href={`/businesses/${businessId}/commercial-authority`}
        className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4"
      >
        Commercial authority and approval limits
      </Link>
      <Link
        href={`/businesses/${businessId}/files`}
        className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4"
      >
        Private Business files
      </Link>
      <Link
        className="inline-flex min-h-11 items-center text-primary underline"
        href={`/businesses/${businessId}/data`}
      >
        Data export and offboarding
      </Link>
      {(await searchParams).joined === "1" && (
        <p
          role="status"
          className="rounded-lg border border-border bg-card p-4 text-sm"
        >
          Invitation accepted. You now have access to this Business.
        </p>
      )}
      {(await searchParams).created === "1" && (
        <p
          role="status"
          className="rounded-lg border border-border bg-card p-4 text-sm"
        >
          Business created. Your profile is saved.
        </p>
      )}
      {access.role === "salesperson" ? (
        <dl className="space-y-6 rounded-2xl border border-border bg-card p-6 sm:p-8">
          {[
            { label: "Offering", value: profile.offering },
            { label: "Home market", value: profile.homeMarket || "Not set" },
            { label: "Website", value: profile.website || "Not set" },
          ].map((field) => (
            <div key={field.label}>
              <dt className="text-sm font-medium text-muted-foreground">
                {field.label}
              </dt>
              <dd className="mt-2 whitespace-pre-wrap wrap-anywhere">
                {field.value}
              </dd>
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
