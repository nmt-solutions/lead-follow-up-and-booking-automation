import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Building2, LockKeyhole } from "lucide-react";
import { getServices } from "@/server/services";
import { SignInForm } from "@/components/sign-in-form";

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
  if (signedIn) redirect("/businesses");
  return (
    <main className="mx-auto flex min-h-svh max-w-5xl flex-col justify-center gap-10 px-6 py-12 sm:px-10 md:flex-row md:items-center md:gap-20">
      <section className="min-w-0 flex-1 space-y-6">
        <div className="flex items-center gap-3 text-sm font-semibold">
          <Building2 className="size-6 text-primary" aria-hidden="true" />
          Business profile
        </div>
        <h1 className="max-w-lg text-4xl leading-tight font-semibold tracking-tight sm:text-5xl">
          Your Business.
          <br />A place to begin.
        </h1>
        <p className="max-w-md text-lg leading-relaxed text-muted-foreground">
          Describe what you offer and where you work. Save your profile and come
          back to it whenever you need.
        </p>
        <p className="flex items-start gap-2 text-sm leading-relaxed text-muted-foreground">
          <LockKeyhole className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Your profile is private to your Business.
        </p>
      </section>
      <section
        aria-labelledby="sign-in-title"
        className="w-full min-w-0 rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8 md:max-w-sm"
      >
        <h2
          id="sign-in-title"
          className="mb-2 text-2xl font-semibold tracking-tight"
        >
          Sign in or get started
        </h2>
        <p className="mb-7 text-sm leading-relaxed text-muted-foreground">
          Use the same email each time to return to your saved Businesses.
        </p>
        {available ? (
          <SignInForm linkFailed={Boolean((await searchParams).error)} />
        ) : (
          <p
            role="status"
            className="rounded-lg bg-muted p-4 text-sm leading-relaxed"
          >
            Sign-in is not available yet. Please try again later.
          </p>
        )}
      </section>
    </main>
  );
}
