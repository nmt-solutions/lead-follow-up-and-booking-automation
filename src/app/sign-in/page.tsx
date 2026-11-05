import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Building2, LockKeyhole } from "lucide-react";
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
    <main className="page-container flex min-h-svh flex-col justify-center gap-10 py-10 sm:py-16 md:flex-row md:items-center md:gap-20">
      <section className="min-w-0 flex-1 space-y-6">
        <div className="inline-flex items-center gap-3 text-sm font-semibold">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Building2 className="size-5" aria-hidden="true" />
          </span>
          Business operations
        </div>
        <h1 className="max-w-lg text-4xl leading-tight font-semibold tracking-tight sm:text-5xl">
          Your Business.
          <br />
          The right people.
          <br />
          <span className="text-primary">Access you control.</span>
        </h1>
        <p className="max-w-md text-lg leading-relaxed text-muted-foreground">
          Keep your Business profile, team permissions and secure access in one
          place.
        </p>
        <p className="flex items-start gap-2 text-sm leading-relaxed text-muted-foreground">
          <LockKeyhole className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Business records stay within your team’s permissions. Owners and
          Admins verify a second factor before protected access.
        </p>
      </section>
      <Card
        aria-labelledby="sign-in-title"
        className="w-full min-w-0 md:max-w-md"
      >
        <CardHeader>
          <p className="eyebrow">Welcome to your Business</p>
          <CardTitle id="sign-in-title" className="text-2xl">
            Sign in or get started
          </CardTitle>
          <CardDescription>
            We’ll send a one-time sign-in link to your email. Then we’ll help
            you check your account security.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {available ? (
            <SignInForm linkFailed={Boolean((await searchParams).error)} />
          ) : (
            <Alert>
              <AlertDescription>
                Sign-in is not available yet. Please try again later.
              </AlertDescription>
            </Alert>
          )}
          <p className="mt-6 border-t border-border pt-5 text-xs leading-relaxed text-muted-foreground">
            Use the same email each time to return to your saved Businesses.
            Your sign-in link expires after 10 minutes.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
