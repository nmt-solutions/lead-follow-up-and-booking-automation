import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { LockKeyhole, ArrowUpRight } from "lucide-react";
import { Brand } from "@/components/brand";
import { WorkflowPreview } from "@/components/workflow-preview";
import { PublicFooter } from "@/components/public-shell";
import { getServices } from "@/server/services";
import { SignInForm } from "@/components/sign-in-form";

import { Alert, AlertDescription } from "@/components/ui/alert";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  let available = true;
  let signedIn = false;
  try {
    signedIn = Boolean(
      await (
        await getServices()
      ).auth.api.getSession({ headers: await headers() }),
    );
  } catch {
    available = false;
  }
  if (signedIn) redirect("/security");
  return (
    <div className="flex min-h-svh flex-col bg-card">
      <main className="grid flex-1 lg:grid-cols-2">
        <section className="hidden flex-col justify-center gap-8 border-r border-border bg-brand-paper p-10 lg:flex xl:px-16">
          <div className="mx-auto flex w-full max-w-xl flex-col gap-8">
            <Link
              href="https://nmtsolutions.in"
              target="_blank"
              rel="noreferrer"
              className="w-fit"
            >
              <Brand />
            </Link>
            <div className="flex flex-col gap-4">
              <h2 className="font-display text-[clamp(2.5rem,4vw,3.75rem)] leading-[1.08] font-medium tracking-[-0.045em]">
                The next conversation starts here.
              </h2>
              <p className="max-w-lg text-base leading-7 text-muted-foreground">
                Find potential buyers, prepare your outreach, and follow up with
                your team in one place.
              </p>
            </div>
            <WorkflowPreview />
          </div>
        </section>
        <section className="flex flex-col justify-center px-6 py-12 sm:px-10 lg:px-14">
          <div className="mx-auto flex w-full max-w-md flex-col gap-9">
            <div className="lg:hidden">
              <Brand />
            </div>
            <div className="flex flex-col gap-3">
              <p className="text-sm font-medium text-primary">
                Welcome to Lead Relay
              </p>
              <h1
                id="sign-in-title"
                className="font-display text-4xl leading-tight font-medium tracking-[-0.045em]"
              >
                Let&apos;s get to work.
              </h1>
              <p className="text-sm leading-7 text-muted-foreground">
                Sign in to your account or create one to get started.
              </p>
            </div>
            {available ? (
              <SignInForm linkFailed={Boolean((await searchParams).error)} />
            ) : (
              <Alert>
                <AlertDescription>
                  Sign-in is temporarily unavailable. Please try again later.
                </AlertDescription>
              </Alert>
            )}
            <p className="flex items-start gap-3 text-xs leading-6 text-muted-foreground">
              <LockKeyhole
                className="mt-1 size-4 shrink-0"
                aria-hidden="true"
              />
              Your authenticator protects your account after sign-in.
            </p>
            <div className="flex flex-col gap-4 border-t border-border pt-6">
              <p className="text-xs leading-6 text-muted-foreground">
                By continuing, you agree to our{" "}
                <Link
                  href="/terms"
                  className="font-medium text-foreground underline underline-offset-4"
                >
                  terms
                </Link>
                . Read our{" "}
                <Link
                  href="/privacy-policy"
                  className="font-medium text-foreground underline underline-offset-4"
                >
                  privacy policy
                </Link>{" "}
                to understand how we handle your information.
              </p>
              <Link
                href="/getting-started"
                className="flex min-h-11 items-center gap-2 text-sm font-medium text-primary"
              >
                New here? Read the vendor guide
                <ArrowUpRight className="size-4" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
