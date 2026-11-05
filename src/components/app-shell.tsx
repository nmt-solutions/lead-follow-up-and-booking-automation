"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, ShieldCheck } from "lucide-react";
import { SignOut } from "./sign-out";
import { cn } from "@/lib/utils";

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <>
      <a
        href="#main-content"
        className="sr-only z-50 rounded-lg bg-card p-3 focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <header className="top-0 z-30 px-3 pt-3 sm:sticky sm:px-5 sm:pt-4">
        <div className="glass-chrome mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-2xl px-4 py-2 sm:px-6 sm:py-3">
          <Link href="/businesses" className="flex min-h-11 items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Building2 className="size-5" aria-hidden="true" />
            </span>
            <span className="text-sm font-semibold leading-tight">
              Business operations
              <span className="mt-1 block text-xs font-normal text-muted-foreground">
                Your Business. Your control.
              </span>
            </span>
          </Link>
          <nav
            aria-label="Main navigation"
            className="flex flex-wrap items-center gap-1 sm:gap-2"
          >
            {[
              { href: "/businesses", title: "Businesses", icon: Building2 },
              { href: "/security", title: "Security", icon: ShieldCheck },
            ].map((item) => {
              const current = path.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors hover:bg-muted motion-reduce:transition-none",
                    current
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  <item.icon
                    className="hidden size-4 sm:block"
                    aria-hidden="true"
                  />
                  {item.title}
                </Link>
              );
            })}
            <span
              className="hidden h-5 border-l border-border sm:block"
              aria-hidden="true"
            />
            <SignOut />
          </nav>
        </div>
      </header>
      <main id="main-content" className="page-container py-8 sm:py-12">
        {children}
      </main>
    </>
  );
}
