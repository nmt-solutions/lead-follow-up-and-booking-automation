import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Brand } from "./brand";
import { Button } from "./ui/button";

export function PublicFooter() {
  return (
    <footer className="border-t border-border">
      <div className="page-container flex flex-wrap items-center justify-between gap-4 py-6 text-xs leading-6 text-muted-foreground">
        <p>
          LeadRelay by{" "}
          <a
            className="hover:text-foreground"
            href="https://nmtsolutions.in"
            target="_blank"
            rel="noreferrer"
          >
            NMT Solutions OPC PVT LTD
          </a>
        </p>
        <nav
          aria-label="Footer"
          className="flex flex-wrap items-center gap-x-6 gap-y-2"
        >
          <Link href="/getting-started">Getting started</Link>
          <Link href="/privacy-policy">Privacy policy</Link>
          <Link href="/terms">Terms</Link>
          <a href="mailto:wafa.khan@nmtsolutions.in">Contact us</a>
        </nav>
      </div>
    </footer>
  );
}

export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:p-4"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-20 border-b border-border bg-card">
        <div className="page-container flex min-h-20 items-center justify-between gap-4">
          <Link href="/businesses" aria-label="LeadRelay home">
            <Brand />
          </Link>
          <nav
            aria-label="Main navigation"
            className="flex items-center gap-2 sm:gap-5"
          >
            <Link
              href="/getting-started"
              className="hidden text-sm font-medium text-muted-foreground hover:text-foreground sm:block"
            >
              Vendor guide
            </Link>
            <Button asChild>
              <Link href="/businesses">
                Open LeadRelay
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
