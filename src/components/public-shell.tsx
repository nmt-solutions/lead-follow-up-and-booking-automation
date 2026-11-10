import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Brand } from "./brand";
import { Button } from "./ui/button";
import { sellerPublicProfile } from "@/production/subscriptions";

export function PublicFooter() {
  const seller = sellerPublicProfile();
  return (
    <footer className="border-t border-border">
      <div className="page-container flex flex-wrap items-center justify-between gap-4 py-6 text-xs leading-6 text-muted-foreground">
        <p>
          Lead Relay by{" "}
          <a
            className="hover:text-foreground"
            href="https://nmtsolutions.in"
            target="_blank"
            rel="noreferrer"
          >
            NMT Solutions OPC PVT LTD
          </a>
        </p>
        {seller && (
          <address className="max-w-lg text-xs leading-6 not-italic">
            {seller.address} · {seller.phone} · CIN {seller.cin}
            {seller.gstStatus === "registered"
              ? ` · GSTIN ${seller.gstin}`
              : ""}
          </address>
        )}
        <nav
          aria-label="Footer"
          className="flex flex-wrap items-center gap-x-6 gap-y-2"
        >
          <Link href="/getting-started">Getting started</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/privacy-policy">Privacy policy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/cancellation-policy">Cancellation</Link>
          <Link href="/refund-policy">Refunds</Link>
          <Link href="/service-delivery">Service delivery</Link>
          <Link href="/contact">Contact us</Link>
        </nav>
      </div>
    </footer>
  );
}

export function PublicShell({
  children,
  marketing = false,
}: {
  children: React.ReactNode;
  marketing?: boolean;
}) {
  return (
    <div className="flex min-h-svh flex-col">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-lg bg-card p-3 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <header className="sticky top-3 z-20 mx-auto mt-3 w-[calc(100%_-_24px)] max-w-7xl sm:top-4 sm:mt-4 sm:w-[calc(100%_-_48px)]">
        <div className="glass-chrome flex min-h-18 items-center justify-between gap-4 rounded-[22px] px-4 py-3 sm:px-5">
          <Link href="/" aria-label="Lead Relay home">
            <Brand />
          </Link>
          <nav
            aria-label="Main navigation"
            className="flex items-center gap-2 sm:gap-5"
          >
            {marketing && (
              <>
                <a
                  href="#product"
                  className="hidden min-h-11 items-center font-display text-sm text-muted-foreground hover:text-foreground lg:inline-flex"
                >
                  Product
                </a>
                <a
                  href="#how-it-works"
                  className="hidden min-h-11 items-center font-display text-sm text-muted-foreground hover:text-foreground lg:inline-flex"
                >
                  How it works
                </a>
              </>
            )}
            <Link
              href="/pricing"
              className="hidden min-h-11 items-center text-sm font-medium text-muted-foreground hover:text-foreground sm:inline-flex"
            >
              Pricing
            </Link>
            <Link
              href="/getting-started"
              className="hidden text-sm font-medium text-muted-foreground hover:text-foreground sm:block"
            >
              Vendor guide
            </Link>
            {marketing && (
              <Link
                href="/sign-in"
                className="hidden min-h-11 items-center text-sm font-medium sm:inline-flex"
              >
                Sign in
              </Link>
            )}
            <Button asChild>
              <Link href={marketing ? "/sign-in?signup=1" : "/businesses"}>
                {marketing ? "Get started" : "Open Lead Relay"}
                <ArrowUpRight data-icon="inline-end" aria-hidden="true" />
              </Link>
            </Button>
          </nav>
        </div>
      </header>
      <main id="main-content" className="flex-1">
        {children}
      </main>
      <PublicFooter />
    </div>
  );
}
