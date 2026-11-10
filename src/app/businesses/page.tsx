import { Alert, AlertDescription } from "@/components/ui/alert";
import { PageHeader } from "@/components/page-header";
import Link from "next/link";
import { headers } from "next/headers";
import { ArrowUpRight, Plus } from "lucide-react";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { OnboardingForm } from "@/components/onboarding-form";
import { Button } from "@/components/ui/button";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your businesses" };

export default async function BusinessesPage({
  searchParams,
}: {
  searchParams: Promise<{ connection?: string }>;
}) {
  const query = await searchParams;
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
    <div className="flex flex-wrap gap-4">
      <Link
        href="/platform/subscription-payments"
        className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
      >
        Review subscription payments
      </Link>
      <Link
        href="/platform/reconciliation"
        className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
      >
        Reconcile subscription money
      </Link>
    </div>
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
  const capacityLink = await (async () => {
    try {
      await (
        await getServices()
      ).discoveryCapacity.configuration(await headers());
      return (
        <Link
          href="/platform/discovery-capacity"
          className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
        >
          Configure discovery capacity
        </Link>
      );
    } catch {
      return null;
    }
  })();
  const hasPlatformAccess = Boolean(
    operationsLink ||
    recoveryLink ||
    billingReviewLink ||
    pricingLink ||
    capacityLink ||
    refundsLink ||
    paymentsLink ||
    documentsLink ||
    costsLink ||
    notificationsLink ||
    senderHealthLink ||
    whatsAppReviewLink,
  );
  if (!businesses.length)
    return (
      <div className="app-page">
        <OnboardingForm />
        {hasPlatformAccess && (
          <details className="rounded-xl border border-border bg-card p-5">
            <summary className="cursor-pointer text-sm font-medium">
              Platform administration
            </summary>
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
              {operationsLink}
              {recoveryLink}
              {billingReviewLink}
              {pricingLink}
              {capacityLink}
              {refundsLink}
              {paymentsLink}
              {documentsLink}
              {costsLink}
              {notificationsLink}
              {senderHealthLink}
              {whatsAppReviewLink}
            </div>
          </details>
        )}
      </div>
    );
  return (
    <div className="flex flex-col gap-8">
      {query.connection === "expired" && (
        <Alert>
          <AlertDescription>
            Your connection session expired. Open your business and try
            connecting again.
          </AlertDescription>
        </Alert>
      )}
      <PageHeader
        title="Your businesses"
        description="Choose the business you want to work with. Each business has separate records and team access."
        actions={
          <Button asChild>
            <Link href="/businesses/new">
              <Plus data-icon="inline-start" aria-hidden="true" />
              Add business
            </Link>
          </Button>
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>Business directory</CardTitle>
          <CardDescription>
            {businesses.length}{" "}
            {businesses.length === 1 ? "business" : "businesses"} available to
            your account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Business</TableHead>
                <TableHead className="hidden md:table-cell">
                  Search area
                </TableHead>
                <TableHead>Setup</TableHead>
                <TableHead className="text-right">Open</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {businesses.map((business) => (
                <TableRow key={business.id}>
                  <TableCell>
                    <Link
                      href={`/businesses/${business.id}`}
                      className="flex min-h-18 items-center gap-3"
                    >
                      <Avatar className="size-10 rounded-xl">
                        <AvatarFallback className="rounded-xl">
                          {business.name.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="flex max-w-sm flex-col gap-1">
                        <span className="font-semibold">{business.name}</span>
                        <span className="line-clamp-1 text-xs text-muted-foreground">
                          {business.offering}
                        </span>
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">
                    {business.homeMarket || "Not set"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        business.configuration?.homeMarketConfirmedAt &&
                        business.configuration?.buyersReviewedAt
                          ? "success"
                          : "default"
                      }
                    >
                      {business.configuration?.homeMarketConfirmedAt &&
                      business.configuration?.buyersReviewedAt
                        ? "Configured"
                        : "In progress"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="ghost" size="icon">
                      <Link
                        href={`/businesses/${business.id}`}
                        aria-label={`Open ${business.name}`}
                      >
                        <ArrowUpRight aria-hidden="true" />
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {hasPlatformAccess && (
        <details className="rounded-xl border border-border bg-card p-5">
          <summary className="cursor-pointer text-sm font-medium">
            Platform administration
          </summary>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
            {operationsLink}
            {recoveryLink}
            {billingReviewLink}
            {pricingLink}
            {capacityLink}
            {refundsLink}
            {paymentsLink}
            {documentsLink}
            {costsLink}
            {notificationsLink}
            {senderHealthLink}
            {whatsAppReviewLink}
          </div>
        </details>
      )}
    </div>
  );
}
