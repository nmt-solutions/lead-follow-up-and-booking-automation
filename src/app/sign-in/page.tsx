import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { Brand } from "@/components/brand";
import { IsometricView } from "@/components/isometric-view";
import { getServices } from "@/server/services";
import { SignInForm } from "@/components/sign-in-form";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
    <main className="page-container flex min-h-svh flex-col justify-center gap-10 py-8 sm:py-12">
      <header>
        <Brand />
      </header>
      <div className="grid items-center gap-10 lg:grid-cols-[1.15fr_1fr] lg:gap-16">
        <section className="min-w-0 space-y-6">
          <p className="eyebrow">Prospect discovery and sales follow-up</p>
          <h1 className="max-w-xl text-4xl leading-[1.1] font-semibold tracking-[-0.04em] sm:text-5xl">
            Find buyers.
            <br />
            <span className="text-primary">Keep conversations moving.</span>
          </h1>
          <p className="max-w-lg text-base leading-relaxed text-muted-foreground">
            Find potential customers for your business, review your outreach,
            and manage the replies with your team.
          </p>
          <IsometricView />
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <ArrowRight
              className="size-4 shrink-0 text-primary"
              aria-hidden="true"
            />
            Start with your business. We&apos;ll guide you through setup.
          </p>
        </section>
        <Card aria-labelledby="sign-in-title" className="w-full min-w-0">
          <CardHeader>
            <p className="eyebrow">Welcome to LeadRelay</p>
            <CardTitle id="sign-in-title" className="text-2xl">
              Sign in or get started
            </CardTitle>
            <CardDescription>
              Enter your email to receive a secure sign-in link.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {available ? (
              <SignInForm linkFailed={Boolean((await searchParams).error)} />
            ) : (
              <Alert>
                <AlertDescription>
                  Sign-in is temporarily unavailable. Please try again later.
                </AlertDescription>
              </Alert>
            )}
            <p className="mt-6 flex items-start gap-2 border-t border-border pt-5 text-sm leading-relaxed text-muted-foreground">
              <LockKeyhole
                className="mt-0.5 size-4 shrink-0"
                aria-hidden="true"
              />
              Your link expires in 10 minutes. Use the same email to return to
              your businesses.
            </p>
          </CardContent>
        </Card>
      </div>
      <footer className="text-xs text-muted-foreground">
        A product of{" "}
        <a
          href="https://nmtsolutions.in"
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-4"
        >
          NMT Solutions OPC PVT LTD
        </a>
      </footer>
    </main>
  );
}
