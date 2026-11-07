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
  const operationsLink = await (async () => {
    try {
      await (
        await getServices()
      ).team.requirePlatformCapability(await headers(), "operations.manage");
      return (
        <Link
          href="/platform/operations"
          className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
        >
          Inspect platform operations
        </Link>
      );
    } catch {
      return null;
    }
  })();
  const recoveryLink = await (async () => {
    try {
      await (
        await getServices()
      ).team.requirePlatformCapability(await headers(), "recovery.manage");
      return (
        <Link
          href="/platform/recovery"
          className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
        >
          Inspect infrastructure recovery
        </Link>
      );
    } catch {
      return null;
    }
  })();
  const businesses = await (async () => {
    try {
      return await (
        await getServices()
      ).application.listBusinesses(await headers());
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  const canReviewBilling = await (async () => {
    try {
      await (
        await getServices()
      ).team.requirePlatformCapability(await headers(), "tax.manage");
      return true;
    } catch {
      return false;
    }
  })();
  const billingReviewLink = canReviewBilling ? (
    <Link
      href="/platform/billing"
      className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
    >
      Review billing evidence
    </Link>
  ) : null;
  const canConfigurePricing = await (async () => {
    try {
      await (
        await getServices()
      ).team.requirePlatformCapability(await headers(), "pricing.manage");
      return true;
    } catch {
      return false;
    }
  })();
  const pricingLink = canConfigurePricing ? (
    <Link
      href="/platform/pricing"
      className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
    >
      Configure subscription pricing
    </Link>
  ) : null;
  const canReviewWhatsApp = await (async () => {
    try {
      await (
        await getServices()
      ).team.requirePlatformCapability(await headers(), "whatsapp.review");
      return true;
    } catch {
      return false;
    }
  })();
  const whatsAppReviewLink = canReviewWhatsApp ? (
    <Link
      href="/platform/whatsapp"
      className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
    >
      Review WhatsApp evidence
    </Link>
  ) : null;
  const canReconcile = await (async () => {
    try {
      await (
        await getServices()
      ).team.requirePlatformCapability(
        await headers(),
        "reconciliation.manage",
      );
      return true;
    } catch {
      return false;
    }
  })();
  const paymentsLink = canReconcile ? (
    <Link
      href="/platform/subscription-payments"
      className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
    >
      Review subscription payments
    </Link>
  ) : null;
  const senderHealthLink = await (async () => {
    try {
      await (
        await getServices()
      ).team.requirePlatformCapability(await headers(), "sender-health.manage");
      return (
        <Link
          href="/platform/sender-health"
          className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
        >
          Review sender health alerts
        </Link>
      );
    } catch {
      return null;
    }
  })();
  const costsLink = await (async () => {
    try {
      await (
        await getServices()
      ).team.requirePlatformCapability(await headers(), "costs.manage");
      return (
        <Link
          href="/platform/costs"
          className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
        >
          Review operator costs and budgets
        </Link>
      );
    } catch {
      return null;
    }
  })();
  const refundsLink = await (async () => {
    try {
      await (
        await getServices()
      ).team.requirePlatformCapability(await headers(), "refunds.manage");
      return (
        <Link
          href="/platform/financial-adjustments"
          className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
        >
          Review refunds and disputes
        </Link>
      );
    } catch {
      return null;
    }
  })();
  const documentsLink = await (async () => {
    try {
      await (
        await getServices()
      ).team.requirePlatformCapability(await headers(), "documents.manage");
      return (
        <Link
          href="/platform/seller-documents"
          className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
        >
          Review seller documents
        </Link>
      );
    } catch {
      return null;
    }
  })();
  const notificationsLink = await (async () => {
    try {
      await (
        await getServices()
      ).team.requirePlatformCapability(await headers(), "notifications.manage");
      return (
        <Link
          href="/platform/notifications"
          className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
        >
          Review transactional notification delivery
        </Link>
      );
    } catch {
      return null;
    }
  })();
  if (!businesses.length)
    return (
      <div className="mx-auto max-w-2xl space-y-8">
        {billingReviewLink}
        {pricingLink}
        {refundsLink}
        {paymentsLink}
        {documentsLink}
        {costsLink}
        {notificationsLink}
        {whatsAppReviewLink}
        {senderHealthLink}
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
        {operationsLink}
        {recoveryLink}
        <ProfileForm />
      </div>
    );
  return (
    <div className="space-y-8">
      {operationsLink}
      {recoveryLink}
      {billingReviewLink}
      {pricingLink}
      {refundsLink}
      {paymentsLink}
      {documentsLink}
      {costsLink}
      {notificationsLink}
      {senderHealthLink}
      {whatsAppReviewLink}
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
