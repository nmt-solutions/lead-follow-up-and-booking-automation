import Link from "next/link";
import { Mail, ArrowUpRight } from "lucide-react";
import { PublicShell } from "@/components/public-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { publicMetadata } from "@/lib/public-site";
import { sellerPublicProfile } from "@/production/subscriptions";
export const metadata = publicMetadata(
  "Contact and support",
  "Contact NMT Solutions for Lead Relay support, payments, privacy and account help.",
  "/contact",
);
export default function ContactPage() {
  const seller = sellerPublicProfile();
  return (
    <PublicShell marketing>
      <div className="page-container flex max-w-4xl flex-col gap-10 py-16 sm:py-24">
        <header className="flex flex-col gap-4">
          <p className="text-sm font-medium text-primary">
            We&apos;re here to help
          </p>
          <h1 className="font-display text-4xl sm:text-5xl">
            Contact Lead Relay
          </h1>
          <p className="text-lg text-muted-foreground">
            Account, billing, privacy or setup questions? Tell us what happened
            and which business needs help.
          </p>
        </header>
        <Card>
          <CardContent className="flex flex-col gap-5 p-6 sm:p-8">
            <h2 className="font-display text-xl">
              {seller?.legalName ?? "NMT Solutions OPC PVT LTD"}
            </h2>
            {seller ? (
              <>
                <address className="text-sm leading-7 not-italic">
                  {seller.address}
                  <br />
                  {seller.phone}
                </address>
                <p className="text-sm text-muted-foreground">
                  CIN {seller.cin}
                  {seller.gstStatus === "registered"
                    ? ` · GSTIN ${seller.gstin}`
                    : ""}
                </p>
                <p className="text-sm leading-7">
                  Grievance contact: {seller.grievanceOfficer} ·{" "}
                  <a
                    className="text-primary underline"
                    href={`mailto:${seller.grievanceEmail}`}
                  >
                    {seller.grievanceEmail}
                  </a>
                </p>
              </>
            ) : (
              <p className="text-sm leading-7 text-muted-foreground">
                India · Lead Relay service operator
              </p>
            )}
            <Button asChild className="w-fit">
              <a
                href={`mailto:${seller?.supportEmail ?? "wafa.khan@nmtsolutions.in"}`}
              >
                <Mail className="size-4" aria-hidden="true" />
                {seller?.supportEmail ?? "wafa.khan@nmtsolutions.in"}
              </a>
            </Button>
            <p className="text-sm leading-7 text-muted-foreground">
              Include your business name and the relevant payment or request
              reference. Never include passwords, authenticator codes, recovery
              codes, API keys or full card details. For privacy requests, use
              the subject “Lead Relay privacy request”. We aim to acknowledge
              requests within 48 hours and resolve grievances within one month.
            </p>
          </CardContent>
        </Card>
        <div className="flex flex-wrap gap-6 text-sm">
          {[
            ["/getting-started", "Getting started"],
            ["/cancellation-policy", "Cancel a subscription"],
            ["/refund-policy", "Refunds"],
            ["/service-delivery", "Service delivery"],
          ].map(([href, label]) => (
            <Link
              className="inline-flex min-h-11 items-center gap-2 text-primary"
              href={href}
              key={href}
            >
              {label}
              <ArrowUpRight className="size-4" aria-hidden="true" />
            </Link>
          ))}
        </div>
      </div>
    </PublicShell>
  );
}
