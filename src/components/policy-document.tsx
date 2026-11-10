import Link from "next/link";
import { ArrowLeft, Mail } from "lucide-react";
import { PublicShell } from "./public-shell";
import { Button } from "./ui/button";
import { Separator } from "./ui/separator";

export type PolicySection = {
  id: string;
  title: string;
  paragraphs: string[];
  bullets?: string[];
};

export function PolicyDocument({
  title,
  summary,
  sections,
}: {
  title: string;
  summary: string;
  sections: PolicySection[];
}) {
  return (
    <PublicShell>
      <div className="page-container py-10 sm:py-16">
        <div className="mb-10 flex max-w-3xl flex-col gap-5">
          <Link
            href="/sign-in"
            className="inline-flex min-h-11 w-fit items-center gap-2 text-sm text-muted-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to Lead Relay
          </Link>
          <p className="text-sm text-muted-foreground">
            Last updated 10 November 2026
          </p>
          <h1 className="text-4xl font-medium tracking-[-0.045em] sm:text-5xl">
            {title}
          </h1>
          <p className="text-lg leading-8 text-muted-foreground">{summary}</p>
        </div>
        <Separator />
        <div className="grid gap-12 pt-10 lg:grid-cols-[14rem_minmax(0,1fr)]">
          <aside>
            <nav
              aria-label="On this page"
              className="flex flex-col gap-1 lg:sticky lg:top-28"
            >
              <p className="mb-3 text-sm font-semibold">On this page</p>
              {sections.map((section) => (
                <a
                  key={section.id}
                  href={`#${section.id}`}
                  className="rounded-md px-2 py-2 text-sm leading-6 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {section.title}
                </a>
              ))}
            </nav>
          </aside>
          <article className="flex max-w-3xl flex-col gap-10">
            {sections.map((section) => (
              <section
                id={section.id}
                key={section.id}
                className="legal-copy scroll-mt-28"
              >
                <h2>{section.title}</h2>
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
                {section.bullets && (
                  <ul>
                    {section.bullets.map((bullet) => (
                      <li key={bullet}>{bullet}</li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card p-6">
              <div className="flex flex-col gap-1">
                <h2 className="font-semibold">Questions about this policy?</h2>
                <p className="text-sm text-muted-foreground">
                  Contact NMT Solutions with your request.
                </p>
              </div>
              <Button asChild variant="outline">
                <a href="mailto:wafa.khan@nmtsolutions.in">
                  <Mail data-icon="inline-start" aria-hidden="true" />
                  Email us
                </a>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              <Link
                className="underline underline-offset-4"
                href={title === "Privacy policy" ? "/terms" : "/privacy-policy"}
              >
                {title === "Privacy policy"
                  ? "Read our terms and conditions"
                  : "Read our privacy policy"}
              </Link>
            </p>
          </article>
        </div>
      </div>
    </PublicShell>
  );
}
