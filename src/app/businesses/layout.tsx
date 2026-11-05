import Link from "next/link";
import { Building2 } from "lucide-react";
import { SignOut } from "@/components/sign-out";

export default function BusinessLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <a
        href="#main-content"
        className="sr-only z-10 rounded-lg bg-card p-3 focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <header className="border-b border-border bg-card">
        <nav
          aria-label="Main navigation"
          className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-5 py-3 sm:px-8"
        >
          <Link
            href="/businesses"
            className="flex min-h-11 items-center gap-3 text-sm font-semibold"
          >
            <Building2 className="size-5 text-primary" aria-hidden="true" />
            Your Businesses
          </Link>
          <SignOut />
        </nav>
      </header>
      <main
        id="main-content"
        className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-14"
      >
        {children}
      </main>
    </>
  );
}
